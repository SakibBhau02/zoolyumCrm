import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { writeSystemAudit } from "../common/system-audit";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  /**
   * Staff directory used by assignee / owner pickers.
   *
   * Explicit projection: the old `findMany` + spread returned every column
   * (lastLoginIp, tokenVersion, webauthn handles) to any signed-in role.
   */
  async list() {
    return this.cache.wrap("users:list", 300, async () => {
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
          employee: { select: { id: true, roleTitle: true, employmentStatus: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return users.map((u) => ({ ...u, roleName: u.role.name }));
    });
  }

  /**
   * Role changes must invalidate the old session immediately: the JWT carries
   * the previous role/permission matrix until it expires. Bumping tokenVersion
   * (checked by JwtAuthGuard on every request) forces a fresh login.
   */
  async updateRole(userId: string, roleId: string, actorId?: string) {
    if (!roleId) throw new BadRequestException("roleId is required");
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { id: true, name: true } } },
    });
    if (!target) throw new NotFoundException("User not found");

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new BadRequestException("Selected role does not exist");

    // Demoting the only active Owner would lock the workspace out of Control.
    if (target.role.name === "Owner" && role.name !== "Owner") {
      await this.assertNotLastOwner(userId, "demote");
    }

    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { roleId, tokenVersion: { increment: 1 } },
      select: { id: true, name: true, email: true, isActive: true, role: { select: { id: true, name: true } } },
    });
    await this.cache.del("users:list");
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "user.role_changed",
      entityType: "User",
      entityId: userId,
      before: { role: target.role.name },
      after: { role: role.name },
    });
    return result;
  }

  async toggleActive(userId: string, isActive: boolean, actorId?: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { name: true } } },
    });
    if (!target) throw new NotFoundException("User not found");
    if (target.isActive && isActive === false && target.role.name === "Owner") {
      await this.assertNotLastOwner(userId, "deactivate");
    }

    const result = await this.prisma.user.update({
      where: { id: userId },
      // Deactivating also revokes outstanding sessions; reactivating must not.
      data: { isActive, ...(isActive === false ? { tokenVersion: { increment: 1 } } : {}) },
      select: { id: true, name: true, email: true, isActive: true },
    });
    await this.cache.del("users:list");
    await writeSystemAudit(this.prisma, {
      actorId,
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "User",
      entityId: userId,
      before: { isActive: target.isActive },
      after: { isActive },
    });
    return result;
  }

  private async assertNotLastOwner(userId: string, action: string) {
    const owners = await this.prisma.user.count({
      where: { role: { name: "Owner" }, isActive: true },
    });
    if (owners <= 1) {
      throw new ForbiddenException(`Cannot ${action} the last active Owner — promote another owner first.`);
    }
    return userId;
  }
}
