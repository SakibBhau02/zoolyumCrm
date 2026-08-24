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
};
