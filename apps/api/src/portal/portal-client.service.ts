import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class PortalClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService
  ) {}

  private async invalidatePortal() {
    await this.cache.del("portal:comments");
    await this.cache.del("portal:approvals");
    await this.cache.del("portal:activity");
  }

  /** Public-safe company branding for portal invoice / receipt PDFs. */
  async branding() {
    const b = await this.prisma.brandingConfig.findFirst();
    if (!b) return null;
    const { id, updatedAt, ...rest } = b as any;
    return rest;
  }

  async login(email: string, password: string) {
    const contact = await this.prisma.clientContact.findFirst({
      where: { email: email.toLowerCase().trim(), portalAccessEnabled: true },
      include: { portalUser: true, client: { select: { id: true, companyName: true } } },
    });
    if (!contact?.portalUser || !contact.portalUser.isActive) {
      throw new UnauthorizedException("Invalid portal credentials");
    }
    const valid = await bcrypt.compare(password, contact.portalUser.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid portal credentials");

    await this.prisma.portalUser.update({
      where: { id: contact.portalUser.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.clientContact.update({ where: { id: contact.id }, data: { lastPortalLogin: new Date() } });
    await this.prisma.portalActivityLog.create({
      data: { portalUserId: contact.portalUser.id, action: "LOGGED_IN" },
    });

    return {
      portalToken: await this.jwt.signAsync({ sub: contact.portalUser.id, scope: "portal", clientId: contact.clientId }),
      portalUser: {
        id: contact.portalUser.id,
        name: contact.name,
        email: contact.email,
        clientId: contact.clientId,
        clientName: contact.client.companyName,
      },
    };
  }

  async me(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: {
        clientContact: { include: { client: { select: { id: true, companyName: true } } } },
      },
    });
    if (!pu) throw new UnauthorizedException();
    return {
      id: pu.id,
      name: pu.clientContact.name,
      email: pu.clientContact.email,
      clientId: pu.clientContact.clientId,
      clientName: pu.clientContact.client.companyName,
      lastLoginAt: pu.lastLoginAt,
    };
  }

  async dashboard(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: {
        clientContact: {
          include: {
            client: { select: { id: true, companyName: true, accountOwnerId: true } },
          },
        },
      },
    });
    if (!pu) throw new UnauthorizedException();
    const clientId = pu.clientContact.clientId;
    const [projects, invoices, visibleTasks] = await Promise.all([
      this.prisma.project.findMany({
        where: { clientId },
        include: {
          milestones: true,
          assignedPm: { select: { id: true, name: true, email: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.invoice.findMany({
        where: { clientId },
        include: { lineItems: true, payments: true },
        orderBy: { issueDate: "desc" },
      }),
      this.prisma.task.findMany({
        where: { project: { clientId }, isClientVisible: true },
        select: { status: true },
      }),
    ]);
    const active = projects.filter((p) => p.status === "ACTIVE" || p.status === "PLANNING");
    const pendingInvoices = invoices.filter((i) => !["PAID", "CANCELLED", "VOID"].includes(i.status));
    const sumLines = (i: any) => i.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paidOf = (i: any) => i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const nextMilestone = active
      .flatMap((p) => p.milestones.filter((m) => m.status !== "COMPLETED").map((m) => ({ ...m, projectName: p.name })))
      .sort((a, b) => (a.dueDate ?? Infinity as any) - (b.dueDate ?? Infinity as any))[0] ?? null;
    const accountOwner = pu.clientContact.client?.accountOwnerId
      ? await this.prisma.user.findUnique({
          where: { id: pu.clientContact.client.accountOwnerId },
          select: { id: true, name: true, email: true, employee: { select: { phone: true } } },
        })
      : null;
    const pms = await this.prisma.user.findMany({
      where: { id: { in: projects.map((p) => p.assignedPmId).filter(Boolean) as string[] } },
      select: { id: true, name: true, email: true, employee: { select: { phone: true } } },
    });
    const teamMap = new Map<string, { id: string; name: string; email: string; phone: string | null; role: string }>();
    if (accountOwner) teamMap.set(accountOwner.id, { ...accountOwner, phone: accountOwner.employee?.phone ?? null, role: "Account Manager" });
    for (const pm of pms) {
      const existing = teamMap.get(pm.id);
      const entry = { id: pm.id, name: pm.name, email: pm.email, phone: pm.employee?.phone ?? null, role: "Project Manager" };
      teamMap.set(pm.id, existing ? { ...existing, role: "Account & Project Manager" } : entry);
    }
    const team = Array.from(teamMap.values());
    const totalInvoiced = invoices.reduce((s, i) => s + sumLines(i), 0);
    const totalCollected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const isDone = (s: string) => ["DONE", "COMPLETED"].includes(s);
    return {
      clientName: pu.clientContact.client?.companyName ?? "",
      activeProjectCount: active.length,
      pendingInvoiceCount: pendingInvoices.length,
      pendingInvoiceValue: pendingInvoices.reduce((s, i) => s + Math.max(sumLines(i) - paidOf(i), 0), 0),
      billingSummary: {
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        totalOutstanding: Math.round(Math.max(totalInvoiced - totalCollected, 0) * 100) / 100,
      },
      taskStats: {
        total: visibleTasks.length,
        done: visibleTasks.filter((t) => isDone(t.status)).length,
        inProgress: visibleTasks.filter((t) => t.status === "IN_PROGRESS").length,
        todo: visibleTasks.filter((t) => t.status === "TODO").length,
      },
      team,
      nextMilestone: nextMilestone ? { name: nextMilestone.name, dueDate: nextMilestone.dueDate, projectName: nextMilestone.projectName } : null,
      projects: active.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        billingType: p.billingType,
        progress: p.milestones.length ? Math.round((p.milestones.filter((m) => m.status === "COMPLETED").length / p.milestones.length) * 100) : 0,
        nextMilestone: p.milestones.filter((m) => m.status !== "COMPLETED").sort((a, b) => (a.dueDate ?? Infinity as any) - (b.dueDate ?? Infinity as any))[0]?.dueDate ?? null,
      })),
      invoices: invoices.slice(0, 5).map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        amount: Math.round(sumLines(i) * 100) / 100,
        paid: Math.round(paidOf(i) * 100) / 100,
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
      })),
    };
  }

  async projects(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({ where: { id: portalUserId }, include: { clientContact: true } });
    if (!pu) throw new UnauthorizedException();
    return this.prisma.project.findMany({
      where: { clientId: pu.clientContact.clientId },
      include: {
        milestones: { orderBy: { dueDate: "asc" } },
        files: { orderBy: { uploadedAt: "desc" } },
        assignedPm: { select: { id: true, name: true, email: true, employee: { select: { phone: true } } } },
        client: { select: { accountOwner: { select: { id: true, name: true, email: true, employee: { select: { phone: true } } } } } },
        tasks: {
          where: { isClientVisible: true },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignedTo: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { tasks: true, comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async invoices(portalUserId: string) {    const pu = await this.prisma.portalUser.findUnique({ where: { id: portalUserId }, include: { clientContact: true } });
    if (!pu) throw new UnauthorizedException();
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: pu.clientContact.clientId },
      include: {
        lineItems: true,
        payments: { orderBy: { paymentDate: "desc" } },
        installments: { orderBy: { sequence: "asc" } },
        project: { select: { id: true, name: true } },
        client: {
          select: {
            companyName: true,
            contacts: { select: { name: true, email: true, phone: true, roleTitle: true }, take: 3 },
          },
        },
      },
      orderBy: { issueDate: "desc" },
    });
    const totalsOf = (i: any) => {
      const subtotal = i.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
      const tax = i.taxApplicable && i.taxRate ? (subtotal * Number(i.taxRate)) / 100 : 0;
      const discount = i.discountRate ? (subtotal * Number(i.discountRate)) / 100 : 0;
      const shipping = Number(i.shippingFee ?? 0);
      const grand = Math.max(0, subtotal + tax - discount + shipping);
      const paid = i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
      return { subtotal, tax, discount, shipping, grand, paid, balance: Math.max(grand - paid, 0) };
    };
    const sumLines = (i: any) => totalsOf(i).grand;
    const paidOf = (i: any) => i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const totalInvoiced = invoices.reduce((s, i) => s + sumLines(i), 0);
    const totalCollected = invoices.reduce((s, i) => s + paidOf(i), 0);
    return {
      summary: {
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        totalOutstanding: Math.round(Math.max(totalInvoiced - totalCollected, 0) * 100) / 100,
      },
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        status: i.status,
        amount: Math.round(totalsOf(i).grand * 100) / 100,
        paid: Math.round(paidOf(i) * 100) / 100,
        balance: Math.round(totalsOf(i).balance * 100) / 100,
        currency: i.currency,
        taxApplicable: i.taxApplicable,
        taxRate: Number(i.taxRate ?? 0),
        discountRate: Number((i as any).discountRate ?? 0),
        shippingFee: Number((i as any).shippingFee ?? 0),
        templateStyle: (i as any).templateStyle ?? "modern-orange",
        terms: (i as any).terms ?? null,
        notes: i.notes,
        project: i.project ? { id: i.project.id, name: i.project.name } : null,
        client: {
          companyName: i.client.companyName,
          contacts: i.client.contacts,
        },
        lines: i.lineItems.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          amount: Number(l.amount),
        })),
        payments: (() => {
          // chronological serials (earliest = 1, stable ties) — matches staff app + PDFs
          const chrono = [...i.payments].sort((a: any, b: any) =>
            +new Date(a.paymentDate) - +new Date(b.paymentDate) ||
            +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0) ||
            String(a.id).localeCompare(String(b.id)));
          return i.payments.map((p) => {
            const serial = chrono.findIndex((x: any) => x.id === p.id) + 1;
            return {
              id: p.id,
              amount: Number(p.amount),
              paymentMethod: p.paymentMethod,
              referenceId: p.referenceId,
              serial,
              receiptNo: p.referenceId ?? `${i.invoiceNumber}-P${serial}`,
              paymentDate: p.paymentDate,
            };
          });
        })(),
        installments: i.installments.map((s) => ({
          sequence: s.sequence,
          amount: Number(s.amount),
          paidAmount: Number(s.paidAmount),
          dueDate: s.dueDate,
          status: s.status,
        })),
      })),
    };
  }

  async activity(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({ where: { id: portalUserId }, include: { clientContact: true } });
    if (!pu) throw new UnauthorizedException();
    const logs = await this.prisma.portalActivityLog.findMany({
      where: { portalUserId },
      include: {
        portalUser: { select: { clientContact: { select: { name: true } } } },
      },
      orderBy: { timestamp: "desc" },
      take: 30,
    });
    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      relatedEntityType: l.relatedEntityType,
      relatedEntityId: l.relatedEntityId,
      timestamp: l.timestamp,
    }));
  }

  async messages(portalUserId: string, projectId?: string) {
    const pu = await this.prisma.portalUser.findUnique({ where: { id: portalUserId }, include: { clientContact: true } });
    if (!pu) throw new UnauthorizedException();
    return this.prisma.clientComment.findMany({
      where: {
        project: { clientId: pu.clientContact.clientId },
        ...(projectId ? { projectId } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
        portalUser: { select: { clientContact: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async postMessage(portalUserId: string, projectId: string, content: string) {
    const comment = await this.prisma.clientComment.create({
      data: { projectId, content, portalUserId },
      include: { portalUser: { select: { clientContact: { select: { name: true } } } } },
    });
    await this.prisma.portalActivityLog.create({
      data: { portalUserId, action: "COMMENTED", relatedEntityType: "Project", relatedEntityId: projectId },
    });
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, assignedPmId: true },
      });
      if (project?.assignedPmId) {
        await this.notifications.create(
          project.assignedPmId,
          "CLIENT_MESSAGE",
          "New client message",
          `${comment.portalUser?.clientContact?.name ?? "Client"} commented on "${project.name}".`,
          "/flow"
        );
      }
    } catch {}
    await this.invalidatePortal();
    return comment;
  }

  async approveDeliverable(portalUserId: string, fileId: string, decision: "APPROVED" | "REVISION_REQUESTED", revisionNotes?: string) {
    const file = await this.prisma.projectFile.findUnique({
      where: { id: fileId },
      include: { project: { select: { clientId: true } } },
    });
    if (!file) throw new NotFoundException("File not found");
    const pu = await this.prisma.portalUser.findUnique({ where: { id: portalUserId }, include: { clientContact: true } });
    if (!pu || file.project.clientId !== pu.clientContact.clientId) throw new UnauthorizedException();
    const approval = await this.prisma.deliverableApproval.create({
      data: { projectFileId: fileId, portalUserId, decision, revisionNotes },
    });
    await this.prisma.projectFile.update({
      where: { id: fileId },
      data: { approvalStatus: decision === "APPROVED" ? "APPROVED" : "REVISION_REQUESTED" },
    });
    await this.prisma.portalActivityLog.create({
      data: { portalUserId, action: "APPROVED_DELIVERABLE", relatedEntityType: "ProjectFile", relatedEntityId: fileId },
    });
    try {
      const proj = await this.prisma.project.findUnique({
        where: { id: file.projectId },
        select: { name: true, assignedPmId: true },
      });
      if (proj?.assignedPmId) {
        await this.notifications.create(
          proj.assignedPmId,
          "CLIENT_MESSAGE",
          decision === "APPROVED" ? "Client approved a file" : "Client requested revision",
          `${pu.clientContact?.name ?? "Client"} ${decision === "APPROVED" ? "approved" : "requested changes on"} a file in "${proj.name}".`,
          "/flow"
        );
      }
    } catch {}
    await this.invalidatePortal();
    return approval;
  }
}