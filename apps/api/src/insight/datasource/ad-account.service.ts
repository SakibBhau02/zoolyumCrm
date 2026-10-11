import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

function encryptMaybe(v?: string | null) {
  if (!v) return null;
  return Buffer.from(v).toString("base64");
}
function decryptMaybe(v?: string | null) {
  if (!v) return null;
  try { return Buffer.from(v, "base64").toString("utf8"); } catch { return v; }
}

@Injectable()
export class AdAccountService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  async list(query: { clientId?: string; provider?: string }) {
    return this.prisma.adAccount.findMany({
      where: {
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.provider ? { provider: query.provider as any } : {}),
      },
      include: { client: { select: { id: true, companyName: true } }, _count: { select: { campaigns: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string) {
    const acc = await this.prisma.adAccount.findUnique({
      where: { id },
      include: { client: { select: { id: true, companyName: true } }, campaigns: { include: { adSets: { include: { ads: true } } } } },
    });
    if (!acc) throw new NotFoundException("Ad account not found");
    return { ...acc, credentialsEnc: acc.credentialsEnc ? "***" : null };
  }

  async create(body: { clientId?: string; provider: string; externalId: string; name: string; credentialsEnc?: string }) {
    if (!body.provider || !body.externalId || !body.name) throw new ConflictException("provider, externalId, name required");
    const provider = body.provider.toUpperCase() as any;
    if (!["GOOGLE", "META"].includes(provider)) throw new ConflictException("provider must be GOOGLE or META");
    const exists = await this.prisma.adAccount.findUnique({ where: { provider_externalId: { provider, externalId: body.externalId } } as any }).catch(() => null);
    if (exists) throw new ConflictException("Ad account with this provider+externalId already exists");
    if (body.clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: body.clientId } });
      if (!client) throw new NotFoundException("Client not found");
    }
    const created = await this.prisma.adAccount.create({
      data: {
        clientId: body.clientId || null,
        provider,
        externalId: body.externalId,
        name: body.name,
        credentialsEnc: encryptMaybe(body.credentialsEnc),
      },
    });
    await this.cache.delPattern("insight:ads:*");
    await this.cache.delPattern("insight:reports:*");
    return created;
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.adAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ad account not found");
    if (body.clientId !== undefined && body.clientId) {
      const c = await this.prisma.client.findUnique({ where: { id: body.clientId } });
      if (!c) throw new NotFoundException("Client not found");
    }
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.clientId !== undefined) data.clientId = body.clientId || null;
    if (body.status !== undefined) data.status = body.status;
    if (body.credentialsEnc !== undefined) data.credentialsEnc = encryptMaybe(body.credentialsEnc);
    if (body.externalId !== undefined) data.externalId = body.externalId;
    const updated = await this.prisma.adAccount.update({ where: { id }, data });
    await this.cache.delPattern("insight:ads:*");
    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.adAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ad account not found");
    await this.prisma.adAccount.delete({ where: { id } });
    await this.cache.delPattern("insight:ads:*");
    return { deleted: true };
  }

  async health() {
    const accounts = await this.prisma.adAccount.findMany({
      select: { id: true, name: true, provider: true, externalId: true, status: true, lastSyncAt: true, clientId: true, client: { select: { companyName: true } } },
      orderBy: { lastSyncAt: "desc" },
    });
    const logs = await this.prisma.adSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { adAccount: { select: { name: true, provider: true } } } });
    return { accounts, recentLogs: logs };
  }
}
