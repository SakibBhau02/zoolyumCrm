export const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
export const dayShort: Record<string, string> = { SUNDAY: "Sun", MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat" };
export const LEAVE_TYPES = ["CASUAL", "SICK", "EARNED", "UNPAID"];
export const ATT_STATUSES = ["PRESENT", "ABSENT", "LATE", "HALF_DAY"];
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract"];
// Must match prisma enum EmploymentStatus: ACTIVE | ON_LEAVE | EXITED.
// "TERMINATED" does not exist on the server (400) and omitting EXITED meant the
// auto-offboarding flow could never be triggered from the profile form.
export const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "EXITED"];
export const COURSE_TYPES = ["mandatory", "optional"];
export const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
export const label = (v: string) => v.replace(/_/g, " ").toLowerCase();
export const okrTone: Record<string, string> = {
  "on-track": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  "at-risk": "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  behind: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  completed: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
};
export const levelTone: Record<string, string> = {
  beginner: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  intermediate: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  advanced: "bg-primary/10 text-primary dark:text-primary",
  expert: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
};
export const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const fmtTime = (t?: string | null) => (t ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—");
export const skillsOf = (e: any) => e?.skills ?? e?.skillTags ?? [];
export const utilBarCls = (u: number | null | undefined) => (u == null ? "bg-muted" : u >= 1.05 ? "bg-rose-500" : u >= 0.95 ? "bg-amber-400" : "bg-emerald-500");

/**
 * People module navigation.
 *
 * The module used to expose 14 equal-weight tabs in one scrolling pill row,
 * which is a wall, not a menu — on a phone you had to scroll horizontally to
 * find Payroll. Five hubs mirror how the work actually happens (who they are →
 * when they work → what they're paid → how they grow), and the routes inside
 * each hub are unchanged so every existing deep link still resolves.
 */
export type NavItem = { label: string; href: string };
export type NavHub = { label: string; href: string; items: NavItem[]; exact?: boolean };

export const NAV: NavHub[] = [
  { label: "My space", href: "/people/me", items: [], exact: true },
  { label: "Overview", href: "/people", items: [], exact: true },
  {
    label: "Team",
    href: "/people/team",
    items: [
      { label: "Team 360", href: "/people/team" },
      { label: "Directory", href: "/people/directory" },
      { label: "Analytics", href: "/people/analytics" },
      { label: "Org chart", href: "/people/org-chart" },
      { label: "Skills", href: "/people/skills" },
      { label: "Onboarding", href: "/people/onboarding" },
      { label: "Assets", href: "/people/assets" },
    ],
  },
  {
    label: "Time",
    href: "/people/attendance",
    items: [
      { label: "Attendance", href: "/people/attendance" },
      { label: "Leave", href: "/people/leave" },
      { label: "Holidays", href: "/people/holidays" },
      { label: "Policy", href: "/people/settings" },
    ],
  },
  { label: "Pay", href: "/people/payroll", items: [] },
  {
    label: "Grow",
    href: "/people/performance",
    items: [
      { label: "Reviews", href: "/people/performance" },
      { label: "OKRs", href: "/people/okrs" },
      { label: "Training", href: "/people/training" },
      { label: "Hiring", href: "/people/candidates" },
    ],
  },
];

/** Flat list kept for anything that still needs to resolve a route → label. */
export const TABS = NAV.flatMap((h) => (h.items.length ? h.items : [{ label: h.label, href: h.href }])) as { label: string; href: string }[];


export function downloadCsv(filename: string, cols: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}