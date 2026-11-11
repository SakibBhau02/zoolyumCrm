import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BillingCycleType, ClientCategory, HealthLevel, Vertical } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { ScoringService } from "../scoring/scoring.service";
import { isReceivable, invoiceTotals } from "../capital/finance-kernel";
import { summariseDollarSales } from "../common/dollar-purchases";

interface ClientFinancials {
  totalInvoiced: number;
  totalPaid: number;
  totalDue: number;
  overdueCount: number;
  overdueAmount: number;
  openInvoiceCount: number;
  draftAmount: number;
  draftCount: number;
  lastInvoiceDate: string | null;
}

// Mirrors the Prisma enums. Validating here turns a bad payload into a 400 with
// a readable message instead of a Prisma validation 500.
const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const CATEGORIES = ["ACTIVE", "ON_HOLD", "ARCHIVED"];
const BILLING_CYCLES = ["PROJECT_BASED", "MONTHLY_RETAINER", "ONE_TIME"];
const DOC_TYPES = ["MOU", "PROPOSAL", "BRAND_ASSET", "CREDENTIAL"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertEnum(field: string, value: unknown, allowed: string[]) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(String(value))) {
    throw new BadRequestException(`${field} must be one of ${allowed.join(", ")}`);
  }
}

/** Only real web links may be stored as documents — blocks `javascript:` etc. */
function assertHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("Document link must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("Document link must start with http:// or https://");
  }
}

function assertContactEmail(email: string | null | undefined) {
  const value = email?.trim();
  if (value && !EMAIL_RE.test(value)) throw new BadRequestException("Contact email looks invalid");
}

