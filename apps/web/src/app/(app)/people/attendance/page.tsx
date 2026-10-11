"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Cpu, Download, Fingerprint, LogIn, LogOut, Plus, RotateCcw, Timer, TrendingUp, Upload, Users } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import { Avatar, CardShell, SectionTitle, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Field, Input, Select } from "@/components/ui";
import { downloadCsv, fmtTime, monthNow } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { AttendanceModal, ImportPunchModal } from "../_components/modals/attendance-modals";

/** minutes → "7h 20m" / "45m" / "—" */
export const fmtDur = (mins?: number | null) => {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

function DevicesCard({ employees, notify, refreshKey }: { employees: any[]; notify: (m: string) => void; refreshKey: number }) {
  const { data: devices } = useList<any[]>("/people/attendance/devices", refreshKey);
  const [drafts, setDrafts] = useState<Record<string, { name: string; location: string; isActive: boolean }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const d: Record<string, { name: string; location: string; isActive: boolean }> = {};
    for (const dev of devices ?? []) d[dev.id] = { name: dev.name ?? "", location: dev.location ?? "", isActive: dev.isActive !== false };
    setDrafts(d);
  }, [devices]);

  const save = async (id: string) => {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    try {
      await apiFetch(`/people/attendance/devices/${id}`, { method: "PATCH", body: JSON.stringify(d) });
      notify("Device updated");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const unmapped = (employees ?? []).filter((e: any) => !e.deviceId);
  const serverBase = API_URL.replace(/\/api\/?$/, "");

  return (
    <CardShell className="mb-4">
      <SectionTitle
        title="Fingerprint devices"
        subtitle="ZKTeco push (ADMS) terminals — auto-registered on first heartbeat"
        action={<Btn variant="ghost" onClick={() => setShowGuide((v) => !v)}>{showGuide ? "Hide setup" : "Setup guide"}</Btn>}
      />
      {showGuide && (
        <div className="mb-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-[12px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">On the device: Menu → COMM → Cloud Server / ADMS</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5">
            <li>Server address: <span className="font-mono font-semibold text-foreground">{serverBase}</span> (device must reach this over LAN/VPN)</li>
            <li>Enable ADMS / push mode. The terminal then polls <span className="font-mono text-[11px]">/iclock/getrequest</span> and pushes punches to <span className="font-mono text-[11px]">/iclock/cdata</span>.</li>
            <li>Enroll staff on the device with numeric PINs, then enter the same PIN as <span className="font-semibold text-foreground">Device ID</span> on each employee (Directory → profile).</li>
            <li>Unknown PINs land below as unmatched punches — map them once, or set the Device ID first.</li>
          </ol>
        </div>
      )}
      {(devices ?? []).length === 0 && (
        <p className="text-[12px] text-muted-foreground">No device has checked in yet. Punches can still be imported manually below.</p>
      )}
      <div className="flex flex-col gap-2">
        {(devices ?? []).map((dev: any) => (
          <div key={dev.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", dev.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>
              <Cpu className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <Input
                value={drafts[dev.id]?.name ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), name: e.target.value } })}
                placeholder="Device name — e.g. Main Entrance"
                className="!py-1.5 text-[12.5px] font-semibold"
              />
              <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                SN {dev.serialNumber} · {dev.punchCount ?? 0} punches{(dev.unmatchedCount ?? 0) > 0 && ` · ${dev.unmatchedCount} unmatched`} · seen {dev.lastSeenAt ? timeAgo(dev.lastSeenAt) : "never"}
              </p>
            </div>
            <Input
              value={drafts[dev.id]?.location ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), location: e.target.value } })}
              placeholder="Location"
              className="!w-36 !py-1.5 text-[12px]"
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={drafts[dev.id]?.isActive ?? true}
                onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), isActive: e.target.checked } })}
                className="size-3.5 accent-emerald-500"
              />
              Active
            </label>
            <Btn variant="outline" onClick={() => void save(dev.id)} disabled={savingId === dev.id} className="!px-3 !py-1.5 text-[11.5px]">
              {savingId === dev.id ? "Saving…" : "Save"}
            </Btn>
          </div>
        ))}
      </div>
      {unmapped.length > 0 && (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          <span className="font-bold text-amber-500">{unmapped.length} employee{unmapped.length === 1 ? "" : "s"}</span> ({unmapped.slice(0, 4).map((e: any) => e.name).join(", ")}{unmapped.length > 4 ? "…" : ""}) {unmapped.length === 1 ? "has" : "have"} no fingerprint ID — set it in Directory so device punches auto-match.
        </p>
      )}
    </CardShell>
  );
}

