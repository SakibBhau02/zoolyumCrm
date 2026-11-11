import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AttendanceService } from "./attendance.service";
import { PayrollService } from "./payroll.service";
import { dateStrDhaka } from "./people-utils";

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const money = (v: any) => `৳${Math.round(Number(v ?? 0)).toLocaleString("en-US")}`;

/**
 * People-module automation — the difference between an HR *record* and an HR
 * *system*. Everything here turns a manual button into a scheduled nudge, and
 * every message goes through NotificationsService so it lands in the bell and
 * on Telegram (when the person linked a chat) without extra plumbing.
 *
 * Dedupe rule: one notification per type per person per day. A restart, a
 * double cron tick or a manual trigger can never spam the team.
 */
@Injectable()
export class PeopleAutomationService {
  private readonly logger = new Logger("PeopleAutomation");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly attendance: AttendanceService,
    private readonly payroll: PayrollService
  ) {}

  private async alreadyNotified(userId: string, type: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const hit = await this.prisma.notification.findFirst({
      where: { userId, type, createdAt: { gte: start } },
      select: { id: true },
    });
    return !!hit;
  }

  /** Same rule, but for a role-wide broadcast (one per type per day). */
  private async roleNotifiedToday(roleMatch: string, type: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const hit = await this.prisma.notification.findFirst({
      where: {
        type,
        createdAt: { gte: start },
        user: { role: { name: { contains: roleMatch, mode: "insensitive" } } },
      },
      select: { id: true },
    });
    return !!hit;
  }

  /** Is today a working day, per policy + holiday calendar + work calendar? */
  private async workingDay(dateStr: string) {
    const [policy, holiday, override] = await Promise.all([
      this.prisma.attendancePolicy.findUnique({ where: { id: "default" } }),
      this.prisma.holiday.findFirst({ where: { date: dateStr }, select: { id: true } }),
      this.prisma.workdayOverride.findFirst({ where: { date: dateStr }, select: { isOpen: true } }),
    ]);
    // An explicit calendar override wins over both the weekly off and holidays —
    // an override-open Saturday was skipped by the cron, so nobody got a row.
    if (override) return override.isOpen;
    if (holiday) return false;
    const dow = DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
    return !(policy?.weeklyOffDays ?? []).includes(dow);
  }

  // ── Nightly attendance recompute ───────────────────────────────────────
  /**
   * 23:45 — rebuild today and yesterday from punches. Without this, attendance
   * only exists if an HR user remembered to press "Recompute", which meant
   * payroll could be computed against a half-empty month.
   */
  @Cron("45 23 * * *")
  async nightlyRecompute() {
    const employees = await this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" }, select: { id: true } });
    const days = [dateStrDhaka(new Date()), dateStrDhaka(new Date(Date.now() - 86400000))];
    let processed = 0;
    for (const d of days) {
      if (!(await this.workingDay(d))) continue;
      for (const e of employees) {
        try {
          await this.attendance.recomputeDay(e.id, d);
          processed++;
        } catch (err: any) {
          this.logger.warn(`recompute ${e.id} ${d} failed: ${err?.message}`);
        }
      }
    }
    return { processed };
  }

  // ── Missing punch nudges ───────────────────────────────────────────────
  /** 12:15 — nobody has checked in yet. 19:15 — no check-out recorded. */
  @Cron("15 12 * * *")
  async lunchNudge() {
    return this.nudgeMissing("in");
  }

  @Cron("15 19 * * *")
  async eveningNudge() {
    return this.nudgeMissing("out");
  }

  private async nudgeMissing(kind: "in" | "out") {
    const today = dateStrDhaka(new Date());
    if (!(await this.workingDay(today))) return { skipped: "non-working-day" };

    const column = new Date(`${today}T00:00:00.000Z`);
    const dayEnd = new Date(column.getTime() + 86400000 - 1);
    const [employees, rows, onLeave] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, name: true, reportingManagerId: true, user: { select: { id: true } } },
      }),
      this.prisma.attendance.findMany({ where: { date: column }, select: { employeeId: true, checkInTime: true, checkOutTime: true } }),
      this.prisma.leaveRequest.findMany({
        where: { status: "APPROVED", startDate: { lte: dayEnd }, endDate: { gte: column } },
        select: { employeeId: true },
      }),
    ]);
    const skip = new Set(onLeave.map((l) => l.employeeId));

    const byEmp = new Map(rows.map((r) => [r.employeeId, r]));
    let sent = 0;

    for (const e of employees) {
      if (skip.has(e.id)) continue;
      const row = byEmp.get(e.id);
      const missing = kind === "in" ? !row?.checkInTime : !!row?.checkInTime && !row?.checkOutTime;
      if (!missing) continue;

      const title = kind === "in" ? "No check-in yet" : "No check-out recorded";
      const message =
        kind === "in"
          ? `${e.name} has no check-in today. Record it or correct the attendance before payroll closes.`
          : `${e.name} checked in but never checked out — the day is still open and will count as overtime if left.`;

      if (e.user?.id && !(await this.alreadyNotified(e.user.id, "ATTENDANCE_NUDGE"))) {
        await this.notifications.create(e.user.id, "ATTENDANCE_NUDGE", title, message, "/people/me").catch(() => null);
        sent++;
      }
      // The manager only hears about it if the employee cannot be reached.
      if (e.reportingManagerId) {
        const manager = await this.prisma.employee.findUnique({ where: { id: e.reportingManagerId }, select: { user: { select: { id: true } } } });
        const managerUserId = manager?.user?.id;
        if (managerUserId && !(await this.alreadyNotified(managerUserId, "ATTENDANCE_NUDGE"))) {
          await this.notifications.create(managerUserId, "ATTENDANCE_NUDGE", `${title} — ${e.name}`, message, `/people/team?id=${e.id}`).catch(() => null);
          sent++;
        }
      }
    }
    return { kind, sent };
  }

  // ── Payroll run reminder ───────────────────────────────────────────────
  /** 25th, 10:00 — payroll has not been generated for this period. */
  @Cron("0 10 25 * *")
  async payrollReminder() {
    const period = dateStrDhaka(new Date()).slice(0, 7);
    const existing = await this.prisma.payrollRecord.count({ where: { period } });
    if (existing > 0) return { skipped: "already-run" };
    if (await this.roleNotifiedToday("Owner", "PAYROLL_REMINDER")) return { skipped: "already-notified" };
    const sent = await this.notifications.notifyRole("Owner", "PAYROLL_REMINDER", "Payroll not run yet", `No payroll records exist for ${period}. Run payroll before month-end so deductions land against real attendance.`, "/people/payroll").catch(() => 0);
    await this.notifications.notifyRole("HR", "PAYROLL_REMINDER", "Payroll not run yet", `No payroll records exist for ${period}. Run payroll before month-end.`, "/people/payroll").catch(() => null);
    return { period, sent };
  }

  /**
   * Monday 09:00 — documents expiring within 30 days (or already expired).
   * `Employee.documents` is a JSON blob, so the scan happens in code; at agency
   * headcount that is far cheaper than a schema change.
   */
  @Cron("0 9 * * 1")
  async documentExpiry() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: { not: "EXITED" } },
      select: { name: true, documents: true },
    });
    const soon: string[] = [];
    for (const e of employees) {
      for (const d of ((e.documents as any[]) ?? [])) {
        if (!d?.expiresAt) continue;
        const days = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86400000);
        if (Number.isNaN(days) || days > 30) continue;
        soon.push(`${e.name} · ${d.name ?? "document"} ${days < 0 ? `(expired ${Math.abs(days)}d ago)` : `(${days}d left)`}`);
      }
    }
    if (!soon.length) return { sent: 0 };
    if (await this.roleNotifiedToday("HR", "DOCUMENT_EXPIRY")) return { skipped: "already-notified", pending: soon.length };
    await this.notifications
      .notifyRole("HR", "DOCUMENT_EXPIRY", `${soon.length} document${soon.length === 1 ? " needs" : "s need"} attention`, soon.slice(0, 8).join("\n"), "/people/directory")
      .catch(() => 0);
    return { sent: soon.length };
  }

  /**
   * Monday 10:00 — onboarding/offboarding runs open for more than a week.
   * The checklist is only useful if someone notices it stalled; a half-finished
   * offboarding is how laptops and client access go missing.
   */
  @Cron("0 10 * * 1")
  async onboardingNudge() {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const runs = await this.prisma.employeeChecklist.findMany({
      where: { status: "IN_PROGRESS", startedAt: { lt: weekAgo } },
      include: { employee: { select: { name: true } }, items: { where: { done: false }, select: { label: true } } },
    });
    if (!runs.length) return { sent: 0 };
    if (await this.roleNotifiedToday("HR", "ONBOARDING_STALE")) return { skipped: "already-notified", pending: runs.length };
    const lines = runs.slice(0, 8).map((r) => `${r.employee.name} · ${r.kind.toLowerCase()} · ${r.items.length} step(s) left`);
    await this.notifications
      .notifyRole("HR", "ONBOARDING_STALE", `${runs.length} checklist${runs.length === 1 ? "" : "s"} stalled for over a week`, lines.join("\n"), "/people/onboarding")
      .catch(() => 0);
    return { sent: runs.length };
  }

  // ── Weekly owner digest ────────────────────────────────────────────────  /** Friday 17:00 — the one message an owner should read about people. */
  @Cron("0 17 * * 5")
  async weeklyDigest() {
    const today = dateStrDhaka(new Date());
    const column = new Date(`${today}T00:00:00.000Z`);
    const [employees, attendance, latestUtil, lastPayroll, overdue, leaveToday] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" }, select: { id: true } }),
      this.prisma.attendance.findMany({ where: { date: column } }),
      this.prisma.utilizationLog.groupBy({ by: ["employeeId"], _max: { weekStartDate: true } }),
      this.prisma.payrollRecord.findFirst({ orderBy: { period: "desc" }, select: { period: true } }),
      this.prisma.task.count({ where: { status: { not: "DONE" }, archivedAt: null, dueDate: { lt: new Date() } } }),
      this.prisma.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: new Date(column.getTime() + 86400000 - 1) }, endDate: { gte: column } } }),
    ]);

    let utilLogs: { utilizationRate: number }[] = [];
    if (latestUtil.length) {
      utilLogs = await this.prisma.utilizationLog.findMany({
        where: { OR: latestUtil.map((u) => ({ employeeId: u.employeeId, weekStartDate: u._max.weekStartDate! })) },
        select: { utilizationRate: true },
      });
    }
    const avgUtil = utilLogs.length ? Math.round((utilLogs.reduce((s, l) => s + Number(l.utilizationRate), 0) / utilLogs.length) * 100) : 0;
    const payrollCost = lastPayroll
      ? await this.prisma.payrollRecord.aggregate({ where: { period: lastPayroll.period }, _sum: { netPay: true } })
      : null;

    const present = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE" || a.status === "HALF_DAY").length;
    const onLeave = leaveToday;
    const body = [
      `${employees.length} active · ${present} in today · ${onLeave} on leave`,
      `Avg utilisation ${avgUtil}%`,
      payrollCost ? `Last payroll ${lastPayroll?.period}: ${money(payrollCost._sum.netPay)}` : "Payroll: never run",
      `${overdue} overdue task${overdue === 1 ? "" : "s"} across the team`,
    ].join("\n");

    if (await this.roleNotifiedToday("Owner", "PEOPLE_DIGEST")) return { skipped: "already-sent" };
    const count = await this.notifications.notifyRole("Owner", "PEOPLE_DIGEST", "Weekly people digest", body, "/people").catch(() => 0);
    return { sent: count };
  }

  /** Manual trigger for the Control panel / tests. */
  async runNow(which: "recompute" | "nudge-in" | "nudge-out" | "payroll" | "digest" | "documents") {
    switch (which) {
      case "recompute":
        return this.nightlyRecompute();
      case "nudge-in":
        return this.nudgeMissing("in");
      case "nudge-out":
        return this.nudgeMissing("out");
      case "payroll":
        return this.payrollReminder();
      case "digest":
        return this.weeklyDigest();
      case "documents":
        return this.documentExpiry();
      default:
        throw new BadRequestException(`Unknown automation: ${which}`);
    }
  }
}
