export const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
export const dayShort: Record<string, string> = { SUNDAY: "Sun", MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat" };
export const LEAVE_TYPES = ["CASUAL", "SICK", "ANNUAL", "UNPAID"];
export const ATT_STATUSES = ["PRESENT", "ABSENT", "LATE", "HALF_DAY"];
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract"];
export const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED"];
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

export const TABS = [
  { value: "Overview", href: "/people" },
  { value: "Directory", href: "/people/directory" },
  { value: "Attendance", href: "/people/attendance" },
  { value: "Leave", href: "/people/leave" },
  { value: "Payroll", href: "/people/payroll" },
  { value: "Settings", href: "/people/settings" },
  { value: "Performance", href: "/people/performance" },
  { value: "OKRs", href: "/people/okrs" },
  { value: "Training", href: "/people/training" },
  { value: "Candidates", href: "/people/candidates" },
  { value: "Holidays", href: "/people/holidays" },
  { value: "Org Chart", href: "/people/org-chart" },
  { value: "Skills", href: "/people/skills" },
] as const;

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