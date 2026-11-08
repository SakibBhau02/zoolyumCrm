import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

export const PORTAL_MODULES = ["WORK", "PERFORMANCE", "MESSAGES", "FILES", "BILLING"] as const;
export type PortalModule = (typeof PORTAL_MODULES)[number];

/**
 * Everything a portal request is allowed to touch, derived from the token only.
 * `clientId` is never taken from a query string or body — a client cannot ask
 * for another client's data by changing a parameter.
 */
export type PortalScope = {
  portalUserId: string;
  clientContactId: string;
  clientId: string;
  clientName: string;
  contactName: string;
  contactEmail: string | null;
  modules: PortalModule[];
  /** null = every project of the client. */
  projectIds: string[] | null;
  canSeeAdSpend: boolean;
};

@Injectable()
export class PortalAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  private key(portalUserId: string) {
    return `portal:scope:${portalUserId}`;
  }

  async resolve(portalUserId: string): Promise<PortalScope> {
    const cached = await this.cache.get<PortalScope>(this.key(portalUserId));
    if (cached) return cached;

    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: {
        contactAccess: true,
        clientContact: {
          include: { client: { select: { id: true, companyName: true } } },
        },
      },
    });
    if (!pu || !pu.isActive) throw new UnauthorizedException("Portal account is not active");

    const access = pu.contactAccess;
    const modules = (access?.modules?.length ? access.modules : [...PORTAL_MODULES]) as PortalModule[];
    const scope: PortalScope = {
      portalUserId,
      clientContactId: pu.clientContactId,
      clientId: pu.clientContact.clientId,
      clientName: pu.clientContact.client.companyName,
      contactName: pu.clientContact.name,
      contactEmail: pu.clientContact.email,
      modules,
      projectIds: access?.scope === "CUSTOM" ? access.projectIds : null,
      canSeeAdSpend: access?.canSeeAdSpend ?? true,
    };

    await this.cache.set(this.key(portalUserId), scope, 60);
    return scope;
  }

  async invalidate(portalUserId: string) {
    await this.cache.del(this.key(portalUserId));
  }

  /** Throws 403 when the contact has this tab disabled. */
  requireModule(scope: PortalScope, module: PortalModule) {
    if (!scope.modules.includes(module)) {
      throw new ForbiddenException(`You do not have access to the ${module.toLowerCase()} section`);
    }
  }

  /** Prisma filter for the projects this contact may see. */
  projectWhere(scope: PortalScope): Prisma.ProjectWhereInput {
    return scope.projectIds ? { id: { in: scope.projectIds } } : {};
  }

  /** Returns the ids to filter project-scoped rows by, or null when unrestricted. */
  projectIdFilter(scope: PortalScope): string[] | null {
    return scope.projectIds;
  }

  /** 404 (not 403) so a client cannot probe which project ids exist. */
  assertProjectId(scope: PortalScope, projectId: string) {
    if (scope.projectIds && !scope.projectIds.includes(projectId)) {
      throw new NotFoundException("Project not found");
    }
  }

  async assertProjectOwned(scope: PortalScope, projectId: string) {
    this.assertProjectId(scope, projectId);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId: scope.clientId, ...this.projectWhere(scope) },
      select: { id: true, name: true, clientId: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }
}
