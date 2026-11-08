/**
 * Scoring engine configuration.
 *
 * Every number that used to be hardcoded in `accounts.service.ts` lives here as
 * data, so an admin can change weights, bands and override rules without a
 * deploy. The engine itself only knows how to: read a metric, normalise it to
 * 0-100, apply a weight, run the override rules, and pick a band.
 */

export type ScoreLevel = "GREEN" | "YELLOW" | "RED";
export type FactorDirection = "lowerBetter" | "higherBetter";
export type MissingPolicy = "exclude" | "neutral" | "zero";
export type NormalizeType = "bands" | "linear";

export interface FactorBand {
  /** Matches when `raw <= lte`. `null` is the catch-all band. */
  lte: number | null;
  /** 0-100 sub-score for this band. */
  score: number;
}

export interface ScoreFactor {
  code: string;
  label: string;
  description?: string;
  weight: number;
  enabled: boolean;
  /** Metric key from the registry in scoring.service.ts. */
  metric: string;
  direction: FactorDirection;
  type: NormalizeType;
  bands?: FactorBand[];
  /** Linear bounds, only used when `type === "linear"`. */
  min?: number;
  max?: number;
  /** What to do when the metric has no data (new client, no invoices, ...). */
  missing: MissingPolicy;
  unit?: string;
  /** Show the raw value on the explainability card. */
  showRaw?: boolean;
}

export interface ScoreOverride {
  id: string;
  label?: string;
  enabled: boolean;
  metric: string;
  op: "gte" | "lte" | "gt" | "lt" | "eq";
  value: number;
  /** `cap` = cannot be better than this level, `set` = force this level. */
  action: "cap" | "set";
  level: ScoreLevel;
  note?: string;
}

export interface ScoreBand {
  /** Lower bound of the band (inclusive). */
  min: number;
  level: ScoreLevel;
  label: string;
  color: string;
  /** What the team should do when a score lands here. */
  action?: string;
}

export interface ScoreProfile {
  enabled: boolean;
  factors: ScoreFactor[];
  bands: ScoreBand[];
  overrides: ScoreOverride[];
  /**
   * Segment-specific weight overrides. The first profile whose
   * `match.billingCycleType` contains the client's billing cycle wins; the base
   * factors are reused with only the weights replaced.
   */
  profiles: ScoreProfileRule[];
}

export interface ScoreProfileRule {
  id: string;
  label: string;
  match: { billingCycleType: string[] };
  weights: Record<string, number>;
}

export interface OverallComponent {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
}

export interface OverallProfile {
  enabled: boolean;
  components: OverallComponent[];
  bands: ScoreBand[];
}

export interface AlertPolicy {
  levels: ScoreLevel[];
  /** Role names to notify via NotificationsService. */
  roles: string[];
}

export interface AlertConfig {
  enabled: boolean;
  /** Also notify when a score recovers into a better band. */
  notifyImprovements: boolean;
  client: AlertPolicy;
  project: AlertPolicy;
}

export interface ScoringConfig {
  version: number;
  client: ScoreProfile;
  project: ScoreProfile;
  overall: OverallProfile;
  alerts: AlertConfig;
  schedule: {
    enabled: boolean;
    /** Informational: when the nightly job runs. */
    time: string;
    /** Scores older than this get flagged as stale in the UI. */
    staleAfterHours: number;
  };
}

