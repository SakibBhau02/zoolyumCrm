/**
 * Calendar date helpers.
 *
 * Every "day" in this module is an Asia/Dhaka day key (`YYYY-MM-DD`) because the
 * agency, its clients, the attendance policy and the dashboard all speak in
 * those keys. Bangladesh has no DST, so a fixed +06:00 offset is exact and
 * avoids pulling a timezone library into the API.
 */

export const CAL_TZ = "Asia/Dhaka";
export const TZ_SUFFIX = "+06:00";
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a UTC instant, in Dhaka. */
export function dayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 6 * 3600_000).toISOString().slice(0, 10);
}

/** Dhaka wall-clock `HH:MM` for a UTC instant. */
export function timeKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 6 * 3600_000).toISOString().slice(11, 16);
}

/** The UTC instant of a Dhaka day/time. */
export function dhakaInstant(day: string, time = "00:00"): Date {
  return new Date(`${day}T${time.length === 5 ? time : "00:00"}:00${TZ_SUFFIX}`);
}

/** Add days to a day key. */
export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day range → [start instant, end-exclusive instant). */
export function dayRange(from: string, to: string): { gte: Date; lt: Date } {
  return { gte: dhakaInstant(from), lt: dhakaInstant(addDays(to, 1)) };
}

/** `YYYY-MM` → first and last day of that month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: first, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

/** Week (Sun→Sat) containing `day`. */
export function weekBounds(day: string): { from: string; to: string } {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = addDays(day, -dow);
  return { from, to: addDays(from, 6) };
}

export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** A day key that also exists on the calendar (rejects 2026-02-30). */
export function isRealDay(v: unknown): v is string {
  if (!isDayKey(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(v: unknown): boolean {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Only absolute http(s) URLs may be stored where the UI renders a link. */
export function safeHttpUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function todayKey(): string {
  return dayKey(new Date());
}

/** Dates between two day keys, inclusive (guard 400 days). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Normalise a stored Date (@db.Date) to a day key without a TZ shift. */
export function dateToDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * A calendar day as a value for a `@db.Date` column.
 *
 * Postgres DATE has no timezone. Feeding it a Dhaka-midnight instant
 * (2026-11-01T00:00+06 = 2026-10-31T18:00Z) truncates to the *previous* day.
 * Every DATE column must therefore be written with the UTC midnight of the
 * intended day, not with `dhakaInstant`.
 */
export function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export const CLIENT_PALETTE = [
  "#7C3AED",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#14B8A6",
  "#8B5CF6",
  "#F97316",
];

export function colorForClient(id?: string | null, explicit?: string | null): string {
  if (explicit) return explicit;
  if (!id) return "#64748B";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CLIENT_PALETTE[h % CLIENT_PALETTE.length];
}

/** `HH:MM` validation with an optional default. */
export function normalizeTime(v: unknown, fallback = "10:00"): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return fallback;
}
