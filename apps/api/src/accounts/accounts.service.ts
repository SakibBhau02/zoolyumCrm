import { Injectable, NotFoundException } from "@nestjs/common";
import { BillingCycleType, HealthLevel, Vertical } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export interface ClientUpdateBody {
  companyName?: string;
  industryVertical?: Vertical;
  accountOwnerId?: string;
  billingCycleType?: BillingCycleType;
  currencyPreference?: string;
  contractStartDate?: string | null;
  renewalDate?: string | null;
  notes?: string;
}

export interface CreateClientBody extends ClientUpdateBody {
  companyName: string;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // ── Health engine ───────────────────────────────────────────────────────
  async recomputeHealth(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        invoices: { select: { status: true, dueDate: true } },
        projects: { select: { healthStatus: true, status: true } },
        churnFlags: {
          where: { flaggedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
          select: { riskLevel: true },
        },
        contacts: { select: { id: true } },
      },
    });
    if (!client) throw new NotFoundException("Client not found");

    let score = 75;
    const drivers: string[] = [];

    const overdue = client.invoices.filter((i) => i.status === "OVERDUE").length;
    if (overdue > 0) {
      score -= Math.min(overdue * 10, 25);
      drivers.push(`${overdue} overdue invoice${overdue > 1 ? "s" : ""}`);
    }

    const atRiskProjects = client.projects.filter(
      (p) => p.healthStatus !== "ON_TRACK" && p.status !== "COMPLETED" && p.status !== "ARCHIVED"
    );
    if (atRiskProjects.length) {
      score -= Math.min(atRiskProjects.length * 8, 20);
      drivers.push(`${atRiskProjects.length} project${atRiskProjects.length > 1 ? "s" : ""} at risk`);
    }

    const activeProjects = client.projects.filter((p) => p.status === "ACTIVE").length;
    if (activeProjects >= 2) score += 5;
    else if (activeProjects === 0) {
      score -= 5;
      drivers.push("no active projects");
    }

    if (client.churnFlags.length) {
      score -= 10;
      drivers.push("churn pattern flagged");
    }

    if (client.contacts.length >= 2) score += 3;
    else if (client.contacts.length === 0) {
      score -= 4;
      drivers.push("no contacts");
    }

    score = clamp(Math.round(score), 0, 100);
    const level: HealthLevel = score >= 70 ? "GREEN" : score >= 40 ? "YELLOW" : "RED";
    const driverSummary = drivers.join(" · ") || "healthy";

    await this.prisma.clientHealthLog.create({
      data: { clientId, score, driverSummary },
    });
    await this.prisma.client.update({
      where: { id: clientId },
      data: { healthScore: score, healthLevel: level, healthDriver: driverSummary },
    });

    await this.invalidateClients();

    return { id: clientId, score, level, drivers: drivers.length ? drivers : ["healthy"] };
  }

  async recomputeAll() {
    const clients = await this.prisma.client.findMany({ select: { id: true } });
    const results = [];
    for (const c of clients) {
      results.push(await this.recomputeHealth(c.id));
    }
    return results;
  }

  // ── Overview / stats ────────────────────────────────────────────────────
  async overview() {
    return this.cache.wrap("accounts:overview", 30, async () => {
      const [clients, flags] = await Promise.all([
        this.prisma.client.findMany({
          include: { accountOwner: { select: { id: true, name: true } } },
        }),
        this.prisma.churnRiskFlag.findMany({
          where: { flaggedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
          distinct: ["clientId"],
          select: { clientId: true },
        }),
      ]);

      const dist = { GREEN: 0, YELLOW: 0, RED: 0 };
      for (const c of clients) dist[c.healthLevel] = (dist[c.healthLevel] ?? 0) + 1;

      const now = new Date();
      const in30 = new Date(Date.now() + 30 * 86400000);
      const renewals = clients.filter(
        (c) => c.renewalDate && c.renewalDate >= now && c.renewalDate <= in30
      );
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      return {
        totalClients: clients.length,
        avgHealth: clients.length ? Math.round(clients.reduce((s, c) => s + (c.healthScore ?? 0), 0) / clients.length) : null,
        distribution: dist,
        renewalsNext30: renewals.map((c) => ({ id: c.id, companyName: c.companyName, renewalDate: c.renewalDate })),
        atRiskCount: dist.RED + dist.YELLOW,
        newThisMonth: clients.filter((c) => c.createdAt >= monthStart).length,
        churnFlagged: new Set(flags.map((f) => f.clientId)).size,
      };
    });
  }

  async healthDistribution() {
    const clients = await this.prisma.client.findMany({
      select: { healthLevel: true, healthScore: true, companyName: true, id: true },
    });
    const dist = { GREEN: 0, YELLOW: 0, RED: 0 };
    for (const c of clients) dist[c.healthLevel] = (dist[c.healthLevel] ?? 0) + 1;
    return { distribution: dist, clients };
  }

  // ── Financial summary ─────────────────────────────────────────────────
  private async financialSummary(ids: string[]) {
    if (!ids.length) return new Map<string, { totalInvoiced: number; totalPaid: number; totalDue: number }>();
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: { in: ids } },
      select: {
        clientId: true,
        lineItems: { select: { amount: true } },
        payments: { select: { amount: true, type: true } },
      },
    });
    const map = new Map<string, { totalInvoiced: number; totalPaid: number; totalDue: number }>();
    for (const inv of invoices) {
      const cur = map.get(inv.clientId) ?? { totalInvoiced: 0, totalPaid: 0, totalDue: 0 };
      const total = inv.lineItems.reduce((s, li) => s + Number(li.amount), 0);
      const paid = inv.payments.reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
      cur.totalInvoiced += total;
      cur.totalPaid += Math.max(0, paid);
      cur.totalDue += Math.max(0, total - paid);
      map.set(inv.clientId, cur);
    }
    return map;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  async list(query: { q?: string; health?: string; vertical?: string; ownerId?: string }) {
    const clients = await this.cache.wrapQuery("accounts:list", query, 30, () =>
      this.prisma.client.findMany({
        where: {
          ...(query.q ? { companyName: { contains: query.q, mode: "insensitive" } } : {}),
          ...(query.health ? { healthLevel: query.health as any } : {}),
          ...(query.vertical ? { industryVertical: query.vertical as any } : {}),
          ...(query.ownerId ? { accountOwnerId: query.ownerId } : {}),
        },
        include: {
          accountOwner: { select: { id: true, name: true } },
          _count: { select: { projects: true, invoices: true, contacts: true } },
        },
        orderBy: [{ healthScore: "desc" }, { createdAt: "desc" }],
      })
    );
    const summary = await this.financialSummary(clients.map((c) => c.id));
    return clients.map((c) => ({ ...c, ...(summary.get(c.id) ?? { totalInvoiced: 0, totalPaid: 0, totalDue: 0 }) }));
  }

  async detail(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        accountOwner: { select: { id: true, name: true } },
        contacts: { include: { portalUser: { select: { lastLoginAt: true, isActive: true } } } },
        documents: { include: { uploadedBy: { select: { name: true } } } },
        healthLogs: { orderBy: { recordedAt: "desc" }, take: 10 },
        churnFlags: { orderBy: { flaggedAt: "desc" }, take: 5 },
        projects: {
          select: {
            id: true, name: true, status: true, healthStatus: true,
            riskScore: true, budgetAmount: true, targetEndDate: true,
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        },
        invoices: {
          select: {
            id: true, invoiceNumber: true, status: true, issueDate: true,
            dueDate: true, lineItems: { select: { amount: true, revenueTag: true } },
            payments: { select: { amount: true, type: true } },
          },
          orderBy: { issueDate: "desc" },
          take: 8,
        },
      },
    });
    if (!client) throw new NotFoundException("Client not found");

    let totalInvoiced = 0;
    let totalPaid = 0;
    const invoices = client.invoices.map((inv) => {
      const total = inv.lineItems.reduce((s, li) => s + Number(li.amount), 0);
      const paid = inv.payments.reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
      totalInvoiced += total;
      totalPaid += Math.max(0, paid);
      return { ...inv, total, paid };
    });

    const payments = await this.prisma.payment.findMany({
      where: { invoice: { clientId: id }, type: "IN" },
      select: {
        id: true, amount: true, paymentMethod: true, paymentDate: true, referenceId: true,
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { paymentDate: "desc" },
      take: 5,
    });

    return {
      ...client,
      invoices,
      payments,
      totalInvoiced,
      totalPaid,
      totalDue: Math.max(0, totalInvoiced - totalPaid),
    };
  }

  async create(body: CreateClientBody) {
    const client = await this.prisma.client.create({
      data: {
        companyName: body.companyName,
        industryVertical: body.industryVertical ?? "OTHER",
        accountOwnerId: body.accountOwnerId || undefined,
        billingCycleType: body.billingCycleType ?? "PROJECT_BASED",
        currencyPreference: body.currencyPreference ?? "BDT",
        contractStartDate: body.contractStartDate ? new Date(body.contractStartDate) : undefined,
        renewalDate: body.renewalDate ? new Date(body.renewalDate) : undefined,
        notes: body.notes,
        healthScore: 75,
        healthLevel: "GREEN",
      },
    });
    await this.recomputeHealth(client.id);
    await this.invalidateClients();
    return this.detail(client.id);
  }

  async update(id: string, body: ClientUpdateBody) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException("Client not found");

    await this.prisma.client.update({
      where: { id },
      data: {
        companyName: body.companyName,
        industryVertical: body.industryVertical,
        accountOwnerId: body.accountOwnerId || undefined,
        billingCycleType: body.billingCycleType,
        currencyPreference: body.currencyPreference,
        contractStartDate: body.contractStartDate === null ? null : body.contractStartDate ? new Date(body.contractStartDate) : undefined,
        renewalDate: body.renewalDate === null ? null : body.renewalDate ? new Date(body.renewalDate) : undefined,
        notes: body.notes,
      },
    });
    await this.recomputeHealth(id);
    await this.invalidateClients();
    return this.detail(id);
  }

  async remove(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException("Client not found");
    await this.prisma.client.delete({ where: { id } });
    await this.invalidateClients();
    return { deleted: true };
  }

  private async invalidateClients() {
    await this.cache.del("accounts:overview");
    await this.cache.delPattern("accounts:list:*");
    await this.cache.del("insight:client-health");
    await this.cache.del("insight:overview");
    await this.cache.del("dashboard:overview");
  }

  // ── Contacts ────────────────────────────────────────────────────────────
  async addContact(id: string, body: { name: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }) {
    await this.ensureClient(id);
    const contact = await this.prisma.clientContact.create({
      data: { clientId: id, name: body.name, roleTitle: body.roleTitle, email: body.email, phone: body.phone, isPrimary: body.isPrimary ?? false },
    });
    await this.recomputeHealth(id);
    return contact;
  }

  async updateContact(clientId: string, contactId: string, body: { name?: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }) {
    const contact = await this.prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
    if (!contact) throw new NotFoundException("Contact not found");
    if (body.isPrimary) {
      await this.prisma.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    const updated = await this.prisma.clientContact.update({
      where: { id: contactId },
      data: {
        name: body.name,
        roleTitle: body.roleTitle,
        email: body.email,
        phone: body.phone,
        isPrimary: body.isPrimary,
      },
    });
    await this.recomputeHealth(clientId);
    return updated;
  }

  async removeContact(clientId: string, contactId: string) {
    await this.prisma.clientContact.delete({ where: { id: contactId, clientId } }).catch(() => {
      throw new NotFoundException("Contact not found");
    });
    await this.recomputeHealth(clientId);
    return { deleted: true };
  }

  // ── Documents ───────────────────────────────────────────────────────────
  async addDocument(id: string, body: { type: string; fileUrl: string }, uploadedById?: string) {
    await this.ensureClient(id);
    return this.prisma.clientDocument.create({
      data: { clientId: id, type: body.type as any, fileUrl: body.fileUrl, uploadedById },
      include: { uploadedBy: { select: { name: true } } },
    });
  }

  async removeDocument(clientId: string, docId: string) {
    await this.prisma.clientDocument.delete({ where: { id: docId, clientId } }).catch(() => {
      throw new NotFoundException("Document not found");
    });
    return { deleted: true };
  }

  private async ensureClient(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }
}