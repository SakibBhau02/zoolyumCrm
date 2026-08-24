import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AttendanceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { dateStr, invalidatePeopleCache, minutesOf, monthRange, toHHmm, weekdayName } from "./people-utils";

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // ── Attendance policy & punch engine ─────────────────────────────────
  private offDaysFor(emp: any, policy: any) {
    const od = emp.weeklyOffDays && emp.weeklyOffDays.length ? emp.weeklyOffDays : policy.weeklyOffDays;
    return new Set(od);
  }

  private computeDayStatus(emp: any, punches: { punchTime: Date }[], policy: any): { status: AttendanceStatus; checkIn: Date | null; checkOut: Date | null; minutesLate: number } {
    const shiftStart = emp.shiftStart ?? policy.shiftStart;
    const grace = emp.graceMinutes ?? policy.graceMinutes;
    const cutoff = policy.halfDayCutoff;
    if (!punches.length) return { status: "ABSENT", checkIn: null, checkOut: null, minutesLate: 0 };
    const checkIn = punches[0].punchTime;
    const checkOut = punches[punches.length - 1].punchTime;
    const inMin = minutesOf(toHHmm(checkIn));
    const limitMin = minutesOf(shiftStart) + grace;
    const cutoffMin = minutesOf(cutoff);
    let status: AttendanceStatus = "PRESENT";
    if (inMin > limitMin) status = inMin < cutoffMin ? "LATE" : "HALF_DAY";
    return { status, checkIn, checkOut, minutesLate: Math.max(0, inMin - limitMin) };
  }

  async attendancePolicy() {
    return this.prisma.attendancePolicy.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
  }

  async updateAttendancePolicy(body: any) {
    const data: any = {};
    for (const f of ["weeklyOffDays", "graceMinutes", "shiftStart", "shiftEnd", "halfDayCutoff", "lateLadder", "dailyRateDivisor", "proRataEnabled"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    return this.prisma.attendancePolicy.update({ where: { id: "default" }, data });
  }

  private async syncDay(emp: any, date: Date, ctx: {
    policy: any;
    holidays: Set<string>;
    leavesByEmp: Map<string, { startDate: Date; endDate: Date }[]>;
    punchesByEmpDate: Map<string, { punchTime: Date }[]>;
  }) {
    const dstr = dateStr(date);
    if (this.offDaysFor(emp, ctx.policy).has(weekdayName(date))) return null;
    if (ctx.holidays.has(dstr)) return null;
    const punches = (ctx.punchesByEmpDate.get(`${emp.id}|${dstr}`) ?? []).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
    const leaves = (ctx.leavesByEmp.get(emp.id) ?? []).filter((l) => date >= l.startDate && date <= l.endDate);
    if (leaves.length && !punches.length) {
      await this.prisma.attendance.deleteMany({ where: { employeeId: emp.id, date } });
      return null;
    }
    const { status, checkIn, checkOut } = this.computeDayStatus(emp, punches, ctx.policy);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const att = await this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: emp.id, date } },
      update: { status, checkInTime: checkIn, checkOutTime: checkOut },
      create: { employeeId: emp.id, date, status, checkInTime: checkIn, checkOutTime: checkOut },
    });
    if (punches.length) {
      await this.prisma.punchLog.updateMany({
        where: { employeeId: emp.id, punchTime: { gte: date, lt: next } },
        data: { isProcessed: true },
      });
    }
    return att;
  }

  private async recomputeDay(employeeId: string, dstr: string) {
    const date = new Date(`${dstr}T00:00:00.000Z`);
    const policy = await this.attendancePolicy();
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return;
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const [holidays, leaves, punches] = await Promise.all([
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } } }),
      this.prisma.punchLog.findMany({ where: { employeeId, punchTime: { gte: date, lt: next } } }),
    ]);
    await this.syncDay(emp, date, {
      policy,
      holidays: new Set(holidays.map((h) => h.date)),
      leavesByEmp: new Map([[employeeId, leaves.map((l) => ({ startDate: l.startDate, endDate: l.endDate }))]]),
      punchesByEmpDate: new Map([[`${employeeId}|${dstr}`, punches]]),
    });
  }

  async importPunches(rows: { deviceId: string; time: string; verifyMethod?: string; workCode?: string; deviceSn?: string; source?: string }[]) {
    const employees = await this.prisma.employee.findMany({ where: { deviceId: { not: null } }, select: { id: true, deviceId: true } });
    const byDevice = new Map(employees.map((e) => [e.deviceId!, e.id]));
    const existing = await this.prisma.punchLog.findMany({
      where: { OR: rows.filter((r) => r.time).map((r) => ({ deviceId: String(r.deviceId), punchTime: new Date(r.time) })) },
      select: { deviceId: true, punchTime: true },
    });
    const seenKeys = new Set(existing.map((e) => `${e.deviceId}|${new Date(e.punchTime).getTime()}`));
    const batchKeys = new Set<string>();
    const created: any[] = [];
    for (const r of rows) {
      if (!r.time) continue;
      const time = new Date(r.time);
      if (Number.isNaN(time.getTime())) continue;
      const key = `${r.deviceId}|${time.getTime()}`;
      if (seenKeys.has(key) || batchKeys.has(key)) continue;
      batchKeys.add(key);
      const empId = byDevice.get(String(r.deviceId)) ?? null;
      created.push(
        await this.prisma.punchLog.create({
          data: {
            deviceId: String(r.deviceId),
            employeeId: empId,
            punchTime: time,
            verifyMethod: r.verifyMethod ?? null,
            workCode: r.workCode ?? null,
            deviceSn: r.deviceSn ?? null,
            source: r.source ?? "DEVICE",
            unmatched: !empId,
          },
        })
      );
    }
    const affected = new Set<string>();
    for (const p of created) if (p.employeeId) affected.add(`${p.employeeId}|${dateStr(p.punchTime)}`);
    for (const key of affected) {
      const [employeeId, dstr] = key.split("|");
      await this.recomputeDay(employeeId, dstr);
    }
    await invalidatePeopleCache(this.cache);
    return { imported: created.length, unmatched: created.filter((c) => c.unmatched).length };
  }

  async iclockGetRequest(_sn?: string) {
    return "OK";
  }

  async iclockPushData(sn: string | undefined, table: string | undefined, raw: string) {
    if (table === "ATTLOG") {
      const rows: { deviceId: string; time: string; verifyMethod?: string; workCode?: string }[] = [];
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split("\t");
        if (parts.length < 2) continue;
        const deviceId = parts[0].trim();
        const dt = parts[1].trim().replace("T", " ").slice(0, 19);
        const time = new Date(dt);
        if (!deviceId || Number.isNaN(time.getTime())) continue;
        rows.push({
          deviceId,
          time: time.toISOString(),
          verifyMethod: parts[2] ? parts[2].trim() : undefined,
          workCode: parts[3] ? parts[3].trim() : undefined,
        });
      }
      if (rows.length) await this.importPunches(rows.map((r) => ({ ...r, deviceSn: sn })));
    }
    return "OK";
  }

  async punches(month?: string, unmatchedOnly = false) {
    const where: any = {};
    if (month) {
      const { start, end } = monthRange(month);
      where.punchTime = { gte: start, lt: end };
    }
    if (unmatchedOnly) where.unmatched = true;
    return this.prisma.punchLog.findMany({
      where,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { punchTime: "desc" },
      take: 500,
    });
  }

  async mapPunch(id: string, employeeId: string) {
    const punch = await this.prisma.punchLog.findUnique({ where: { id } });
    if (!punch) throw new NotFoundException("Punch not found");
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new NotFoundException("Employee not found");
    const updated = await this.prisma.punchLog.update({ where: { id }, data: { employeeId, unmatched: false } });
    await this.recomputeDay(employeeId, dateStr(punch.punchTime));
    await invalidatePeopleCache(this.cache);
    return updated;
  }

  async kioskPunch(user: any, action: "in" | "out") {
    if (!user?.sub) throw new BadRequestException("Not authenticated");
    const emp = await this.prisma.employee.findFirst({
      where: { user: { id: user.sub }, employmentStatus: "ACTIVE" },
    });
    if (!emp) throw new BadRequestException("No active employee is linked to your account");
    if (!emp.deviceId) {
      throw new BadRequestException("Your profile has no fingerprint device ID yet — ask HR to set it in Directory");
    }
    const now = new Date();
    const punch = await this.prisma.punchLog.create({
      data: { deviceId: emp.deviceId, employeeId: emp.id, punchTime: now, source: "KIOSK", unmatched: false },
    });
    await this.recomputeDay(emp.id, dateStr(now));
    await invalidatePeopleCache(this.cache);
    return { ok: true, action, employee: emp.name, punch };
  }

  async recomputeMonth(month: string) {
    const { start, end } = monthRange(month);
    const policy = await this.attendancePolicy();
    const [employees, holidays, leaves, punches] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } } }),
      this.prisma.punchLog.findMany({ where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } } }),
    ]);
    const ctx = {
      policy,
      holidays: new Set(holidays.map((h) => h.date)),
      leavesByEmp: new Map<string, { startDate: Date; endDate: Date }[]>(),
      punchesByEmpDate: new Map<string, { punchTime: Date }[]>(),
    };
    for (const l of leaves) {
      const arr = ctx.leavesByEmp.get(l.employeeId) ?? [];
      arr.push({ startDate: l.startDate, endDate: l.endDate });
      ctx.leavesByEmp.set(l.employeeId, arr);
    }
    for (const p of punches) {
      const key = `${p.employeeId}|${dateStr(p.punchTime)}`;
      const arr = ctx.punchesByEmpDate.get(key) ?? [];
      arr.push({ punchTime: p.punchTime });
      ctx.punchesByEmpDate.set(key, arr);
    }
    for (const arr of ctx.punchesByEmpDate.values()) arr.sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let processed = 0;
    for (const emp of employees) {
      const d = new Date(start);
      while (d < end) {
        if (d <= today) {
          const att = await this.syncDay(emp, new Date(d), ctx);
          if (att) processed++;
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    await invalidatePeopleCache(this.cache);
    return { month, processed };
  }

  async correctAttendance(id: string, body: { field?: string; value?: any; reason?: string }, user: any) {
    const att = await this.prisma.attendance.findUnique({ where: { id } });
    if (!att) throw new NotFoundException("Attendance record not found");
    const field = body.field === "checkInTime" || body.field === "checkOutTime" ? body.field : "status";
    const oldVal = (att as any)[field];
    const newVal = field === "status" ? body.value : body.value ? new Date(body.value) : null;
    const updated = await this.prisma.attendance.update({
      where: { id },
      data: { [field]: newVal, isManuallyCorrected: true, correctedById: user?.sub ?? null },
    });
    await this.prisma.attendanceCorrection.create({
      data: {
        attendanceId: id,
        employeeId: att.employeeId,
        field,
        oldValue: oldVal == null ? null : String(oldVal),
        newValue: newVal == null ? null : String(newVal),
        reason: body.reason ?? null,
        correctedById: user?.sub ?? null,
      },
    });
    await invalidatePeopleCache(this.cache);
    return updated;
  }

  async attendanceReport(month: string) {
    const { start, end } = monthRange(month);
    const policy = await this.attendancePolicy();
    const [employees, holidays, leaves, attendance, punches] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } } }),
      this.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } }),
      this.prisma.punchLog.findMany({ where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows: any[] = [];
    for (const emp of employees) {
      const off = this.offDaysFor(emp, policy);
      const empAtt = attendance.filter((a) => a.employeeId === emp.id);
      const empPunches = punches.filter((p) => p.employeeId === emp.id);
      const empLeaves = leaves.filter((l) => l.employeeId === emp.id);
      let workingDays = 0, weekOffDays = 0, holidayDays = 0, leaveDays = 0;
      let present = 0, late = 0, halfDay = 0, absent = 0, lateMinutes = 0;
      const d = new Date(start);
      while (d < end) {
        if (d > today) break;
        const dstr = dateStr(d);
        if (off.has(weekdayName(d))) { weekOffDays++; d.setUTCDate(d.getUTCDate() + 1); continue; }
        if (holidaySet.has(dstr)) { holidayDays++; d.setUTCDate(d.getUTCDate() + 1); continue; }
        if (empLeaves.some((l) => d >= l.startDate && d <= l.endDate)) { leaveDays++; workingDays++; d.setUTCDate(d.getUTCDate() + 1); continue; }
        workingDays++;
        const att = empAtt.find((a) => a.date.getTime() === d.getTime());
        const dayPunches = empPunches.filter((p) => dateStr(p.punchTime) === dstr).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
        const st = att?.status ?? this.computeDayStatus(emp, dayPunches, policy).status;
        if (st === "LATE") { late++; lateMinutes += this.computeDayStatus(emp, dayPunches, policy).minutesLate; }
        else if (st === "HALF_DAY") halfDay++;
        else if (st === "ABSENT") absent++;
        else present++;
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const basic = Number(emp.salary ?? 0);
      const divisor = policy.dailyRateDivisor === 0 ? Math.max(workingDays, 1) : policy.dailyRateDivisor;
      const daily = divisor > 0 ? basic / divisor : 0;
      const ladder = ((policy.lateLadder as any[]) ?? []).slice().sort((a, b) => (a.lates ?? 0) - (b.lates ?? 0));
      const ladderEntry = ladder.filter((e) => late >= (e.lates ?? 0)).pop();
      const lateDays = ladderEntry?.days ?? 0;
      rows.push({
        employeeId: emp.id, name: emp.name, roleTitle: emp.roleTitle, department: emp.department ?? null,
        workingDays, weekOffDays, holidayDays, leaveDays,
        present, late, halfDay, absent, lateMinutes,
        divisor, dailyRate: Math.round(daily * 100) / 100,
        lateDeductionDays: lateDays,
        lateDeduction: Math.round(lateDays * daily * 100) / 100,
        halfDayDeduction: Math.round((halfDay * daily * 0.5) * 100) / 100,
        absentDeduction: Math.round(absent * daily * 100) / 100,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async lateList(month: string) {
    const { start, end } = monthRange(month);
    const [records, punches, employees, policy] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { status: "LATE", date: { gte: start, lt: end } },
        include: { employee: { select: { id: true, name: true, roleTitle: true, department: true } } },
        orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
      }),
      this.prisma.punchLog.findMany({ where: { punchTime: { gte: start, lt: end } } }),
      this.prisma.employee.findMany({ select: { id: true, shiftStart: true, graceMinutes: true } }),
      this.attendancePolicy(),
    ]);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return records.map((r) => {
      const emp = empMap.get(r.employeeId);
      const dayPunches = punches
        .filter((p) => p.employeeId === r.employeeId && dateStr(p.punchTime) === dateStr(r.date))
        .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
      const shiftStart = emp?.shiftStart ?? policy.shiftStart;
      const grace = emp?.graceMinutes ?? policy.graceMinutes;
      const checkIn = r.checkInTime ?? dayPunches[0]?.punchTime ?? null;
      const minutesLate = checkIn ? Math.max(0, minutesOf(toHHmm(checkIn)) - (minutesOf(shiftStart) + grace)) : 0;
      return { ...r, minutesLate, shiftStart, graceMinutes: grace };
    });
  }

  // ── Attendance ───────────────────────────────────────────────────────
  async recordAttendance(body: {
    employeeId: string;
    date?: string;
    status?: AttendanceStatus;
    checkInTime?: string;
    checkOutTime?: string;
  }) {
    const date = body.date ? new Date(body.date) : new Date();
    const result = await this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: body.employeeId, date } },
      update: {
        status: body.status,
        checkInTime: body.checkInTime ? new Date(body.checkInTime) : undefined,
        checkOutTime: body.checkOutTime ? new Date(body.checkOutTime) : undefined,
      },
      create: {
        employeeId: body.employeeId,
        date,
        status: body.status ?? "PRESENT",
        checkInTime: body.checkInTime ? new Date(body.checkInTime) : undefined,
      },
    });
    await invalidatePeopleCache(this.cache);
    return result;
  }

  async attendanceMonth(month: string) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const records = await this.prisma.attendance.findMany({
      where: { date: { gte: start, lt: end } },
      include: { employee: { select: { id: true, name: true, roleTitle: true, department: true } } },
      orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
    });
    return records;
  }

  async attendanceSummary(month: string) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const records = await this.prisma.attendance.findMany({
      where: { date: { gte: start, lt: end } },
      select: { employeeId: true, status: true },
    });
    const byEmp: Record<string, Record<string, number>> = {};
    for (const r of records) {
      byEmp[r.employeeId] ??= {};
      byEmp[r.employeeId][r.status] = (byEmp[r.employeeId][r.status] ?? 0) + 1;
    }
    return byEmp;
  }

  // ── Holidays ─────────────────────────────────────────────────────────
  async holidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: "asc" } });
  }

  async createHoliday(body: { date: string; name: string; description?: string; tentative?: boolean; isGovernment?: boolean }) {
    return this.prisma.holiday.create({
      data: {
        date: body.date,
        name: body.name,
        description: body.description ?? null,
        tentative: body.tentative ?? false,
        isGovernment: body.isGovernment ?? true,
      },
    });
  }

  async deleteHoliday(id: string) {
    await this.prisma.holiday.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Holiday not found");
    });
    return { ok: true };
  }
}
