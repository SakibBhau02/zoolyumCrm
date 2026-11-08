import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isReceivable, invoiceTotals } from "../capital/finance-kernel";
import {
  DEFAULT_OVERALL_COMPONENTS,
  DEFAULT_SCORING_CONFIG,
  LEVEL_SEVERITY,
  METRIC_REGISTRY,
  OVERALL_COMPONENT_REGISTRY,
  ScoreBand,
  ScoreFactor,
  ScoreLevel,
  ScoreOverride,
  ScoreProfileRule,
  ScoringConfig,
  mergeScoringConfig,
  normalizeScoringConfig,
} from "./scoring.config";

const DAY = 86400000;

export interface FactorResult {
  code: string;
  label: string;
  metric: string;
  weight: number;
  raw: number | null;
  unit?: string;
  subScore: number | null;
  /** Weighted points this factor contributed (0-100 scale). */
  contribution: number;
  /** Share of the max contribution this factor achieved. */
  ratio: number;
  status: "good" | "warn" | "bad" | "nodata";
  note?: string;
}

export interface ScoreResult {
  score: number;
  /** Weighted score before override rules pulled the level down. */
  rawScore: number;
  level: ScoreLevel;
  band: ScoreBand;
  breakdown: FactorResult[];
  /** Share of the configured weight that had data, 0-100. */
  coverage: number;
  overridden: boolean;
  overrideNotes: string[];
  drivers: string[];
  driverSummary: string;
  missingMetrics: string[];
  computedAt: string;
}

