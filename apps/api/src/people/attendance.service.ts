import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AttendanceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { dateStrDhaka, dhakaDayRange, dhakaDaysInMonth, eachDayStr, invalidatePeopleCache, isWorkingDay, minutesOf, parseDeviceTime, toHHmmDhaka, weekdayDhaka } from "./people-utils";

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

  /**
   * Working-day count for an arbitrary range — the single source of truth for
   * leave deduction (LeaveService) and anything else that needs "how many of
   * these days consume quota". Same precedence as the engine: explicit
   * calendar override > holiday > weekly off.
   */
  async countWorkingDays(employeeId: string, from: string, to: string): Promise<{ working: number; total: number }> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, weeklyOffDays: true } });
    if (!emp) throw new NotFoundException("Employee not found");
    const [policy, holidays, overrides] = await Promise.all([
      this.attendancePolicy(),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.overrideMap(),
    ]);
    const weeklyOff = new Set(
      (emp.weeklyOffDays?.length ? emp.weeklyOffDays : policy.weeklyOffDays).map((d: any) => String(d).trim().toUpperCase())
    );
    const holidaySet = new Set(holidays.map((h) => h.date));
    const overrideBools = new Map([...overrides.entries()].map(([k, v]) => [k, v.isOpen]));
    const days = eachDayStr(from, to);
    const working = days.filter((d) => isWorkingDay(d, weeklyOff, holidaySet, overrideBools)).length;
    return { working, total: days.length };
  }

  private computeDayStatus(emp: any, punches: { punchTime: Date }[], policy: any): { status: AttendanceStatus; checkIn: Date | null; checkOut: Date | null; minutesLate: number } {
    const shiftStart = emp.shiftStart ?? policy.shiftStart;
    const grace = emp.graceMinutes ?? policy.graceMinutes;
    const cutoff = policy.halfDayCutoff;
    if (!punches.length) return { status: "ABSENT", checkIn: null, checkOut: null, minutesLate: 0 };
    const checkIn = punches[0].punchTime;
    const checkOut = punches[punches.length - 1].punchTime;
    const inMin = minutesOf(toHHmmDhaka(checkIn));
    const limitMin = minutesOf(shiftStart) + grace;
    const cutoffMin = minutesOf(cutoff);
    let status: AttendanceStatus = "PRESENT";
    if (inMin > limitMin) status = inMin < cutoffMin ? "LATE" : "HALF_DAY";
    return { status, checkIn, checkOut, minutesLate: Math.max(0, inMin - limitMin) };
  }

  // ── Work-hours engine ──────────────────────────────────────────────
  // checkIn/checkOut times existed but no duration was ever computed, so the
  // page could never answer "how long did they work". Everything below derives
  // from first-punch → last-punch per day (single shift model, no breaks).
  private expectedMinutes(emp: any, policy: any): number {
    const diff = minutesOf(emp.shiftEnd ?? policy.shiftEnd) - minutesOf(emp.shiftStart ?? policy.shiftStart);
    return diff > 0 ? diff : 0;
  }

  private dayHours(
    checkIn: Date | null,
    checkOut: Date | null,
    expected: number,
    threshold: number,
    now = new Date()
  ): { worked: number; overtime: number; undertime: number; open: boolean } {
    if (!checkIn) return { worked: 0, overtime: 0, undertime: 0, open: false };
    // No checkout yet = still inside; hours-so-far instead of zero.
    const end = checkOut ?? now;
    const worked = Math.max(0, Math.round((end.getTime() - checkIn.getTime()) / 60000));
    const extra = worked - expected;
    return {
      worked,
      overtime: extra >= threshold ? extra : 0,
      undertime: checkOut && worked < expected ? expected - worked : 0,
      open: !checkOut,
    };
  }

  /** Month (default) or trailing-N-days / explicit from→to window. Future days excluded. */
  private resolveDays(query: { month?: string; days?: string; from?: string; to?: string }): string[] {
    const today = dateStrDhaka(new Date());
    if (query.from && query.to) {
      const out: string[] = [];
      const d = new Date(`${query.from}T00:00:00.000Z`);
      const end = new Date(`${query.to}T00:00:00.000Z`);
      let guard = 0;
      while (d <= end && guard++ < 366) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
      return out.filter((x) => x <= today);
    }
    if (query.days) {
      const n = Math.min(90, Math.max(1, parseInt(String(query.days), 10) || 30));
      const out: string[] = [];
      const d = new Date(`${today}T00:00:00.000Z`);
      for (let i = n - 1; i >= 0; i--) {
        const x = new Date(d);
        x.setUTCDate(x.getUTCDate() - i);
        out.push(x.toISOString().slice(0, 10));
      }
      return out;
    }
    return dhakaDaysInMonth(query.month ?? today.slice(0, 7)).filter((x) => x <= today);
  }

  private rangeBounds(days: string[]) {
    const start = dhakaDayRange(days[0]).start;
    const end = dhakaDayRange(days[days.length - 1]).end;
    return { start, end };
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
    for (const f of ["weeklyOffDays", "graceMinutes", "shiftStart", "shiftEnd", "halfDayCutoff", "lateLadder", "dailyRateDivisor", "proRataEnabled", "overtimeThresholdMinutes"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    return this.prisma.attendancePolicy.update({ where: { id: "default" }, data });
  }

  // ── Work calendar (monthly open/closed overrides) ────────────────────
  // Weekly offs are the default rhythm; this is the exception list. One row
  // per date: open a Saturday, or close a weekday. Every engine path that
  // asks "is this a working day" reads this map first.
  async overrideMap(): Promise<Map<string, { isOpen: boolean; note: string | null }>> {
    const rows = await this.prisma.workdayOverride.findMany({ select: { date: true, isOpen: true, note: true } });
    return new Map(rows.map((r) => [r.date, { isOpen: r.isOpen, note: r.note ?? null }]));
  }

  async workCalendar(month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : dateStrDhaka(new Date()).slice(0, 7);
    const [overrides, holidays, policy] = await Promise.all([
      this.prisma.workdayOverride.findMany({
        where: { date: { gte: `${m}-01`, lt: `${m}-32` } },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { date: "asc" },
      }),
      this.prisma.holiday.findMany({
        where: { date: { gte: `${m}-01`, lt: `${m}-32` } },
        orderBy: { date: "asc" },
      }),
      this.attendancePolicy(),
    ]);
    return { month: m, weeklyOffDays: policy.weeklyOffDays, overrides, holidays };
  }

  async upsertOverride(body: { date: string; isOpen: boolean; note?: string }, userId?: string) {
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new BadRequestException("date must be YYYY-MM-DD");
    // Only dates from the start of the current month forward — history is
    // immutable (payroll already ran on it).
    const monthFloor = `${dateStrDhaka(new Date()).slice(0, 7)}-01`;
    if (body.date < monthFloor) throw new BadRequestException("Cannot change past months — payroll already ran on them");
    const row = await this.prisma.workdayOverride.upsert({
      where: { date: body.date },
      create: { date: body.date, isOpen: !!body.isOpen, note: body.note?.trim() || null, createdById: userId ?? null },
      update: { isOpen: !!body.isOpen, note: body.note?.trim() || null, createdById: userId ?? null },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await invalidatePeopleCache(this.cache);
    return row;
  }

  async deleteOverride(id: string) {
    const row = await this.prisma.workdayOverride.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Override not found");
    const monthFloor = `${dateStrDhaka(new Date()).slice(0, 7)}-01`;
    if (row.date < monthFloor) throw new BadRequestException("Cannot change past months — payroll already ran on them");
    await this.prisma.workdayOverride.delete({ where: { id } });
    await invalidatePeopleCache(this.cache);
    return { ok: true };
  }

  private async syncDay(emp: any, dstr: string, ctx: {
    policy: any;
    holidays: Set<string>;
    overrides: Map<string, { isOpen: boolean; note: string | null }>;
    leavesByEmp: Map<string, { startDate: Date; endDate: Date }[]>;
    punchesByEmpDate: Map<string, { punchTime: Date }[]>;
  }) {
    // dstr is a Dhaka calendar date (YYYY-MM-DD). The stored `attendance.date`
    // is UTC-midnight labelled with that date so displays stay correct.
    const date = new Date(`${dstr}T00:00:00.000Z`);
    const { start, end } = dhakaDayRange(dstr);
    // Precedence: explicit override > weekly off / holiday.
    const ov = ctx.overrides.get(dstr)?.isOpen;
    if (ov === false) return null; // office closed by override
    if (ov !== true) {
      if (this.offDaysFor(emp, ctx.policy).has(weekdayDhaka(date))) return null;
      if (ctx.holidays.has(dstr)) return null;
    }
    const punches = (ctx.punchesByEmpDate.get(`${emp.id}|${dstr}`) ?? []).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
    const leaves = (ctx.leavesByEmp.get(emp.id) ?? []).filter((l) => date >= l.startDate && date <= l.endDate);
    if (leaves.length && !punches.length) {
      await this.prisma.attendance.deleteMany({ where: { employeeId: emp.id, date } });
      return null;
    }
    const { status, checkIn, checkOut } = this.computeDayStatus(emp, punches, ctx.policy);
    const att = await this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: emp.id, date } },
      update: { status, checkInTime: checkIn, checkOutTime: checkOut },
      create: { employeeId: emp.id, date, status, checkInTime: checkIn, checkOutTime: checkOut },
    });
    if (punches.length) {
      await this.prisma.punchLog.updateMany({
        where: { employeeId: emp.id, punchTime: { gte: start, lt: end } },
        data: { isProcessed: true },
      });
    }
    return att;
  }

  /** Recompute one day. Public so LeaveService can refresh days after a leave decision. */
  async recomputeDay(employeeId: string, dstr: string) {
    const { start, end } = dhakaDayRange(dstr);
    const policy = await this.attendancePolicy();
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return;
    const [holidays, leaves, punches, overrides] = await Promise.all([
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } } }),
      this.prisma.punchLog.findMany({ where: { employeeId, punchTime: { gte: start, lt: end } } }),
      this.overrideMap(),
    ]);
    await this.syncDay(emp, dstr, {
      policy,
      holidays: new Set(holidays.map((h) => h.date)),
      overrides,
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
    for (const p of created) if (p.employeeId) affected.add(`${p.employeeId}|${dateStrDhaka(p.punchTime)}`);
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
    if (sn) await this.touchDevice(sn).catch(() => {});
    if (table === "ATTLOG") {
      const rows: { deviceId: string; time: string; verifyMethod?: string; workCode?: string }[] = [];
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split("\t");
        if (parts.length < 2) continue;
        const deviceId = parts[0].trim();
        // Device sends Dhaka wall time ("YYYY-MM-DD HH:MM:SS"); parse as +06:00
        // so instants are exact regardless of server timezone.
        const time = parseDeviceTime(parts[1].trim().replace("T", " ").slice(0, 19));
        if (!deviceId || !time) continue;
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
      const days = dhakaDaysInMonth(month);
      where.punchTime = { gte: dhakaDayRange(days[0]).start, lt: dhakaDayRange(days[days.length - 1]).end };
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
    await this.recomputeDay(employeeId, dateStrDhaka(punch.punchTime));
    await invalidatePeopleCache(this.cache);
    return updated;
  }

  /** HR cleanup: delete a stray punch, then rebuild that employee-day. */
  async deletePunch(id: string) {
    const punch = await this.prisma.punchLog.findUnique({ where: { id } });
    if (!punch) throw new NotFoundException("Punch not found");
    await this.prisma.punchLog.delete({ where: { id } });
    if (punch.employeeId) await this.recomputeDay(punch.employeeId, dateStrDhaka(punch.punchTime));
    await invalidatePeopleCache(this.cache);
    return { ok: true };
  }

  /**
   * Self / shared-terminal punch. Works with or without a fingerprint device
   * ID on the profile (manual punches are stored under deviceId "MANUAL").
   * Guards: no double check-in within 3 minutes (accidental double-tap),
   * check-out requires a check-in earlier today.
   */
  async kioskPunch(user: any, action: "in" | "out", mode: "kiosk" | "self" = "kiosk") {
    if (!user?.sub) throw new BadRequestException("Not authenticated");
    const emp = await this.prisma.employee.findFirst({
      where: { user: { id: user.sub }, employmentStatus: "ACTIVE" },
    });
    if (!emp) throw new BadRequestException("No active employee is linked to your account");
    const now = new Date();
    const dstr = dateStrDhaka(now);
    const { start, end } = dhakaDayRange(dstr);
    const todays = await this.prisma.punchLog.findMany({
      where: { employeeId: emp.id, punchTime: { gte: start, lt: end } },
      orderBy: { punchTime: "desc" },
      take: 5,
    });
    const latest = todays[0] ?? null;
    if (latest && now.getTime() - new Date(latest.punchTime).getTime() < 3 * 60000) {
      throw new BadRequestException(`Already punched at ${toHHmmDhaka(new Date(latest.punchTime))} — wait a few minutes before punching again`);
    }
    const att = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: new Date(`${dstr}T00:00:00.000Z`) } },
    });
    if (action === "out" && !att?.checkInTime && todays.length === 0) {
      throw new BadRequestException("You have not checked in today — check in first");
    }
    // Note: repeat check-ins are allowed (split shifts) — first punch of the
    // day stays the check-in; only rapid double-taps are blocked above.
    const source = mode === "self" ? "SELF" : "KIOSK";
    const punch = await this.prisma.punchLog.create({
      data: { deviceId: emp.deviceId ?? "MANUAL", employeeId: emp.id, punchTime: now, source, unmatched: false },
    });
    await this.recomputeDay(emp.id, dstr);
    await invalidatePeopleCache(this.cache);
    const fresh = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: new Date(`${dstr}T00:00:00.000Z`) } },
    });
    return { ok: true, action, employee: emp.name, punch, status: fresh?.status ?? null };
  }

  async recomputeMonth(month: string) {
    const days = dhakaDaysInMonth(month);
    const first = dhakaDayRange(days[0]);
    const last = dhakaDayRange(days[days.length - 1]);
    const start = first.start;
    const end = last.end;
    const policy = await this.attendancePolicy();
    const [employees, holidays, leaves, punches, overrides] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lt: new Date(end.getTime() + 86400000) }, endDate: { gte: start } } }),
      this.prisma.punchLog.findMany({ where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } } }),
      this.overrideMap(),
    ]);
    const ctx = {
      policy,
      holidays: new Set(holidays.map((h) => h.date)),
      overrides,
      leavesByEmp: new Map<string, { startDate: Date; endDate: Date }[]>(),
      punchesByEmpDate: new Map<string, { punchTime: Date }[]>(),
    };
    for (const l of leaves) {
      const arr = ctx.leavesByEmp.get(l.employeeId) ?? [];
      arr.push({ startDate: l.startDate, endDate: l.endDate });
      ctx.leavesByEmp.set(l.employeeId, arr);
    }
    for (const p of punches) {
      const key = `${p.employeeId}|${dateStrDhaka(p.punchTime)}`;
      const arr = ctx.punchesByEmpDate.get(key) ?? [];
      arr.push({ punchTime: p.punchTime });
      ctx.punchesByEmpDate.set(key, arr);
    }
    for (const arr of ctx.punchesByEmpDate.values()) arr.sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
    const todayStr = dateStrDhaka(new Date());
    let processed = 0;
    for (const emp of employees) {
      for (const dstr of days) {
        if (dstr <= todayStr) {
          const att = await this.syncDay(emp, dstr, ctx);
          if (att) processed++;
        }
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

  async attendanceReport(query: { month?: string; days?: string; from?: string; to?: string }) {
    const days = this.resolveDays(query);
    if (!days.length) return [];
    const { start, end } = this.rangeBounds(days);
    const policy = await this.attendancePolicy();
    const threshold = policy.overtimeThresholdMinutes ?? 30;
    const [employees, holidays, leaves, attendance, punches, overrides] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lt: new Date(end.getTime() + 86400000) }, endDate: { gte: start } } }),
      this.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } }),
      this.prisma.punchLog.findMany({ where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } } }),
      this.overrideMap(),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const todayStr = dateStrDhaka(new Date());
    const rows: any[] = [];
    for (const emp of employees) {
      const off = this.offDaysFor(emp, policy);
      const empAtt = attendance.filter((a) => a.employeeId === emp.id);
      const empPunches = punches.filter((p) => p.employeeId === emp.id);
      const empLeaves = leaves.filter((l) => l.employeeId === emp.id);
      const expected = this.expectedMinutes(emp, policy);
      const joinedStr = emp.joinDate ? dateStrDhaka(emp.joinDate) : null;
      let workingDays = 0, weekOffDays = 0, holidayDays = 0, leaveDays = 0;
      let present = 0, late = 0, halfDay = 0, absent = 0, lateMinutes = 0, unrecordedDays = 0;
      let workedMinutes = 0, expectedMinutes = 0, overtimeMinutes = 0, undertimeMinutes = 0, daysCounted = 0;
      for (const dstr of days) {
        if (dstr > todayStr) break;
        // Before the hire date the person was not employed: count nothing at all
        // (no working day, no absence, no deduction).
        if (joinedStr != null && dstr < joinedStr) continue;
        // Explicit calendar override wins over weekly off / holiday.
        const ov = overrides.get(dstr)?.isOpen;
        if (ov === false) { holidayDays++; continue; }
        if (ov !== true) {
          if (off.has(weekdayDhaka(new Date(`${dstr}T00:00:00.000Z`)))) { weekOffDays++; continue; }
          if (holidaySet.has(dstr)) { holidayDays++; continue; }
        }
        if (empLeaves.some((l) => dstr >= dateStrDhaka(l.startDate) && dstr <= dateStrDhaka(l.endDate))) { leaveDays++; workingDays++; continue; }
        workingDays++;
        const att = empAtt.find((a) => dateStrDhaka(a.date) === dstr);
        const dayPunches = empPunches.filter((p) => dateStrDhaka(p.punchTime) === dstr).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
        // "No row and no punch" means the day was never processed — that is not
        // evidence of absence, so it must not feed a deduction. A real ABSENT is
        // one the engine (or HR) actually wrote.
        const unrecorded = !att && !dayPunches.length;
        const st = att?.status ?? (dayPunches.length ? this.computeDayStatus(emp, dayPunches, policy).status : null);
        if (unrecorded) unrecordedDays++;
        else if (st === "LATE") { late++; lateMinutes += this.computeDayStatus(emp, dayPunches, policy).minutesLate; }
        else if (st === "HALF_DAY") halfDay++;
        else if (st === "ABSENT") absent++;
        else present++;
        // hours: stored times win, otherwise first→last punch of the day
        const ci = att?.checkInTime ?? dayPunches[0]?.punchTime ?? null;
        const co = att?.checkOutTime ?? (dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].punchTime : null);
        if (ci) {
          const h = this.dayHours(new Date(ci), co ? new Date(co) : null, expected, threshold);
          workedMinutes += h.worked;
          expectedMinutes += expected;
          overtimeMinutes += h.overtime;
          undertimeMinutes += h.undertime;
          daysCounted++;
        }
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
        present, late, halfDay, absent, lateMinutes, unrecordedDays,
        // hours (new): totals across counted days + per-day average
        workedMinutes, expectedMinutes, overtimeMinutes, undertimeMinutes,
        daysCounted,
        avgWorkedMinutes: daysCounted ? Math.round(workedMinutes / daysCounted) : 0,
        divisor, dailyRate: Math.round(daily * 100) / 100,
        lateDeductionDays: lateDays,
        lateDeduction: Math.round(lateDays * daily * 100) / 100,
        halfDayDeduction: Math.round((halfDay * daily * 0.5) * 100) / 100,
        absentDeduction: Math.round(absent * daily * 100) / 100,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async lateList(query: { month?: string; days?: string; from?: string; to?: string }) {
    const days = this.resolveDays(query);
    if (!days.length) return [];
    const { start, end } = this.rangeBounds(days);
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
        .filter((p) => p.employeeId === r.employeeId && dateStrDhaka(p.punchTime) === dateStrDhaka(r.date))
        .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
      const shiftStart = emp?.shiftStart ?? policy.shiftStart;
      const grace = emp?.graceMinutes ?? policy.graceMinutes;
      const checkIn = r.checkInTime ?? dayPunches[0]?.punchTime ?? null;
      const minutesLate = checkIn ? Math.max(0, minutesOf(toHHmmDhaka(checkIn)) - (minutesOf(shiftStart) + grace)) : 0;
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
    const emp = body.employeeId
      ? await this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true } })
      : null;
    if (!emp) throw new NotFoundException("Employee not found");
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

  async attendanceMonth(query: { month?: string; days?: string; from?: string; to?: string }) {
    const days = this.resolveDays(query);
    if (!days.length) return [];
    const { start, end } = this.rangeBounds(days);
    const records = await this.prisma.attendance.findMany({
      where: { date: { gte: start, lt: end } },
      include: { employee: { select: { id: true, name: true, roleTitle: true, department: true } } },
      orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
    });
    return records;
  }

  async attendanceSummary(month: string) {
    const days = dhakaDaysInMonth(month);
    const start = dhakaDayRange(days[0]).start;
    const end = dhakaDayRange(days[days.length - 1]).end;
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

  // ── Employee attendance profile (month view + history) ───────────────
  async employeeAttendance(employeeId: string, query: { month?: string; days?: string; from?: string; to?: string }) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, name: true, roleTitle: true, department: true, employmentStatus: true,
        shiftStart: true, shiftEnd: true, graceMinutes: true, weeklyOffDays: true, deviceId: true,
        joinDate: true,
      },
    });
    if (!emp) throw new NotFoundException("Employee not found");
    const days = this.resolveDays(query);
    if (!days.length) {
      return { employee: emp, range: query, summary: {}, days: [], leaves: [] };
    }
    const { start, end } = this.rangeBounds(days);
    const policy = await this.attendancePolicy();
    const threshold = policy.overtimeThresholdMinutes ?? 30;
    const expected = this.expectedMinutes(emp, policy);
    const [holidays, leaves, attendance, punches, overrides] = await Promise.all([
      this.prisma.holiday.findMany({ select: { date: true, name: true } }),
      this.prisma.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", startDate: { lt: new Date(end.getTime() + 86400000) }, endDate: { gte: start } } }),
      this.prisma.attendance.findMany({ where: { employeeId, date: { gte: new Date(`${days[0]}T00:00:00.000Z`), lt: new Date(new Date(`${days[days.length - 1]}T00:00:00.000Z`).getTime() + 86400000) } } }),
      this.prisma.punchLog.findMany({ where: { employeeId, punchTime: { gte: start, lt: end } }, orderBy: { punchTime: "asc" } }),
      this.overrideMap(),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const holidayName = new Map(holidays.map((h) => [h.date, h.name]));
    const off = this.offDaysFor(emp, policy);
    const todayStr = dateStrDhaka(new Date());
    // Days before the person was hired are not "absent" — they were not employed.
    // Counting them made a fresh hire look like they had 19 unpaid absences.
    const joinedStr = emp.joinDate ? dateStrDhaka(emp.joinDate) : null;
    const shiftStart = emp.shiftStart ?? policy.shiftStart;
    const grace = emp.graceMinutes ?? policy.graceMinutes;
    const dayList: any[] = [];
    const summary = { working: 0, present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, off: 0, holiday: 0, lateMinutes: 0, workedMinutes: 0, expectedMinutes: 0, overtimeMinutes: 0, undertimeMinutes: 0, beforeJoining: 0, unrecorded: 0 };
    for (const dstr of days) {
      const isFuture = dstr > todayStr;
      // Not employed yet — skip entirely, never absorb it into working days or
      // absences (that is what made a new hire look like they had 19 absences).
      const beforeJoining = joinedStr != null && dstr < joinedStr;
      const ov = overrides.get(dstr);
      const isOff = ov?.isOpen !== true && off.has(weekdayDhaka(new Date(`${dstr}T00:00:00.000Z`)));
      const isHoliday = ov?.isOpen !== true && holidaySet.has(dstr);
      const isOverrideClosed = ov?.isOpen === false;
      const onLeave = leaves.some((l) => dstr >= dateStrDhaka(l.startDate) && dstr <= dateStrDhaka(l.endDate));
      const att = attendance.find((a) => dateStrDhaka(a.date) === dstr);
      const dayPunches = punches.filter((p) => dateStrDhaka(p.punchTime) === dstr);
      let kind: string;
      let hours: { worked: number; overtime: number; undertime: number; open: boolean } | null = null;
      if (beforeJoining) { kind = "before"; summary.beforeJoining++; }
      else if (isFuture) kind = "future";
      else if (isOverrideClosed) { kind = "holiday"; summary.holiday++; }
      else if (isOff) { kind = "off"; summary.off++; }
      else if (isHoliday) { kind = "holiday"; summary.holiday++; }
      else if (onLeave && !dayPunches.length) { kind = "leave"; summary.leave++; }
      else {
        summary.working++;
        // A working day with neither an attendance row nor a punch was never
        // processed — surface it as such instead of silently calling it absent.
        const unrecorded = !att && !dayPunches.length;
        const st = att?.status ?? (dayPunches.length ? this.computeDayStatus(emp, dayPunches, policy).status : null);
        if (unrecorded) { kind = "unrecorded"; summary.unrecorded++; }
        else if (st === "LATE") {
          kind = "late"; summary.late++;
          const ci = att?.checkInTime ?? dayPunches[0]?.punchTime ?? null;
          const mins = ci ? Math.max(0, minutesOf(toHHmmDhaka(new Date(ci))) - (minutesOf(shiftStart) + grace)) : 0;
          summary.lateMinutes += mins;
        } else if (st === "HALF_DAY") { kind = "half"; summary.halfDay++; }
        else if (st === "ABSENT") { kind = "absent"; summary.absent++; }
        else { kind = "present"; summary.present++; }
        const ci = att?.checkInTime ?? dayPunches[0]?.punchTime ?? null;
        const co = att?.checkOutTime ?? (dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].punchTime : null);
        if (ci) {
          hours = this.dayHours(new Date(ci), co ? new Date(co) : null, expected, threshold);
          summary.workedMinutes += hours.worked;
          summary.expectedMinutes += expected;
          summary.overtimeMinutes += hours.overtime;
          summary.undertimeMinutes += hours.undertime;
        }
      }
      dayList.push({
        date: dstr,
        kind,
        status: att?.status ?? null,
        checkIn: att?.checkInTime ? new Date(att.checkInTime).toISOString() : (dayPunches[0] ? new Date(dayPunches[0].punchTime).toISOString() : null),
        checkOut: att?.checkOutTime ? new Date(att.checkOutTime).toISOString() : (dayPunches.length > 1 ? new Date(dayPunches[dayPunches.length - 1].punchTime).toISOString() : null),
        workedMinutes: hours?.worked ?? null,
        overtimeMinutes: hours?.overtime ?? null,
        undertimeMinutes: hours?.undertime ?? null,
        stillInside: hours?.open ?? false,
        punches: dayPunches.length,
        leave: onLeave,
        holiday: isOverrideClosed ? overrides.get(dstr)?.note ?? "Office closed" : isHoliday ? holidayName.get(dstr) ?? true : false,
      });
    }
    return {
      employee: { ...emp, shiftStart, graceMinutes: grace, expectedMinutes: expected },
      range: { from: days[0], to: days[days.length - 1], count: days.length },
      month: query.month ?? null,
      summary,
      days: dayList,
      leaves: leaves.map((l) => ({ id: l.id, leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate })),
    };
  }
  // ── Dashboard: my punch state + team summary for today ─────────────────
  async todayStatus(user: any) {
    const now = new Date();
    const dstr = dateStrDhaka(now);
    const { start, end } = dhakaDayRange(dstr);
    const [employees, todayAttendance] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, name: true, deviceId: true, user: { select: { id: true } } },
      }),
      this.prisma.attendance.findMany({
        where: { date: new Date(`${dstr}T00:00:00.000Z`) },
        select: { employeeId: true, status: true, checkInTime: true, checkOutTime: true },
      }),
    ]);
    const attByEmp = new Map(todayAttendance.map((a) => [a.employeeId, a]));

    let mine: {
      status: string;
      checkIn: string | null;
      checkOut: string | null;
      hasDeviceId: boolean;
      punchCount: number;
      lastPunchAt: string | null;
      lastSource: string | null;
      minutesLate: number | null;
      punches: { at: string; source: string | null }[];
    } | null = null;
    if (user?.sub) {
      const emp = employees.find((e) => e.user?.id === user.sub);
      if (emp) {
        const a = attByEmp.get(emp.id);
        const myPunches = await this.prisma.punchLog.findMany({
          where: { employeeId: emp.id, punchTime: { gte: start, lt: end } },
          orderBy: { punchTime: "desc" },
          take: 20,
          select: { punchTime: true, source: true },
        });
        const last = myPunches[0] ?? null;
        let minutesLate: number | null = null;
        if (a?.checkInTime) {
          const policy = await this.attendancePolicy();
          const full = await this.prisma.employee.findUnique({ where: { id: emp.id }, select: { shiftStart: true, graceMinutes: true } });
          minutesLate = Math.max(0, minutesOf(toHHmmDhaka(new Date(a.checkInTime))) - (minutesOf(full?.shiftStart ?? policy.shiftStart) + (full?.graceMinutes ?? policy.graceMinutes)));
        }
        mine = a
          ? {
              status: a.status,
              checkIn: a.checkInTime?.toISOString() ?? null,
              checkOut: a.checkOutTime?.toISOString() ?? null,
              hasDeviceId: !!emp.deviceId,
              punchCount: myPunches.length,
              lastPunchAt: last ? new Date(last.punchTime).toISOString() : null,
              lastSource: last?.source ?? null,
              minutesLate,
              punches: myPunches.map((p) => ({ at: new Date(p.punchTime).toISOString(), source: p.source })),
            }
          : { status: "NOT_PUNCHED", checkIn: null, checkOut: null, hasDeviceId: !!emp.deviceId, punchCount: myPunches.length, lastPunchAt: last ? new Date(last.punchTime).toISOString() : null, lastSource: last?.source ?? null, minutesLate: null, punches: myPunches.map((p) => ({ at: new Date(p.punchTime).toISOString(), source: p.source })) };
      }
    }
    const counts = { present: 0, late: 0, halfDay: 0, wfh: 0, absent: 0, notPunched: 0 };
    for (const emp of employees) {
      const a = attByEmp.get(emp.id);
      if (!a) counts.notPunched++;
      else if (a.status === "PRESENT") counts.present++;
      else if (a.status === "LATE") counts.late++;
      else if (a.status === "HALF_DAY") counts.halfDay++;
      else if (a.status === "WFH") counts.wfh++;
      else if (a.status === "ABSENT") counts.absent++;
    }
    return { date: dstr, total: employees.length, mine, counts };
  }

  // ── Live board: who is in right now ─────────────────────────────────
  // todayStatus() only returns counts + the caller's own row. This returns one
  // row per active employee so the attendance page can show a live floor view.
  async liveBoard() {
    const now = new Date();
    const dstr = dateStrDhaka(now);
    const { start, end } = dhakaDayRange(dstr);
    const policy = await this.attendancePolicy();
    const threshold = policy.overtimeThresholdMinutes ?? 30;
    const [employees, todayAttendance, todaysPunches] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, name: true, roleTitle: true, department: true, shiftStart: true, shiftEnd: true, graceMinutes: true },
      }),
      this.prisma.attendance.findMany({
        where: { date: new Date(`${dstr}T00:00:00.000Z`) },
      }),
      this.prisma.punchLog.findMany({
        where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } },
        orderBy: { punchTime: "asc" },
      }),
    ]);
    const attByEmp = new Map(todayAttendance.map((a) => [a.employeeId, a]));
    const rows = employees.map((emp) => {
      const a = attByEmp.get(emp.id);
      const dayPunches = todaysPunches.filter((p) => p.employeeId === emp.id);
      const ci = a?.checkInTime ?? dayPunches[0]?.punchTime ?? null;
      const co = a?.checkOutTime ?? (dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].punchTime : null);
      const expected = this.expectedMinutes(emp, policy);
      const h = ci ? this.dayHours(new Date(ci), co ? new Date(co) : null, expected, threshold, now) : null;
      const shiftStart = emp.shiftStart ?? policy.shiftStart;
      const grace = emp.graceMinutes ?? policy.graceMinutes;
      const minutesLate = ci ? Math.max(0, minutesOf(toHHmmDhaka(new Date(ci))) - (minutesOf(shiftStart) + grace)) : null;
      const state = !ci ? "not_in" : !co ? "inside" : "left";
      return {
        employeeId: emp.id,
        name: emp.name,
        roleTitle: emp.roleTitle,
        department: emp.department,
        status: a?.status ?? (ci ? "PRESENT" : null),
        state,
        checkIn: ci ? new Date(ci).toISOString() : null,
        checkOut: co ? new Date(co).toISOString() : null,
        hoursSoFarMinutes: h?.worked ?? null,
        overtimeMinutes: h?.overtime ?? 0,
        minutesLate,
        punches: dayPunches.length,
      };
    });
    const inside = rows.filter((r) => r.state === "inside").length;
    const left = rows.filter((r) => r.state === "left").length;
    return {
      date: dstr,
      total: rows.length,
      inside,
      left,
      notIn: rows.length - inside - left,
      rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // ── Trends & anomalies over a trailing window ──────────────────────────
  // Habitual latecomers and absence streaks, so HR sees patterns instead of
  // scrolling daily rows. Thresholds are deliberately simple and documented.
  async attendanceTrends(query: { month?: string; days?: string; from?: string; to?: string }) {
    // default window is trailing 30 days; explicit month / days= / from→to wins
    const days = this.resolveDays(
      query.month || query.days || (query.from && query.to) ? query : { days: "30" }
    );
    if (!days.length) return { range: null, rows: [] };
    const { start, end } = this.rangeBounds(days);
    const policy = await this.attendancePolicy();
    const threshold = policy.overtimeThresholdMinutes ?? 30;
    const [employees, holidays, leaves, attendance, punches, overrides] = await Promise.all([
      this.prisma.employee.findMany({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.holiday.findMany({ select: { date: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lt: new Date(end.getTime() + 86400000) }, endDate: { gte: start } } }),
      this.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } }),
      this.prisma.punchLog.findMany({ where: { employeeId: { not: null }, punchTime: { gte: start, lt: end } } }),
      this.overrideMap(),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const rows = employees.map((emp) => {
      const off = this.offDaysFor(emp, policy);
      const empAtt = attendance.filter((a) => a.employeeId === emp.id);
      const empPunches = punches.filter((p) => p.employeeId === emp.id);
      const empLeaves = leaves.filter((l) => l.employeeId === emp.id);
      const expected = this.expectedMinutes(emp, policy);
      const joinedStr = emp.joinDate ? dateStrDhaka(emp.joinDate) : null;
      let late = 0, absent = 0, worked = 0, overtime = 0, counted = 0;
      let streak = 0; // current run of consecutive missed working days (absent or late), most recent first
      let streakOpen = true;
      for (let i = days.length - 1; i >= 0; i--) {
        const dstr = days[i];
        // Not employed yet — not a missed day, and it must not extend a streak.
        if (joinedStr != null && dstr < joinedStr) continue;
        const ov = overrides.get(dstr)?.isOpen;
        if (ov === false) continue;
        if (ov !== true) {
          if (off.has(weekdayDhaka(new Date(`${dstr}T00:00:00.000Z`)))) continue;
          if (holidaySet.has(dstr)) continue;
        }
        if (empLeaves.some((l) => dstr >= dateStrDhaka(l.startDate) && dstr <= dateStrDhaka(l.endDate))) continue;
        const att = empAtt.find((a) => dateStrDhaka(a.date) === dstr);
        const dayPunches = empPunches.filter((p) => dateStrDhaka(p.punchTime) === dstr).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
        // Never-processed days are neither attendance nor absence — skip them so
        // a data gap cannot be reported as a miss streak.
        if (!att && !dayPunches.length) continue;
        const st = att?.status ?? this.computeDayStatus(emp, dayPunches, policy).status;
        const missed = st === "ABSENT" || st === "LATE";
        if (streakOpen) {
          if (missed) streak++;
          else streakOpen = false;
        }
        if (st === "LATE") late++;
        else if (st === "ABSENT") absent++;
        const ci = att?.checkInTime ?? dayPunches[0]?.punchTime ?? null;
        const co = att?.checkOutTime ?? (dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].punchTime : null);
        if (ci) {
          const h = this.dayHours(new Date(ci), co ? new Date(co) : null, expected, threshold);
          worked += h.worked;
          overtime += h.overtime;
          counted++;
        }
      }
      const flags: string[] = [];
      if (late >= 3) flags.push(`habitual late (${late})`);
      if (streak >= 2) flags.push(`miss streak ×${streak}`);
      if (absent >= 3) flags.push(`frequent absent (${absent})`);
      return {
        employeeId: emp.id,
        name: emp.name,
        roleTitle: emp.roleTitle,
        department: emp.department ?? null,
        late,
        absent,
        workedMinutes: worked,
        overtimeMinutes: overtime,
        avgWorkedMinutes: counted ? Math.round(worked / counted) : 0,
        currentMissStreak: streak,
        flags,
      };
    });
    return {
      range: { from: days[0], to: days[days.length - 1], count: days.length },
      rows: rows.sort((a, b) => b.flags.length - a.flags.length || b.late - a.late || b.absent - a.absent),
    };
  }

  // ── Fingerprint devices ────────────────────────────────────────────
  async touchDevice(sn: string) {
    if (!sn) return null;
    return this.prisma.attendanceDevice.upsert({
      where: { serialNumber: sn },
      update: { lastSeenAt: new Date() },
      create: { serialNumber: sn, isActive: true, lastSeenAt: new Date() },
    });
  }

  async listDevices() {
    const devices = await this.prisma.attendanceDevice.findMany({ orderBy: { lastSeenAt: "desc" } });
    const stats = await this.prisma.punchLog.groupBy({
      by: ["deviceSn"],
      _count: { id: true },
      _max: { punchTime: true },
      where: { deviceSn: { not: null } },
    });
    const unmatched = await this.prisma.punchLog.groupBy({
      by: ["deviceSn"],
      _count: { id: true },
      where: { deviceSn: { not: null }, unmatched: true },
    });
    const statBySn = new Map(stats.map((s) => [s.deviceSn!, { punches: s._count.id, lastPunchAt: s._max.punchTime }]));
    const unBySn = new Map(unmatched.map((s) => [s.deviceSn!, s._count.id]));
    return devices.map((d) => ({
      ...d,
      punchCount: statBySn.get(d.serialNumber)?.punches ?? 0,
      lastPunchAt: statBySn.get(d.serialNumber)?.lastPunchAt ?? null,
      unmatchedCount: unBySn.get(d.serialNumber) ?? 0,
    }));
  }

  async updateDevice(id: string, body: { name?: string | null; location?: string | null; isActive?: boolean }) {
    const data: any = {};
    if (body.name !== undefined) data.name = body.name?.trim() || null;
    if (body.location !== undefined) data.location = body.location?.trim() || null;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    return this.prisma.attendanceDevice.update({ where: { id }, data });
  }

  /** HR cleanup: remove a decommissioned / test device (punch history keeps its SN string). */
  async deleteDevice(id: string) {
    await this.prisma.attendanceDevice.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Device not found");
    });
    return { ok: true };
  }
}
