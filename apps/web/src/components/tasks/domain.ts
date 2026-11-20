/**
 * Canonical task vocabulary — single source of truth for the whole web app.
 *
 * The API/Prisma enum is `TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED`.
 * Before this module existed the UI used `BACKLOG` and `IN_REVIEW`, so every
 * REVIEW task was invisible on the board and moving a card into "In Review"
 * failed validation server-side. Everything status-related must now come from
 * here — never hardcode a status string in a component.
 */
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Board/column metadata, in workflow order. */
export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; short: string; dot: string; chip: string; ring: string }
> = {
  TODO: {
    label: "To Do",
    short: "Todo",
    dot: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-400",
    ring: "ring-sky-500/25",
  },
  IN_PROGRESS: {
    label: "In Progress",
    short: "In Progress",
    dot: "bg-primary",
    chip: "bg-primary/15 text-primary",
    ring: "ring-primary/25",
  },
  REVIEW: {
    label: "In Review",
    short: "Review",
    dot: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-400",
    ring: "ring-amber-500/25",
  },
  BLOCKED: {
    label: "Blocked",
    short: "Blocked",
    dot: "bg-rose-400",
    chip: "bg-rose-500/15 text-rose-400",
    ring: "ring-rose-500/25",
  },
  DONE: {
    label: "Done",
    short: "Done",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-400",
    ring: "ring-emerald-500/25",
  },
};

/** Board columns, workflow order. */
export const BOARD_COLUMNS = TASK_STATUSES.map((key) => ({
  key,
  label: TASK_STATUS_META[key].label,
  dot: TASK_STATUS_META[key].dot,
}));

/** Gantt bar colours per status (rgba fill + solid border). */
export const GANTT_BAR: Record<TaskStatus, { fill: string; line: string }> = {
  TODO: { fill: "rgba(56,189,248,0.30)", line: "rgb(56,189,248)" },
  IN_PROGRESS: { fill: "rgba(139,92,246,0.40)", line: "rgb(139,92,246)" },
  REVIEW: { fill: "rgba(251,191,36,0.35)", line: "rgb(251,191,36)" },
  BLOCKED: { fill: "rgba(244,63,94,0.40)", line: "rgb(244,63,94)" },
  DONE: { fill: "rgba(16,185,129,0.35)", line: "rgb(16,185,129)" },
};

export const TASK_STATUS_OPTS = TASK_STATUSES.map((key) => ({
  value: key,
  label: TASK_STATUS_META[key].label,
}));

/** Statuses that count as "still open" — everything except DONE. */
export const OPEN_STATUSES: TaskStatus[] = TASK_STATUSES.filter((s) => s !== "DONE");

/**
 * Maps any legacy/unknown value onto a real status. `BACKLOG` and `IN_REVIEW`
 * were shipped in older builds; they are folded into TODO and REVIEW so old
 * saved views and stale props keep working instead of crashing a column.
 */
export function normalizeStatus(value?: string | null): TaskStatus {
  if (!value) return "TODO";
  const v = value.toUpperCase().replace(/[\s-]/g, "_");
  if (v === "IN_REVIEW" || v === "REVIEW") return "REVIEW";
  if (v === "BACKLOG" || v === "TODO" || v === "OPEN") return "TODO";
  if (v === "IN_PROGRESS" || v === "PROGRESS" || v === "DOING") return "IN_PROGRESS";
  if (v === "BLOCKED") return "BLOCKED";
  if (v === "DONE" || v === "COMPLETED" || v === "CLOSED") return "DONE";
  return "TODO";
}

export function statusLabel(value?: string | null): string {
  return TASK_STATUS_META[normalizeStatus(value)].label;
}

