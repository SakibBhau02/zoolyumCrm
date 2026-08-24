import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async list() {
    return this.cache.wrap("users:list", 300, async () => {
      const users = await this.prisma.user.findMany({
        include: {
          role: { select: { name: true } },
          employee: { select: { roleTitle: true, employmentStatus: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return users.map((u) => {
        const { passwordHash, ...safe } = u;
        return { ...safe, roleName: u.role.name };
      });
    });
  }

  async updateRole(userId: string, roleId: string) {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { roleId },
      include: { role: true },
    });
    await this.cache.del("users:list");
    return result;
  }

  async toggleActive(userId: string, isActive: boolean) {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, name: true, email: true, isActive: true },
    });
    await this.cache.del("users:list");
    return result;
  }
}
