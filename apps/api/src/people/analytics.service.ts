import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { dateStrDhaka, minutesOf, toHHmmDhaka, weekdayDhaka } from "./people-utils";

/**
 * People analytics — the management layer of the module.
 *
 * The module could already answer "how is Rahim doing this month" (Team 360).
 * What it could not answer is the question a manager actually asks every
 * quarter: *per month, per person* — how many tasks, how many late arrivals,
 * how many meetings, how many shoots, how many absences. Without that table
 * every review meeting started by exporting three screens into a spreadsheet.
 *
 * Everything here reads the same rows the operational screens read (Attendance,
 * Task, TimeLog, LeadMeetingAttendee, ShootCrew, LeaveRequest) and aggregates
 * them in one pass, so the numbers cannot drift from the source of truth.
 */

type Bucket = {
  presentDays: number;
  lateDays: number;
  lateMinutes: number;
  halfDays: number;
  absentDays: number;
  workedHours: number;
  tasksDone: number;
  loggedHours: number;
  meetingsAttended: number;
  meetingsInvited: number;
  shoots: number;
  leaveDays: number;
};

const emptyBucket = (): Bucket => ({
  presentDays: 0,
  lateDays: 0,
  lateMinutes: 0,
  halfDays: 0,
  absentDays: 0,
  workedHours: 0,
  tasksDone: 0,
  loggedHours: 0,
  meetingsAttended: 0,
  meetingsInvited: 0,
  shoots: 0,
  leaveDays: 0,
});

const round1 = (n: number) => Math.round(n * 10) / 10;

/** `YYYY-MM` keys for the last `n` months, oldest first (Asia/Dhaka). */
const monthKeys = (n: number): string[] => {
  const [y, m] = dateStrDhaka(new Date()).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
};

const monthBounds = (keys: string[]) => {
  const [fy, fm] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  return {
    start: new Date(Date.UTC(fy, fm - 1, 1)),
    end: new Date(Date.UTC(ly, lm, 1)),
  };
};