// ── Priority ────────────────────────────────────────────────────────────
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: string; rank: number }> = {
  URGENT: { label: "Urgent", tone: "border-rose-500/30 bg-rose-500/10 text-rose-400", rank: 3 },
  HIGH: { label: "High", tone: "border-amber-500/30 bg-amber-500/10 text-amber-400", rank: 2 },
  MEDIUM: { label: "Medium", tone: "border-sky-500/30 bg-sky-500/10 text-sky-400", rank: 1 },
  LOW: { label: "Low", tone: "border-border bg-muted/60 text-muted-foreground", rank: 0 },
};

export function normalizePriority(value?: string | null): TaskPriority {
  const v = (value ?? "").toUpperCase();
  return (PRIORITIES as readonly string[]).includes(v) ? (v as TaskPriority) : "MEDIUM";
}

// ── Task type (category → sub-category) ────────────────────────────────
/**
 * Agency work vocabulary. `taskType` stores the category key, `taskSubType`
 * the optional key inside it. Kept as a static list (not DB rows) because the
 * department rules, filters and reports all read it from here — one place to
 * add a category or a sub-category.
 */
export type TaskSubType = { key: string; label: string };
export type TaskCategory = {
  key: string;
  label: string;
  /** Chip tone used everywhere a category is shown. */
  tone: string;
  hint: string;
  subtypes: TaskSubType[];
};

