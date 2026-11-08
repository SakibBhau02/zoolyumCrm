import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { PortalAccessService, PORTAL_MODULES } from "./portal-access.service";
import { TelegramService } from "./telegram.service";
import { PortalClientService } from "./portal-client.service";

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: PortalAccessService,
    private readonly telegram: TelegramService,
    private readonly client: PortalClientService
  ) {}

  private async invalidateUsers() {
    await this.cache.del("portal:users");
  }

  async users() {
    return this.cache.wrap("portal:users", 30, () =>
      this.prisma.portalUser.findMany({
        include: {
          clientContact: {
            include: { client: { select: { id: true, companyName: true } } },
          },
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    );
  }

  async activity() {
    return this.cache.wrap("portal:activity", 30, () =>
      this.prisma.portalActivityLog.findMany({
        include: {
          portalUser: {
            select: { clientContact: { select: { name: true, client: { select: { companyName: true } } } } },
          },
        },
        orderBy: { timestamp: "desc" },
        take: 20,
      })
    );
  }

  async comments() {
    return this.cache.wrap("portal:comments", 30, () =>
      this.prisma.clientComment.findMany({
        include: {
          // project is null for the client-level "general" thread.
          project: { select: { id: true, name: true } },
          client: { select: { id: true, companyName: true } },
          portalUser: { select: { clientContact: { select: { name: true } } } },
          author: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    );
  }

  async approvals() {
    return this.cache.wrap("portal:approvals", 30, () =>
      this.prisma.deliverableApproval.findMany({
        include: {
          portalUser: { select: { clientContact: { select: { name: true, client: { select: { companyName: true } } } } } },
        },
        orderBy: { decidedAt: "desc" },
        take: 20,
      })
    );
  }

  async clients() {
    return this.prisma.client.findMany({
      select: {
        id: true,
        companyName: true,
        accountOwner: { select: { id: true, name: true } },
        contacts: {
          select: {
            id: true,
            name: true,
            roleTitle: true,
            email: true,
            phone: true,
            isPrimary: true,
            portalAccessEnabled: true,
            lastPortalLogin: true,
            portalUser: { select: { id: true, isActive: true, lastLoginAt: true, createdAt: true } },
          },
          orderBy: { isPrimary: "desc" },
        },
      },
      orderBy: { companyName: "asc" },
    });
  }

  async createPortalUser(clientContactId: string, password: string) {
    if (!password || password.length < 6) {
      throw new BadRequestException("Password must be at least 6 characters");
    }
    const contact = await this.prisma.clientContact.findUnique({
      where: { id: clientContactId },
      include: { portalUser: true },
    });
    if (!contact) throw new NotFoundException("Client contact not found");
    if (contact.portalUser) throw new ConflictException("Portal user already exists for this contact");
    const portalUser = await this.prisma.portalUser.create({
      data: {
        clientContactId,
        passwordHash: await bcrypt.hash(password, 10),
        isActive: true,
      },
    });
    await this.prisma.clientContact.update({
      where: { id: clientContactId },
      data: { portalAccessEnabled: true },
    });
    await this.invalidateUsers();
    return portalUser;
  }

  async resetPortalPassword(portalUserId: string, password: string) {
    if (!password || password.length < 6) {
      throw new BadRequestException("Password must be at least 6 characters");
    }
    const portalUser = await this.prisma.portalUser.findUnique({ where: { id: portalUserId } });
    if (!portalUser) throw new NotFoundException("Portal user not found");
    const updated = await this.prisma.portalUser.update({
      where: { id: portalUserId },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    await this.invalidateUsers();
    return updated;
  }

  async setPortalAccess(portalUserId: string, isActive: boolean) {
    const portalUser = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: { clientContact: true },
    });
    if (!portalUser) throw new NotFoundException("Portal user not found");
    const updated = await this.prisma.portalUser.update({
      where: { id: portalUserId },
      data: { isActive },
    });
    await this.prisma.clientContact.update({
      where: { id: portalUser.clientContactId },
      data: { portalAccessEnabled: isActive },
    });
    await this.access.invalidate(portalUserId);
    await this.invalidateUsers();
    return updated;
  }

  // ── Communication (staff → client) ─────────────────────────────────────
  async replyToThread(
    body: { threadKey: string; content: string; parentId?: string; clientId?: string },
    authorId?: string
  ) {
    const threadKey = (body.threadKey || "general").trim();
    const content = String(body.content ?? "").trim();
    if (!content) throw new BadRequestException("Message cannot be empty");
    if (content.length > 5000) throw new BadRequestException("Message is too long");

    let projectId: string | null = null;
    let clientId = body.clientId;

    if (threadKey !== "general") {
      const project = await this.prisma.project.findUnique({
        where: { id: threadKey },
        select: { id: true, clientId: true },
      });
      if (!project) throw new NotFoundException("Project not found");
      projectId = project.id;
      clientId = project.clientId;
    }
    if (!clientId) throw new BadRequestException("clientId is required for the general thread");

    const comment = await this.prisma.clientComment.create({
      data: { threadKey, clientId, projectId, parentId: body.parentId ?? null, content, authorId },
    });

    // Notify every active portal contact who can see this thread.
    const portalUsers = await this.prisma.portalUser.findMany({
      where: { isActive: true, clientContact: { clientId } },
      select: { id: true, contactAccess: { select: { modules: true, scope: true, projectIds: true } } },
    });
    for (const pu of portalUsers) {
      const modules = pu.contactAccess?.modules?.length ? pu.contactAccess.modules : [...PORTAL_MODULES];
      if (!modules.includes("MESSAGES")) continue;
      if (projectId && pu.contactAccess?.scope === "CUSTOM" && !pu.contactAccess.projectIds.includes(projectId)) {
        continue;
      }
      await this.prisma.notification.create({
        data: {
          portalUserId: pu.id,
          type: "AGENCY_MESSAGE",
          title: "New message from your agency",
          message: content.slice(0, 140),
          link: `/portal-client?thread=${encodeURIComponent(threadKey)}`,
        },
      });
    }

    // Push the same heads-up to Telegram for contacts who linked their chat.
    await this.telegram
      .notifyClient(clientId, `💬 New message from your agency:\n\n"${content.slice(0, 300)}"`, {
        onlyLinkedToProject: projectId ?? undefined,
      })
      .catch(() => null);

    await this.cache.del("portal:comments");
    return comment;
  }

  // ── Task visibility (per-task toggle + bulk) ───────────────────────────
  async setTaskVisibility(taskId: string, isClientVisible: boolean) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { isClientVisible },
      select: { id: true, isClientVisible: true, projectId: true },
    });
    await this.cache.del("dashboard:overview");
    return updated;
  }

  async bulkTaskVisibility(projectId: string, visible: boolean) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
    const result = await this.prisma.task.updateMany({
      where: { projectId, archivedAt: null },
      data: { isClientVisible: visible },
    });
    return { updated: result.count, isClientVisible: visible };
  }

  /** Which active projects have no client-visible task — drives the staff warning. */
  async visibilityAudit() {
    const projects = await this.prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      select: {
        id: true,
        name: true,
        clientId: true,
        client: { select: { companyName: true } },
        tasks: { where: { archivedAt: null }, select: { id: true, isClientVisible: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return projects
      .map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.client.companyName,
        totalTasks: p.tasks.length,
        visibleTasks: p.tasks.filter((t) => t.isClientVisible).length,
      }))
      .filter((p) => p.totalTasks > 0);
  }

  // ── Per-contact access ─────────────────────────────────────────────────
  async contactAccess(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: {
        contactAccess: true,
        clientContact: {
          select: {
            id: true,
            name: true,
            email: true,
            clientId: true,
            client: { select: { companyName: true, projects: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!pu) throw new NotFoundException("Portal user not found");
    const a = pu.contactAccess;
    return {
      portalUserId: pu.id,
      contact: {
        id: pu.clientContact.id,
        name: pu.clientContact.name,
        email: pu.clientContact.email,
        clientId: pu.clientContact.clientId,
        clientName: pu.clientContact.client.companyName,
      },
      availableProjects: pu.clientContact.client.projects,
      access: {
        scope: a?.scope ?? "ALL",
        projectIds: a?.projectIds ?? [],
        modules: a?.modules?.length ? a.modules : [...PORTAL_MODULES],
        canSeeAdSpend: a?.canSeeAdSpend ?? true,
      },
    };
  }

  async updateContactAccess(    portalUserId: string,
    dto: { scope?: "ALL" | "CUSTOM"; projectIds?: string[]; modules?: string[]; canSeeAdSpend?: boolean }
  ) {
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: { clientContact: { select: { clientId: true } } },
    });
    if (!pu) throw new NotFoundException("Portal user not found");

    const scope: "ALL" | "CUSTOM" | undefined =
      dto.scope === "CUSTOM" ? "CUSTOM" : dto.scope === "ALL" ? "ALL" : undefined;
    let projectIds = dto.projectIds;
    if (projectIds) {
      // Only projects belonging to this client may be granted.
      const owned = await this.prisma.project.findMany({
        where: { clientId: pu.clientContact.clientId, id: { in: projectIds } },
        select: { id: true },
      });
      projectIds = owned.map((p) => p.id);
    }
    const modules = dto.modules?.filter((m) => (PORTAL_MODULES as readonly string[]).includes(m));

    const data = {
      ...(scope ? { scope } : {}),
      ...(projectIds ? { projectIds } : {}),
      ...(modules ? { modules } : {}),
      ...(dto.canSeeAdSpend !== undefined ? { canSeeAdSpend: dto.canSeeAdSpend } : {}),
    };

    const saved = await this.prisma.portalContactAccess.upsert({
      where: { portalUserId },
      create: {
        portalUserId,
        scope: scope ?? "ALL",
        projectIds: projectIds ?? [],
        modules: modules ?? [...PORTAL_MODULES],
        canSeeAdSpend: dto.canSeeAdSpend ?? true,
      },
      update: data,
    });
    await this.access.invalidate(portalUserId);
    return saved;
  }

  /**
   * "Preview as client" — resolves the contact's real permission envelope and
   * renders exactly what they would see, without issuing a token or logging in
   * as them.
   */
  async preview(portalUserId: string) {
    const scope = await this.access.resolve(portalUserId);
    const [overview, tasks] = await Promise.all([
      this.client.overview(scope).catch((e) => ({ error: e?.message ?? "unavailable" })),
      this.client.tasks(scope, { pageSize: "20" }).catch((e) => ({ error: e?.message ?? "unavailable" })),
    ]);
    return {
      scope: {
        clientName: scope.clientName,
        contactName: scope.contactName,
        modules: scope.modules,
        projectIds: scope.projectIds,
        canSeeAdSpend: scope.canSeeAdSpend,
      },
      overview,
      tasks,
    };
  }
}
