"use client";
import { useCallback, useState } from "react";
import { Download, Fingerprint, Plus, RotateCcw, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { Avatar, SectionTitle, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Input, Select } from "@/components/ui";
import { downloadCsv, fmtTime, monthNow } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { AttendanceModal, ImportPunchModal } from "../_components/modals/attendance-modals";

export default function AttendancePage() {
  const [month, setMonth] = useState(monthNow());
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: report, loading: rpl, error: rpe } = useList<any[]>("/people/attendance/report?month=" + month, refresh);
  const { data: lateList, loading: ll, error: le } = useList<any[]>("/people/attendance/late-list?month=" + month, refresh);
  const { data: records, loading: rl, error: re } = useList<any[]>("/people/attendance?month=" + month, refresh);
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
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-44" />
        <Btn variant="outline" onClick={() => kiosk("in")} className={kioskBusy ? "opacity-60" : ""}><Fingerprint className="size-3.5" /> Check in (kiosk)</Btn>
        <Btn variant="outline" onClick={() => kiosk("out")} className={kioskBusy ? "opacity-60" : ""}><Fingerprint className="size-3.5" /> Check out (kiosk)</Btn>
        <Btn variant="outline" onClick={() => setImportOpen(true)}><Upload className="size-3.5" /> Import punches</Btn>
        <Btn variant="outline" onClick={recompute} className={recompBusy ? "opacity-60" : ""}><RotateCcw className="size-3.5" /> Recompute</Btn>
        <Btn variant="primary" onClick={() => { setEdit(null); setOpen(true); }}><Plus className="size-3.5" /> Record Attendance</Btn>
      </div>
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Monthly report" subtitle={`Attendance + deduction preview for ${month}`} />
          <Btn variant="ghost" onClick={() => downloadCsv(`attendance-report-${month}.csv`, ["Employee", "Working", "Present", "Late", "Half day", "Absent", "Daily rate", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)"], (report ?? []).map((s: any) => [s.name, s.workingDays, s.present, s.late, s.halfDay, s.absent, s.dailyRate, s.lateDeduction, s.halfDayDeduction, s.absentDeduction]))}><Download className="size-3.5" /> CSV</Btn>
        </div>
        <DataTable
          loading={rpl}
          error={rpe}
          onRetry={reload}
          skeleton={6}
          footer={<span className="text-[11.5px] text-muted-foreground">{(report ?? []).length} employees · daily rate = salary ÷ {report?.[0]?.divisor ?? "divisor"}</span>}
          cols={["Employee", "Working", "Present", "Late", "Half", "Absent", "Daily (BDT)", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)", "Total (BDT)"]}
          rows={(report ?? []).map((s: any, i: number) => (
            <Tr key={s.employeeId ?? s.name} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={s.name} /><div><p className="font-medium">{s.name}</p><p className="text-[11px] text-muted-foreground">{s.roleTitle}</p></div></div></Td>
              <Td className="font-semibold tabular-nums">{s.workingDays}</Td>
              <Td className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s.present}</Td>
              <Td className="tabular-nums text-amber-500">{s.late}</Td>
              <Td className="tabular-nums text-orange-500">{s.halfDay}</Td>
              <Td className="tabular-nums text-rose-500">{s.absent}</Td>
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
          <SectionTitle title="Late arrivals" subtitle="Punches after shift start + grace" />
          <Btn variant="ghost" onClick={() => downloadCsv(`late-list-${month}.csv`, ["Employee", "Date", "Check-in", "Minutes late", "Shift start", "Grace"], (lateList ?? []).map((r: any) => [r.employee?.name, String(r.date).slice(0, 10), fmtTime(r.checkInTime), r.minutesLate, r.shiftStart, r.graceMinutes]))}><Download className="size-3.5" /> CSV</Btn>
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
        <SectionTitle title="Daily records" subtitle="Click a row to correct a status with a reason" />
        <DataTable
          loading={rl}
          error={re}
          onRetry={reload}
          skeleton={8}
          footer={<span className="text-[11.5px] text-muted-foreground">{(records ?? []).length} records</span>}
          cols={["Employee", "Date", "Status", "Check-in", "Check-out"]}
          rows={(records ?? []).map((r: any, i: number) => (
            <Tr key={r.id} index={i} onClick={() => { setEdit(r); setOpen(true); }} className="cursor-pointer">
              <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} size="size-7" /><p className="font-medium">{r.employee?.name}</p></div></Td>
              <Td className="text-muted-foreground">{formatDate(r.date)}</Td>
              <Td><StatusBadge status={r.status} /></Td>
              <Td className="tabular-nums text-muted-foreground">{fmtTime(r.checkInTime)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtTime(r.checkOutTime)}</Td>
            </Tr>
          ))}
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
              <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", p.source === "DEVICE" ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : p.source === "KIOSK" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-primary/10 text-primary dark:text-primary")}>{p.source}</span></Td>
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
