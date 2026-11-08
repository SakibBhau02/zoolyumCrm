import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_CAPACITY = 40;

/** UTC Monday 00:00 of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0 = Sunday
  const shift = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + shift);
  return x;
}

/**
 * Utilisation is the one People number an agency actually steers by — and until
 * now it was seeded fiction: nothing ever wrote `UtilizationLog`, so "Avg
 * utilization 85%" and the heatmap were frozen test data.
 *
 * This service derives it from real time logs:
 *   billable hours logged in the week ÷ contracted capacity hours.
 * It runs weekly, and can be replayed for the last N weeks so a fresh install
 * backfills instead of showing a single empty column.
 */
@Injectable()
export class UtilizationService {
  private readonly logger = new Logger("Utilization");

  constructor(private readonly prisma: PrismaService) {}

  async recompute(weeks = 8) {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: { not: "EXITED" } },
      select: { id: true, weeklyCapacityHours: true },
    });
    if (!employees.length) return { weeks: 0, rows: 0 };

    const currentMonday = mondayOf(new Date());
    const starts: Date[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(currentMonday);
      d.setUTCDate(d.getUTCDate() - i * 7);
      starts.push(d);
    }
    const earliest = starts[0];
    const latestEnd = new Date(currentMonday.getTime() + 7 * 86400000);

    // One query for the whole window, grouped by employee.
    const logs = await this.prisma.timeLog.findMany({
      where: { date: { gte: earliest, lt: latestEnd }, employeeId: { not: null }, isBillable: true },
      select: { employeeId: true, hours: true, date: true },
    });

    const bucket = new Map<string, number>(); // `${employeeId}|${weekISO}`
    for (const l of logs) {
      if (!l.employeeId) continue;
      const wk = mondayOf(l.date).toISOString().slice(0, 10);
      const key = `${l.employeeId}|${wk}`;
      bucket.set(key, (bucket.get(key) ?? 0) + Number(l.hours));
    }

    let rows = 0;
    for (const e of employees) {
      const capacity = Number(e.weeklyCapacityHours ?? DEFAULT_CAPACITY) || DEFAULT_CAPACITY;
      for (const start of starts) {
        const wk = start.toISOString().slice(0, 10);
        const billable = Math.round((bucket.get(`${e.id}|${wk}`) ?? 0) * 100) / 100;
        // Only write weeks that have real logged time. Writing 0% for every
        // empty week would drown the trend chart and erase whatever a team
        // already has — "no logs" and "0% utilised" are different facts.
        if (billable <= 0) continue;
        const rate = Math.round((billable / capacity) * 1000) / 1000;
        try {
          await this.prisma.utilizationLog.upsert({
            where: { employeeId_weekStartDate: { employeeId: e.id, weekStartDate: start } },
            create: { employeeId: e.id, weekStartDate: start, billableHours: billable, availableHours: capacity, utilizationRate: rate },
            update: { billableHours: billable, availableHours: capacity, utilizationRate: rate },
          });
          rows++;
        } catch (err: any) {
          this.logger.warn(`upsert ${e.id} ${wk}: ${err?.message}`);
        }
      }
    }
    this.logger.log(`utilisation recomputed: ${rows} rows across ${weeks} week(s)`);
    return { weeks: starts.length, rows };
  }

  /** Mondays 04:00 — after the nightly attendance recompute has settled. */
  @Cron("0 4 * * 1")
  async weekly() {
    return this.recompute(4);
  }
}