export default function AttendancePage() {
  const [month, setMonth] = useState(monthNow());
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  // Range mode: calendar month (payroll view) or trailing 7/15/30 days.
  // Every metric section keys off `qs` so all tables stay in sync.
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const qs = rangeDays ? `days=${rangeDays}` : `month=${month}`;
  const rangeLabel = rangeDays ? `Last ${rangeDays} days` : month;
  const { data: report, loading: rpl, error: rpe } = useList<any[]>(`/people/attendance/report?${qs}`, refresh);
  const { data: lateList, loading: ll, error: le } = useList<any[]>(`/people/attendance/late-list?${qs}`, refresh);
  const { data: records, loading: rl, error: re } = useList<any[]>(`/people/attendance?${qs}`, refresh);
  const { data: live, loading: lvLoading } = useList<any>(`/people/attendance/live`, refresh);
  const { data: trends } = useList<any>(`/people/attendance/trends?${qs}`, refresh);
  const { data: punches, loading: pl, error: pe } = useList<any[]>("/people/punches?month=" + month, refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [kioskBusy, setKioskBusy] = useState(false);
  const [recompBusy, setRecompBusy] = useState(false);
  const { flash, notify } = useToast();
  const kiosk = async (action: "in" | "out") => {
    setKioskBusy(true);
    try { await apiFetch("/people/attendance/kiosk", { method: "POST", body: JSON.stringify({ action }) }); notify(action === "in" ? "Checked in - welcome!" : "Checked out - good work!"); reload(); } catch (e: any) { notify(e.message ?? "Kiosk failed"); } finally { setKioskBusy(false); }
  };
  const recompute = async () => {
    setRecompBusy(true);
    try { const r = await apiFetch<any>("/people/attendance/recompute", { method: "POST", body: JSON.stringify({ month }) }); notify(`Recomputed ${r.processed} attendance days`); reload(); } catch (e: any) { notify(e.message ?? "Recompute failed"); } finally { setRecompBusy(false); }
  };
  const mapPunch = async (p: any, employeeId: string) => {
    if (!employeeId) return;
    try { await apiFetch(`/people/punches/${p.id}/map`, { method: "PATCH", body: JSON.stringify({ employeeId }) }); notify("Punch mapped to employee"); reload(); } catch (e: any) { notify(e.message ?? "Mapping failed"); }
  };
  const totalDeduction = (s: any) => (s.lateDeduction ?? 0) + (s.halfDayDeduction ?? 0) + (s.absentDeduction ?? 0);

  // Overall roll-up across the visible range — the "overall report" header.
  const overall = useMemo(() => {
    const rows = report ?? [];
    const working = rows.reduce((s: number, r: any) => s + (r.workingDays ?? 0), 0);
    const attended = rows.reduce((s: number, r: any) => s + (r.present ?? 0) + (r.late ?? 0) + (r.halfDay ?? 0), 0);
    const worked = rows.reduce((s: number, r: any) => s + (r.workedMinutes ?? 0), 0);
    const overtime = rows.reduce((s: number, r: any) => s + (r.overtimeMinutes ?? 0), 0);
    const late = rows.reduce((s: number, r: any) => s + (r.late ?? 0), 0);
    const absent = rows.reduce((s: number, r: any) => s + (r.absent ?? 0), 0);
    return {
      rate: working ? Math.round((attended / working) * 100) : 0,
      worked, overtime, late, absent,
      heads: rows.length,
    };
  }, [report]);
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setRangeDays(null); }} className="!w-44" />
        {([7, 15, 30] as const).map((n) => (
          <button
            key={n}
            onClick={() => setRangeDays((d) => (d === n ? null : n))}
            className={cn(
              "rounded-xl px-3 py-2 text-[12px] font-bold transition-colors",
              rangeDays === n ? "bg-brand-gradient text-white" : "border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Last {n}D
          </button>
        ))}
        <Btn variant="outline" onClick={() => kiosk("in")} className={kioskBusy ? "opacity-60" : ""}><Fingerprint className="size-3.5" /> Check in (kiosk)</Btn>
        <Btn variant="outline" onClick={() => kiosk("out")} className={kioskBusy ? "opacity-60" : ""}><Fingerprint className="size-3.5" /> Check out (kiosk)</Btn>
        <Btn variant="outline" onClick={() => setImportOpen(true)}><Upload className="size-3.5" /> Import punches</Btn>
        <Btn variant="outline" onClick={recompute} className={recompBusy ? "opacity-60" : ""}><RotateCcw className="size-3.5" /> Recompute</Btn>
        <Btn variant="primary" onClick={() => { setEdit(null); setOpen(true); }}><Plus className="size-3.5" /> Record Attendance</Btn>
      </div>

      {/* Overall report header — attendance rate, hours, overtime for the range */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label={`Attendance · ${rangeLabel}`} value={rpl ? "—" : `${overall.rate}%`} sub={`${overall.heads} active employees`} icon={<Users className="size-5" />} />
        <StatCard label="Hours worked" value={rpl ? "—" : fmtDur(overall.worked)} sub={rangeLabel} icon={<Timer className="size-5" />} />
        <StatCard label="Overtime" value={rpl ? "—" : fmtDur(overall.overtime)} sub="past threshold" icon={<Clock className="size-5" />} />
        <StatCard label="Late arrivals" value={rpl ? "—" : overall.late} sub={rangeLabel} icon={<LogIn className="size-5" />} />
        <StatCard label="Absents" value={rpl ? "—" : overall.absent} sub={rangeLabel} icon={<LogOut className="size-5" />} />
        <StatCard label="Inside now" value={lvLoading ? "—" : `${live?.inside ?? 0}/${live?.total ?? 0}`} sub="live floor" icon={<Fingerprint className="size-5" />} />
      </div>

      {/* Live board — who is in the office right now */}
      <CardShell className="mt-4">
        <SectionTitle title="Live now" subtitle={`Who is in · ${live?.date ?? "today"}`} />
        {lvLoading ? (
          <p className="text-[11.5px] text-muted-foreground">Loading live board…</p>
        ) : (live?.rows ?? []).length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">No active employees.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(live?.rows ?? []).map((r: any) => (
              <Link
                key={r.employeeId}
                href={`/people/attendance/${r.employeeId}`}
                title={`${r.name} · in ${r.checkIn ? fmtTime(r.checkIn) : "—"}${r.checkOut ? ` · out ${fmtTime(r.checkOut)}` : ""}${r.hoursSoFarMinutes != null ? ` · ${fmtDur(r.hoursSoFarMinutes)} so far` : ""}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:border-primary/40",
                  r.state === "inside" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : r.state === "left" ? "border-border bg-card text-muted-foreground"
                      : "border-dashed border-border text-muted-foreground/60"
                )}
              >
                <span className={cn("size-1.5 rounded-full", r.state === "inside" ? "bg-emerald-500" : r.state === "left" ? "bg-muted-foreground/50" : "bg-transparent ring-1 ring-muted-foreground/40")} />
                {r.name}
                {r.state === "inside" && r.hoursSoFarMinutes != null && <span className="tabular-nums opacity-80">{fmtDur(r.hoursSoFarMinutes)}</span>}
              </Link>
            ))}
          </div>
        )}
      </CardShell>
      <DevicesCard employees={employees ?? []} notify={notify} refreshKey={refresh} />
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Attendance + hours" subtitle={`Per-employee check-in/out totals and payroll deductions · ${rangeLabel}`} />
          <Btn variant="ghost" onClick={() => downloadCsv(`attendance-report-${rangeDays ? `${rangeDays}d` : month}.csv`, ["Employee", "Working", "Present", "Late", "Half day", "Absent", "Worked", "Avg per day", "Overtime", "Daily rate", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)"], (report ?? []).map((s: any) => [s.name, s.workingDays, s.present, s.late, s.halfDay, s.absent, fmtDur(s.workedMinutes), fmtDur(s.avgWorkedMinutes), fmtDur(s.overtimeMinutes), s.dailyRate, s.lateDeduction, s.halfDayDeduction, s.absentDeduction]))}><Download className="size-3.5" /> CSV</Btn>
        </div>
        <DataTable
          loading={rpl}
          error={rpe}
          onRetry={reload}
          skeleton={6}
          footer={<span className="text-[11.5px] text-muted-foreground">{(report ?? []).length} employees · {fmtDur(overall.worked)} worked · {fmtDur(overall.overtime)} overtime · daily rate = salary ÷ {report?.[0]?.divisor ?? "divisor"}</span>}
          cols={["Employee", "Working", "Present", "Late", "Half", "Absent", "Worked", "Avg/day", "Overtime", "Daily (BDT)", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)", "Total (BDT)"]}
          rows={(report ?? []).map((s: any, i: number) => (
            <Tr key={s.employeeId ?? s.name} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={s.name} /><div><p className="font-medium"><Link href={`/people/attendance/${s.employeeId}`} className="hover:text-primary hover:underline">{s.name}</Link></p><p className="text-[11px] text-muted-foreground">{s.roleTitle}</p></div></div></Td>
              <Td className="font-semibold tabular-nums">{s.workingDays}</Td>
              <Td className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s.present}</Td>
              <Td className="tabular-nums text-amber-500">{s.late}</Td>
              <Td className="tabular-nums text-orange-500">{s.halfDay}</Td>
              <Td className="tabular-nums text-rose-500">{s.absent}</Td>
              <Td className="font-semibold tabular-nums">{fmtDur(s.workedMinutes)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtDur(s.avgWorkedMinutes)}</Td>
              <Td className={cn("tabular-nums", (s.overtimeMinutes ?? 0) > 0 ? "font-bold text-amber-500" : "text-muted-foreground")}>{(s.overtimeMinutes ?? 0) > 0 ? fmtDur(s.overtimeMinutes) : "—"}</Td>
              <Td className="tabular-nums text-muted-foreground">{formatBDT(s.dailyRate)}</Td>
              <Td className="tabular-nums text-amber-600">{s.lateDeduction ? formatBDT(s.lateDeduction) : "—"}</Td>
              <Td className="tabular-nums text-orange-600">{s.halfDayDeduction ? formatBDT(s.halfDayDeduction) : "—"}</Td>
              <Td className="tabular-nums text-rose-600">{s.absentDeduction ? formatBDT(s.absentDeduction) : "—"}</Td>
              <Td className="font-bold tabular-nums">{totalDeduction(s) ? formatBDT(totalDeduction(s)) : "—"}</Td>
            </Tr>
          ))}
        />
      </div>
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Late arrivals" subtitle={`Punches after shift start + grace · ${rangeLabel}`} />
          <Btn variant="ghost" onClick={() => downloadCsv(`late-list-${rangeDays ? `${rangeDays}d` : month}.csv`, ["Employee", "Date", "Check-in", "Minutes late", "Shift start", "Grace"], (lateList ?? []).map((r: any) => [r.employee?.name, String(r.date).slice(0, 10), fmtTime(r.checkInTime), r.minutesLate, r.shiftStart, r.graceMinutes]))}><Download className="size-3.5" /> CSV</Btn>
        </div>
        <DataTable
          loading={ll}
          error={le}
          onRetry={reload}
          skeleton={4}
          footer={<span className="text-[11.5px] text-muted-foreground">{(lateList ?? []).length} late entries</span>}
          cols={["Employee", "Date", "Check-in", "Minutes late", "Shift start", "Grace"]}
          rows={(lateList ?? []).map((r: any, i: number) => (
            <Tr key={r.id} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} size="size-7" /><p className="font-medium">{r.employee?.name}</p></div></Td>
              <Td className="text-muted-foreground">{formatDate(r.date)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtTime(r.checkInTime)}</Td>
              <Td className="font-semibold tabular-nums text-amber-500">{r.minutesLate} min</Td>
              <Td className="tabular-nums text-muted-foreground">{r.shiftStart}</Td>
              <Td className="tabular-nums text-muted-foreground">{r.graceMinutes} min</Td>
            </Tr>
          ))}
        />
      </div>
      <div className="mb-4">
        <SectionTitle title="Trends & anomalies" subtitle={`Late / absence patterns · ${rangeLabel}`} />
        {!(trends?.rows ?? []).length ? (
          <p className="text-[11.5px] text-muted-foreground">No trend data for this range.</p>
        ) : (trends.rows.every((r: any) => r.flags.length === 0) ? (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="size-3.5" /> Clean sheet — no habitual lates, streaks or frequent absents in this range.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(trends.rows ?? []).filter((r: any) => r.flags.length > 0).map((r: any) => (
              <Link
                key={r.employeeId}
                href={`/people/attendance/${r.employeeId}`}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 transition-colors hover:border-amber-500/50"
              >
                <Avatar name={r.name} size="size-7" />
                <span className="min-w-0 flex-1 text-[12.5px] font-bold">{r.name}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{r.late} late · {r.absent} absent · avg {fmtDur(r.avgWorkedMinutes)}/day</span>
                {r.flags.map((f: string) => (
                  <span key={f} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="size-2.5" />{f}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="mb-4">
        <SectionTitle title="Daily records" subtitle={`Click a row to correct a status with a reason · ${rangeLabel}`} />
        <DataTable
          loading={rl}
          error={re}
          onRetry={reload}
          skeleton={8}
          footer={<span className="text-[11.5px] text-muted-foreground">{(records ?? []).length} records</span>}
          cols={["Employee", "Date", "Status", "Check-in", "Check-out", "Worked"]}
          rows={(records ?? []).map((r: any, i: number) => {
            const worked = r.checkInTime ? Math.max(0, Math.round(((r.checkOutTime ? new Date(r.checkOutTime).getTime() : Date.now()) - new Date(r.checkInTime).getTime()) / 60000)) : null;
            return (
              <Tr key={r.id} index={i} onClick={() => { setEdit(r); setOpen(true); }} className="cursor-pointer">
                <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} size="size-7" /><p className="font-medium">{r.employee?.name}</p></div></Td>
                <Td className="text-muted-foreground">{formatDate(r.date)}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="tabular-nums text-muted-foreground">{fmtTime(r.checkInTime)}</Td>
                <Td className="tabular-nums text-muted-foreground">{r.checkOutTime ? fmtTime(r.checkOutTime) : (r.checkInTime ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">inside</span> : "—")}</Td>
                <Td className="font-semibold tabular-nums">{fmtDur(worked)}</Td>
              </Tr>
            );
          })}
        />
      </div>
      <div>
        <SectionTitle title="Raw device punches" subtitle="Fingerprint / CSV / kiosk log — map unmatched rows to employees" />
        <DataTable
          loading={pl}
          error={pe}
          onRetry={reload}
          skeleton={6}
          footer={<span className="text-[11.5px] text-muted-foreground">{(punches ?? []).length} punches · {(punches ?? []).filter((p: any) => p.unmatched).length} unmatched</span>}
          cols={["Device", "Time", "Employee", "Source", "Status"]}
          rows={(punches ?? []).map((p: any, i: number) => (
            <Tr key={p.id} index={i}>
              <Td><span className="font-mono text-[11.5px] font-semibold">{p.deviceId}</span></Td>
              <Td className="tabular-nums text-muted-foreground">{new Date(p.punchTime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
              <Td>{p.employee ? <div className="flex items-center gap-2"><Avatar name={p.employee.name} size="size-6" /><span className="text-[12.5px] font-medium">{p.employee.name}</span></div> : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">Unmatched</span>}</Td>
              <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", p.source === "DEVICE" ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : p.source === "KIOSK" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : p.source === "SELF" ? "bg-teal-500/10 text-teal-600 dark:text-teal-300" : "bg-primary/10 text-primary dark:text-primary")}>{p.source}</span></Td>
              <Td>{p.unmatched ? <Select className="!w-40" value="" onChange={(e) => mapPunch(p, e.target.value)}><option value="">Map to…</option>{(employees ?? []).map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}</Select> : <span className="text-[11.5px] text-muted-foreground">Mapped</span>}</Td>
            </Tr>
          ))}
        />
      </div>
      <AttendanceModal open={open} onClose={() => { setOpen(false); setEdit(null); }} employees={employees ?? []} edit={edit} onSaved={() => { notify(edit ? "Correction saved" : "Attendance recorded"); setEdit(null); reload(); }} />
      <ImportPunchModal open={importOpen} onClose={() => setImportOpen(false)} onSaved={(r) => { notify(`Imported ${r.imported} punches${r.unmatched ? ` · ${r.unmatched} unmatched` : ""}`); reload(); }} />
    </div>
  );
}