export const TASK_CATEGORIES: readonly TaskCategory[] = [
  {
    key: "graphics",
    label: "Graphics",
    tone: "border-pink-500/30 bg-pink-500/10 text-pink-400",
    hint: "Static design — posts, banners, print",
    subtypes: [
      { key: "social_post", label: "Social post" },
      { key: "banner", label: "Banner / cover" },
      { key: "thumbnail", label: "Thumbnail" },
      { key: "poster", label: "Poster / flyer" },
      { key: "logo", label: "Logo / identity" },
      { key: "print", label: "Print / brochure" },
      { key: "packaging", label: "Packaging" },
      { key: "illustration", label: "Illustration" },
      { key: "other", label: "Other graphics" },
    ],
  },
  {
    key: "video",
    label: "Video",
    tone: "border-primary/30 bg-primary/10 text-primary",
    hint: "Shoots, edits and motion",
    subtypes: [
      { key: "reel", label: "Reel / short" },
      { key: "tvc", label: "TVC / ad film" },
      { key: "motion", label: "Motion graphics" },
      { key: "explainer", label: "Explainer" },
      { key: "event_coverage", label: "Event coverage" },
      { key: "youtube", label: "YouTube long form" },
      { key: "editing", label: "Editing only" },
      { key: "other", label: "Other video" },
    ],
  },
  {
    key: "script",
    label: "Script writing",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    hint: "Copy, scripts and captions",
    subtypes: [
      { key: "video_script", label: "Video script" },
      { key: "ad_copy", label: "Ad copy" },
      { key: "storyboard", label: "Storyboard" },
      { key: "caption", label: "Caption / post copy" },
      { key: "blog", label: "Blog / article" },
      { key: "other", label: "Other writing" },
    ],
  },
  {
    key: "social",
    label: "Social media",
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    hint: "Posting, scheduling and community",
    subtypes: [
      { key: "post", label: "Post / publish" },
      { key: "story", label: "Story" },
      { key: "campaign", label: "Campaign" },
      { key: "community", label: "Community management" },
      { key: "other", label: "Other social" },
    ],
  },
  {
    key: "meeting",
    label: "Meeting",
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    hint: "Calls, reviews and planning",
    subtypes: [
      { key: "client", label: "Client meeting" },
      { key: "internal", label: "Internal / standup" },
      { key: "shoot_planning", label: "Shoot planning" },
      { key: "review", label: "Review / feedback call" },
      { key: "other", label: "Other meeting" },
    ],
  },
  {
    key: "development",
    label: "Development",
    tone: "border-violet-500/30 bg-violet-500/10 text-violet-400",
    hint: "Web, product and fixes",
    subtypes: [
      { key: "website", label: "Website" },
      { key: "landing_page", label: "Landing page" },
      { key: "bug_fix", label: "Bug fix" },
      { key: "seo", label: "SEO" },
      { key: "maintenance", label: "Maintenance" },
      { key: "other", label: "Other development" },
    ],
  },
  {
    key: "research",
    label: "Research",
    tone: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    hint: "Studies, audits and strategy",
    subtypes: [
      { key: "market", label: "Market research" },
      { key: "competitor", label: "Competitor study" },
      { key: "audit", label: "Audit" },
      { key: "strategy", label: "Strategy" },
      { key: "other", label: "Other research" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    tone: "border-border bg-muted/60 text-muted-foreground",
    hint: "Paperwork and documentation",
    subtypes: [
      { key: "quotation", label: "Quotation" },
      { key: "invoice", label: "Invoice / billing" },
      { key: "report", label: "Report" },
      { key: "documentation", label: "Documentation" },
      { key: "other", label: "Other admin" },
    ],
  },
  {
    key: "general",
    label: "General",
    tone: "border-border bg-muted/60 text-muted-foreground",
    hint: "Anything that does not fit the rest",
    subtypes: [{ key: "other", label: "Other" }],
  },
];

export type TaskType = string;

export const TASK_TYPES = TASK_CATEGORIES.map((c) => c.key);

export const TASK_TYPE_META: Record<string, { label: string; tone: string }> = Object.fromEntries(
  TASK_CATEGORIES.map((c) => [c.key, { label: c.label, tone: c.tone }])
);

/** Values shipped by older builds, folded onto today's categories. */
const LEGACY_TASK_TYPE: Record<string, string> = {
  design: "graphics",
  bug: "development",
  feature: "development",
  improvement: "development",
  documentation: "admin",
};

export function normalizeTaskType(value?: string | null): TaskType {
  const v = (value ?? "").toLowerCase();
  if (TASK_TYPE_META[v]) return v;
  return LEGACY_TASK_TYPE[v] ?? "general";
}

export function categoryLabel(value?: string | null): string {
  if (!value) return TASK_TYPE_META.general.label;
  return TASK_TYPE_META[value.toLowerCase()]?.label ?? value.replace(/_/g, " ");
}

/** Chip class for a category — legacy/unknown values fall back to neutral. */
export function categoryTone(value?: string | null): string {
  return TASK_TYPE_META[normalizeTaskType(value)]?.tone ?? TASK_TYPE_META.general.tone;
}

/** Sub-categories available under a category (empty for a free-form value). */
export function subtypesFor(category?: string | null): TaskSubType[] {
  return TASK_CATEGORIES.find((c) => c.key === (category ?? "").toLowerCase())?.subtypes ?? [];
}

export function subtypeLabel(category?: string | null, subtype?: string | null): string {
  if (!subtype) return "";
  const hit = subtypesFor(category).find((s) => s.key === subtype);
  return hit?.label ?? subtype.replace(/_/g, " ");
}

/** "Graphics · Social post" — the display line used on cards and rows. */
export function taskTypeLabel(type?: string | null, subType?: string | null): string {
  const main = categoryLabel(type);
  const sub = subtypeLabel(type, subType);
  return sub ? `${main} · ${sub}` : main;
}

// ── Small shared helpers ────────────────────────────────────────────────
export const label = (v?: string | null) => (v ?? "").replace(/_/g, " ").toLowerCase();

/** True when the task is past its due date and not finished. */
export function isOverdue(task: { status?: string | null; dueDate?: string | null }, now = Date.now()): boolean {
  if (!task.dueDate) return false;
  if (normalizeStatus(task.status) === "DONE") return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now;
}

/** Local YYYY-MM-DD key (never UTC — board "today" must match the user's clock). */
export function localDayKey(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function isDueToday(task: { dueDate?: string | null }, now = new Date()): boolean {
  if (!task.dueDate) return false;
  return localDayKey(task.dueDate) === localDayKey(now);
}
