/** Calendar date helpers (Asia/Dhaka day keys, no DST). */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const todayISO = (): string => iso(new Date());

export function parseISO(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(day: string, n: number): string {
  const d = parseISO(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string): string {
  const d = parseISO(day);
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function monthGrid(anchor: string): { date: string; inMonth: boolean }[] {
  const first = parseISO(startOfMonth(anchor));
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const month = first.getMonth();
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: iso(d), inMonth: d.getMonth() === month });
  }
  // Trim a fully-trailing week so a 5-week month does not render an empty row.
  while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.splice(-7, 7);
  return cells;
}

export function weekDates(anchor: string): string[] {
  const d = parseISO(anchor);
  d.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return iso(x);
  });
}

export function monthLabel(day: string): string {
  return parseISO(day).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function dayLabel(day: string): string {
  return parseISO(day).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

export function longDayLabel(day: string): string {
  return parseISO(day).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function shiftMonth(day: string, delta: number): string {
  const d = parseISO(startOfMonth(day));
  d.setMonth(d.getMonth() + delta);
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function shiftWeek(day: string, delta: number): string {
  return addDays(day, delta * 7);
}

/** Minutes since midnight for an HH:MM string. */
export function minutes(hhmm?: string | null): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function humanTime(hhmm?: string | null): string {
  if (!hhmm) return "All day";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Dhaka day key for a UTC ISO instant (API returns ISO strings). */
export function dhakaDay(value?: string | null): string {
  if (!value) return todayISO();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return todayISO();
  return new Date(d.getTime() + 6 * 3600_000).toISOString().slice(0, 10);
}

/** Dhaka HH:MM for a UTC ISO instant. */
export function dhakaTime(value?: string | null): string {
  if (!value) return "10:00";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "10:00";
  return new Date(d.getTime() + 6 * 3600_000).toISOString().slice(11, 16);
}

export function rangeForView(view: string, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const days = weekDates(anchor);
    return { from: days[0], to: days[6] };
  }
  if (view === "overview") {
    const days = weekDates(anchor);
    return { from: days[0], to: days[6] };
  }
  if (view === "grid") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  const cells = monthGrid(anchor);
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}