export const DEFAULT_CLIENT_FACTORS: ScoreFactor[] = [
  {
    code: "payment",
    label: "Payment behavior",
    description: "Overdue invoices. Fewer is better; 30+ days late is escalated by an override rule.",
    weight: 30,
    enabled: true,
    metric: "overdueInvoiceCount",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 100 },
      { lte: 1, score: 70 },
      { lte: 2, score: 50 },
      { lte: 3, score: 30 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "invoices",
    showRaw: true,
  },
  {
    code: "delivery",
    label: "Delivery",
    description: "Projects the PM has flagged at risk or delayed.",
    weight: 20,
    enabled: true,
    metric: "atRiskProjectCount",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 100 },
      { lte: 1, score: 60 },
      { lte: 2, score: 30 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "projects",
    showRaw: true,
  },
  {
    code: "engagement",
    label: "Engagement recency",
    description: "Days since the last client comment, meeting or portal login.",
    weight: 20,
    enabled: true,
    metric: "daysSinceContact",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 7, score: 100 },
      { lte: 14, score: 80 },
      { lte: 30, score: 55 },
      { lte: 60, score: 25 },
      { lte: null, score: 10 },
    ],
    missing: "exclude",
    unit: "days",
    showRaw: true,
  },
  {
    code: "commercial",
    label: "Renewal proximity",
    description: "How close the renewal date is. A renewal inside 30 days needs attention.",
    weight: 15,
    enabled: true,
    metric: "renewalDays",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 40 },
      { lte: 14, score: 60 },
      { lte: 30, score: 80 },
      { lte: null, score: 100 },
    ],
    missing: "exclude",
    unit: "days",
    showRaw: true,
  },
  {
    code: "relationship",
    label: "Relationship depth",
    description: "Number of named contacts. One contact is a single point of failure.",
    weight: 15,
    enabled: true,
    metric: "contactCount",
    direction: "higherBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 0 },
      { lte: 1, score: 50 },
      { lte: 2, score: 85 },
      { lte: null, score: 100 },
    ],
    missing: "exclude",
    unit: "contacts",
    showRaw: true,
  },
];

export const DEFAULT_PROJECT_FACTORS: ScoreFactor[] = [
  {
    code: "schedule",
    label: "Schedule",
    description: "Worst milestone slip, or how far the target end date has passed.",
    weight: 25,
    enabled: true,
    metric: "scheduleSlipDays",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 100 },
      { lte: 3, score: 85 },
      { lte: 7, score: 65 },
      { lte: 14, score: 40 },
      { lte: 30, score: 20 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "days",
    showRaw: true,
  },
  {
    code: "budget",
    label: "Budget burn",
    description: "Spend % divided by progress %. 100 = spend is exactly on plan.",
    weight: 25,
    enabled: true,
    metric: "budgetBurnRatio",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 80, score: 100 },
      { lte: 100, score: 85 },
      { lte: 115, score: 60 },
      { lte: 140, score: 35 },
      { lte: 200, score: 15 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "%",
    showRaw: true,
  },
  {
    code: "progress",
    label: "Progress vs plan",
    description: "Percentage points behind the expected progress for the elapsed timeline.",
    weight: 20,
    enabled: true,
    metric: "progressGap",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: -10, score: 100 },
      { lte: 0, score: 95 },
      { lte: 10, score: 75 },
      { lte: 20, score: 50 },
      { lte: 35, score: 25 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "pp",
    showRaw: true,
  },
  {
    code: "quality",
    label: "Quality & blockers",
    description: "Open tasks that are blocked or past due.",
    weight: 15,
    enabled: true,
    metric: "blockedTaskCount",
    direction: "lowerBetter",
    type: "bands",
    bands: [
      { lte: 0, score: 100 },
      { lte: 1, score: 75 },
      { lte: 2, score: 55 },
      { lte: 4, score: 30 },
      { lte: null, score: 0 },
    ],
    missing: "exclude",
    unit: "tasks",
    showRaw: true,
  },
  {
    code: "confidence",
    label: "PM confidence",
    description: "The PM's own 1-5 read on the next sprint. The only subjective input.",
    weight: 15,
    enabled: true,
    metric: "pmConfidence",
    direction: "higherBetter",
    type: "bands",
    bands: [
      { lte: 1, score: 10 },
      { lte: 2, score: 35 },
      { lte: 3, score: 60 },
      { lte: 4, score: 85 },
      { lte: null, score: 100 },
    ],
    missing: "exclude",
    unit: "/5",
    showRaw: true,
  },
];