/** Emails are stored lower-cased so portal login is deterministic. */
function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface ClientUpdateBody {
  companyName?: string;
  industryVertical?: Vertical;
  category?: ClientCategory;
  /** `null` unassigns the account owner; `undefined` leaves it untouched. */
  accountOwnerId?: string | null;
  billingCycleType?: BillingCycleType;
  currencyPreference?: string;
  contractStartDate?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  billingDayOfMonth?: number | null;
  monthlyAmount?: number | null;
  monthlyServiceDescription?: string | null;
  autoGenerateInvoice?: boolean;
  paymentDueDays?: number | null;
  retainerInterval?: string | null;
  nextRetainerDate?: string | null;
  /** Explicit scoring profile id; `null` falls back to the billing-cycle match. */
  scoreProfile?: string | null;
  primaryContact?: {
    id?: string;
    name: string;
    roleTitle?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
}

export interface CreateClientBody extends ClientUpdateBody {
  companyName: string;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly scoring: ScoringService
  ) {}

  // ── Health engine ───────────────────────────────────────────────────────
  /**
   * Delegates to the config-driven scoring engine. The public shape stays the
   * same (`{ id, score, level, drivers }`) because the Accounts UI and the
   * invoice hooks depend on it.
   */
  async recomputeHealth(clientId: string) {
    const result: any = await this.scoring.recomputeClient(clientId);
    if (result?.skipped) return result;
    return {
      id: clientId,
      score: result.score,
      level: result.level,
      drivers: result.drivers?.length ? result.drivers : ["healthy"],
      coverage: result.coverage,
      breakdown: result.breakdown,
      overridden: result.overridden,
      overrideNotes: result.overrideNotes,
    };
  }

  async recomputeAll() {
    return this.scoring.recomputeAll("clients");
  }

  // ── Overview / stats ────────────────────────────────────────────────────
  async overview() {
    return this.cache.wrap("accounts:overview", 30, async () => {
      const [clients, flags] = await Promise.all([
        this.prisma.client.findMany({
          include: {
            accountOwner: { select: { id: true, name: true } },
            _count: { select: { contacts: true, projects: true, invoices: true } },
          },
        }),
        this.prisma.churnRiskFlag.findMany({
          where: { flaggedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
          distinct: ["clientId"],
          select: { clientId: true },
        }),
      ]);

      // Archived clients keep their history but are not part of the active book:
      // the list/presets hide them, so the KPIs must count the same set.
      const activeClients = clients.filter((c) => c.category !== "ARCHIVED");
      const fins = await this.financialSummary(activeClients.map((c) => c.id));
      const activeIds = new Set(activeClients.map((c) => c.id));

      const dist = { GREEN: 0, YELLOW: 0, RED: 0 };
      for (const c of activeClients) dist[c.healthLevel] = (dist[c.healthLevel] ?? 0) + 1;

      const now = new Date();
      const in30 = new Date(Date.now() + 30 * 86400000);
      const renewals = activeClients
        .filter((c) => c.renewalDate && c.renewalDate >= now && c.renewalDate <= in30)
        .sort((a, b) => (a.renewalDate as Date).getTime() - (b.renewalDate as Date).getTime());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const money = [...fins.values()];
      const totalDue = money.reduce((s, f) => s + f.totalDue, 0);
      const overdueAmount = money.reduce((s, f) => s + f.overdueAmount, 0);
      const overdueClients = [...fins.values()].filter((f) => f.overdueCount > 0).length;

      const activeRetainers = activeClients.filter(
        (c) => c.category === "ACTIVE" && c.billingCycleType === "MONTHLY_RETAINER"
      );
      const mrr = activeRetainers.reduce((s, c) => s + Number(c.monthlyAmount ?? 0), 0);
      const retainerMissingAmount = activeRetainers.filter((c) => Number(c.monthlyAmount ?? 0) <= 0).length;
      const noContact = activeClients.filter((c) => c._count.contacts === 0).length;
      const noOwner = activeClients.filter((c) => !c.accountOwnerId).length;

      return {
        totalClients: activeClients.length,
        archivedClients: clients.length - activeClients.length,
        avgHealth: activeClients.length
          ? Math.round(activeClients.reduce((s, c) => s + (c.healthScore ?? 0), 0) / activeClients.length)
          : null,
        distribution: dist,
        renewalsNext30: renewals.map((c) => ({
          id: c.id,
          companyName: c.companyName,
          renewalDate: c.renewalDate,
          healthLevel: c.healthLevel,
        })),
        atRiskCount: dist.RED + dist.YELLOW,
        newThisMonth: activeClients.filter((c) => c.createdAt >= monthStart).length,
        churnFlagged: new Set(flags.map((f) => f.clientId).filter((id) => activeIds.has(id))).size,
        // money + hygiene, used by the Accounts "today" strip
        totalDue,
        overdueAmount,
        overdueClients,
        mrr,
        retainerMissingAmount,
        noContact,
        noOwner,
        dataGaps: retainerMissingAmount + noContact + noOwner,
      };
    });
  }

  /** Minimal id/name list for pickers in Flow, Calendar and Capital. */
  async clientLookup() {
    return this.prisma.client.findMany({
      select: { id: true, companyName: true },
      orderBy: { companyName: "asc" },
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
  /**
   * Per-client money picture, using the same math as Capital (grand total,
   * net of refunds, receivables only). `overdueCount` is derived from invoice
   * dates, so a stale `SENT` invoice past its due date still counts.
   */
  private async financialSummary(ids: string[]) {
    const empty: ClientFinancials = {
      totalInvoiced: 0,
      totalPaid: 0,
      totalDue: 0,
      overdueCount: 0,
      overdueAmount: 0,
      openInvoiceCount: 0,
      draftAmount: 0,
      draftCount: 0,
      lastInvoiceDate: null,
    };
    if (!ids.length) return new Map<string, ClientFinancials>();
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: { in: ids } },
      select: {
        clientId: true,
        status: true,
        issueDate: true,
        dueDate: true,
        taxApplicable: true,
        taxRate: true,
        discountRate: true,
        shippingFee: true,
        lineItems: { select: { amount: true } },
        payments: { select: { amount: true, type: true } },
      },
    });
    // "Overdue" means the due date has passed, not "is due today" — the same
    // rule the Billing tab and Collections modal use, so the numbers agree.
    const today = startOfToday().getTime();
    const map = new Map<string, ClientFinancials>();
    for (const inv of invoices) {
      const cur = map.get(inv.clientId) ?? { ...empty };
      const t = invoiceTotals(inv);
      if (!cur.lastInvoiceDate || inv.issueDate.toISOString() > cur.lastInvoiceDate) {
        cur.lastInvoiceDate = inv.issueDate.toISOString();
      }
      if (isReceivable(inv.status)) {
        cur.totalInvoiced += t.grand;
        cur.totalPaid += t.paid;
        cur.totalDue += t.balance;
        if (t.balance > 0) {
          cur.openInvoiceCount += 1;
          if (inv.dueDate && inv.dueDate.getTime() < today) {
            cur.overdueCount += 1;
            cur.overdueAmount += t.balance;
          }
        }
      } else if (inv.status === "DRAFT") {
        // Drafts are work-in-progress, not client debt — shown separately.
        cur.draftAmount += t.grand;
        cur.draftCount += 1;
      }
      map.set(inv.clientId, cur);
    }
    return map;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  async list(query: { q?: string; health?: string; vertical?: string; ownerId?: string; category?: string }) {
    assertEnum("health", query.health, ["GREEN", "YELLOW", "RED"]);
    assertEnum("vertical", query.vertical, VERTICALS);
    assertEnum("category", query.category, CATEGORIES);
    const clients = await this.cache.wrapQuery("accounts:list", query, 30, async () => {
      const rows = await this.prisma.client.findMany({
        where: {
          ...(query.q
            ? {
                OR: [
                  { companyName: { contains: query.q, mode: "insensitive" as const } },
                  { contacts: { some: { name: { contains: query.q, mode: "insensitive" as const } } } },
                  { contacts: { some: { email: { contains: query.q, mode: "insensitive" as const } } } },
                  { accountOwner: { name: { contains: query.q, mode: "insensitive" as const } } },
                ],
              }
            : {}),
          ...(query.health ? { healthLevel: query.health as any } : {}),
          ...(query.vertical ? { industryVertical: query.vertical as any } : {}),
          ...(query.ownerId ? { accountOwnerId: query.ownerId } : {}),
          ...(query.category ? { category: query.category as any } : {}),
        },
        include: {
          accountOwner: { select: { id: true, name: true } },
          contacts: {
            select: { id: true, name: true, roleTitle: true, email: true, phone: true, isPrimary: true },
            orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
            take: 2,
          },
          _count: { select: { projects: true, invoices: true, contacts: true } },
        },
        orderBy: [{ healthScore: "desc" }, { createdAt: "desc" }],
        // Hard safety cap: without it a single request materialises the whole
        // client book (plus contacts) and the response grows without bound.
        take: 500,
      });
      // The money summary is part of the cached payload now. It used to run
      // OUTSIDE wrapQuery, so every request still read every invoice + line
      // item + payment even when the client list was a cache hit.
      const summary = await this.financialSummary(rows.map((c) => c.id));
      return rows.map((c) => {
        const fins = summary.get(c.id) ?? {
          totalInvoiced: 0,
          totalPaid: 0,
          totalDue: 0,
          overdueCount: 0,
          overdueAmount: 0,
          openInvoiceCount: 0,
          draftAmount: 0,
          draftCount: 0,
          lastInvoiceDate: null,
        };
        const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0] ?? null;
        return { ...c, primaryContact: primary, ...fins };
      });
    });
    return clients;
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
        },
      },
    });
    if (!client) throw new NotFoundException("Client not found");

    // Money is always measured over EVERY invoice and with the same math as
    // Capital (grand total, refunds netted, drafts excluded from receivables).
    const allInvoices = await this.prisma.invoice.findMany({
      where: { clientId: id },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        invoiceType: true,
        issueDate: true,
        dueDate: true,
        taxApplicable: true,
        taxRate: true,
        discountRate: true,
        shippingFee: true,
        lineItems: {
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            amount: true,
            revenueTag: true,
          },
          orderBy: { id: "asc" },
        },
        payments: { select: { amount: true, type: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { issueDate: "desc" },
    });

    let totalInvoiced = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let draftAmount = 0;
    let draftCount = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    // Due today is not overdue; only a due date before today is.
    const today = startOfToday();
    const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };

    const invoices = allInvoices.map((inv) => {
      const t = invoiceTotals(inv);
      if (isReceivable(inv.status)) {
        totalInvoiced += t.grand;
        totalPaid += t.paid;
        totalDue += t.balance;
        if (t.balance > 0) {
          if (inv.dueDate && inv.dueDate < today) {
            overdueCount += 1;
            overdueAmount += t.balance;
            const days = Math.floor((today.getTime() - inv.dueDate.getTime()) / 86400000);
            if (days <= 30) aging.d30 += t.balance;
            else if (days <= 60) aging.d60 += t.balance;
            else if (days <= 90) aging.d90 += t.balance;
            else aging.d90p += t.balance;
          } else {
            aging.current += t.balance;
          }
        }
      } else if (inv.status === "DRAFT") {
        draftAmount += t.grand;
        draftCount += 1;
      }
      return { ...inv, total: t.grand, paid: t.paid, balance: t.balance, refunded: t.refunded };
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

    // Cost side of the relationship: everything spent for this client, whether
    // the expense was tagged to the client directly or to one of its projects.
    const expenseRows = await this.prisma.expense.findMany({
      where: { OR: [{ clientId: id }, { project: { clientId: id } }] },
      select: {
        id: true, description: true, amount: true, category: true, date: true,
        approvalStatus: true, isClientBillable: true, projectId: true,
      },
      orderBy: { date: "desc" },
    });
    const approvedExpenses = expenseRows.filter((e) => e.approvalStatus === "APPROVED");
    const expensesTotal = approvedExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const pendingExpenses = expenseRows
      .filter((e) => e.approvalStatus === "PENDING")
      .reduce((s, e) => s + Number(e.amount), 0);

    // Dollar Desk: USD the client bought from the agency. Client-level (not
    // project-level), so it belongs on the client file alongside billing.
    const dollarRows = await this.prisma.dollarSale.findMany({
      where: { clientId: id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    const dollar = summariseDollarSales(dollarRows);

    return {
      ...client,
      // Full history so the Billing tab's filters and counts agree with the
      // money cards (a client can have more than 8 invoices).
      invoices,
      invoiceCount: invoices.length,
      projectCount: client.projects.length,
      projectBreakdown: client.projects.reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      }, {}),
      payments,
      totalInvoiced,
      totalPaid,
      totalDue: Math.max(0, totalDue),
      overdueCount,
      overdueAmount,
      draftAmount,
      draftCount,
      aging,
      // USD the client bought (Dollar Desk), with the agency-side margin — this
      // is an internal view, so profit is included.
      dollar,
      finance: {
        expensesTotal,
        pendingExpenses,
        billableExpenses: approvedExpenses.filter((e) => e.isClientBillable).reduce((s, e) => s + Number(e.amount), 0),
        expenseCount: approvedExpenses.length,
        // Revenue recognised against this client (invoiced minus direct cost).
        profit: totalInvoiced - expensesTotal,
        margin: totalInvoiced ? Math.round(((totalInvoiced - expensesTotal) / totalInvoiced) * 100) : null,
        recentExpenses: expenseRows.slice(0, 5).map((e) => ({ ...e, amount: Number(e.amount) })),
        projectBreakdown: client.projects.map((p) => p.name),
      },
    };
  }

  /**
   * Validate an owner id before writing it. An empty string or a stale id used
   * to reach Prisma as a foreign key and surface as a confusing 500.
   */
  private async resolveOwnerId(raw: string): Promise<string> {
    const id = raw.trim();
    const user = await this.prisma.user.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!user) throw new BadRequestException("Account owner not found or inactive");
    return user.id;
  }

  async create(body: CreateClientBody) {
    if (!body.companyName?.trim()) {
      throw new BadRequestException("companyName is required");
    }
    assertEnum("industryVertical", body.industryVertical, VERTICALS);
    assertEnum("category", body.category, CATEGORIES);
    assertEnum("billingCycleType", body.billingCycleType, BILLING_CYCLES);

    const billingCycle = body.billingCycleType ?? "PROJECT_BASED";
    // Same guard the form applies: a zero-value retainer cannot be auto-billed.
    if (
      billingCycle === "MONTHLY_RETAINER" &&
      body.autoGenerateInvoice !== false &&
      !(Number(body.monthlyAmount) > 0)
    ) {
      throw new BadRequestException(
        "Set the retainer amount — auto-billing cannot issue a zero-value invoice"
      );
    }

    const ownerId = body.accountOwnerId ? await this.resolveOwnerId(body.accountOwnerId) : null;

    const pc = body.primaryContact;
    const contactName = pc?.name?.trim();
    if (pc && !contactName) {
      throw new BadRequestException("Primary contact name is required");
    }
    assertContactEmail(pc?.email);

    // Client + primary contact are written together: either both exist or the
    // request fails, so a contact can no longer be silently lost.
    const client = await this.prisma.client.create({
      data: {
        companyName: body.companyName.trim(),
        industryVertical: body.industryVertical ?? "OTHER",
        category: (body.category as any) ?? "ACTIVE",
        // Checked form (relation write) so the primary contact can be created
        // in the same statement as the client.
        ...(ownerId ? { accountOwner: { connect: { id: ownerId } } } : {}),
        billingCycleType: billingCycle,
        currencyPreference: body.currencyPreference ?? "BDT",
        contractStartDate: body.contractStartDate ? new Date(body.contractStartDate) : undefined,
        renewalDate: body.renewalDate ? new Date(body.renewalDate) : undefined,
        notes: body.notes,
        billingDayOfMonth: body.billingDayOfMonth ?? undefined,
        monthlyAmount: body.monthlyAmount ?? undefined,
        monthlyServiceDescription: body.monthlyServiceDescription || undefined,
        autoGenerateInvoice: body.autoGenerateInvoice ?? true,
        paymentDueDays: body.paymentDueDays ?? undefined,
        retainerInterval: body.retainerInterval || undefined,
        nextRetainerDate: body.nextRetainerDate ? new Date(body.nextRetainerDate) : undefined,
        healthScore: 75,
        healthLevel: "GREEN",
        ...(contactName
          ? {
              contacts: {
                create: {
                  name: contactName,
                  roleTitle: pc?.roleTitle?.trim() || null,
                  email: normalizeEmail(pc?.email),
                  phone: pc?.phone?.trim() || null,
                  isPrimary: true,
                },
              },
            }
          : {}),
      },
    });
    await this.recomputeHealth(client.id);
    await this.invalidateClients();
    return this.detail(client.id);
  }

  async update(id: string, body: ClientUpdateBody) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException("Client not found");
    assertEnum("industryVertical", body.industryVertical, VERTICALS);
    assertEnum("category", body.category, CATEGORIES);
    assertEnum("billingCycleType", body.billingCycleType, BILLING_CYCLES);
    if (body.companyName !== undefined && !body.companyName.trim()) {
      throw new BadRequestException("companyName cannot be empty");
    }
    if (body.scoreProfile !== undefined && body.scoreProfile !== null) {
      const profiles = await this.scoring.profileChoices();
      if (!profiles.some((p) => p.id === body.scoreProfile)) {
        throw new BadRequestException(`Unknown scoring profile "${body.scoreProfile}"`);
      }
    }

    // `undefined` leaves the owner alone; null/"" clears it; anything else must
    // be a real, active user (otherwise Prisma would throw a 500).
    let ownerValue: string | null | undefined;
    if (body.accountOwnerId !== undefined) {
      ownerValue = body.accountOwnerId ? await this.resolveOwnerId(body.accountOwnerId) : null;
    }

    const pc = body.primaryContact;
    let contactData: {
      name: string;
      roleTitle: string | null;
      email: string | null;
      phone: string | null;
      isPrimary: boolean;
    } | null = null;
    if (pc) {
      const contactName = pc.name?.trim();
      if (!contactName) throw new BadRequestException("Primary contact name is required");
      assertContactEmail(pc.email);
      contactData = {
        name: contactName,
        roleTitle: pc.roleTitle?.trim() || null,
        email: normalizeEmail(pc.email),
        phone: pc.phone?.trim() || null,
        isPrimary: true,
      };
    }

    // Client fields and the inline primary contact are saved atomically, so a
    // contact failure can no longer be swallowed behind a "Client updated".
    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id },
        data: {
          companyName: body.companyName,
          industryVertical: body.industryVertical,
          category: body.category as any,
          accountOwnerId: ownerValue,
          billingCycleType: body.billingCycleType,
          currencyPreference: body.currencyPreference,
          contractStartDate: body.contractStartDate === null ? null : body.contractStartDate ? new Date(body.contractStartDate) : undefined,
          renewalDate: body.renewalDate === null ? null : body.renewalDate ? new Date(body.renewalDate) : undefined,
          notes: body.notes === null ? null : body.notes,
          billingDayOfMonth: body.billingDayOfMonth === null ? null : body.billingDayOfMonth,
          monthlyAmount: body.monthlyAmount === null ? null : body.monthlyAmount,
          monthlyServiceDescription: body.monthlyServiceDescription === null ? null : body.monthlyServiceDescription,
          autoGenerateInvoice: body.autoGenerateInvoice,
          paymentDueDays: body.paymentDueDays === null ? null : body.paymentDueDays,
          retainerInterval: body.retainerInterval === null ? null : body.retainerInterval,
          nextRetainerDate: body.nextRetainerDate === null ? null : body.nextRetainerDate ? new Date(body.nextRetainerDate) : undefined,
          scoreProfile: body.scoreProfile === null ? null : body.scoreProfile,
        },
      });

      if (contactData) {
        if (pc!.id) {
          const belongs = await tx.clientContact.findFirst({ where: { id: pc!.id, clientId: id } });
          if (!belongs) throw new BadRequestException("Contact does not belong to this client");
          await tx.clientContact.update({ where: { id: pc!.id }, data: contactData });
        } else {
          const existingPrimary = await tx.clientContact.findFirst({ where: { clientId: id, isPrimary: true } });
          if (existingPrimary) {
            await tx.clientContact.update({ where: { id: existingPrimary.id }, data: contactData });
          } else {
            await tx.clientContact.create({ data: { clientId: id, ...contactData } });
          }
        }
      }
    });
    await this.recomputeHealth(id);
    await this.invalidateClients();
    return this.detail(id);
  }

  async remove(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true, projects: true } } },
    });
    if (!client) throw new NotFoundException("Client not found");
    // Invoices and projects have a required FK with no cascade, so a hard
    // delete only works for a client that has never done business. Give the
    // caller a usable message instead of a Prisma P2003 → 500.
    if (client._count.invoices > 0 || client._count.projects > 0) {
      throw new BadRequestException(
        `${client.companyName} has ${client._count.projects} project(s) and ${client._count.invoices} invoice(s). Archive it instead of deleting, so billing history stays intact.`
      );
    }
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
    const name = body.name?.trim();
    if (!name) throw new BadRequestException("Contact name is required");
    assertContactEmail(body.email);
    const data = {
      clientId: id,
      name,
      roleTitle: body.roleTitle?.trim() || null,
      email: normalizeEmail(body.email),
      phone: body.phone?.trim() || null,
      isPrimary: body.isPrimary ?? false,
    };
    // Adding a primary must demote the previous one, exactly like update does —
    // otherwise a client can end up with two "primary" contacts.
    const contact = data.isPrimary
      ? await this.prisma.$transaction(async (tx) => {
          await tx.clientContact.updateMany({ where: { clientId: id }, data: { isPrimary: false } });
          return tx.clientContact.create({ data });
        })
      : await this.prisma.clientContact.create({ data });
    await this.recomputeHealth(id);
    return contact;
  }

  async updateContact(clientId: string, contactId: string, body: { name?: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }) {
    const contact = await this.prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
    if (!contact) throw new NotFoundException("Contact not found");
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException("Contact name cannot be empty");
    }
    assertContactEmail(body.email);
    if (body.isPrimary) {
      await this.prisma.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    const updated = await this.prisma.clientContact.update({
      where: { id: contactId },
      data: {
        name: body.name !== undefined ? body.name.trim() : undefined,
        roleTitle: body.roleTitle !== undefined ? body.roleTitle?.trim() || null : undefined,
        email: body.email !== undefined ? normalizeEmail(body.email) : undefined,
        phone: body.phone !== undefined ? body.phone?.trim() || null : undefined,
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
    assertEnum("type", body.type, DOC_TYPES);
    const fileUrl = body.fileUrl?.trim();
    if (!fileUrl) throw new BadRequestException("Document link is required");
    assertHttpUrl(fileUrl);
    return this.prisma.clientDocument.create({
      data: { clientId: id, type: body.type as any, fileUrl, uploadedById },
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