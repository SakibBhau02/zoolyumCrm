"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Fingerprint } from "lucide-react";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Td, Tr } from "@/components/table";
import { Input } from "@/components/ui";
import { monthNow } from "../../_components/constants";
import { DataTable, useList } from "../../_components/hooks";

const KIND_STYLE: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  late: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  half: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  absent: "bg-rose-500/10 text-rose-500",
  leave: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  off: "bg-muted text-muted-foreground/60",
  holiday: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  future: "bg-transparent text-muted-foreground/40",
};

const KIND_LABEL: Record<string, string> = {
  present: "Present", late: "Late", half: "Half day", absent: "Absent",
  leave: "Leave", off: "Weekly off", holiday: "Holiday", future: "—",
};

const fmtT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function EmployeeAttendancePage() {
  const params = useParams<{ employeeId: string }>();
  const [month, setMonth] = useState(monthNow());
  const { data, loading, error } = useList<any>(`/people/attendance/employee/${params.employeeId}?month=${month}`);

  const emp = data?.employee;
  const summary = data?.summary;
  const days: any[] = data?.days ?? [];

  // Calendar grid: weeks starting Sunday
  const firstDow = days.length ? new Date(`${days[0].date}T00:00:00.000Z`).getUTCDay() : 0;
  const cells: (any | null)[] = [...Array(firstDow).fill(null), ...days];

  const stats: [string, string | number][] = summary
    ? [
        ["Working", summary.working],
        ["Present", summary.present],
        ["Late", summary.late],
        ["Half day", summary.halfDay],
        ["Absent", summary.absent],
        ["Leave", summary.leave],
        ["Late time", `${summary.lateMinutes} min`],
      ]
    : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/people/attendance" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Attendance
        </Link>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-44" />
        {emp && (
          <Link href={`/people/payroll?period=${month}`} className="ml-auto text-[11.5px] font-semibold text-primary hover:underline">
            Payroll for {month} →
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error || !data ? (
        <EmptyState title={error ?? "Not found"} hint="This employee may have been removed." />
      ) : (
        <div className="flex flex-col gap-4">
          <CardShell>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={emp.name} size="size-11" />
              <div className="min-w-0 flex-1">
                <p className="font-heading text-[16px] font-semibold">{emp.name}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  {emp.roleTitle}{emp.department ? ` · ${emp.department}` : ""} · {emp.shiftStart ?? "10:00"} start · {emp.graceMinutes ?? 15} min grace
                </p>
              </div>
              {emp.deviceId ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-300">
                  <Fingerprint className="size-3" /> {emp.deviceId}
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-300">No fingerprint ID</span>
              )}
              <StatusBadge status={emp.employmentStatus} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {stats.map(([k, v]) => (
                <div key={k + String(v)} className="rounded-xl bg-muted/40 px-2.5 py-2 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          </CardShell>

          <CardShell>
            <SectionTitle title="Daily log" subtitle={`${month} · all times Dhaka`} />
            <div className="grid grid-cols-7 gap-1.5">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <p key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{d}</p>
              ))}
              {cells.map((d: any, i: number) =>
                !d ? (
                  <div key={`x-${i}`} />
                ) : (
                  <div
                    key={d.date}
                    title={`${d.date} — ${KIND_LABEL[d.kind] ?? d.kind}${d.checkIn ? ` · in ${fmtT(d.checkIn)}` : ""}${d.checkOut ? ` · out ${fmtT(d.checkOut)}` : ""}`}
                    className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-transparent px-1 py-1.5", KIND_STYLE[d.kind] ?? "")}
                  >
                    <span className="text-[12px] font-bold tabular-nums">{Number(d.date.slice(8, 10))}</span>
                    <span className="text-[9px] font-semibold tabular-nums">{d.checkIn ? fmtT(d.checkIn) : d.kind === "future" ? "" : "·"}</span>
                  </div>
                )
              )}
            </div>
          </CardShell>

          <div>
            <SectionTitle title="Day records" subtitle="Check-in / out per working day" />
            <DataTable
              loading={false}
              error={null}
              skeleton={0}
              footer={<span className="text-[11.5px] text-muted-foreground">{days.filter((d: any) => !["future", "off", "holiday"].includes(d.kind)).length} working days · all times Dhaka</span>}
              cols={["Date", "Status", "Check-in", "Check-out", "Punches", "Note"]}
              rows={days
                .filter((d: any) => !["future", "off", "holiday"].includes(d.kind))
                .map((d: any, i: number) => (
                  <Tr key={d.date} index={i}>
                    <Td className="tabular-nums text-muted-foreground">{d.date}</Td>
                    <Td>
                      {d.kind === "leave" ? <StatusBadge status="ON_LEAVE" /> : d.status ? <StatusBadge status={d.status} /> : <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", KIND_STYLE[d.kind])}>{KIND_LABEL[d.kind]}</span>}
                    </Td>
                    <Td className="tabular-nums">{fmtT(d.checkIn)}</Td>
                    <Td className="tabular-nums">{fmtT(d.checkOut)}</Td>
                    <Td className="tabular-nums text-muted-foreground">{d.punches || "—"}</Td>
                    <Td className="text-[11.5px] text-muted-foreground">{d.holiday && d.holiday !== true ? String(d.holiday) : d.leave ? "Approved leave" : "—"}</Td>
                  </Tr>
                ))}
            />
          </div>

          {(data?.leaves ?? []).length > 0 && (
            <CardShell>
              <SectionTitle title="Approved leaves in period" subtitle={`${data.leaves.length} request(s)`} />
              <div className="flex flex-col gap-1.5">
                {data.leaves.map((l: any) => (
                  <p key={l.id} className="text-[12px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{l.leaveType}</span> · {String(l.startDate).slice(0, 10)} → {String(l.endDate).slice(0, 10)}
                  </p>
                ))}
              </div>
            </CardShell>
          )}
        </div>
      )}
    </div>
  );
}
