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

// ── Task type ───────────────────────────────────────────────────────────
export const TASK_TYPES = [
  "general",
  "bug",
  "feature",
  "improvement",
  "research",
  "design",
  "documentation",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_META: Record<TaskType, { label: string; tone: string }> = {
  general: { label: "General", tone: "border-border bg-muted/60 text-muted-foreground" },
  bug: { label: "Bug", tone: "border-rose-500/30 bg-rose-500/10 text-rose-400" },
  feature: { label: "Feature", tone: "border-primary/30 bg-primary/10 text-primary" },
  improvement: { label: "Improvement", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  research: { label: "Research", tone: "border-sky-500/30 bg-sky-500/10 text-sky-400" },
  design: { label: "Design", tone: "border-pink-500/30 bg-pink-500/10 text-pink-400" },
  documentation: { label: "Documentation", tone: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
};

export function normalizeTaskType(value?: string | null): TaskType {
  const v = (value ?? "").toLowerCase();
  return (TASK_TYPES as readonly string[]).includes(v) ? (v as TaskType) : "general";
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
