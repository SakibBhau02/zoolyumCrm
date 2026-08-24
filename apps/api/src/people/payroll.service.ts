import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { CapitalService } from "../capital/capital.service";
import { AttendanceService } from "./attendance.service";
import { leaveDays } from "./people-utils";

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly capital: CapitalService,
    private readonly attendance: AttendanceService
  ) {}

  async payslip(id: string) {
    const record = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: { select: { id: true, name: true, roleTitle: true, department: true, salary: true, joinDate: true } } },
    });
    if (!record) throw new NotFoundException("Payroll record not found");
    const branding = await this.prisma.brandingConfig.findFirst();
    return { record, employee: record.employee, company: { name: "Zoolyum OS", branding: branding ?? null } };
  }

  async payroll(period?: string) {
    return this.prisma.payrollRecord.findMany({
      where: period ? { period } : undefined,
      include: { employee: { select: { id: true, name: true, roleTitle: true, department: true } } },
      orderBy: [{ period: "desc" }, { employee: { name: "asc" } }],
    });
  }

  async runPayroll(period: string) {
    const employees = await this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } });
    const existing = await this.prisma.payrollRecord.findMany({ where: { period }, select: { employeeId: true } });
    const existingIds = new Set(existing.map((e) => e.employeeId));
    const report = await this.attendance.attendanceReport(period);
    const reportMap = new Map(report.map((r) => [r.employeeId, r]));
    const unpaidLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        leaveType: "UNPAID",
        status: "APPROVED",
        startDate: { gte: new Date(`${period}-01T00:00:00.000Z`), lt: new Date(new Date(`${period}-01`).getFullYear(), new Date(`${period}-01`).getMonth() + 1, 1) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const unpaidMap: Record<string, number> = {};
    for (const l of unpaidLeaves) unpaidMap[l.employeeId] = (unpaidMap[l.employeeId] ?? 0) + leaveDays(l.startDate, l.endDate);

    const created = [];
    for (const e of employees) {
      if (existingIds.has(e.id)) continue;
      const basic = Number(e.salary ?? 0);
      const rep = reportMap.get(e.id);
      const daily = rep?.dailyRate ?? 0;
      const lateD = rep?.lateDeduction ?? 0;
      const halfD = rep?.halfDayDeduction ?? 0;
      const absentD = rep?.absentDeduction ?? 0;
      const unpaidD = (unpaidMap[e.id] ?? 0) * daily;
      const totalD = lateD + halfD + absentD + unpaidD;
      const rec = await this.prisma.payrollRecord.create({
        data: {
          employeeId: e.id,
          period,
          basicSalary: basic,
          allowances: 0,
          lateDeduction: Math.round(lateD * 100) / 100,
          halfDayDeduction: Math.round(halfD * 100) / 100,
          absentDeduction: Math.round(absentD * 100) / 100,
          unpaidLeaveDeduction: Math.round(unpaidD * 100) / 100,
          deductions: Math.round(totalD * 100) / 100,
          bonus: 0,
          netPay: Math.round((basic - totalD) * 100) / 100,
          status: "DRAFT",
          breakdown: rep
            ? { workingDays: rep.workingDays, divisor: rep.divisor, dailyRate: rep.dailyRate, lateCount: rep.late, halfDays: rep.halfDay, absentDays: rep.absent }
            : {},
          auditTrail: [
            {
              action: "generated",
              at: new Date().toISOString(),
              by: "Payroll Run",
              attendance: rep ? { present: rep.present, late: rep.late, halfDay: rep.halfDay, absent: rep.absent } : null,
            },
          ],
        },
      });
      created.push(rec.id);
    }
    return { period, createdCount: created.length };
  }

  async updatePayrollStatus(id: string, status: "DRAFT" | "FINALIZED" | "PAID") {
    const rec = await this.prisma.payrollRecord.findUnique({
      where: { id },
      include: { employee: { select: { name: true } }, salaryExpense: { select: { id: true } } },
    });
    if (!rec) throw new NotFoundException("Payroll record not found");
    const updated = await this.prisma.payrollRecord.update({
      where: { id },
      data: { status, auditTrail: [{ action: `status-${status.toLowerCase()}`, at: new Date().toISOString() }] },
    });
    if (status === "FINALIZED" && !rec.salaryExpense) {
      const bankAccount = await this.prisma.bankAccount.findFirst({ orderBy: { accountType: "asc" } });
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
      if (bankAccount) {
        await this.prisma.bankAccount.update({ where: { id: bankAccount.id }, data: { currentBalance: { decrement: rec.netPay } } });
        await this.prisma.expense.update({ where: { id: expense.id }, data: { balanceDeducted: true } });
      }
      await this.capital.invalidateFinance();
      await this.cache.del("capital:overview");
      await this.cache.del("capital:reports");
    }
    return updated;
  }
}