@Injectable()
export class PeopleAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-employee × per-month matrix for the last `months` months.
   * One query per source table — not one query per cell.
   */
  async monthlyMatrix(opts: { months?: number; department?: string } = {}) {
    const count = Math.min(Math.max(Number(opts.months) || 6, 1), 24);
    const keys = monthKeys(count);
    const { start, end } = monthBounds(keys);
    // Future-dated attendance rows exist (recompute writes the whole month and
    // a seed can pre-fill it). The operational report never counts a day that
    // has not happened yet, so the management view must not either — otherwise
    // "absent days" runs ahead of reality by one or two every month.
    const tomorrow = new Date(`${dateStrDhaka(new Date())}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const attendanceUntil = end.getTime() < tomorrow.getTime() ? end : tomorrow;

    const [employees, attendance, tasks, logs, meetingAttendees, shoots, leaves, policy, holidays, overrides] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          employmentStatus: { not: "EXITED" },
          ...(opts.department ? { department: opts.department } : {}),
        },
        select: {
          id: true,
          name: true,
          roleTitle: true,
          department: true,
          photoUrl: true,
          joinDate: true,
          shiftStart: true,
          graceMinutes: true,
          weeklyOffDays: true,
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.attendance.findMany({
        where: { date: { gte: start, lt: attendanceUntil } },
        select: { employeeId: true, date: true, status: true, checkInTime: true, checkOutTime: true },
      }),
      this.prisma.task.findMany({
        where: { status: "DONE", completedAt: { gte: start, lt: end }, assignedToId: { not: null } },
        select: { assignedToId: true, completedAt: true },
      }),
      this.prisma.timeLog.findMany({
        where: { date: { gte: start, lt: end }, employeeId: { not: null } },
        select: { employeeId: true, date: true, hours: true },
      }),
      this.prisma.leadMeetingAttendee.findMany({
        where: { meeting: { scheduledAt: { gte: start, lt: end } } },
        select: { employeeId: true, status: true, meeting: { select: { scheduledAt: true } } },
      }),
      this.prisma.shootCrew.findMany({
        where: {
          employeeId: { not: null },
          shoot: { shootDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
        },
        select: { employeeId: true, shoot: { select: { shootDate: true } } },
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
      this.prisma.attendancePolicy.findFirst({ where: { id: "default" } }),
      this.prisma.holiday.findMany({ where: { date: { gte: start.toISOString().slice(0, 10), lt: end.toISOString().slice(0, 10) } }, select: { date: true } }),
      this.prisma.workdayOverride.findMany({ where: { date: { gte: start.toISOString().slice(0, 10), lt: end.toISOString().slice(0, 10) } }, select: { date: true, isOpen: true } }),
    ]);

    const defaultShift = policy?.shiftStart ?? "10:00";
    const defaultGrace = policy?.graceMinutes ?? 0;
    const todayStr = dateStrDhaka(new Date());
    const holidaySet = new Set(holidays.map((h) => h.date));
    const overrideMap = new Map(overrides.map((o) => [o.date, o.isOpen]));
    const offDays = (emp: (typeof employees)[number]) =>
      new Set(
        (emp.weeklyOffDays?.length ? emp.weeklyOffDays : policy?.weeklyOffDays ?? [])
          .map((d) => String(d).toUpperCase()),
      );
    /**
     * Same precedence as `AttendanceService.isWorkingDay`:
     * override → holiday → weekly off. The management view must not count an
     * absence on a day nobody was expected to work.
     */
    const isWorkingDay = (dstr: string, emp: (typeof employees)[number]) => {
      const ov = overrideMap.get(dstr);
      if (ov !== undefined) return ov;
      if (holidaySet.has(dstr)) return false;
      return !offDays(emp).has(weekdayDhaka(new Date(`${dstr}T00:00:00.000Z`)));
    };

    // employeeId -> month -> bucket
    const grid = new Map<string, Map<string, Bucket>>();
    const bucketFor = (employeeId: string, month: string) => {
      let months = grid.get(employeeId);
      if (!months) grid.set(employeeId, (months = new Map()));
      let b = months.get(month);
      if (!b) months.set(month, (b = emptyBucket()));
      return b;
    };

    const empById = new Map(employees.map((e) => [e.id, e]));

    // Approved leave days, keyed `employeeId|YYYY-MM-DD`, so an attendance row
    // on a leave day is not billed twice (leave + absence).
    const leaveDates = new Set<string>();
    for (const l of leaves) {
      const emp = empById.get(l.employeeId);
      if (!emp) continue;
      const from = dateStrDhaka(l.startDate);
      const to = dateStrDhaka(l.endDate);
      const cursor = new Date(`${from}T00:00:00.000Z`);
      const last = new Date(`${to}T00:00:00.000Z`);
      let guard = 0;
      while (cursor <= last && guard++ < 400) {
        const dstr = dateStrDhaka(cursor);
        leaveDates.add(`${l.employeeId}|${dstr}`);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    for (const a of attendance) {
      const emp = empById.get(a.employeeId);
      if (!emp) continue;
      const dstr = dateStrDhaka(a.date);
      if (dstr > todayStr) continue; // not happened yet
      if (dstr < dateStrDhaka(emp.joinDate)) continue; // not employed yet
      if (!isWorkingDay(dstr, emp)) continue; // weekend / holiday / closed office
      if (leaveDates.has(`${a.employeeId}|${dstr}`) && !a.checkInTime) continue; // counted as leave
      const b = bucketFor(a.employeeId, dstr.slice(0, 7));
      if (a.status === "PRESENT" || a.status === "WFH") b.presentDays++;
      else if (a.status === "LATE") {
        b.lateDays++;
        const shift = emp.shiftStart ?? defaultShift;
        const grace = emp.graceMinutes ?? defaultGrace;
        if (a.checkInTime) {
          const inMinutes = minutesOf(toHHmmDhaka(new Date(a.checkInTime)));
          b.lateMinutes += Math.max(0, inMinutes - (minutesOf(shift) + grace));
        }
      } else if (a.status === "HALF_DAY") b.halfDays++;
      else if (a.status === "ABSENT") b.absentDays++;
      if (a.checkInTime && a.checkOutTime) {
        const worked = (new Date(a.checkOutTime).getTime() - new Date(a.checkInTime).getTime()) / 3600000;
        if (worked > 0 && worked < 24) b.workedHours += worked;
      }
    }

    for (const t of tasks) {
      const id = t.assignedToId!;
      if (!empById.has(id) || !t.completedAt) continue;
      bucketFor(id, dateStrDhaka(t.completedAt).slice(0, 7)).tasksDone++;
    }

    for (const l of logs) {
      const id = l.employeeId!;
      if (!empById.has(id)) continue;
      bucketFor(id, dateStrDhaka(l.date).slice(0, 7)).loggedHours += Number(l.hours ?? 0);
    }

    for (const m of meetingAttendees) {
      if (!empById.has(m.employeeId)) continue;
      const b = bucketFor(m.employeeId, dateStrDhaka(m.meeting.scheduledAt).slice(0, 7));
      b.meetingsInvited++;
      if (m.status === "ATTENDED") b.meetingsAttended++;
    }

    for (const s of shoots) {
      const id = s.employeeId!;
      if (!empById.has(id)) continue;
      bucketFor(id, dateStrDhaka(s.shoot.shootDate).slice(0, 7)).shoots++;
    }

    for (const l of leaves) {
      const emp = empById.get(l.employeeId);
      if (!emp) continue;
      // Only leave that has actually been taken counts; approved future leave
      // belongs in "balance", not in "days taken this month".
      const from = new Date(Math.max(l.startDate.getTime(), start.getTime()));
      const to = new Date(Math.min(l.endDate.getTime(), end.getTime() - 86400000));
      const cursor = new Date(from);
      let guard = 0;
      while (cursor <= to && guard++ < 400) {
        const dstr = dateStrDhaka(cursor);
        if (dstr > todayStr) break;
        if (isWorkingDay(dstr, emp)) bucketFor(l.employeeId, dstr.slice(0, 7)).leaveDays++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const finalize = (b: Bucket) => ({
      ...b,
      lateMinutes: Math.round(b.lateMinutes),
      workedHours: round1(b.workedHours),
      loggedHours: round1(b.loggedHours),
    });

    const totalsByMonth = new Map<string, Bucket>(keys.map((k) => [k, emptyBucket()]));
    const rows = employees.map((e) => {
      const months: Record<string, ReturnType<typeof finalize>> = {};
      const total = emptyBucket();
      for (const key of keys) {
        const b = finalize(grid.get(e.id)?.get(key) ?? emptyBucket());
        months[key] = b;
        const t = totalsByMonth.get(key)!;
        for (const k of Object.keys(total) as (keyof Bucket)[]) {
          total[k] += b[k];
          t[k] += b[k];
        }
      }
      return {
        employee: e,
        months,
        totals: finalize(total),
      };
    });

    return {
      months: keys.map((key) => {
        const [y, m] = key.split("-").map(Number);
        return {
          key,
          label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short" }) + ` '${String(y).slice(2)}`,
        };
      }),
      totals: Object.fromEntries(keys.map((k) => [k, finalize(totalsByMonth.get(k)!)])),
      rows,
      departments: [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(),
    };
  }

  /** One employee's monthly series + shoot/meeting history for the profile page. */
  async employeeTrend(employeeId: string, months = 12) {
    const matrix = await this.monthlyMatrix({ months });
    const row = matrix.rows.find((r) => r.employee.id === employeeId);
    const recentShoots = await this.prisma.shootCrew.findMany({
      where: { employeeId, shoot: { status: { not: "CANCELLED" } } },
      select: {
        id: true,
        role: true,
        isConfirmed: true,
        shoot: {
          select: {
            id: true,
            title: true,
            shootDate: true,
            status: true,
            location: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { shoot: { shootDate: "desc" } },
      take: 8,
    });
    return {
      months: matrix.months,
      row: row ?? null,
      totals: row?.totals ?? emptyBucket(),
      recentShoots: recentShoots.map((s) => ({
        id: s.id,
        role: s.role,
        isConfirmed: s.isConfirmed,
        shootId: s.shoot.id,
        title: s.shoot.title,
        shootDate: s.shoot.shootDate.toISOString(),
        status: s.shoot.status,
        location: s.shoot.location,
        project: s.shoot.project?.name ?? null,
      })),
    };
  }
}
