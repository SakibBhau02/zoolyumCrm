export type CalendarView =
  | "overview"
  | "month"
  | "week"
  | "day"
  | "timeline"
  | "grid"
  | "plans"
  | "settings";

export type CalendarSource =
  | "TASK"
  | "CONTENT_POST"
  | "EVENT"
  | "MILESTONE"
  | "DELIVERABLE"
  | "AD_FLIGHT"
  | "INVOICE"
  | "LEAVE"
  | "HOLIDAY";

export type CalItem = {
  key: string;
  source: CalendarSource;
  sourceId: string;
  title: string;
  subtitle?: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  clientId?: string;
  clientName?: string;
  clientColor?: string;
  projectId?: string;
  projectName?: string;
  campaignId?: string;
  campaignName?: string;
  platforms: string[];
  assigneeIds: string[];
  assigneeNames: string[];
  status: string;
  statusTone: "neutral" | "info" | "success" | "warning" | "danger";
  approval?: string;
  clientVisible: boolean;
  overdue?: boolean;
  isDone?: boolean;
  href?: string;
  editable: boolean;
  draggable: boolean;
  meta?: Record<string, any>;
};

export type CalendarFilters = {
  clientId: string;
  projectId: string;
  sources: string;
  platforms: string;
  approval: string;
  mine: boolean;
  q: string;
};

export type FeedResponse = {
  range: { from: string; to: string; timeZone: string };
  items: CalItem[];
  days: Record<
    string,
    { counts: Record<string, number>; done: number; overdue: number; pendingApproval: number; hasHoliday: boolean }
  >;
  totals: {
    planned: number;
    done: number;
    overdue: number;
    pendingApproval: number;
    bySource: Record<string, number>;
    byPlatform: Record<string, number>;
    byClient: Record<string, number>;
  };
  truncated: boolean;
};

export type CalendarSummary = {
  range: { from: string; to: string };
  meetings: { planned: number; done: number; noShow: number };
  tasks: { due: number; done: number; open: number; overdue: number };
  posts: { planned: number; published: number; missed: number; pendingApproval: number; coverageDays: number; gapDays: number };
  ads: { live: number; planned: number; actualSpend: number };
  gaps: string[];
};

export type CalendarClient = {
  id: string;
  companyName: string;
  calendarColor?: string | null;
  healthLevel?: string;
  category?: string;
  accountOwner?: { id: string; name: string } | null;
  postingTargets?: Record<string, number> | null;
};

export type CalendarPerson = { id: string; name: string; roleTitle?: string; department?: string };

export const PLATFORMS = [
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "X",
  "YOUTUBE",
  "GOOGLE_BUSINESS",
  "PINTEREST",
  "THREADS",
];

export const PLATFORM_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  TIKTOK: "TikTok",
  X: "X",
  YOUTUBE: "YouTube",
  GOOGLE_BUSINESS: "Google Business",
  PINTEREST: "Pinterest",
  THREADS: "Threads",
};

export const PLATFORM_STYLE: Record<string, string> = {
  FACEBOOK: "bg-blue-500/15 text-blue-500 dark:text-blue-300",
  INSTAGRAM: "bg-fuchsia-500/15 text-fuchsia-500 dark:text-fuchsia-300",
  LINKEDIN: "bg-sky-500/15 text-sky-500 dark:text-sky-300",
  TIKTOK: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  X: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300",
  YOUTUBE: "bg-red-500/15 text-red-500 dark:text-red-300",
  GOOGLE_BUSINESS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  PINTEREST: "bg-rose-500/15 text-rose-500 dark:text-rose-300",
  THREADS: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

export const SOURCE_LABEL: Record<string, string> = {
  TASK: "Task",
  CONTENT_POST: "Post",
  EVENT: "Event",
  MILESTONE: "Milestone",
  DELIVERABLE: "Deliverable",
  AD_FLIGHT: "Ad flight",
  INVOICE: "Invoice",
  LEAVE: "Leave",
  HOLIDAY: "Holiday",
};

export const SOURCE_DOT: Record<string, string> = {
  TASK: "bg-sky-500",
  CONTENT_POST: "bg-primary",
  EVENT: "bg-amber-500",
  MILESTONE: "bg-emerald-500",
  DELIVERABLE: "bg-teal-500",
  AD_FLIGHT: "bg-fuchsia-500",
  INVOICE: "bg-rose-500",
  LEAVE: "bg-slate-400",
  HOLIDAY: "bg-slate-300",
};

export const TONE_BADGE: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground ring-1 ring-border",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
};

export const EVENT_TYPES = ["MEETING", "SHOOT", "CAMPAIGN", "CONTENT", "DEADLINE", "MILESTONE", "REPORT"];
export const POST_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED", "MISSED"];
export const APPROVAL_STATUSES = ["NONE", "INTERNAL_REVIEW", "APPROVED", "REJECTED"];
export const FORMATS = ["STATIC", "CAROUSEL", "REEL", "STORY", "VIDEO", "TEXT", "ARTICLE"];
export const EVENT_OUTCOMES = ["PENDING", "DONE", "NO_SHOW", "CANCELLED", "RESCHEDULED"];

export const label = (v?: string | null) =>
  (v ?? "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
