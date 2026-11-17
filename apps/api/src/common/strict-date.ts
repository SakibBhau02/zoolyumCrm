import { BadRequestException } from "@nestjs/common";

/**
 * Strict date parsing for API bodies.
 *
 * `new Date("2026-02-31")` does not fail — JavaScript rolls it over to
 * 2026-03-03 and the expense is silently filed in the wrong month. The audit
 * found this on expenses (and it affects every hand-rolled `new Date(body.x)`),
 * so date fields go through here instead.
 *
 * Accepts `YYYY-MM-DD` and full ISO-8601 strings. For date-only input the
 * calendar date must survive a UTC round-trip, which rejects 2026-02-31,
 * 2026-13-01 and 2026-04-31 while still allowing real leap days.
 */
export function parseStrictDate(value: unknown, field = "date"): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  const raw = value.trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid date (expected YYYY-MM-DD)`);
  }
  // Only day-precision strings are round-tripped: a full timestamp carries an
  // unambiguous instant and must not be reinterpreted.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const [, y, m, d] = match.map(Number) as unknown as number[];
    const roundTrip = new Date(Date.UTC(y, m - 1, d));
    if (
      roundTrip.getUTCFullYear() !== y ||
      roundTrip.getUTCMonth() !== m - 1 ||
      roundTrip.getUTCDate() !== d
    ) {
      throw new BadRequestException(`${field} "${raw}" is not a real calendar date`);
    }
    return roundTrip;
  }
  return parsed;
}

/** Optional variant: `undefined`/`null`/`""` stay `null` (Prisma-friendly). */
export function parseOptionalDate(value: unknown, field = "date"): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return parseStrictDate(value, field);
}
