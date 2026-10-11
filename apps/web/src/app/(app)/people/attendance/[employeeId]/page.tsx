"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock, Timer } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { useList } from "../../_components/hooks";

export const fmtDur = (mins?: number | null) => {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

const KIND_TONES: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-500",
  late: "bg-amber-500/10 text-amber-500",
  half: "bg-orange-500/10 text-orange-500",
  absent: "bg-rose-500/10 text-rose-500",
  leave: "bg-sky-500/10 text-sky-500",
  off: "bg-muted text-muted-foreground",
  holiday: "bg-violet-500/10 text-violet-500",
  future: "bg-transparent text-muted-foreground/40",
};

function useRange(range: { type: "month" | "days"; month: string; days: number }) {
  return useMemo(() => {
    if (range.type === "days") return `days=${range.days}`;
    return `month=${range.month}`;
  }, [range]);
}

export default function EmployeeAttendancePage({ params }: { params: Promise<{ employeeId: string }> }) {
  // Next 16: route params are async and must be unwrapped with React.use()
  const { employeeId } = use(params);
  // default view: trailing 30 days — the user asked for 7/15/30 filters
  const [range, setRange] = useState<{ type: "month" | "days"; month: string; days: number }>(() => ({
    type: "days",
    month: new Date().toISOString().slice(0, 7),
    days: 30,
  }));
  const qs = useRange(range);
  const { data, loading, error } = useList<any>(`/people/attendance/employee/${employeeId}?${qs}`, 0);

  const summary = data?.summary;
  const days = data?.days ?? [];
  const workedDays = days.filter((d: any) => d.workedMinutes != null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/people/attendance" className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-[20px] font-bold tracking-tight">{data?.employee?.name ?? "Employee"}</h1>
          <p className="text-[11.5px] text-muted-foreground">
            {data?.employee?.roleTitle ?? ""}{data?.employee?.department ? ` · ${data.employee.department}` : ""}
            {data?.range ? ` · ${formatDate(data.range.from)} → ${formatDate(data.range.to)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {([7, 15, 30] as const).map((n) => (
            <button
              key={n}
              onClick={() => setRange((r) => ({ ...r, type: "days", days: n }))}
              className={cn(
                "rounded-xl px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                range.type === "days" && range.days === n ? "bg-brand-gradient text-white" : "border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {n}D
            </button>
          ))}
          <input
            type="month"
            value={range.month}
            onChange={(e) => setRange({ type: "month", month: e.target.value, days: 30 })}
            className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-semibold outline-none focus:border-primary/40"
          />
          {range.type === "month" && (
            <Link href={`/people/payroll?period=${range.month}`} className="text-[11.5px] font-semibold text-primary hover:underline">
              Payroll for {range.month} →
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : error ? (
        <EmptyState title={String(error)} hint="The employee may not exist or you lack access." />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatMini label="Worked" value={fmtDur(summary?.workedMinutes)} sub={`expected ${fmtDur(summary?.expectedMinutes)}`} icon={<Timer className="size-4" />} />
            <StatMini label="Overtime" value={fmtDur(summary?.overtimeMinutes)} sub={`${summary?.working ?? 0} working days`} icon={<Clock className="size-4" />} tone="amber" />
            <StatMini label="Present" value={summary?.present ?? 0} sub={`${summary?.late ?? 0} late · ${summary?.halfDay ?? 0} half`} icon={<CheckCircle2 className="size-4" />} tone="emerald" />
            <StatMini label="Absent" value={summary?.absent ?? 0} sub={`${summary?.leave ?? 0} leave`} icon={<CalendarDays className="size-4" />} tone="rose" />
            <StatMini label="Avg / day" value={workedDays.length ? fmtDur(Math.round((summary?.workedMinutes ?? 0) / workedDays.length)) : "—"} sub={`${workedDays.length} days with hours`} icon={<Timer className="size-4" />} />
            <StatMini
              label="Shift"
              value={data?.employee?.shiftStart && data?.employee ? `${data.employee.shiftStart}–${data.employee.shiftEnd ?? ""}` : "—"}
              sub={`grace ${data?.employee?.graceMinutes ?? 0}m`}
              icon={<Clock className="size-4" />}
            />
          </div>

          <CardShell className="mt-4">
            <SectionTitle title="Daily hours" subtitle="Check-in → check-out → worked hours, day by day" />
            <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{days.length} days · overtime counts only past the policy threshold</span>}>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Status</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Worked</Th><Th>Overtime</Th><Th>Note</Th></THead>
                <tbody>
                  {days.map((d: any, i: number) => (
                    <Tr key={d.date} index={i}>
                      <Td className="whitespace-nowrap text-muted-foreground">{formatDate(d.date)}</Td>
                      <Td>
                        {d.kind === "present" || d.kind === "late" || d.kind === "half" || d.kind === "absent"
                          ? <StatusBadge status={d.status ?? d.kind.toUpperCase()} />
                          : <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold capitalize", KIND_TONES[d.kind] ?? "bg-muted text-muted-foreground")}>{d.kind}</span>}
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">{d.checkIn ? new Date(d.checkIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {d.checkOut
                          ? new Date(d.checkOut).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                          : d.stillInside ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">inside now</span> : "—"}
                      </Td>
                      <Td className="font-semibold tabular-nums">{fmtDur(d.workedMinutes)}</Td>
                      <Td className={cn("tabular-nums", (d.overtimeMinutes ?? 0) > 0 ? "font-bold text-amber-500" : "text-muted-foreground")}>
                        {(d.overtimeMinutes ?? 0) > 0 ? fmtDur(d.overtimeMinutes) : "—"}
                      </Td>
                      <Td className="text-[11px] text-muted-foreground">
                        {d.leave ? "on leave" : d.holiday ? String(d.holiday) : d.punches > 2 ? `${d.punches} punches` : ""}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </CardShell>

          {(data?.leaves ?? []).length > 0 && (
            <CardShell className="mt-4">
              <SectionTitle title="Approved leaves in range" subtitle={`${data.leaves.length} request(s)`} />
              <div className="flex flex-wrap gap-1.5">
                {data.leaves.map((l: any) => (
                  <span key={l.id} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold">
                    {l.leaveType} · {formatDate(l.startDate)} → {formatDate(l.endDate)}
                  </span>
                ))}
              </div>
            </CardShell>
          )}
        </>
      )}
    </div>
  );
}

function StatMini({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub?: string; icon: React.ReactNode; tone?: "amber" | "emerald" | "rose" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={cn(
          "flex size-7 items-center justify-center rounded-lg",
          tone === "amber" ? "bg-amber-500/10 text-amber-500" : tone === "emerald" ? "bg-emerald-500/10 text-emerald-500" : tone === "rose" ? "bg-rose-500/10 text-rose-500" : "bg-primary/10 text-primary"
        )}>
          {icon}
        </span>
      </div>
      <p className="mt-1 font-heading text-[19px] font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
