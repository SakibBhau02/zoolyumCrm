import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Lead, LeadStage, LeadTemperature, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

/**
 * Lead intake rules.
 *
 * Everything in here is data, not code: the object below is the default and the
 * live copy lives in `Settings.leadRules`, so Control can switch any rule on/off
 * (or change a threshold) without a deploy. One service owns the whole intake
 * decision — validation → duplicates → defaults → ownership → score → SLA — so
 * the Add Lead form, CSV import and any future web form all behave the same.
 */

export type RuleAction = "BLOCK" | "WARN";

export interface LeadRules {
  version: number;
  enabled: boolean;
  intake: {
    requirePhone: { enabled: boolean };
    requireEmail: { enabled: boolean };
    requireCompany: { enabled: boolean };
    requireSource: { enabled: boolean };
    requireDealSize: { enabled: boolean; minAmount: number };
    requireNotes: { enabled: boolean; minChars: number };
    normalizePhone: { enabled: boolean };
    validateEmail: { enabled: boolean };
  };
  duplicates: {
    byPhone: { enabled: boolean; action: RuleAction };
    byEmail: { enabled: boolean; action: RuleAction };
    byCompany: { enabled: boolean; action: RuleAction };
    includeConverted: { enabled: boolean };
    lookbackDays: number;
  };
  routing: {
    mode: "MANUAL" | "CREATOR" | "VERTICAL_THEN_ROUND_ROBIN" | "ROUND_ROBIN";
    verticalOwners: Record<string, string>;
    roundRobinRoles: string[];
    fallbackUserId: string;
    autoFollowUpHours: number;
    autoTagSource: boolean;
  };
  scoring: {
    enabled: boolean;
    base: number;
    source: Record<string, number>;
    priority: Record<string, number>;
    vertical: Record<string, number>;
    dealSizeBands: { min: number; points: number }[];
    contact: { email: number; phone: number; company: number };
    freshness: { freshDays: number; freshPoints: number; agingDays: number; agingPoints: number; staleDays: number; stalePoints: number };
    activity: { perActivity: number; max: number };
    thresholds: { hot: number; cold: number };
    autoTemperature: boolean;
  };
  sla: {
    enabled: boolean;
    firstResponseHours: Record<string, number>;
    staleDays: number;
    notifyOnBreach: boolean;
  };
  audit: { nightly: boolean };
}

export const DEFAULT_LEAD_RULES: LeadRules = {
  version: 1,
  enabled: true,
  intake: {
    // Bangladesh market: phone is the contact that actually works.
    requirePhone: { enabled: true },
    requireEmail: { enabled: false },
    requireCompany: { enabled: false },
    requireSource: { enabled: false },
    requireDealSize: { enabled: false, minAmount: 0 },
    requireNotes: { enabled: false, minChars: 20 },
    normalizePhone: { enabled: true },
    validateEmail: { enabled: true },
  },
  duplicates: {
    byPhone: { enabled: true, action: "BLOCK" },
    byEmail: { enabled: true, action: "BLOCK" },
    byCompany: { enabled: true, action: "WARN" },
    includeConverted: { enabled: true },
    lookbackDays: 180,
  },
  routing: {
    mode: "VERTICAL_THEN_ROUND_ROBIN",
    verticalOwners: {},
    roundRobinRoles: ["Sales/BD"],
    fallbackUserId: "",
    autoFollowUpHours: 24,
    autoTagSource: true,
  },
  scoring: {
    enabled: true,
    base: 20,
    source: {
      REFERRAL: 15, WEBSITE: 10, LINKEDIN: 10, PARTNER: 10, FACEBOOK: 8, GOOGLE_ADS: 8,
      WHATSAPP: 8, INBOUND_PHONE: 8, EMAIL_CAMPAIGN: 5, EVENT: 5, EMAIL: 5, COLD_CALL: 2, COLD: 0, OTHER: 0,
    },
    priority: { URGENT: 8, HIGH: 5, MEDIUM: 0, LOW: -3 },
    vertical: { EDUCATION: 10, D2C: 8, HEALTHCARE: 5, OTHER: 2 },
    dealSizeBands: [
      { min: 500000, points: 25 },
      { min: 200000, points: 20 },
      { min: 100000, points: 15 },
      { min: 50000, points: 10 },
      { min: 1, points: 5 },
    ],
    contact: { email: 10, phone: 5, company: 5 },
    freshness: { freshDays: 7, freshPoints: 10, agingDays: 21, agingPoints: 5, staleDays: 45, stalePoints: -10 },
    activity: { perActivity: 2, max: 10 },
    thresholds: { hot: 80, cold: 40 },
    autoTemperature: true,
  },
  sla: {
    enabled: true,
    firstResponseHours: { URGENT: 1, HIGH: 4, MEDIUM: 24, LOW: 72 },
    staleDays: 7,
    notifyOnBreach: true,
  },
  audit: { nightly: true },
};