type Scope = "client" | "project";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function daysAgo(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / DAY);
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService
  ) {}

  // ── Config ─────────────────────────────────────────────────────────────

  async getConfig(): Promise<ScoringConfig> {
    return this.cache.wrap("scoring:config", 60, async () => {
      const row = await this.prisma.settings.findUnique({
        where: { id: "default" },
        select: { scoringConfig: true, healthScoreWeights: true },
      });
      const stored = row?.scoringConfig as any;
      const hasStored = stored && typeof stored === "object" && Object.keys(stored).length > 0;
      if (hasStored) return normalizeScoringConfig(stored);
      // First run after the upgrade: carry the old weight table over so the
      // numbers an admin already tuned do not silently reset.
      return normalizeScoringConfig(this.legacyWeightsToConfig(row?.healthScoreWeights));
    });
  }

  /**
   * The pre-engine `healthScoreWeights` table used display names instead of
   * codes. Map the ones that have a real metric and drop the rest (NPS had no
   * data source, which is exactly why it never worked).
   */
  private legacyWeightsToConfig(weights: unknown): any {
    if (!Array.isArray(weights) || !weights.length) return DEFAULT_SCORING_CONFIG;
    const map: Record<string, string> = {
      payment: "payment",
      engagement: "engagement",
      "project activity": "delivery",
      delivery: "delivery",
      relationship: "relationship",
      "nps score": "",
      nps: "",
    };
    const byCode = new Map(DEFAULT_SCORING_CONFIG.client.factors.map((f) => [f.code, { ...f }]));
    for (const row of weights as any[]) {
      const key = String(row?.factor ?? "").trim().toLowerCase();
      const code = map[key];
      const weight = Number(row?.weight);
      if (!code || !byCode.has(code) || !Number.isFinite(weight)) continue;
      byCode.set(code, { ...(byCode.get(code) as ScoreFactor), weight: clamp(weight, 0, 100) });
    }
    // The legacy table had four entries and no commercial/relationship factor,
    // so mapped weights can add up to more than 100. Keep their ratios and
    // rescale the whole profile to 100.
    const factors = [...byCode.values()];
    const sum = factors.reduce((s, f) => s + f.weight, 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.01) {
      let running = 0;
      factors.forEach((f, i) => {
        const next = i === factors.length - 1 ? 100 - running : Math.round((f.weight / sum) * 100);
        f.weight = clamp(next, 0, 100);
        running += f.weight;
      });
    }
    return {
      ...DEFAULT_SCORING_CONFIG,
      client: { ...DEFAULT_SCORING_CONFIG.client, factors },
    };
  }

  async saveConfig(patch: any, actorId?: string) {
    if (!patch || typeof patch !== "object") throw new BadRequestException("Invalid scoring config");
    const current = await this.getConfig();
    const merged = mergeScoringConfig(current, patch);
    const next = normalizeScoringConfig(merged);
    next.version = (current.version ?? 0) + 1;
    this.validate(next);

    // Keep the legacy column in sync so anything still reading it sees the
    // same weights, and a rollback does not lose the intent.
    const legacyWeights = next.client.factors.map((f) => ({ factor: f.label, weight: f.weight }));

    await this.prisma.settings.upsert({
      where: { id: "default" },
      update: {
        scoringConfig: next as any,
        healthScoreWeights: legacyWeights as any,
      },
      create: {
        id: "default",
        scoringConfig: next as any,
        healthScoreWeights: legacyWeights as any,
      },
    });

    await this.audit(actorId, "scoring.config.update", current, next);
    await this.cache.del("scoring:config");
    await this.invalidateScores();
    return next;
  }

  async resetConfig(actorId?: string) {
    const current = await this.getConfig();
    await this.prisma.settings.update({
      where: { id: "default" },
      data: { scoringConfig: DEFAULT_SCORING_CONFIG as any },
    });
    await this.audit(actorId, "scoring.config.reset", current, DEFAULT_SCORING_CONFIG);
    await this.cache.del("scoring:config");
    await this.invalidateScores();
    return this.getConfig();
  }

  private validate(config: ScoringConfig) {
    for (const scope of ["client", "project"] as const) {
      const profile = config[scope];
      if (!profile.factors.length) throw new BadRequestException(`${scope} scoring needs at least one factor`);
      const enabled = profile.factors.filter((f) => f.enabled);
      if (!enabled.length) throw new BadRequestException(`${scope} scoring needs at least one enabled factor`);
      const total = enabled.reduce((s, f) => s + f.weight, 0);
      if (total <= 0) throw new BadRequestException(`${scope} factor weights must add up to more than 0`);
      for (const f of enabled) {
        if (!METRIC_REGISTRY[f.metric] || METRIC_REGISTRY[f.metric].scope !== scope) {
          throw new BadRequestException(`Unknown ${scope} metric "${f.metric}" on factor "${f.code}"`);
        }
        if (f.type === "bands" && (!f.bands || !f.bands.length)) {
          throw new BadRequestException(`Factor "${f.code}" needs at least one band`);
        }
        if (f.type === "linear" && (f.min === undefined || f.max === undefined || f.max === f.min)) {
          throw new BadRequestException(`Factor "${f.code}" needs different min/max for linear scoring`);
        }
      }
      for (const o of profile.overrides) {
        const metric = METRIC_REGISTRY[o.metric];
        if (!metric || metric.scope !== scope) {
          throw new BadRequestException(`Unknown ${scope} override metric "${o.metric}"`);
        }
      }
      for (const p of profile.profiles ?? []) {
        if (!p.match.billingCycleType.length) {
          throw new BadRequestException(`Profile "${p.label}" needs at least one billing cycle`);
        }
        for (const code of Object.keys(p.weights)) {
          if (!profile.factors.some((f) => f.code === code)) {
            throw new BadRequestException(`Profile "${p.label}" targets unknown factor "${code}"`);
          }
        }
      }
    }
    const overallEnabled = config.overall.components.filter((c) => c.enabled);
    if (config.overall.enabled && !overallEnabled.length) {
      throw new BadRequestException("Overall score needs at least one enabled component");
    }
    if (overallEnabled.reduce((s, c) => s + c.weight, 0) <= 0) {
      throw new BadRequestException("Overall component weights must add up to more than 0");
    }
    for (const c of overallEnabled) {
      if (!OVERALL_COMPONENT_REGISTRY[c.key]) {
        throw new BadRequestException(`Unknown overall component "${c.key}"`);
      }
    }
  }

  private async audit(actorId: string | undefined, action: string, before: any, after: any) {
    try {
      await this.prisma.systemAuditLog.create({
        data: {
          actorUserId: actorId ?? null,
          action,
          entityType: "Settings",
          entityId: "default",
          beforeValue: before as any,
          afterValue: after as any,
        },
      });
    } catch {
      /* auditing must never fail the request */
    }
  }

  // ── Evaluation (pure) ──────────────────────────────────────────────────

  private normalizeValue(factor: ScoreFactor, raw: number | null): number | null {
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
      if (factor.missing === "neutral") return 50;
      if (factor.missing === "zero") return 0;
      return null;
    }
    if (factor.type === "linear") {
      const min = factor.min ?? 0;
      const max = factor.max ?? 100;
      if (max === min) return null;
      const ratio =
        factor.direction === "higherBetter" ? (raw - min) / (max - min) : (max - raw) / (max - min);
      return clamp(Math.round(ratio * 100), 0, 100);
    }
    const bands = factor.bands ?? [];
    for (const band of bands) {
      if (band.lte === null || raw <= band.lte) return band.score;
    }
    // No catch-all band: fall through to the worst band rather than guessing.
    return bands.length ? bands[bands.length - 1].score : 0;
  }

  private pickBand(bands: ScoreBand[], score: number): ScoreBand {
    const sorted = [...bands].sort((a, b) => b.min - a.min);
    return sorted.find((b) => score >= b.min) ?? sorted[sorted.length - 1];
  }

  /** Apply a segment profile's weight overrides to the base factors. */
  private profileFactors(
    base: ScoreFactor[],
    profiles: ScoreProfileRule[] | undefined,
    billingCycleType?: string | null,
    explicitProfileId?: string | null
  ): { factors: ScoreFactor[]; applied: string | null } {
    if (!profiles?.length) return { factors: base, applied: null };
    // An explicit id on the client wins over the billing-cycle match.
    const rule =
      (explicitProfileId && profiles.find((p) => p.id === explicitProfileId)) ||
      (billingCycleType ? profiles.find((p) => p.match.billingCycleType.includes(billingCycleType)) : undefined);
    if (!rule) return { factors: base, applied: null };
    return {
      factors: base.map((f) =>
        rule.weights[f.code] !== undefined ? { ...f, weight: rule.weights[f.code] } : f
      ),
      applied: rule.id,
    };
  }

  /** Profile list for the client-file selector. */
  async profileChoices() {
    const config = await this.getConfig();
    return config.client.profiles.map((p) => ({
      id: p.id,
      label: p.label,
      billingCycleType: p.match.billingCycleType,
    }));
  }

  private matchesOverride(o: ScoreOverride, metrics: Record<string, number | null>): boolean {
    const raw = metrics[o.metric];
    if (raw === null || raw === undefined) return false;
    switch (o.op) {
      case "gte": return raw >= o.value;
      case "lte": return raw <= o.value;
      case "gt": return raw > o.value;
      case "lt": return raw < o.value;
      case "eq": return raw === o.value;
      default: return false;
    }
  }

  private evaluate(
    profile: { enabled: boolean; factors: ScoreFactor[]; bands: ScoreBand[]; overrides: ScoreOverride[] },
    metrics: Record<string, number | null>,
    scope: Scope
  ): ScoreResult {
    const enabled = profile.enabled ? profile.factors.filter((f) => f.enabled) : [];
    const configuredWeight = enabled.reduce((s, f) => s + f.weight, 0);

    const breakdown: FactorResult[] = [];
    let weighted = 0;
    let usedWeight = 0;

    for (const factor of enabled) {
      const raw = metrics[factor.metric] ?? null;
      const subScore = this.normalizeValue(factor, raw);
      const contribution = subScore === null ? 0 : (subScore * factor.weight) / 100;
      if (subScore !== null) {
        weighted += subScore * factor.weight;
        usedWeight += factor.weight;
      }
      const ratio = subScore === null ? 0 : subScore;
      breakdown.push({
        code: factor.code,
        label: factor.label,
        metric: factor.metric,
        weight: factor.weight,
        raw,
        unit: factor.unit,
        subScore,
        contribution: Math.round(contribution * 10) / 10,
        ratio,
        status: subScore === null ? "nodata" : subScore >= 70 ? "good" : subScore >= 40 ? "warn" : "bad",
        note: subScore === null ? "no data" : undefined,
      });
    }

    const rawScore = usedWeight > 0 ? Math.round(weighted / usedWeight) : 0;
    let score = rawScore;
    const coverage = configuredWeight > 0 ? Math.round((usedWeight / configuredWeight) * 100) : 0;
    const baseBand = this.pickBand(profile.bands, rawScore);
    let level: ScoreLevel = baseBand.level;
    let band = baseBand;
    const overrideNotes: string[] = [];

    for (const o of profile.overrides) {
      if (!o.enabled || !this.matchesOverride(o, metrics)) continue;
      const before = level;
      if (o.action === "set") level = o.level;
      else level = LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[o.level] ? level : o.level;
      if (level !== before || o.action === "set") {
        overrideNotes.push(o.note || o.label || `Override rule ${o.id} applied`);
      }
    }
    // Keep the number and the traffic light consistent: if an override pulled
    // the level down, the score cannot sit in a healthier band. This matters
    // because project risk is stored as 100 - score.
    if (LEVEL_SEVERITY[level] > LEVEL_SEVERITY[baseBand.level]) {
      const ceiling = level === "RED" ? 39 : 69;
      score = Math.min(score, ceiling);
    }
    if (level !== baseBand.level) {
      band = this.pickBand(profile.bands, score);
    }

    const ranked = breakdown
      .filter((b) => b.subScore !== null)
      .sort((a, b) => a.ratio - b.ratio)
      .sort((a, b) => b.weight * (100 - b.ratio) - a.weight * (100 - a.ratio));
    const drivers = ranked
      .filter((b) => b.ratio < 70)
      .slice(0, 3)
      .map((b) => `${b.label} ${b.subScore}/100${b.raw !== null && b.unit ? ` (${Math.round(b.raw)} ${b.unit})` : ""}`);

    return {
      score,
      rawScore,
      level,
      band: { ...band, level },
      breakdown,
      coverage,
      overridden: level !== baseBand.level,
      overrideNotes,
      drivers,
      driverSummary: [...overrideNotes, ...drivers].join(" · ") || (scope === "client" ? "healthy" : "on track"),
      missingMetrics: breakdown.filter((b) => b.subScore === null).map((b) => b.label),
      computedAt: new Date().toISOString(),
    };
  }

  // ── Metric collection ──────────────────────────────────────────────────

  private async collectClientMetrics(
    clientId: string
  ): Promise<{ metrics: Record<string, number | null>; billingCycleType: string; scoreProfile: string | null }> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        invoices: {
          select: {
            status: true, dueDate: true,
            taxApplicable: true, taxRate: true, discountRate: true, shippingFee: true,
            lineItems: { select: { amount: true } },
            payments: { select: { amount: true, type: true } },
          },
        },
        projects: { select: { id: true, status: true, healthStatus: true } },
        churnFlags: {
          where: { flaggedAt: { gte: new Date(Date.now() - 30 * DAY) } },
          select: { riskLevel: true },
        },
        contacts: { select: { id: true, lastPortalLogin: true } },
        clientComments: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { createdAt: true, sentiment: true },
        },
        calendarEvents: { orderBy: { date: "desc" }, take: 20, select: { date: true } },
      },
    });
    if (!client) throw new NotFoundException("Client not found");

    const now = Date.now();
    let invoiced = 0;
    let paid = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    let oldestOverdueDays = 0;

    for (const inv of client.invoices) {
      const t = invoiceTotals(inv);
      if (isReceivable(inv.status)) {
        invoiced += t.grand;
        paid += t.paid;
        if (t.balance > 0 && inv.dueDate && new Date(inv.dueDate).getTime() < now) {
          overdueCount += 1;
          overdueAmount += t.balance;
          oldestOverdueDays = Math.max(
            oldestOverdueDays,
            Math.floor((now - new Date(inv.dueDate).getTime()) / DAY)
          );
        }
      }
    }

    const activeProjects = client.projects.filter((p) => p.status === "ACTIVE");
    const atRiskProjects = client.projects.filter(
      (p) => p.healthStatus !== "ON_TRACK" && p.status !== "COMPLETED" && p.status !== "ARCHIVED"
    );

    const projectIds = client.projects.map((p) => p.id);
    const openTasks = projectIds.length
      ? await this.prisma.task.findMany({
          where: { projectId: { in: projectIds }, status: { not: "DONE" } },
          select: { dueDate: true, status: true },
        })
      : [];
    const overdueTasks = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length;

    // Engagement = the most recent real touch, across every channel we store.
    const touches: number[] = [];
    for (const c of client.clientComments) touches.push(new Date(c.createdAt).getTime());
    for (const e of client.calendarEvents) {
      const t = new Date(e.date).getTime();
      if (!Number.isNaN(t) && t <= now) touches.push(t);
    }
    for (const c of client.contacts) {
      if (c.lastPortalLogin) touches.push(new Date(c.lastPortalLogin).getTime());
    }
    const lastTouch = touches.length ? Math.max(...touches) : null;

    const negative30d = client.clientComments.filter(
      (c) => c.sentiment === "NEGATIVE_URGENT" && new Date(c.createdAt).getTime() >= now - 30 * DAY
    ).length;

    return {
      billingCycleType: String(client.billingCycleType),
      scoreProfile: (client as any).scoreProfile ?? null,
      metrics: {
        overdueInvoiceCount: overdueCount,
        overdueAmount: Math.round(overdueAmount * 100) / 100,
        oldestOverdueDays,
        atRiskProjectCount: atRiskProjects.length,
        activeProjectCount: activeProjects.length,
        overdueTaskCount: overdueTasks,
        overdueTaskRatio: openTasks.length ? Math.round((overdueTasks / openTasks.length) * 100) : null,
        daysSinceContact: lastTouch === null ? null : Math.floor((now - lastTouch) / DAY),
        contactCount: client.contacts.length,
        negativeSentimentCount: negative30d,
        churnFlagged: client.churnFlags.length ? 1 : 0,
        renewalDays: client.renewalDate ? Math.floor((new Date(client.renewalDate).getTime() - now) / DAY) : null,
        collectionRate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : null,
      },
    };
  }

  private async collectProjectMetrics(projectId: string): Promise<Record<string, number | null>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        milestones: { select: { dueDate: true, status: true } },
        tasks: { where: { status: { not: "DONE" } }, select: { dueDate: true, status: true } },
        expenses: { where: { approvalStatus: "APPROVED" }, select: { amount: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const now = Date.now();
    let slip = 0;
    for (const m of project.milestones) {
      if (m.status === "COMPLETED" || !m.dueDate) continue;
      slip = Math.max(slip, Math.floor((now - new Date(m.dueDate).getTime()) / DAY));
    }
    if (
      project.targetEndDate &&
      (project.status === "ACTIVE" || project.status === "PLANNING") &&
      new Date(project.targetEndDate).getTime() < now
    ) {
      slip = Math.max(slip, Math.floor((now - new Date(project.targetEndDate).getTime()) / DAY));
    }

    const budget = Number(project.budgetAmount ?? project.amount ?? 0);
    const expenseSum = project.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const spent = Number(project.spentAmount ?? 0) || expenseSum;
    const budgetUsedPct = budget > 0 ? Math.round((spent / budget) * 100) : null;
    const progress = clamp(Number(project.progress ?? 0), 0, 100);
    let budgetBurnRatio: number | null = null;
    if (budget > 0) {
      if (progress <= 0) budgetBurnRatio = spent > 0 ? 200 : 0;
      else budgetBurnRatio = Math.round(((spent / budget) * 100 / progress) * 100);
    }

    let progressGap: number | null = null;
    if (project.startDate && project.targetEndDate) {
      const start = new Date(project.startDate).getTime();
      const end = new Date(project.targetEndDate).getTime();
      if (end > start) {
        const expected = clamp(((now - start) / (end - start)) * 100, 0, 100);
        progressGap = Math.round((expected - progress) * 10) / 10;
      }
    }

    const blocked = project.tasks.filter((t) => t.status === "BLOCKED").length;
    const overdueTasks = project.tasks.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() < now
    ).length;

    return {
      scheduleSlipDays: slip,
      budgetBurnRatio,
      budgetUsedPct,
      progressGap,
      actualProgress: progress,
      blockedTaskCount: blocked,
      overdueTaskCountProject: overdueTasks,
      pmConfidence: project.confidenceScore ?? null,
    };
  }

  // ── Public compute / persist ───────────────────────────────────────────

  async previewClient(clientId: string, configOverride?: any, metricsOverride?: Record<string, number | null>) {
    const config = configOverride
      ? normalizeScoringConfig(mergeScoringConfig(await this.getConfig(), configOverride))
      : await this.getConfig();
    const collected = await this.collectClientMetrics(clientId);
    const metrics = { ...collected.metrics, ...(metricsOverride ?? {}) };
    const { factors, applied } = this.profileFactors(
      config.client.factors,
      config.client.profiles,
      collected.billingCycleType,
      collected.scoreProfile
    );
    return {
      metrics,
      billingCycleType: collected.billingCycleType,
      scoreProfile: applied,
      ...this.evaluate({ ...config.client, factors }, metrics, "client"),
    };
  }

  async previewProject(projectId: string, configOverride?: any, metricsOverride?: Record<string, number | null>) {
    const config = configOverride
      ? normalizeScoringConfig(mergeScoringConfig(await this.getConfig(), configOverride))
      : await this.getConfig();
    const metrics = { ...(await this.collectProjectMetrics(projectId)), ...(metricsOverride ?? {}) };
    return { metrics, ...this.evaluate(config.project, metrics, "project") };
  }

  async recomputeClient(clientId: string, configOverride?: any, silent = false) {
    const config = configOverride ? normalizeScoringConfig(configOverride) : await this.getConfig();
    if (!config.client.enabled) return { id: clientId, skipped: true };
    const collected = await this.collectClientMetrics(clientId);
    const { factors, applied } = this.profileFactors(
      config.client.factors,
      config.client.profiles,
      collected.billingCycleType,
      collected.scoreProfile
    );
    const result = this.evaluate({ ...config.client, factors }, collected.metrics, "client");

    const previous = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { healthLevel: true, companyName: true },
    });

    const last = await this.prisma.clientHealthLog.findFirst({
      where: { clientId },
      orderBy: { recordedAt: "desc" },
      select: { score: true },
    });

    if (!last || last.score !== result.score) {
      await this.prisma.clientHealthLog.create({
        data: {
          clientId,
          score: result.score,
          level: result.level,
          driverSummary: result.driverSummary,
          breakdown: result.breakdown as any,
        },
      });
    }

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        healthScore: result.score,
        healthLevel: result.level,
        healthDriver: result.driverSummary,
        healthBreakdown: { ...result, metrics: collected.metrics } as any,
        healthComputedAt: new Date(),
      },
    });

    if (!silent) {
      await this.maybeAlert("client", previous?.companyName ?? "Client", clientId, previous?.healthLevel, result, `/accounts`);
    }
    await this.invalidateScores();
    return { id: clientId, billingCycleType: collected.billingCycleType, scoreProfile: applied, ...result };
  }

  async recomputeProject(projectId: string, configOverride?: any, silent = false) {
    const config = configOverride ? normalizeScoringConfig(configOverride) : await this.getConfig();
    if (!config.project.enabled) return { id: projectId, skipped: true };

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, clientId: true, name: true, status: true, riskScore: true,
        healthStatus: true, healthStatusOverride: true, confidenceScore: true,
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    if (project.status === "COMPLETED" || project.status === "ARCHIVED") {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { healthStatus: "ON_TRACK", healthComputedAt: new Date() },
      });
      return { id: projectId, skipped: true, reason: "closed project" };
    }

    const metrics = await this.collectProjectMetrics(projectId);
    const result = this.evaluate(config.project, metrics, "project");
    const riskScore = clamp(100 - result.score, 0, 100);
    const derived: "ON_TRACK" | "AT_RISK" | "DELAYED" =
      result.level === "GREEN" ? "ON_TRACK" : result.level === "YELLOW" ? "AT_RISK" : "DELAYED";
    const effective = project.healthStatusOverride ?? derived;

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        riskScore,
        riskDriver: result.driverSummary,
        healthStatus: effective,
        healthBreakdown: { ...result, riskScore, derived, metrics } as any,
        healthComputedAt: new Date(),
      },
    });

    if (project.riskScore !== riskScore) {
      await this.prisma.projectRiskLog.create({
        data: {
          projectId,
          riskScore,
          primaryDriver: result.driverSummary,
          breakdown: result.breakdown as any,
        },
      });
    }

    if (!silent) {
      await this.maybeAlert(
        "project",
        project.name,
        projectId,
        project.healthStatus,
        result,
        `/flow/${projectId}`
      );
    }
    await this.invalidateScores();
    return { id: projectId, clientId: project.clientId, riskScore, derived, manualOverride: !!project.healthStatusOverride, ...result };
  }

  /** Recompute every project for a client, then the client itself. */
  async recomputeClientTree(clientId: string) {
    const projects = await this.prisma.project.findMany({
      where: { clientId, status: { notIn: ["COMPLETED", "ARCHIVED"] } },
      select: { id: true },
    });
    for (const p of projects) await this.recomputeProject(p.id);
    return this.recomputeClient(clientId);
  }

  async recomputeAll(scope: "clients" | "projects" | "all" = "all", silent = true) {
    if (this.running) return { skipped: true, reason: "a recompute is already running" };
    this.running = true;
    const startedAt = Date.now();
    try {
      let projects = 0;
      let clients = 0;
      if (scope !== "clients") {
        const rows = await this.prisma.project.findMany({
          where: { status: { notIn: ["COMPLETED", "ARCHIVED"] } },
          select: { id: true },
        });
        for (const p of rows) {
          await this.recomputeProject(p.id, undefined, silent);
          projects += 1;
        }
      }
      if (scope !== "projects") {
        const rows = await this.prisma.client.findMany({ select: { id: true } });
        for (const c of rows) {
          await this.recomputeClient(c.id, undefined, silent);
          clients += 1;
        }
      }
      const result = { projects, clients, tookMs: Date.now() - startedAt, at: new Date().toISOString() };
      await this.cache.set("scoring:last-run", result, 7 * 24 * 3600);
      return result;
    } finally {
      this.running = false;
    }
  }

  // ── Weight calibration ─────────────────────────────────────────────────

  /**
   * Suggests weights from the same data the backtest uses: how far apart were
   * churned and retained clients on each factor 90 days before the outcome.
   * A factor that reads the same in both groups earns no weight.
   */
  async calibrate(days = 90) {
    return this.cache.wrap(`scoring:calibrate:${days}`, 120, async () => {
      const cutoff = new Date(Date.now() - days * DAY);
      const clients = await this.prisma.client.findMany({
        select: {
          id: true,
          companyName: true,
          category: true,
          healthLogs: {
            orderBy: { recordedAt: "desc" },
            select: { score: true, breakdown: true, recordedAt: true },
          },
          churnFlags: { select: { flaggedAt: true } },
        },
      });

      const samples: { churned: boolean; scores: Record<string, number> }[] = [];
      let method: "historical" | "current-snapshot" = "historical";
      const factorList = (raw: any): any[] | null => {
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.breakdown)) return raw.breakdown;
        return null;
      };
      const collect = (cutoffDate: Date | null) => {
        const out: { churned: boolean; scores: Record<string, number> }[] = [];
        for (const c of clients) {
          const snapshot = cutoffDate
            ? c.healthLogs.find(
                (l) =>
                  new Date(l.recordedAt).getTime() <= cutoffDate.getTime() &&
                  factorList(l.breakdown) !== null
              )
            : c.healthLogs.find((l) => factorList(l.breakdown) !== null);
          if (!snapshot) continue;
          const flaggedAfter = cutoffDate
            ? c.churnFlags.some((f) => new Date(f.flaggedAt).getTime() > cutoffDate.getTime())
            : c.churnFlags.length > 0;
          const scores: Record<string, number> = {};
          for (const factor of factorList(snapshot.breakdown) as any[]) {
            if (factor?.code && factor.subScore !== null && factor.subScore !== undefined) {
              scores[factor.code] = Number(factor.subScore);
            }
          }
          out.push({ churned: c.category === "ARCHIVED" || flaggedAfter, scores });
        }
        return out;
      };

      samples.push(...collect(cutoff));
      // Until ~90 days of breakdown history exists, fall back to each client's
      // latest breakdown. It is an exploratory view (no time machine), so the
      // response says so instead of pretending it is a backtest.
      if (samples.length < 4) {
        const current = collect(null);
        if (current.length > samples.length) {
          samples.length = 0;
          samples.push(...current);
          method = "current-snapshot";
        }
      }

      const config = await this.getConfig();
      const mean = (values: number[]) =>
        values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null;

      const rows = config.client.factors
        .filter((f) => f.enabled)
        .map((f) => {
          const churned = samples.filter((s) => s.churned).map((s) => s.scores[f.code]).filter((v) => v != null);
          const retained = samples.filter((s) => !s.churned).map((s) => s.scores[f.code]).filter((v) => v != null);
          const meanChurned = mean(churned);
          const meanRetained = mean(retained);
          const separation =
            meanChurned !== null && meanRetained !== null
              ? Math.round(Math.abs(meanRetained - meanChurned) * 10) / 10
              : null;
          return {
            code: f.code,
            label: f.label,
            currentWeight: f.weight,
            meanChurned,
            meanRetained,
            separation,
            churnedSamples: churned.length,
            retainedSamples: retained.length,
            suggestedWeight: 0,
          };
        });

      const totalSeparation = rows.reduce((s, r) => s + (r.separation ?? 0), 0);
      if (totalSeparation > 0) {
        let running = 0;
        rows.forEach((r, i) => {
          const value =
            r.separation === null
              ? 0
              : i === rows.length - 1
                ? 100 - running
                : Math.round((r.separation / totalSeparation) * 100);
          r.suggestedWeight = Math.max(0, Math.min(100, value));
          running += r.suggestedWeight;
        });
      }

      return {
        days,
        cutoff,
        method,
        caveat:
          method === "current-snapshot"
            ? "Not enough historical breakdowns yet — this compares each client's current factors with their current outcome. Re-run after a few months of snapshots for a true backtest."
            : null,
        sample: samples.length,
        churned: samples.filter((s) => s.churned).length,
        retained: samples.filter((s) => !s.churned).length,
        reliable: samples.filter((s) => s.churned).length >= 2 && samples.filter((s) => !s.churned).length >= 2,
        rows,
      };
    });
  }

  // ── Trend forecast ─────────────────────────────────────────────────────

  /** Linear regression over the last N snapshots, projected 4 weeks ahead. */
  async forecast(scope: "client" | "project", id: string, points = 8) {
    const config = await this.getConfig();
    const take = Math.min(52, Math.max(3, points));

    let rows: { date: Date; value: number }[] = [];
    if (scope === "client") {
      const logs = await this.prisma.clientHealthLog.findMany({
        where: { clientId: id },
        orderBy: { recordedAt: "desc" },
        take,
        select: { score: true, recordedAt: true },
      });
      rows = logs.reverse().map((l) => ({ date: new Date(l.recordedAt), value: l.score }));
    } else {
      const logs = await this.prisma.projectRiskLog.findMany({
        where: { projectId: id },
        orderBy: { calculatedAt: "desc" },
        take,
        select: { riskScore: true, calculatedAt: true },
      });
      rows = logs.reverse().map((l) => ({ date: new Date(l.calculatedAt), value: 100 - l.riskScore }));
    }

    if (rows.length < 2) {
      return { scope, id, insufficient: true, points: rows, sample: rows.length };
    }

    const base = rows[0].date.getTime();
    const xs = rows.map((r) => (r.date.getTime() - base) / DAY);
    const ys = rows.map((r) => r.value);
    const n = xs.length;
    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    const sxx = xs.reduce((s, v) => s + (v - meanX) ** 2, 0);
    const sxy = xs.reduce((s, v, i) => s + (v - meanX) * (ys[i] - meanY), 0);
    const slopePerDay = sxx > 0 ? sxy / sxx : 0;
    const intercept = meanY - slopePerDay * meanX;
    const ssRes = xs.reduce((s, v, i) => s + (ys[i] - (intercept + slopePerDay * v)) ** 2, 0);
    const ssTot = ys.reduce((s, v) => s + (v - meanY) ** 2, 0);
    const r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

    const current = ys[ys.length - 1];
    const slopePerWeek = Math.round(slopePerDay * 7 * 10) / 10;
    const projected = Math.max(0, Math.min(100, Math.round(current + slopePerDay * 28)));
    const profile = scope === "client" ? config.client : config.project;
    const currentBand = this.pickBand(profile.bands, current);
    const projectedBand = this.pickBand(profile.bands, projected);

    // How many weeks until the trend crosses the next band boundary.
    const boundaries = [...new Set(profile.bands.map((b) => b.min))]
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    let crossing: { weeks: number; at: number } | null = null;
    if (Math.abs(slopePerWeek) > 0.05) {
      const candidates = boundaries
        .filter((b) => (slopePerWeek < 0 ? b < current : b > current))
        .map((b) => ({ at: b, weeks: Math.round(((b - current) / slopePerWeek) * 10) / 10 }))
        .filter((c) => c.weeks > 0);
      crossing = candidates.sort((a, b) => a.weeks - b.weeks)[0] ?? null;
    }

    return {
      scope,
      id,
      sample: n,
      points: rows,
      current,
      slopePerWeek,
      r2: Math.round(r2 * 100) / 100,
      projected,
      currentLevel: currentBand.level,
      currentLabel: currentBand.label,
      projectedLevel: projectedBand.level,
      projectedLabel: projectedBand.label,
      crossing,
      direction: slopePerWeek > 0.05 ? "improving" : slopePerWeek < -0.05 ? "declining" : "flat",
    };
  }

  // ── Read models for the admin UI ───────────────────────────────────────

  async clientHistory(clientId: string, take = 30) {
    return this.prisma.clientHealthLog.findMany({
      where: { clientId },
      orderBy: { recordedAt: "desc" },
      take: Math.min(200, Math.max(1, take)),
      select: { id: true, score: true, level: true, driverSummary: true, breakdown: true, recordedAt: true },
    });
  }

  async projectHistory(projectId: string, take = 30) {
    return this.prisma.projectRiskLog.findMany({
      where: { projectId },
      orderBy: { calculatedAt: "desc" },
      take: Math.min(200, Math.max(1, take)),
      select: { id: true, riskScore: true, primaryDriver: true, breakdown: true, calculatedAt: true },
    });
  }

  async overview() {
    return this.cache.wrap("scoring:overview", 30, async () => {
      const config = await this.getConfig();
      const staleBefore = new Date(Date.now() - config.schedule.staleAfterHours * 3600000);
      const [clients, projects, lastRun] = await Promise.all([
        this.prisma.client.findMany({
          select: { healthScore: true, healthLevel: true, healthComputedAt: true, category: true },
        }),
        this.prisma.project.findMany({
          where: { status: { notIn: ["COMPLETED", "ARCHIVED"] } },
          select: { riskScore: true, healthStatus: true, healthComputedAt: true },
        }),
        this.cache.get<any>("scoring:last-run"),
      ]);

      const clientDist = { GREEN: 0, YELLOW: 0, RED: 0 };
      for (const c of clients) clientDist[c.healthLevel] = (clientDist[c.healthLevel] ?? 0) + 1;
      const projectDist = { ON_TRACK: 0, AT_RISK: 0, DELAYED: 0 };
      for (const p of projects) projectDist[p.healthStatus] = (projectDist[p.healthStatus] ?? 0) + 1;

      return {
        clients: {
          total: clients.length,
          avg: clients.length
            ? Math.round(clients.reduce((s, c) => s + (c.healthScore ?? 0), 0) / clients.length)
            : null,
          distribution: clientDist,
          atRisk: clientDist.YELLOW + clientDist.RED,
          neverScored: clients.filter((c) => !c.healthComputedAt).length,
          stale: clients.filter((c) => c.healthComputedAt && c.healthComputedAt < staleBefore).length,
        },
        projects: {
          total: projects.length,
          avgRisk: projects.length
            ? Math.round(projects.reduce((s, p) => s + (p.riskScore ?? 0), 0) / projects.length)
            : null,
          distribution: projectDist,
          atRisk: projectDist.AT_RISK + projectDist.DELAYED,
          neverScored: projects.filter((p) => !p.healthComputedAt).length,
          stale: projects.filter((p) => p.healthComputedAt && p.healthComputedAt < staleBefore).length,
        },
        config: {
          version: config.version,
          schedule: config.schedule,
          alerts: config.alerts,
          overall: config.overall,
          overallComponents: OVERALL_COMPONENT_REGISTRY,
        },
        lastRun: lastRun ?? null,
        metricRegistry: METRIC_REGISTRY,
      };
    });
  }

  // ── Overall score ──────────────────────────────────────────────────────

  /**
   * Combines the module-level numbers into the single business health score.
   * The values are computed by the dashboard (collection rate, on-track share,
   * attendance, average client health) and only the weights/bands live here.
   */
  async computeOverall(values: Record<string, number | null | undefined>) {
    const config = await this.getConfig();
    const profile = config.overall;
    const enabled = profile.components.filter((c) => c.enabled);
    const used = enabled.filter((c) => values[c.key] !== null && values[c.key] !== undefined);
    const totalWeight = used.reduce((s, c) => s + c.weight, 0);
    const score =
      totalWeight > 0
        ? Math.round(used.reduce((s, c) => s + clamp(Number(values[c.key]), 0, 100) * c.weight, 0) / totalWeight)
        : 0;
    const band = this.pickBand(profile.bands, score);
    return {
      score,
      grade: band.label,
      level: band.level,
      band,
      enabled: profile.enabled,
      components: enabled.map((c) => {
        const value = clamp(Number(values[c.key] ?? 0), 0, 100);
        return {
          key: c.key,
          label: c.label,
          value,
          weight: c.weight,
          weightPct: totalWeight > 0 ? Math.round((c.weight / totalWeight) * 100) : 0,
          contribution: totalWeight > 0 ? Math.round(((value * c.weight) / totalWeight) * 10) / 10 : 0,
          status: value >= 70 ? "good" : value >= 40 ? "warn" : "bad",
        };
      }),
      missing: enabled.filter((c) => values[c.key] === null || values[c.key] === undefined).map((c) => c.key),
    };
  }

  // ── Outcome validation (backtest) ──────────────────────────────────────

  /**
   * "Does the score actually predict churn?" Takes each client's score at
   * (now - days) and compares it with what happened afterwards. Uses only data
   * that existed at the cutoff, so there is no look-ahead leak.
   */
  async backtest(days = 90) {
    return this.cache.wrap(`scoring:backtest:${days}`, 120, async () => {
      const cutoff = new Date(Date.now() - days * DAY);
      const clients = await this.prisma.client.findMany({
        select: {
          id: true,
          companyName: true,
          category: true,
          createdAt: true,
          healthLogs: {
            orderBy: { recordedAt: "desc" },
            select: { score: true, level: true, recordedAt: true },
          },
          churnFlags: { select: { flaggedAt: true, riskLevel: true } },
        },
      });

      const rows: any[] = [];
      for (const c of clients) {
        // history is newest-first: the first entry at or before the cutoff is
        // the score the team saw that day.
        const then = c.healthLogs.find((l) => new Date(l.recordedAt).getTime() <= cutoff.getTime());
        if (!then) continue;
        const flagAfter = c.churnFlags
          .filter((f) => new Date(f.flaggedAt).getTime() > cutoff.getTime())
          .sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime())[0];
        const churned = c.category === "ARCHIVED" || !!flagAfter;
        rows.push({
          id: c.id,
          companyName: c.companyName,
          thenScore: then.score,
          thenLevel: then.level,
          thenDate: then.recordedAt,
          status: c.category,
          churned,
          outcome: churned ? "churned" : c.category === "ON_HOLD" ? "paused" : "retained",
          churnSignal: flagAfter ? "churn flag" : c.category === "ARCHIVED" ? "archived" : null,
        });
      }

      const churnedRows = rows.filter((r) => r.churned);
      const retainedRows = rows.filter((r) => !r.churned);
      const wasFlagged = (r: any) => r.thenScore < 70;
      const flaggedRows = rows.filter(wasFlagged);
      const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

      return {
        days,
        cutoff,
        sample: rows.length,
        churned: churnedRows.length,
        retained: retainedRows.length,
        /** Of the clients that churned, how many were amber/red 90 days earlier. */
        catchRate: pct(churnedRows.filter(wasFlagged).length, churnedRows.length),
        /** Of the clients flagged amber/red, how many did NOT churn. */
        falseAlarmRate: pct(retainedRows.filter(wasFlagged).length, retainedRows.length),
        /** Of everyone flagged, how many actually churned. */
        precision: pct(flaggedRows.filter((r) => r.churned).length, flaggedRows.length),
        /** Churned while green — the most instructive cases. */
        surprises: churnedRows.filter((r) => !wasFlagged(r)),
        rows: rows.sort((a, b) => a.thenScore - b.thenScore),
      };
    });
  }

  /** Sample rows for the Preview tab pickers. */
  async subjects(q?: string) {
    const search = (q ?? "").trim();
    const [clients, projects] = await Promise.all([
      this.prisma.client.findMany({
        where: search ? { companyName: { contains: search, mode: "insensitive" } } : undefined,
        select: { id: true, companyName: true, healthScore: true, healthLevel: true, healthComputedAt: true },
        orderBy: { companyName: "asc" },
        take: 50,
      }),
      this.prisma.project.findMany({
        where: {
          status: { notIn: ["COMPLETED", "ARCHIVED"] },
          ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, riskScore: true, healthStatus: true, healthComputedAt: true, client: { select: { companyName: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return { clients, projects, metrics: METRIC_REGISTRY };
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  @Cron("0 2 * * *")
  async nightlyRecompute() {
    const config = await this.getConfig();
    if (!config.schedule.enabled) return;
    try {
      const result = await this.recomputeAll("all", false);
      this.logger.log(`Nightly scoring recompute finished: ${JSON.stringify(result)}`);
    } catch (e: any) {
      this.logger.error(`Nightly scoring recompute failed: ${e?.message ?? e}`);
    }
  }

  /**
   * Notify the configured roles when a score worsens into an alert band.
   * Only a downgrade fires — the nightly recompute must not re-alert a client
   * that has been red for weeks.
   */
  private async maybeAlert(
    scope: "client" | "project",
    name: string,
    id: string,
    previousLevel: string | null | undefined,
    result: { level: ScoreLevel; score: number; driverSummary: string },
    link: string
  ) {
    try {
      const config = await this.getConfig();
      if (!config.alerts.enabled) return;
      const policy = config.alerts[scope];

      const toScoreLevel = (value?: string | null): ScoreLevel | null => {
        if (!value) return null;
        if (value === "ON_TRACK") return "GREEN";
        if (value === "AT_RISK") return "YELLOW";
        if (value === "DELAYED") return "RED";
        if (value === "GREEN" || value === "YELLOW" || value === "RED") return value;
        return null;
      };
      const before = toScoreLevel(previousLevel);
      const worsened = !before || LEVEL_SEVERITY[result.level] > LEVEL_SEVERITY[before];
      const improved = !!before && LEVEL_SEVERITY[result.level] < LEVEL_SEVERITY[before];

      // Downgrades obey the per-scope level list. Recoveries are opt-in and
      // fire on any improvement, including into GREEN.
      const downgrade = worsened && policy.levels.includes(result.level);
      const recovery = improved && config.alerts.notifyImprovements;
      if (!downgrade && !recovery) return;

      const who = scope === "client" ? "Client" : "Project";
      const title = recovery
        ? `${who} recovered to ${result.level}: ${name}`
        : `${who} slipped to ${result.level}: ${name}`;
      const message = `Score ${result.score}/100. ${result.driverSummary}`;
      await Promise.all(
        policy.roles.map((role) =>
          this.notifications.notifyRole(role, "SCORING_ALERT", title, message, link).catch(() => 0)
        )
      );
    } catch (e: any) {
      this.logger.warn(`Scoring alert failed for ${scope} ${id}: ${e?.message ?? e}`);
    }
  }

  private async invalidateScores() {
    await this.cache.del("accounts:overview");
    await this.cache.delPattern("accounts:list:*");
    await this.cache.del("insight:client-health");
    await this.cache.del("insight:overview");
    await this.cache.del("dashboard:overview");
    await this.cache.del("flow:overview");
    await this.cache.delPattern("flow:projects:*");
    await this.cache.del("scoring:overview");
    await this.cache.delPattern("scoring:backtest:*");
    await this.cache.delPattern("scoring:calibrate:*");
  }
}
