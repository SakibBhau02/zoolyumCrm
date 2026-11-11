import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { CapitalService } from "../capital/capital.service";
import { AttendanceService } from "./attendance.service";
import { assertPeriod, dhakaDayRange, dhakaDaysInMonth, leaveDays } from "./people-utils";

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly capital: CapitalService,
    private readonly attendance: AttendanceService
  ) {}

  /**
   * Compact status for the page header: the newest period that actually has
   * records, plus how far it got through DRAFT → FINALIZED → PAID. The header
   * used to hard-code "Payroll: July finalized", which was simply untrue.
   */
  async status() {
    const last = await this.prisma.payrollRecord.findFirst({ orderBy: { period: "desc" }, select: { period: true } });
    if (!last) return { period: null, status: null, count: 0, totalNet: 0, breakdown: [] as { status: string; count: number }[] };
    const [agg, byStatus] = await Promise.all([
      this.prisma.payrollRecord.aggregate({ where: { period: last.period }, _count: { _all: true }, _sum: { netPay: true } }),
      this.prisma.payrollRecord.groupBy({ by: ["status"], where: { period: last.period }, _count: { _all: true } }),
    ]);
    const breakdown = byStatus.map((s) => ({ status: s.status, count: s._count._all }));
    const status = breakdown.length === 1 ? breakdown[0].status : breakdown.some((b) => b.status === "DRAFT") ? "IN_PROGRESS" : "MIXED";
    return {
      period: last.period,
      status,
      count: agg._count._all,
      totalNet: Number(agg._sum.netPay ?? 0),
      breakdown,
    };
  }

  async payslip(id: string, user?: any) {
    const record = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: { select: { id: true, name: true, roleTitle: true, department: true, salary: true, joinDate: true } } },
    });
    if (!record) throw new NotFoundException("Payroll record not found");
    // Ownership gate: HR sees everyone, an employee sees only their own slip.
    if (user && !/owner|hr|admin/i.test(user.role ?? "")) {
      const self = await this.prisma.employee.findFirst({ where: { user: { id: user.sub } }, select: { id: true } });
      if (!self || self.id !== record.employeeId) {
        throw new ForbiddenException("You can only open your own payslip");
      }
    }
    const branding = await this.prisma.brandingConfig.findFirst();
    return { record, employee: record.employee, company: { name: "Zoolyum OS", branding: branding ?? null } };
  }

  async payroll(period?: string) {
    const p = period ? assertPeriod(period, "period") : undefined;
    return this.prisma.payrollRecord.findMany({
      where: p ? { period: p } : undefined,
      include: {
        employee: { select: { id: true, name: true, roleTitle: true, department: true } },
        salaryExpense: { select: { id: true, amount: true } },
      },
      orderBy: [{ period: "desc" }, { employee: { name: "asc" } }],
    });
  }

  private appendAudit(existing: any, entry: any) {    const trail = Array.isArray(existing?.auditTrail) ? existing.auditTrail : [];
    return [...trail, entry];
  }

  /**
   * A posted salary expense must follow the payroll record: reverse + repost the
   * ledger and update the expense amount. Cash movement is handled once, inside
   * `updateExpense` — the old extra bank decrement here debited the account a
   * second time for the same delta.
   */
  private async syncPostedSalary(rec: any, netPay: number, actorId?: string) {
    const expense = rec?.salaryExpense;
    if (!expense?.id) return;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    await this.capital.updateExpense(expense.id, { amount: r2(netPay) }, actorId, { skipPayrollSync: true });
    await this.capital.invalidateFinance().catch(() => null);
  }

  private computeNet(basic: number, allowances: number, bonus: number, lateD: number, halfD: number, absentD: number, unpaidD: number) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const totalD = r2(lateD + halfD + absentD + unpaidD);
    return { totalD, netPay: r2(basic + allowances + bonus - totalD) };
  }

  private async buildForEmployee(e: any, period: string, reportMap: Map<string, any>, unpaidMap: Record<string, number>) {
    const basic = Number(e.salary ?? 0);
    const rep = reportMap.get(e.id);
    const daily = rep?.dailyRate ?? 0;
    const lateD = rep?.lateDeduction ?? 0;
    const halfD = rep?.halfDayDeduction ?? 0;
    const absentD = rep?.absentDeduction ?? 0;
    const unpaidD = (unpaidMap[e.id] ?? 0) * daily;
    const { totalD, netPay } = this.computeNet(basic, 0, 0, lateD, halfD, absentD, unpaidD);
    return {
      basic, daily, lateD, halfD, absentD, unpaidD, totalD, netPay,
      breakdown: rep
        ? { workingDays: rep.workingDays, divisor: rep.divisor, dailyRate: rep.dailyRate, lateCount: rep.late, halfDays: rep.halfDay, absentDays: rep.absent }
        : {},
      attendance: rep ? { present: rep.present, late: rep.late, halfDay: rep.halfDay, absent: rep.absent } : null,
    };
  }

  async runPayroll(period: string) {
    const month = assertPeriod(period, "period");
    const employees = await this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } });
    const existing = await this.prisma.payrollRecord.findMany({ where: { period: month }, select: { employeeId: true } });
    const existingIds = new Set(existing.map((e) => e.employeeId));
    const report = await this.attendance.attendanceReport({ month });
    const reportMap = new Map(report.map((r) => [r.employeeId, r]));
    const days = dhakaDaysInMonth(month);
    const mStart = dhakaDayRange(days[0]).start;
    const mEnd = dhakaDayRange(days[days.length - 1]).end;
    const unpaidLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        leaveType: "UNPAID",
        status: "APPROVED",
        // @db.Date columns compare at day precision — pad the upper bound
        // so leaves starting on the month's last day are included
        startDate: { gte: mStart, lt: new Date(mEnd.getTime() + 86400000) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const unpaidMap: Record<string, number> = {};
    for (const l of unpaidLeaves) unpaidMap[l.employeeId] = (unpaidMap[l.employeeId] ?? 0) + leaveDays(l.startDate, l.endDate);

    const rows: any[] = [];
    for (const e of employees) {
      if (existingIds.has(e.id)) continue;
      const c = await this.buildForEmployee(e, month, reportMap, unpaidMap);
      rows.push({
        employeeId: e.id,
        period: month,
        basicSalary: c.basic,
        allowances: 0,
        lateDeduction: Math.round(c.lateD * 100) / 100,
        halfDayDeduction: Math.round(c.halfD * 100) / 100,
        absentDeduction: Math.round(c.absentD * 100) / 100,
        unpaidLeaveDeduction: Math.round(c.unpaidD * 100) / 100,
        deductions: Math.round(c.totalD * 100) / 100,
        bonus: 0,
        netPay: Math.round(c.netPay * 100) / 100,
        status: "DRAFT" as const,
        breakdown: c.breakdown as any,
        auditTrail: [
          {
            action: "generated",
            at: new Date().toISOString(),
            by: "Payroll Run",
            attendance: c.attendance,
          },
        ],
      });
    }
    if (!rows.length) {
      return { period: month, createdCount: 0, skipped: employees.length, attendanceRows: report.length, warning: null };
    }
    // skipDuplicates rides on PayrollRecord's (employeeId, period) unique index:
    // a double click or two HR users running at once can no longer pay twice.
    const inserted = await this.prisma.payrollRecord.createMany({ data: rows, skipDuplicates: true });
    return {
      period: month,
      createdCount: inserted.count,
      skipped: employees.length - inserted.count,
      attendanceRows: report.length,
      // Silence here used to mean "full salary, zero deductions" with no hint.
      warning:
        report.length === 0
          ? "No attendance was computed for this period — deductions are 0. Run attendance recompute first if that is not what you expect."
          : null,
    };
  }

  /** Manual edit of a payroll record — recomputes net pay, syncs a posted salary expense. */
  async updatePayrollRecord(id: string, body: any, actorId?: string) {
    const rec = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: { select: { name: true } }, salaryExpense: { select: { id: true, amount: true, bankAccountId: true, balanceDeducted: true } } },
    });
    if (!rec) throw new NotFoundException("Payroll record not found");
    // A disbursed payslip is an accounting fact; changing it months later would
    // silently rewrite closed payroll and the ledger against it.
    if (rec.status === "PAID") {
      throw new BadRequestException("This payroll is already paid — record an adjustment instead of editing it.");
    }
    const num = (v: any, fallback: any) => (v === undefined || v === null || v === "" ? Number(fallback ?? 0) : Number(v));
    // Every money field must be a finite, non-negative number.
    const moneyFields = ["basicSalary", "allowances", "bonus", "lateDeduction", "halfDayDeduction", "absentDeduction", "unpaidLeaveDeduction"] as const;
    for (const field of moneyFields) {
      if (body[field] === undefined || body[field] === null || body[field] === "") continue;
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be zero or greater`);
    }
    if (body.basicSalary !== undefined && Number.isNaN(Number(body.basicSalary))) throw new BadRequestException("Invalid basic salary");
    const basic = num(body.basicSalary, rec.basicSalary);
    const allowances = num(body.allowances, (rec as any).allowances ?? 0);
    const bonus = num(body.bonus, (rec as any).bonus ?? 0);
    const lateD = num(body.lateDeduction, rec.lateDeduction);
    const halfD = num(body.halfDayDeduction, rec.halfDayDeduction);
    const absentD = num(body.absentDeduction, rec.absentDeduction);
    const unpaidD = num(body.unpaidLeaveDeduction, rec.unpaidLeaveDeduction);
    const { totalD, netPay } = this.computeNet(basic, allowances, bonus, lateD, halfD, absentD, unpaidD);
    if (netPay < 0) throw new BadRequestException("Net pay cannot be negative — check the deductions.");
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const updated = await this.prisma.payrollRecord.update({
      where: { id },
      data: {
        basicSalary: r2(basic),
        allowances: r2(allowances),
        bonus: r2(bonus),
        lateDeduction: r2(lateD),
        halfDayDeduction: r2(halfD),
        absentDeduction: r2(absentD),
        unpaidLeaveDeduction: r2(unpaidD),
        deductions: r2(totalD),
        netPay: r2(netPay),
        auditTrail: this.appendAudit(rec, { action: "manual-edit", at: new Date().toISOString(), by: actorId ?? "staff", before: { netPay: Number(rec.netPay) }, after: { netPay: r2(netPay) } }),
      },
    });
    // Keep a posted salary expense in sync (ledger reversal/repost + bank).
    await this.syncPostedSalary(rec, netPay, actorId);
    return updated;
  }

  /** Refresh attendance-derived deductions from the current report (not PAID). */
  async recomputePayrollRecord(id: string, actorId?: string) {
    const rec = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: true, salaryExpense: { select: { id: true } } },
    });
    if (!rec) throw new NotFoundException("Payroll record not found");
    if (rec.status === "PAID") throw new BadRequestException("Already paid out — edit manually instead of recomputing");
    const report = await this.attendance.attendanceReport({ month: rec.period });
    const rep = report.find((r) => r.employeeId === rec.employeeId);
    if (!rep) throw new BadRequestException("No attendance data for this employee and period");
    const daily = rep.dailyRate ?? 0;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const lateD = r2(rep.lateDeduction ?? 0);
    const halfD = r2(rep.halfDayDeduction ?? 0);
    const absentD = r2(rep.absentDeduction ?? 0);
    const allowances = Number((rec as any).allowances ?? 0);
    const bonus = Number((rec as any).bonus ?? 0);
    // Unpaid leave is intentionally left as-is on recompute (HR-owned).
    const unpaidD = Number(rec.unpaidLeaveDeduction ?? 0);
    // Use the CURRENT employee salary (it may have changed since the run),
    // otherwise fresh deductions mix with a stale basic and net goes wrong.
    const basicNow = Number(rec.employee?.salary ?? rec.basicSalary);
    const { totalD, netPay } = this.computeNet(basicNow, allowances, bonus, lateD, halfD, absentD, unpaidD);
    const updated = await this.prisma.payrollRecord.update({
      where: { id },
      data: {
        basicSalary: r2(basicNow),
        lateDeduction: lateD,
        halfDayDeduction: halfD,
        absentDeduction: absentD,
        deductions: r2(totalD),
        netPay: r2(netPay),
        breakdown: { workingDays: rep.workingDays, divisor: rep.divisor, dailyRate: rep.dailyRate, lateCount: rep.late, halfDays: rep.halfDay, absentDays: rep.absent } as any,
        auditTrail: this.appendAudit(rec, { action: "recomputed", at: new Date().toISOString(), by: actorId ?? "staff", before: { netPay: Number(rec.netPay) }, after: { netPay: r2(netPay) } }),
      },
    });
    if (rec.salaryExpense) {
      await this.syncPostedSalary(rec, r2(netPay), actorId);
    }
    return updated;
  }

  async deletePayrollRecord(id: string) {
    const rec = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { salaryExpense: { select: { id: true } } },
    });
    if (!rec) throw new NotFoundException("Payroll record not found");
    if (rec.status !== "DRAFT") throw new BadRequestException("Only DRAFT records can be deleted — posted salary lives in finance");
    await this.prisma.payrollRecord.delete({ where: { id } });
    return { ok: true };
  }

  async updatePayrollStatus(id: string, status: "DRAFT" | "FINALIZED" | "PAID", actorId?: string, bankAccountId?: string) {
    const rec = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: { select: { name: true } }, salaryExpense: { select: { id: true, amount: true, bankAccountId: true, balanceDeducted: true } } },
    });
    if (!rec) throw new NotFoundException("Payroll record not found");
    // Reopen: FINALIZED → DRAFT pulls the posted salary back out of finance
    // (reverse journal, refund bank, delete expense) so mistakes are fixable.
    if (status === "DRAFT" && rec.status === "FINALIZED" && rec.salaryExpense) {
      await this.capital.reverseLedger(rec.salaryExpense.id, actorId);
      if ((rec.salaryExpense as any).balanceDeducted && (rec.salaryExpense as any).bankAccountId) {
        await this.prisma.bankAccount.update({
          where: { id: (rec.salaryExpense as any).bankAccountId },
          data: { currentBalance: { increment: Number((rec.salaryExpense as any).amount) } },
        });
      }
      await this.prisma.expense.delete({ where: { id: rec.salaryExpense.id } });
      const updated = await this.prisma.payrollRecord.update({
        where: { id },
        data: {
          status: "DRAFT",
          auditTrail: this.appendAudit(rec, { action: "reopened", at: new Date().toISOString(), by: actorId ?? "staff" }),
        },
      });
      await this.capital.invalidateFinance();
      return updated;
    }
    if (status === "DRAFT" && rec.status === "PAID") {
      throw new BadRequestException("Already paid out — adjust via a correction entry instead of reopening");
    }
    const updated = await this.prisma.payrollRecord.update({
      where: { id },
      data: {
        status,
        auditTrail: this.appendAudit(rec, { action: `status-${status.toLowerCase()}`, at: new Date().toISOString(), by: actorId ?? "staff" }),
      },
    });
    if (status === "FINALIZED" && !rec.salaryExpense) {
      // Which account pays salaries: the one HR picked, else the account that
      // paid the previous salary, else the first account by name. The old code
      // sorted by accountType, which is arbitrary.
      const lastSalary = await this.prisma.expense.findFirst({
        where: { category: "SALARY", bankAccountId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { bankAccountId: true },
      });
      const bankAccount =
        (bankAccountId ? await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } }) : null) ??
        (lastSalary?.bankAccountId ? await this.prisma.bankAccount.findUnique({ where: { id: lastSalary.bankAccountId } }) : null) ??
        (await this.prisma.bankAccount.findFirst({ orderBy: { accountName: "asc" } }));
      const expense = await this.prisma.expense.create({
        data: {
          description: `Salary — ${rec.employee.name} (${rec.period})`,
          amount: rec.netPay,
          category: "SALARY",
          date: new Date(),
          approvalStatus: "APPROVED",
          submittedById: null,
          payrollRecordId: rec.id,
          bankAccountId: bankAccount?.id ?? null,
          balanceDeducted: false,
        },
      });
      // Post the double-entry journal (same as any approved expense) so the
      // general ledger stays in sync with the salary expense.
      await this.capital.postExpenseLedger(expense.id, actorId);
      if (bankAccount) {
        await this.prisma.bankAccount.update({ where: { id: bankAccount.id }, data: { currentBalance: { decrement: rec.netPay } } });
        await this.prisma.expense.update({ where: { id: expense.id }, data: { balanceDeducted: true } });
      }
      try {
        await this.capital.notifyRole(
          "Finance",
          "SALARY_POSTED",
          "Salary posted to finance",
          `Salary — ${rec.employee.name} (${rec.period}): ৳${Number(rec.netPay).toLocaleString()} posted as a salary expense.`,
          "/capital/expenses"
        );
      } catch {}
      await this.capital.invalidateFinance();
      await this.cache.del("capital:overview");
      await this.cache.del("capital:reports");
    }
    return updated;
  }
}