export const DEFAULT_CLIENT_BANDS: ScoreBand[] = [
  {
    min: 70,
    level: "GREEN",
    label: "Healthy",
    color: "#22c55e",
    action: "Standard cadence. Upsell and referral candidates.",
  },
  {
    min: 40,
    level: "YELLOW",
    label: "Watch",
    color: "#f59e0b",
    action: "Account owner books a real conversation this week.",
  },
  {
    min: 0,
    level: "RED",
    label: "Critical",
    color: "#ef4444",
    action: "Founder/owner save call within 5 days and a written recovery plan.",
  },
];

export const DEFAULT_PROJECT_BANDS: ScoreBand[] = [
  {
    min: 70,
    level: "GREEN",
    label: "On track",
    color: "#22c55e",
    action: "No intervention. Keep the normal reporting cadence.",
  },
  {
    min: 40,
    level: "YELLOW",
    label: "At risk",
    color: "#f59e0b",
    action: "PM reviews the weakest factor this week and logs a mitigation.",
  },
  {
    min: 0,
    level: "RED",
    label: "Delayed",
    color: "#ef4444",
    action: "Escalate to the delivery lead, produce a recovery plan with dates.",
  },
];

export const DEFAULT_OVERALL_COMPONENTS: OverallComponent[] = [
  { key: "finance", label: "Cash & collections", weight: 30, enabled: true },
  { key: "delivery", label: "Delivery health", weight: 30, enabled: true },
  { key: "people", label: "Team availability", weight: 20, enabled: true },
  { key: "clients", label: "Client health", weight: 20, enabled: true },
];

export const DEFAULT_OVERALL_BANDS: ScoreBand[] = [
  {
    min: 80,
    level: "GREEN",
    label: "Healthy",
    color: "#22c55e",
    action: "Steady state. Protect margin and keep the delivery cadence.",
  },
  {
    min: 60,
    level: "YELLOW",
    label: "Watch",
    color: "#f59e0b",
    action: "Review the weakest component in the weekly leadership meeting.",
  },
  {
    min: 0,
    level: "RED",
    label: "At risk",
    color: "#ef4444",
    action: "Run a full business review this week and assign one owner per red signal.",
  },
];

/** The only values the overall score accepts — each one is computed elsewhere. */
export const OVERALL_COMPONENT_REGISTRY: Record<string, { label: string; description: string }> = {
  finance: {
    label: "Cash & collections",
    description: "Collected amount as a share of invoiced receivables.",
  },
  delivery: {
    label: "Delivery health",
    description: "Share of active projects that are on track.",
  },
  people: {
    label: "Team availability",
    description: "Share of active employees present today.",
  },
  clients: {
    label: "Client health",
    description: "Average client health score.",
  },
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 1,
  client: {
    enabled: true,
    factors: DEFAULT_CLIENT_FACTORS,
    bands: DEFAULT_CLIENT_BANDS,
    overrides: [
      {
        id: "client-ov-overdue-30",
        label: "30+ days overdue",
        enabled: true,
        metric: "oldestOverdueDays",
        op: "gte",
        value: 30,
        action: "cap",
        level: "RED",
        note: "An invoice is more than 30 days past due.",
      },
      {
        id: "client-ov-churn",
        label: "Churn pattern flagged",
        enabled: true,
        metric: "churnFlagged",
        op: "gte",
        value: 1,
        action: "cap",
        level: "YELLOW",
        note: "A churn risk pattern was flagged in the last 30 days.",
      },
    ],
    profiles: [],
  },
  project: {
    enabled: true,
    factors: DEFAULT_PROJECT_FACTORS,
    bands: DEFAULT_PROJECT_BANDS,
    overrides: [
      {
        id: "project-ov-slip-30",
        label: "30+ days slipped",
        enabled: true,
        metric: "scheduleSlipDays",
        op: "gte",
        value: 30,
        action: "cap",
        level: "RED",
        note: "A milestone or the end date is more than 30 days late.",
      },
      {
        id: "project-ov-burn-150",
        label: "Burn above 150%",
        enabled: true,
        metric: "budgetBurnRatio",
        op: "gte",
        value: 150,
        action: "cap",
        level: "RED",
        note: "Spend is more than 1.5x what progress justifies.",
      },
      {
        id: "project-ov-progress-30",
        label: "30pp behind plan",
        enabled: true,
        metric: "progressGap",
        op: "gte",
        value: 30,
        action: "cap",
        level: "YELLOW",
        note: "Progress is 30 percentage points behind the elapsed timeline.",
      },
    ],
    profiles: [],
  },
  overall: {
    enabled: true,
    components: DEFAULT_OVERALL_COMPONENTS,
    bands: DEFAULT_OVERALL_BANDS,
  },
  alerts: {
    enabled: true,
    notifyImprovements: true,
    client: { levels: ["RED"], roles: ["Owner"] },
    project: { levels: ["RED"], roles: ["Owner", "PM"] },
  },
  schedule: {
    enabled: true,
    time: "02:00",
    staleAfterHours: 24,
  },
};

