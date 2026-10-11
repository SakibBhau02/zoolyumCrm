import type { CacheService } from "../cache/cache.service";

// Day keys follow the app convention: DATE columns round-trip as UTC
// midnight, so all day-level math uses UTC getters; punch time-of-day
// (late detection) uses local getters (device wall time).
export const dateStr = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export const monthRange = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

// ── Asia/Dhaka wall-clock helpers ─────────────────────────────────────
// Bangladesh has no DST — a fixed +06:00 offset is exact. All attendance
// day math (grouping, boundaries, late detection, device timestamps) uses
// Dhaka wall time so results are identical regardless of server timezone.
//
// Storage convention: `attendance.date` is UTC-midnight *labelled* with the
// Dhaka date (so `slice(0, 10)` displays correctly everywhere), while punch
// instants are true UTC. A Dhaka day D covers punch instants
// [UTC(D) − 6h, UTC(D+1) − 6h).
export const DHAKA_OFFSET_MINUTES = 6 * 60;

const shiftDhaka = (d: Date) => new Date(d.getTime() + DHAKA_OFFSET_MINUTES * 60000);

export const dateStrDhaka = (d: Date) => dateStr(shiftDhaka(d));

export const weekdayDhaka = (d: Date) =>
  ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][shiftDhaka(d).getUTCDay()];

export const toHHmmDhaka = (d: Date) => {
  const s = shiftDhaka(d);
  return `${String(s.getUTCHours()).padStart(2, "0")}:${String(s.getUTCMinutes()).padStart(2, "0")}`;
};

/** True UTC instants bounding Dhaka calendar day `dstr` (for punch queries). */
export const dhakaDayRange = (dstr: string) => {
  const [y, m, day] = dstr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, day) - DHAKA_OFFSET_MINUTES * 60000);
  return { start, end: new Date(start.getTime() + 86400000) };
};

/** Dhaka calendar days in `YYYY-MM` (for month iteration). */
export const dhakaDaysInMonth = (period: string): string[] => {
  const [y, m] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
};

/** Parse a naive device timestamp ("YYYY-MM-DD HH:MM:SS") as Asia/Dhaka wall time. */
export const parseDeviceTime = (s: string): Date | null => {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, sec ?? 0) - DHAKA_OFFSET_MINUTES * 60000);
  return Number.isNaN(t.getTime()) ? null : t;
};

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const toHHmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const weekdayName = (d: Date) => ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][d.getUTCDay()];

export const leaveDays = (start: Date, end: Date): number => {
  const ms = new Date(end.getTime()).setHours(0, 0, 0, 0) - new Date(start.getTime()).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
};

export const invalidatePeopleCache = async (cache: CacheService) => {
  await cache.del("people:overview");
  await cache.del("people:employees");
  await cache.del("people:employees:masked");
};