/** Flags the audit can raise on a stored lead. */
export const QUALITY_FLAGS = {
  NO_PHONE: "Missing phone",
  NO_COMPANY: "Missing company",
  DUPLICATE: "Duplicate contact",
  STALE: "No contact within SLA window",
  SLA_BREACH: "First response breached",
  UNASSIGNED: "No owner",
} as const;

export type QualityFlag = keyof typeof QUALITY_FLAGS;

const ACTIVE_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION"];

/** Deep-merge stored rules over the defaults so a partial JSON never breaks intake. */
export function mergeLeadRules(base: any, override: any): any {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object") return override;
  const out: any = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = key in base ? mergeLeadRules(base[key], override[key]) : override[key];
  }
  return out;
}

/**
 * Normalise a phone number for duplicate matching.
 * `+8801813-778899`, `01813778899`, `8801813778899` all become `+8801813778899`.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = "0" + digits.slice(3);
  if (/^01\d{9}$/.test(digits)) return "+880" + digits.slice(1);
  if (/^1\d{9}$/.test(digits)) return "+880" + digits; // 1813778899 without the leading 0
  if (/^\d{10,15}$/.test(digits)) return "+" + digits;
  return null;
}

export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  return v || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export interface IntakeResult {
  errors: string[];
  warnings: string[];
  phoneNormalized: string | null;
  emailNormalized: string | null;
}

export interface DuplicateHit {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  phone: string | null;
  email: string | null;
  matchedOn: "phone" | "email" | "company";
  /** true when the lead already became a client — worth warning even harder. */
  converted: boolean;
}

