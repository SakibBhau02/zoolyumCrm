import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
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
          project: { select: { id: true, name: true } },
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
    await this.invalidateUsers();
    return updated;
  }
}