/** Human-readable metadata for every metric the engine can read. */
export const METRIC_REGISTRY: Record<
  string,
  { label: string; unit?: string; description: string; scope: "client" | "project" }
> = {
  overdueInvoiceCount: {
    label: "Overdue invoices",
    unit: "invoices",
    description: "Receivable invoices past their due date with a balance.",
    scope: "client",
  },
  overdueAmount: {
    label: "Overdue amount",
    unit: "BDT",
    description: "Total unpaid balance on overdue invoices.",
    scope: "client",
  },
  oldestOverdueDays: {
    label: "Oldest overdue days",
    unit: "days",
    description: "Days since the due date of the oldest unpaid invoice.",
    scope: "client",
  },
  atRiskProjectCount: {
    label: "At-risk projects",
    unit: "projects",
    description: "Active projects whose health is AT_RISK or DELAYED.",
    scope: "client",
  },
  activeProjectCount: {
    label: "Active projects",
    unit: "projects",
    description: "Projects currently in ACTIVE status.",
    scope: "client",
  },
  overdueTaskCount: {
    label: "Overdue tasks",
    unit: "tasks",
    description: "Open tasks on the client's projects past their due date.",
    scope: "client",
  },
  overdueTaskRatio: {
    label: "Overdue task ratio",
    unit: "%",
    description: "Overdue open tasks as a share of all open tasks.",
    scope: "client",
  },
  daysSinceContact: {
    label: "Days since contact",
    unit: "days",
    description: "Most recent client comment, meeting or portal login.",
    scope: "client",
  },
  contactCount: {
    label: "Contacts",
    unit: "contacts",
    description: "Named contacts on the account.",
    scope: "client",
  },
  negativeSentimentCount: {
    label: "Negative comments (30d)",
    unit: "comments",
    description: "Client comments with NEGATIVE sentiment in the last 30 days.",
    scope: "client",
  },
  churnFlagged: {
    label: "Churn flag",
    unit: "0/1",
    description: "1 when a churn risk pattern was flagged in the last 30 days.",
    scope: "client",
  },
  renewalDays: {
    label: "Days to renewal",
    unit: "days",
    description: "Days until the renewal date. Negative means it has passed.",
    scope: "client",
  },
  collectionRate: {
    label: "Collection rate",
    unit: "%",
    description: "Paid amount as a share of invoiced receivables.",
    scope: "client",
  },
  scheduleSlipDays: {
    label: "Schedule slip",
    unit: "days",
    description: "Worst overdue milestone or target-end-date slip, whichever is larger.",
    scope: "project",
  },
  budgetBurnRatio: {
    label: "Budget burn",
    unit: "%",
    description: "Spend percent divided by progress percent (100 = on plan).",
    scope: "project",
  },
  budgetUsedPct: {
    label: "Budget used",
    unit: "%",
    description: "Spend as a share of the approved budget.",
    scope: "project",
  },
  progressGap: {
    label: "Progress gap",
    unit: "pp",
    description: "Expected progress minus actual progress, in percentage points.",
    scope: "project",
  },
  actualProgress: {
    label: "Progress",
    unit: "%",
    description: "Progress recorded on the project.",
    scope: "project",
  },
  blockedTaskCount: {
    label: "Blocked tasks",
    unit: "tasks",
    description: "Open tasks marked blocked on the project.",
    scope: "project",
  },
  overdueTaskCountProject: {
    label: "Overdue tasks",
    unit: "tasks",
    description: "Open tasks past their due date on the project.",
    scope: "project",
  },
  pmConfidence: {
    label: "PM confidence",
    unit: "/5",
    description: "The project manager's 1-5 forward-looking confidence.",
    scope: "project",
  },
};