@Injectable()
export class LeadRulesService implements OnModuleInit {
  private readonly logger = new Logger(LeadRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  /**
   * One-time normalisation for leads that existed before the rule engine.
   * Without it, a new lead could be saved as a duplicate of an old record whose
   * phone was never normalised.
   *
   * Runs AFTER boot, in one batched statement per 500 rows. It used to run
   * inside onModuleInit and issue one UPDATE per lead, so a database with 5,000
   * imported leads delayed the API start by minutes.
   */
  onModuleInit() {
    setTimeout(() => {
      void this.backfillPhoneNormalization().catch(() => null);
    }, 5_000).unref?.();
  }

  private async backfillPhoneNormalization() {
    try {
      const rows = await this.prisma.lead.findMany({
        where: { phoneNormalized: null, contactPhone: { not: null } },
        select: { id: true, contactPhone: true },
        take: 10_000,
      });
      const pairs = rows
        .map((r) => ({ id: r.id, norm: normalizePhone(r.contactPhone) }))
        .filter((p): p is { id: string; norm: string } => !!p.norm);
      if (!pairs.length) return;
      for (let i = 0; i < pairs.length; i += 500) {
        const chunk = pairs.slice(i, i + 500);
        await this.prisma.$executeRaw`
          UPDATE "Lead" AS l
          SET "phoneNormalized" = v.norm
          FROM (VALUES ${Prisma.join(chunk.map((p) => Prisma.sql`(${p.id}, ${p.norm})`))}) AS v(id, norm)
          WHERE l.id = v.id AND l."phoneNormalized" IS NULL
        `;
      }
      this.logger.log(`Backfilled phoneNormalized for ${pairs.length} leads`);
    } catch (e: any) {
      this.logger.warn(`phoneNormalized backfill skipped: ${e?.message ?? e}`);
    }
  }

  async getRules(): Promise<LeadRules> {
    return this.cache.wrap("lead:rules", 60, async () => {
      const settings = await this.prisma.settings.findUnique({ where: { id: "default" } }).catch(() => null);
      const stored = (settings as any)?.leadRules;
      const parsed = typeof stored === "string" ? safeJson(stored) : stored;
      return mergeLeadRules(DEFAULT_LEAD_RULES, parsed ?? {}) as LeadRules;
    });
  }

  async invalidate() {
    await this.cache.del("lead:rules");
  }

  // ── Intake validation ────────────────────────────────────────────────────
  /**
   * Returns hard errors (save is refused) and soft warnings (saved, but the
   * caller shows a confirmation). Also hands back the normalised contact values
   * so the caller can persist them.
   */
  async checkIntake(dto: {
    name?: string;
    company?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    source?: string | null;
    estimatedDealSize?: number | null;
    notes?: string | null;
  }): Promise<IntakeResult> {
    const rules = await this.getRules();
    const errors: string[] = [];
    const warnings: string[] = [];
    const phoneNormalized = rules.intake.normalizePhone.enabled ? normalizePhone(dto.contactPhone) : null;
    const emailNormalized = normalizeEmail(dto.contactEmail);

    if (!rules.enabled) return { errors, warnings, phoneNormalized, emailNormalized };

    const phone = (dto.contactPhone ?? "").trim();
    const email = (dto.contactEmail ?? "").trim();

    if (rules.intake.requirePhone.enabled && !phone) {
      errors.push("Phone number is required");
    } else if (phone && rules.intake.normalizePhone.enabled && !phoneNormalized) {
      errors.push("Phone number doesn't look valid — use 01XXXXXXXXX or +8801XXXXXXXXX");
    }
    if (rules.intake.requireEmail.enabled && !email) {
      errors.push("Email is required");
    } else if (email && rules.intake.validateEmail.enabled && !EMAIL_RE.test(email)) {
      errors.push("Email address looks invalid");
    }
    if (rules.intake.requireCompany.enabled && !(dto.company ?? "").trim()) {
      errors.push("Company name is required");
    }
    if (rules.intake.requireSource.enabled && (!dto.source || dto.source === "OTHER")) {
      warnings.push("Pick the real source instead of “Other” — it drives channel reporting");
    }
    if (rules.intake.requireDealSize.enabled) {
      const size = Number(dto.estimatedDealSize ?? 0);
      if (!size) errors.push("Estimated deal size is required");
      else if (rules.intake.requireDealSize.minAmount > 0 && size < rules.intake.requireDealSize.minAmount) {
        errors.push(`Deal size should be at least ${rules.intake.requireDealSize.minAmount.toLocaleString()}`);
      }
    }
    if (rules.intake.requireNotes.enabled) {
      const len = (dto.notes ?? "").trim().length;
      if (len < rules.intake.requireNotes.minChars) {
        errors.push(`Add at least ${rules.intake.requireNotes.minChars} characters of context in notes`);
      }
    }

    return { errors, warnings, phoneNormalized, emailNormalized };
  }

  // ── Duplicates ───────────────────────────────────────────────────────────
  async findDuplicates(input: {
    contactPhone?: string | null;
    contactEmail?: string | null;
    company?: string | null;
    name?: string | null;
    excludeId?: string | null;
  }): Promise<{ hard: DuplicateHit[]; soft: DuplicateHit[] }> {
    const rules = await this.getRules();
    const d = rules.duplicates;
    if (!d.byPhone.enabled && !d.byEmail.enabled && !d.byCompany.enabled) return { hard: [], soft: [] };

    const phone = normalizePhone(input.contactPhone);
    const email = normalizeEmail(input.contactEmail);
    const company = (input.company ?? "").trim().toLowerCase();
    if (!phone && !email && !company) return { hard: [], soft: [] };

    const since = d.lookbackDays > 0 ? new Date(Date.now() - d.lookbackDays * 86400000) : null;
    const OR: any[] = [];
    if (phone && d.byPhone.enabled) OR.push({ phoneNormalized: phone });
    if (email && d.byEmail.enabled) OR.push({ contactEmail: { equals: email, mode: "insensitive" } });
    if (company && d.byCompany.enabled) OR.push({ company: { equals: input.company ?? "", mode: "insensitive" } });
    if (!OR.length) return { hard: [], soft: [] };

    const rows = await this.prisma.lead.findMany({
      where: {
        AND: [
          { OR },
          ...(input.excludeId ? [{ id: { not: input.excludeId } }] : []),
          ...(d.includeConverted.enabled ? [] : [{ stage: { not: "WON" as LeadStage } }]),
          ...(since ? [{ createdAt: { gte: since } }] : []),
        ],
      },
      select: { id: true, name: true, company: true, stage: true, contactPhone: true, contactEmail: true, convertedClientId: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const hard: DuplicateHit[] = [];
    const soft: DuplicateHit[] = [];
    for (const r of rows) {
      const hit = (matchedOn: DuplicateHit["matchedOn"]): DuplicateHit => ({
        id: r.id,
        name: r.name,
        company: r.company,
        stage: r.stage,
        phone: r.contactPhone,
        email: r.contactEmail,
        matchedOn,
        converted: !!r.convertedClientId,
      });
      if (phone && d.byPhone.enabled && normalizePhone(r.contactPhone) === phone) {
        (d.byPhone.action === "BLOCK" ? hard : soft).push(hit("phone"));
      } else if (email && d.byEmail.enabled && normalizeEmail(r.contactEmail) === email) {
        (d.byEmail.action === "BLOCK" ? hard : soft).push(hit("email"));
      } else if (company && d.byCompany.enabled && (r.company ?? "").trim().toLowerCase() === company) {
        (d.byCompany.action === "BLOCK" ? hard : soft).push(hit("company"));
      }
    }
    // Same record could match on two fields — keep one entry per lead.
    return { hard: uniqueById(hard), soft: uniqueById(soft).filter((s) => !hard.some((h) => h.id === s.id)) };
  }

  // ── Defaults + ownership ─────────────────────────────────────────────────
  /** Fill the fields the rep left empty so the record is immediately workable. */
  applyDefaults<T extends Record<string, any>>(dto: T, rules: LeadRules): T & { tags?: string[] } {
    if (!rules.enabled) return dto;
    const out: any = { ...dto };
    if (rules.routing.autoTagSource && out.source && out.source !== "OTHER") {
      const tag = String(out.source).toLowerCase().replace(/_/g, "-");
      const tags: string[] = Array.isArray(out.tags) ? out.tags : [];
      if (!tags.includes(tag)) out.tags = [...tags, tag];
    }
    return out;
  }

  /**
   * Who owns the new lead. Vertical owner wins; otherwise the sales pool member
   * with the fewest active leads (load-balanced, not blind rotation). Falls back
   * to the configured fallback user, then the creator.
   */
  async pickOwner(input: { vertical?: string | null; creatorId?: string | null; explicitOwnerId?: string | null }, rules: LeadRules): Promise<string | null> {
    if (!rules.enabled) return input.explicitOwnerId ?? null;
    if (rules.routing.mode === "MANUAL") return input.explicitOwnerId ?? null;
    if (input.explicitOwnerId) return input.explicitOwnerId;
    if (rules.routing.mode === "CREATOR") return input.creatorId ?? null;

    const verticalOwner = input.vertical ? rules.routing.verticalOwners?.[input.vertical] : null;
    if (verticalOwner && rules.routing.mode === "VERTICAL_THEN_ROUND_ROBIN") {
      const exists = await this.prisma.user.findFirst({ where: { id: verticalOwner, isActive: true }, select: { id: true } });
      if (exists) return exists.id;
    }

    // Count active leads per rep in ONE grouped query. Loading every active
    // lead id for every user made each new lead cost O(leads) rows.
    const [pool, counts] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isActive: true,
          ...(rules.routing.roundRobinRoles?.length ? { role: { name: { in: rules.routing.roundRobinRoles } } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.lead.groupBy({
        by: ["assignedToId"],
        where: { stage: { in: ACTIVE_STAGES }, assignedToId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    if (pool.length) {
      const loadByUser = new Map(counts.map((c) => [c.assignedToId as string, c._count._all]));
      pool.sort((a, b) => (loadByUser.get(a.id) ?? 0) - (loadByUser.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      return pool[0].id;
    }
    if (rules.routing.fallbackUserId) {
      const fb = await this.prisma.user.findFirst({ where: { id: rules.routing.fallbackUserId, isActive: true }, select: { id: true } });
      if (fb) return fb.id;
    }
    return input.creatorId ?? null;
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  score(
    lead: Pick<Lead, "source" | "vertical" | "estimatedDealSize" | "contactEmail" | "contactPhone" | "company" | "createdAt" | "priority"> & {
      activityCount: number;
    },
    rules: LeadRules
  ): number {
    const s = rules.scoring;
    if (!rules.enabled || !s.enabled) return 0;

    let score = Number(s.base ?? 0);
    score += Number(s.source?.[lead.source] ?? 0);
    score += Number(s.priority?.[lead.priority] ?? 0);
    score += Number(s.vertical?.[lead.vertical] ?? 0);

    const size = Number(lead.estimatedDealSize ?? 0);
    for (const band of [...(s.dealSizeBands ?? [])].sort((a, b) => b.min - a.min)) {
      if (size >= band.min) {
        score += Number(band.points);
        break;
      }
    }

    if (lead.contactEmail) score += Number(s.contact.email ?? 0);
    if (lead.contactPhone) score += Number(s.contact.phone ?? 0);
    if (lead.company) score += Number(s.contact.company ?? 0);

    const ageDays = (Date.now() - new Date(lead.createdAt).getTime()) / 86400000;
    if (ageDays <= s.freshness.freshDays) score += Number(s.freshness.freshPoints);
    else if (ageDays <= s.freshness.agingDays) score += Number(s.freshness.agingPoints);
    else if (ageDays > s.freshness.staleDays) score += Number(s.freshness.stalePoints);

    score += Math.min(lead.activityCount * Number(s.activity.perActivity ?? 0), Number(s.activity.max ?? 0));
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  temperatureFor(scoreValue: number, rules: LeadRules): LeadTemperature | null {
    if (!rules.enabled || !rules.scoring.enabled || !rules.scoring.autoTemperature) return null;
    if (scoreValue >= rules.scoring.thresholds.hot) return "HOT";
    if (scoreValue <= rules.scoring.thresholds.cold) return "COLD";
    return "WARM";
  }

  // ── SLA ──────────────────────────────────────────────────────────────────
  slaHours(priority: string | null | undefined, rules: LeadRules): number | null {
    if (!rules.enabled || !rules.sla.enabled) return null;
    return Number(rules.sla.firstResponseHours?.[priority ?? "MEDIUM"] ?? rules.sla.firstResponseHours?.MEDIUM ?? 24);
  }

  slaDueAt(createdAt: Date, priority: string | null | undefined, rules: LeadRules): Date | null {
    const hours = this.slaHours(priority, rules);
    if (hours === null) return null;
    return new Date(new Date(createdAt).getTime() + hours * 3600000);
  }

  isSlaBreached(lead: { createdAt: Date; firstResponseAt: Date | null; priority: string; stage: string }, rules: LeadRules): boolean {
    if (!rules.enabled || !rules.sla.enabled) return false;
    if (lead.firstResponseAt) return false;
    if (!ACTIVE_STAGES.includes(lead.stage as LeadStage)) return false;
    const due = this.slaDueAt(lead.createdAt, lead.priority, rules);
    return !!due && Date.now() > due.getTime();
  }

  isStale(lead: { lastContactedAt: Date | null; createdAt: Date; stage: string }, rules: LeadRules): boolean {
    if (!ACTIVE_STAGES.includes(lead.stage as LeadStage)) return false;
    const days = rules.sla.staleDays ?? 7;
    const anchor = lead.lastContactedAt ?? lead.createdAt;
    return Date.now() - new Date(anchor).getTime() > days * 86400000;
  }

  // ── Retro audit (existing leads) ─────────────────────────────────────────
  flagsFor(
    lead: Pick<Lead, "contactPhone" | "company" | "assignedToId" | "createdAt" | "lastContactedAt" | "firstResponseAt" | "priority" | "stage" | "qualityFlags">,
    opts: { duplicate?: boolean } = {},
    rules: LeadRules
  ): QualityFlag[] {
    const flags: QualityFlag[] = [];
    if (rules.enabled) {
      if (rules.intake.requirePhone.enabled && !normalizePhone(lead.contactPhone)) flags.push("NO_PHONE");
      if (rules.intake.requireCompany.enabled && !(lead.company ?? "").trim()) flags.push("NO_COMPANY");
      if (!lead.assignedToId) flags.push("UNASSIGNED");
      if (this.isStale(lead, rules)) flags.push("STALE");
      if (this.isSlaBreached(lead as any, rules)) flags.push("SLA_BREACH");
    }
    if (opts.duplicate) flags.push("DUPLICATE");
    return flags;
  }

  /**
   * Re-evaluate every stored lead: normalise phones, recompute flags, recompute
   * scores with the current weights. Returns a small report for the UI.
   */
  async auditAll(): Promise<{ scanned: number; flagged: number; duplicates: number; slaBreach: number; stale: number; unassigned: number; rescored: number }> {
    const rules = await this.getRules();
    const leads = await this.prisma.lead.findMany({
      select: {
        id: true, name: true, company: true, contactPhone: true, contactEmail: true, phoneNormalized: true,
        assignedToId: true, createdAt: true, lastContactedAt: true, firstResponseAt: true, priority: true,
        stage: true, source: true, vertical: true, estimatedDealSize: true, leadScore: true,
        // Count only: loading every activity id (50+ per lead) just to know the
        // number was the largest allocation in this job.
        _count: { select: { activities: true } },
      },
    });

    // Duplicate map by normalised phone / email.
    const byPhone = new Map<string, string[]>();
    const byEmail = new Map<string, string[]>();
    for (const l of leads) {
      const p = l.phoneNormalized ?? normalizePhone(l.contactPhone);
      if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), l.id]);
      const e = normalizeEmail(l.contactEmail);
      if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), l.id]);
    }

    let flagged = 0, duplicates = 0, slaBreach = 0, stale = 0, unassigned = 0, rescored = 0;
    const pending: { where: { id: string }; data: any }[] = [];
    for (const l of leads) {
      const phoneNormalized = normalizePhone(l.contactPhone);
      const p = phoneNormalized ?? l.phoneNormalized;
      const e = normalizeEmail(l.contactEmail);
      const isDup =
        (rules.duplicates.byPhone.enabled && !!p && (byPhone.get(p)?.length ?? 0) > 1) ||
        (rules.duplicates.byEmail.enabled && !!e && (byEmail.get(e)?.length ?? 0) > 1);

      const flags = this.flagsFor({ ...l, phoneNormalized } as any, { duplicate: isDup }, rules);
      const scoreValue = this.score({ ...l, activityCount: l._count.activities }, rules);
      const temperature = this.temperatureFor(scoreValue, rules);
      if (scoreValue !== (l.leadScore ?? 0)) rescored++;

      if (flags.length) flagged++;
      if (flags.includes("DUPLICATE")) duplicates++;
      if (flags.includes("SLA_BREACH")) slaBreach++;
      if (flags.includes("STALE")) stale++;
      if (flags.includes("UNASSIGNED")) unassigned++;

      pending.push({
        where: { id: l.id },
        data: { phoneNormalized, qualityFlags: flags, leadScore: scoreValue, ...(temperature && l.stage !== "WON" ? { temperature } : {}) },
      });
    }
    // Batched writes: one round trip per 200 leads instead of one per lead.
    for (let i = 0; i < pending.length; i += 200) {
      await this.prisma.$transaction(pending.slice(i, i + 200).map((p) => this.prisma.lead.update(p)));
    }
    await this.cache.del("pulse:summary");
    return { scanned: leads.length, flagged, duplicates, slaBreach, stale, unassigned, rescored };
  }
}

function uniqueById(hits: DuplicateHit[]): DuplicateHit[] {
  const seen = new Map<string, DuplicateHit>();
  for (const h of hits) if (!seen.has(h.id)) seen.set(h.id, h);
  return [...seen.values()];
}

function safeJson(v: string) {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}