export const LEVEL_SEVERITY: Record<ScoreLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function worstLevel(a: ScoreLevel, b: ScoreLevel): ScoreLevel {
  return LEVEL_SEVERITY[a] >= LEVEL_SEVERITY[b] ? a : b;
}

/** Deep-merge a stored config over the defaults so a partial JSON never breaks scoring. */
export function mergeScoringConfig(base: any, override: any): any {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object") return override;
  const out: any = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = key in base ? mergeScoringConfig(base[key], override[key]) : override[key];
  }
  return out;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalise a stored/edited config. Unknown factor codes are dropped, weights
 * clamped, bands sorted. This is what makes "admin can edit anything" safe.
 */
export function normalizeScoringConfig(input: any): ScoringConfig {
  const merged = mergeScoringConfig(DEFAULT_SCORING_CONFIG, input ?? {});
  const cleanProfile = (profile: any, defaults: ScoreProfile): ScoreProfile => {
    const factors = (Array.isArray(profile?.factors) ? profile.factors : defaults.factors)
      .filter((f: any) => f && typeof f.code === "string")
      .map((f: any) => {
        const bands = (Array.isArray(f.bands) ? f.bands : [])
          .filter((b: any) => b && (b.lte === null || Number.isFinite(Number(b.lte))))
          .map((b: any) => ({
            lte: b.lte === null ? null : Number(b.lte),
            score: Math.max(0, Math.min(100, num(b.score, 0))),
          }))
          .sort((a: any, b: any) => (a.lte === null ? Infinity : a.lte) - (b.lte === null ? Infinity : b.lte));
        const bandsOk = bands.length > 0 && bands.some((b: any) => b.lte === null);
        return {
          code: String(f.code),
          label: String(f.label ?? f.code),
          description: f.description ? String(f.description) : undefined,
          weight: Math.max(0, Math.min(100, num(f.weight, 0))),
          enabled: f.enabled !== false,
          metric: String(f.metric ?? ""),
          direction: f.direction === "higherBetter" ? "higherBetter" : "lowerBetter",
          type: f.type === "linear" ? "linear" : "bands",
          bands: bandsOk ? bands : undefined,
          min: f.min === undefined ? undefined : num(f.min, 0),
          max: f.max === undefined ? undefined : num(f.max, 100),
          missing: ["exclude", "neutral", "zero"].includes(f.missing) ? f.missing : "exclude",
          unit: f.unit ? String(f.unit) : undefined,
          showRaw: f.showRaw !== false,
        } as ScoreFactor;
      });
    const bands = (Array.isArray(profile?.bands) ? profile.bands : defaults.bands)
      .filter((b: any) => b && b.level)
      .map((b: any) => ({
        min: Math.max(0, Math.min(100, num(b.min, 0))),
        level: (["GREEN", "YELLOW", "RED"].includes(b.level) ? b.level : "GREEN") as ScoreLevel,
        label: String(b.label ?? b.level),
        color: String(b.color ?? "#64748b"),
        action: b.action ? String(b.action) : undefined,
      }))
      .sort((a: any, b: any) => b.min - a.min);
    const overrides = (Array.isArray(profile?.overrides) ? profile.overrides : defaults.overrides)
      .filter((o: any) => o && o.metric && ["gte", "lte", "gt", "lt", "eq"].includes(o.op))
      .map((o: any, i: number) => ({
        id: String(o.id ?? `ov-${i + 1}`),
        label: o.label ? String(o.label) : undefined,
        enabled: o.enabled !== false,
        metric: String(o.metric),
        op: o.op,
        value: num(o.value, 0),
        action: o.action === "set" ? "set" : "cap",
        level: (["GREEN", "YELLOW", "RED"].includes(o.level) ? o.level : "RED") as ScoreLevel,
        note: o.note ? String(o.note) : undefined,
      }));
    const profiles = (Array.isArray(profile?.profiles) ? profile.profiles : [])
      .filter((p: any) => p && typeof p.id === "string")
      .map((p: any) => {
        const weights: Record<string, number> = {};
        for (const [code, w] of Object.entries(p.weights ?? {})) {
          const value = Number(w);
          if (Number.isFinite(value)) weights[code] = Math.max(0, Math.min(100, value));
        }
        return {
          id: String(p.id),
          label: String(p.label ?? p.id),
          match: {
            billingCycleType: (Array.isArray(p.match?.billingCycleType) ? p.match.billingCycleType : [])
              .filter((v: any) => ["PROJECT_BASED", "MONTHLY_RETAINER", "ONE_TIME"].includes(String(v)))
              .map(String),
          },
          weights,
        };
      });
    return {
      enabled: profile?.enabled !== false,
      factors,
      bands: bands.length ? bands : defaults.bands,
      overrides,
      profiles,
    };
  };

  const cleanBands = (input: any, fallback: ScoreBand[]): ScoreBand[] => {
    const bands = (Array.isArray(input) ? input : fallback)
      .filter((b: any) => b && b.level)
      .map((b: any) => ({
        min: Math.max(0, Math.min(100, num(b.min, 0))),
        level: (["GREEN", "YELLOW", "RED"].includes(b.level) ? b.level : "GREEN") as ScoreLevel,
        label: String(b.label ?? b.level),
        color: String(b.color ?? "#64748b"),
        action: b.action ? String(b.action) : undefined,
      }))
      .sort((a: any, b: any) => b.min - a.min);
    return bands.length ? bands : fallback;
  };

  const overallComponents = (Array.isArray(merged?.overall?.components)
    ? merged.overall.components
    : DEFAULT_OVERALL_COMPONENTS
  )
    .filter((c: any) => c && OVERALL_COMPONENT_REGISTRY[c.key])
    .map((c: any) => ({
      key: String(c.key),
      label: String(c.label ?? OVERALL_COMPONENT_REGISTRY[c.key].label),
      weight: Math.max(0, Math.min(100, num(c.weight, 0))),
      enabled: c.enabled !== false,
    }));

  const cleanPolicy = (input: any, fallback: AlertPolicy): AlertPolicy => ({
    levels: (Array.isArray(input?.levels) ? input.levels : fallback.levels)
      .filter((l: any) => ["GREEN", "YELLOW", "RED"].includes(l))
      .map((l: any) => l as ScoreLevel),
    roles: (Array.isArray(input?.roles) ? input.roles : fallback.roles)
      .filter((r: any) => typeof r === "string" && r.trim())
      .map((r: any) => String(r).trim()),
  });

  return {
    version: num(merged.version, 1),
    client: cleanProfile(merged.client, DEFAULT_SCORING_CONFIG.client),
    project: cleanProfile(merged.project, DEFAULT_SCORING_CONFIG.project),
    overall: {
      enabled: merged?.overall?.enabled !== false,
      components: overallComponents.length ? overallComponents : DEFAULT_OVERALL_COMPONENTS,
      bands: cleanBands(merged?.overall?.bands, DEFAULT_OVERALL_BANDS),
    },
    alerts: {
      enabled: merged?.alerts?.enabled !== false,
      notifyImprovements: merged?.alerts?.notifyImprovements !== false,
      client: cleanPolicy(merged?.alerts?.client, DEFAULT_SCORING_CONFIG.alerts.client),
      project: cleanPolicy(merged?.alerts?.project, DEFAULT_SCORING_CONFIG.alerts.project),
    },
    schedule: {
      enabled: merged?.schedule?.enabled !== false,
      time: String(merged?.schedule?.time ?? "02:00"),
      staleAfterHours: Math.max(1, num(merged?.schedule?.staleAfterHours, 24)),
    },
  };
}
