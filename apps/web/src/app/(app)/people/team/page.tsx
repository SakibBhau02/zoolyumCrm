"use client";

/**
 * Team 360 — one employee at a time, everything about their month.
 *
 * Left: the roster (search, department, "needs attention" chips).
 * Right: the selected person — attendance heat-map, hours, tasks completed,
 * meetings attended, leave and the latest payslip.
 *
 * Selection lives in `?id=` so a link can point at one person, and deep links
 * from other pages (attendance report, workload table) land on the right person.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  CalendarDays, CheckCircle2, Clock, Fingerprint, ListTodo, Plus, Search, Timer, Users, Video,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate } from "@/lib/format";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { Input, Select } from "@/components/ui";
import { AttendanceHeatmap, type AttendanceDay } from "@/components/people/attendance-heatmap";
import { normalizeStatus, statusLabel } from "@/components/tasks/domain";
import { PeopleHero } from "../_components/hero";
import { Pager } from "../_components/table-kit";
import { useToast, Toast } from "../_components/hooks";
import { monthNow } from "../_components/constants";
import { usePeopleAccess } from "../_components/permissions";
import { AttendanceModal } from "../_components/modals/attendance-modals";
import { EmployeeModal } from "../_components/modals/employee-form";

const fmtDur = (mins?: number | null) => {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

type RosterRow = {
  id: string;
  name: string;
  roleTitle: string;
  department?: string | null;
  employmentStatus: string;
  todayStatus?: string | null;
  todayCheckIn?: string | null;
};

type Range = { type: "month" | "days"; month: string; days: number };

const TABS = ["Attendance", "Days", "Tasks", "Meetings", "Shoots", "Leave"] as const;
type Tab = (typeof TABS)[number];

export default function TeamPage() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const { flash, notify } = useToast();
  const { canManagePulse, canEdit, isHr } = usePeopleAccess();

  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [range, setRange] = useState<Range>({ type: "days", month: monthNow(), days: 30 });
  const [tab, setTab] = useState<Tab>("Attendance");
  const [dayPage, setDayPage] = useState(0);
  const [attDay, setAttDay] = useState<any>(null);
  const [refresh, setRefresh] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);

  const qs = range.type === "days" ? `days=${range.days}` : `month=${range.month}`;

  const { data: roster, loading: rosterLoading } = useApi<{ departments: string[]; rows: RosterRow[] }>(`/people/team?v=${refresh}`);
  const { data: detail, loading: detailLoading, error: detailError } = useApi<any>(
    selectedId ? `/people/team/${selectedId}?${qs}&v=${refresh}` : null
  );

  const rows = roster?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept && (r.department ?? "") !== dept) return false;
      if (onlyAttention && !["LATE", "ABSENT"].includes(r.todayStatus ?? "")) return false;
      if (!needle) return true;
      return `${r.name} ${r.roleTitle} ${r.department ?? ""}`.toLowerCase().includes(needle);
    });
  }, [rows, q, dept, onlyAttention]);

  const select = (id: string) => router.replace(`/people/team?id=${id}`, { scroll: false });

  const att = detail?.attendance;
  const summary = att?.summary ?? {};
  const days: AttendanceDay[] = att?.days ?? [];
  const workedDays = days.filter((d) => d.workedMinutes != null).length;
  // Unrecorded days are a data gap, not a miss — exclude them from the rate so
  // the number reflects measured days only.
  const measuredDays = Math.max(0, (summary.working ?? 0) - (summary.unrecorded ?? 0));
  const attendanceRate =
    measuredDays > 0
      ? Math.round(((summary.present + summary.late + summary.halfDay) / measuredDays) * 100)
      : 0;

  return (
    <div>
      <Toast flash={flash} />
      <AttendanceModal
        open={!!attDay}
        onClose={() => setAttDay(null)}
        employees={detail?.employee ? [{ id: detail.employee.id, name: detail.employee.name }] : []}
        edit={attDay}
        onSaved={() => { notify("Attendance corrected"); setDayPage(0); reload(); }}
      />
      <EmployeeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(employee) => {
          notify(employee?.name ? `Employee added — ${employee.name}` : "Employee added");
          reload();
        }}
      />
      <PeopleHero
        icon={<Users className="size-4" />}
        title="Team 360"
        subtitle="Pick a person — attendance, hours, tasks and meetings for the window"
        stats={[
          { label: "People", value: rows.length, sub: `${filtered.length} shown` },
          { label: "Departments", value: roster?.departments?.length ?? "—", tone: "sky" },
          { label: "In today", value: rows.filter((r) => r.todayStatus === "PRESENT").length, tone: "emerald" },
          { label: "Late", value: rows.filter((r) => r.todayStatus === "LATE").length, tone: "amber" },
          { label: "Absent", value: rows.filter((r) => r.todayStatus === "ABSENT").length, tone: "rose" },
        ]}
        actions={
          <div className="flex items-center gap-1">
            {([7, 15, 30] as const).map((n) => (
              <button
                key={n}
                onClick={() => setRange((r) => ({ ...r, type: "days", days: n }))}
                className={cn(
                  "rounded-lg px-2 py-1 text-micro font-bold transition-colors",
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
              className="rounded-lg border border-border bg-card px-2 py-1 text-micro font-semibold outline-none focus:border-primary/40"
            />
            {canEdit && (
              <Btn variant="primary" onClick={() => setAddOpen(true)} className="!px-2 !py-1 text-micro">
                <Plus className="size-3.5" /> Add
              </Btn>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Roster ─────────────────────────────────────────────────── */}
        <CardShell className="h-fit xl:sticky xl:top-4">
          <SectionTitle title="People" subtitle={`${filtered.length} of ${rows.length}`} />
          <div className="mb-2 flex flex-col gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, role, dept…"
                className="w-full rounded-xl border border-border bg-card py-1.5 pl-9 pr-3 text-body outline-none placeholder:text-muted-foreground focus:border-primary/40"
              />
            </div>
            <div className="flex gap-1.5">
              <Select value={dept} onChange={(e) => setDept(e.target.value)} className="!w-full !py-1.5 text-meta">
                <option value="">All departments</option>
                {(roster?.departments ?? []).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
            </div>
            <button
              onClick={() => setOnlyAttention((v) => !v)}
              className={cn(
                "rounded-xl border px-2.5 py-1.5 text-meta font-bold transition-colors",
                onlyAttention ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Late / absent today only
            </button>
          </div>

          <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto pr-0.5">
            {rosterLoading && [...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-11" />)}
            {!rosterLoading && filtered.length === 0 && (
              <p className="py-4 text-center text-meta text-muted-foreground">No match.</p>
            )}
            {filtered.map((r) => {
              const active = r.id === selectedId;
              const st = r.todayStatus;
              return (
                <button
                  key={r.id}
                  onClick={() => select(r.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors",
                    active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/60"
                  )}
                >
                  <Avatar name={r.name} size="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-body font-semibold", active && "text-primary")}>{r.name}</span>
                    <span className="block truncate text-micro text-muted-foreground">
                      {r.roleTitle}{r.department ? ` · ${r.department}` : ""}
                    </span>
                  </span>
                  {st && (
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        st === "PRESENT" ? "bg-emerald-500"
                          : st === "LATE" ? "bg-amber-500"
                            : st === "ABSENT" ? "bg-rose-500"
                              : st === "HALF_DAY" ? "bg-orange-500"
                                : "bg-sky-500"
                      )}
                      title={statusLabel(st)}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </CardShell>

        {/* ── Detail ─────────────────────────────────────────────────── */}
        <div>
          {!selectedId ? (
            <CardShell>
              <EmptyState
                title="Select a person"
                hint="Pick someone from the list to see their month: attendance days, late minutes, tasks completed and meetings attended."
              />
            </CardShell>
          ) : detailLoading ? (
            <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-24" />)}</div>
          ) : detailError ? (
            <CardShell>
              <EmptyState title={detailError} hint="The employee may not exist or you lack access." />
            </CardShell>
          ) : !detail ? null : (
            <div className="flex flex-col gap-1.5">
              {/* Identity */}
              <CardShell className="!p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={detail.employee.name} size="size-10" src={detail.employee.photoUrl} jxlSrc={detail.employee.photoJxlUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading text-title font-bold">{detail.employee.name}</p>
                      <StatusBadge status={detail.employee.employmentStatus} />
                    </div>
                    <p className="mt-0.5 text-meta text-muted-foreground">
                      {detail.employee.roleTitle}
                      {detail.employee.department ? ` · ${detail.employee.department}` : ""}
                      {detail.employee.reportingManager ? ` · reports to ${detail.employee.reportingManager.name}` : ""}
                      {detail.employee.shiftStart ? ` · shift ${detail.employee.shiftStart}–${detail.employee.shiftEnd ?? "?"}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/people/directory/${detail.employee.id}`}
                      className="rounded-xl border border-border px-2.5 py-1.5 text-meta font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Profile
                    </Link>
                    <Link
                      href={`/tasks?assignee=${detail.employee.id}`}
                      className="rounded-xl border border-border px-2.5 py-1.5 text-meta font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Their tasks
                    </Link>
                  </div>
                </div>

                {/* KPI row — same shape for every department. */}
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-7">
                  <Kpi label="Attendance" value={`${attendanceRate}%`} sub={`${measuredDays} measured of ${summary.working ?? 0}`} tone="emerald" />
                  <Kpi label="Present" value={summary.present ?? 0} sub={`${summary.late ?? 0} late · ${summary.halfDay ?? 0} half`} />
                  <Kpi label="Absent" value={summary.absent ?? 0} sub={`${summary.leave ?? 0} leave`} tone="rose" />
                  <Kpi label="No record" value={summary.unrecorded ?? 0} sub="never processed" tone="muted" />
                  <Kpi label="Late minutes" value={`${summary.lateMinutes ?? 0}m`} sub={`${summary.late ?? 0} occurrences`} tone="amber" />
                  <Kpi label="Worked" value={fmtDur(summary.workedMinutes)} sub={workedDays ? `avg ${fmtDur(Math.round((summary.workedMinutes ?? 0) / workedDays))}/day` : "—"} />
                  <Kpi label="Overtime" value={fmtDur(summary.overtimeMinutes)} sub={`expected ${fmtDur(summary.expectedMinutes)}`} tone="amber" />
                </div>
              </CardShell>

              {/* Tabs */}
              <div className="flex flex-wrap items-center gap-1">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-meta font-bold transition-colors",
                      tab === t ? "bg-brand-gradient text-white" : "border border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t}
                    {t === "Tasks" && detail.tasks ? ` (${detail.tasks.doneInRange})` : ""}
                    {t === "Meetings" && detail.meetings ? ` (${detail.meetings.attended})` : ""}
                    {t === "Shoots" && detail.shoots ? ` (${detail.shoots.days})` : ""}
                  </button>
                ))}
              </div>

              {tab === "Attendance" && (
                <>
                  <CardShell>
                    <SectionTitle
                      title="Day by day"
                      subtitle={`${formatDate(att?.range?.from)} → ${formatDate(att?.range?.to)} · hover a day for times`}
                      icon={<CalendarDays className="size-4" />}
                    />
                    <AttendanceHeatmap days={days} />
                  </CardShell>
                </>
              )}

              {tab === "Days" && (() => {
                const logged = days.filter((d) => !["future", "off", "before"].includes(d.kind));
                const pageSize = 4;
                const pages = Math.max(1, Math.ceil(logged.length / pageSize));
                const safe = Math.min(dayPage, pages - 1);
                const paged = logged.slice(safe * pageSize, safe * pageSize + pageSize);
                return (
                  <CardShell>
                    <SectionTitle title="Daily hours" subtitle="Check-in → check-out → worked, day by day" icon={<Timer className="size-4" />} />
                    <TableShell
                      footer={
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-meta text-muted-foreground">{logged.length} days · overtime counts past the policy threshold</span>
                          <Pager page={safe} pages={pages} onPage={setDayPage} total={logged.length} pageSize={pageSize} label="days" />
                        </div>
                      }
                    >
                      <table className="w-full">
                        <THead><Th>Date</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th>Worked</Th><Th>OT</Th><Th>Note</Th>{isHr && <Th> </Th>}</THead>
                        <tbody>
                          {paged.map((d, i) => (
                            <Tr key={d.date} index={i}>
                              <Td className="whitespace-nowrap text-muted-foreground">{formatDate(d.date)}</Td>
                              <Td>
                                {["present", "late", "half", "absent"].includes(d.kind)
                                  ? <StatusBadge status={d.status ?? (d.kind === "half" ? "HALF_DAY" : d.kind.toUpperCase())} />
                                  : d.kind === "unrecorded"
                                    ? <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground" title="No attendance row and no punch — this day was never processed">no record</span>
                                    : <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-micro font-bold capitalize text-sky-500">{d.kind}</span>}
                              </Td>
                              <Td className="tabular-nums text-muted-foreground">{d.checkIn ? new Date(d.checkIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</Td>
                              <Td className="tabular-nums text-muted-foreground">
                                {d.checkOut
                                  ? new Date(d.checkOut).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                                  : d.stillInside ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-bold text-emerald-500">inside</span> : "—"}
                              </Td>
                              <Td className="font-semibold tabular-nums">{fmtDur(d.workedMinutes)}</Td>
                              <Td className={cn("tabular-nums", (d.overtimeMinutes ?? 0) > 0 ? "font-bold text-amber-500" : "text-muted-foreground")}>
                                {(d.overtimeMinutes ?? 0) > 0 ? fmtDur(d.overtimeMinutes) : "—"}
                              </Td>
                              <Td className="text-meta text-muted-foreground">
                                {d.leave ? "on leave" : typeof d.holiday === "string" ? d.holiday : (d.punches ?? 0) > 2 ? `${d.punches} punches` : ""}
                              </Td>
                              {isHr && (
                                <Td>
                                  {d.id ? (
                                    <button
                                      onClick={() =>
                                        setAttDay({
                                          id: d.id,
                                          date: d.date,
                                          status: d.status ?? "PRESENT",
                                          checkIn: d.checkIn,
                                          checkOut: d.checkOut,
                                          punchCount: d.punches,
                                          employee: { id: selectedId ?? "", name: detail?.employee?.name ?? "" },
                                        })
                                      }
                                      className="rounded-lg border border-border px-2 py-0.5 text-micro font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                                    >
                                      Fix
                                    </button>
                                  ) : (
                                    <Link href="/people/attendance" className="text-micro font-semibold text-primary hover:underline">Record</Link>
                                  )}
                                </Td>
                              )}
                            </Tr>
                          ))}
                        </tbody>
                      </table>
                    </TableShell>
                  </CardShell>
                );
              })()}

              {tab === "Tasks" && (detail?.tasks ? (
                <>
                  <CardShell className="!p-3">
                    <SectionTitle title="Task output" subtitle={`Completed, on-time and open work · ${range.type === "days" ? `last ${range.days} days` : range.month}`} icon={<ListTodo className="size-4" />} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <Kpi label="Completed" value={detail.tasks.doneInRange} sub={`${detail.tasks.doneAllTime} all time`} tone="emerald" />
                      <Kpi label="On time" value={detail.tasks.onTimeRate != null ? `${detail.tasks.onTimeRate}%` : "—"} sub={`${detail.tasks.onTime}/${detail.tasks.doneInRange} met due date`} />
                      <Kpi label="Open" value={detail.tasks.open} sub={`${detail.tasks.overdue} overdue`} tone="rose" />
                      <Kpi label="Logged" value={fmtDur(detail.tasks.loggedMinutes)} sub="time logs in window" />
                      <Kpi label="Est vs actual" value={`${detail.tasks.estimatedHours}h / ${detail.tasks.actualHours}h`} sub="all open + done" />
                    </div>
                  </CardShell>

                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <BreakdownCard title="By type" subtitle="What kind of work they actually pick up" rows={detail.tasks.byType} keyLabel="Task type" />
                    <BreakdownCard title="By project" subtitle="Where their hours are spread" rows={detail.tasks.byProject} keyLabel="Project" nameKey="name" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <CardShell>
                    <SectionTitle title="Recently completed" subtitle="Newest first" icon={<CheckCircle2 className="size-4" />} />
                    {(detail.tasks.recentDone ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">Nothing completed in this window.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {detail.tasks.recentDone.slice(0, 2).map((t: any) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                            <p className="min-w-0 truncate text-body font-medium">{t.title}</p>
                            <span className="shrink-0 text-micro text-muted-foreground">
                              {t.project ? `${t.project} · ` : ""}{formatDate(t.completedAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardShell>

                  <CardShell>
                    <SectionTitle title="Open work" subtitle="Soonest due first" />
                    {(detail.tasks.openList ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">No open tasks.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {detail.tasks.openList.slice(0, 2).map((t: any) => (
                          <Link
                            key={t.id}
                            href={`/tasks?task=${t.id}`}
                            className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2 transition-colors hover:border-primary/40"
                          >
                            <p className="min-w-0 truncate text-body font-medium">{t.title}</p>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="text-micro font-bold uppercase text-muted-foreground">{t.priority}</span>
                              <StatusBadge status={normalizeStatus(t.status)} />
                              <span className="text-micro text-muted-foreground">{t.dueDate ? formatDate(t.dueDate) : "no due"}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardShell>
                  </div>
                </>
              ) : (
                <CardShell><p className="text-body text-muted-foreground">No task data in this window.</p></CardShell>
              ))}

              {tab === "Meetings" && (detail?.meetings ? (
                <>
                  <CardShell className="!p-3">
                    <SectionTitle title="Meeting load" subtitle="Invited vs actually attended" icon={<Video className="size-4" />} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <Kpi label="Invited" value={detail.meetings.invited} sub="in this window" />
                      <Kpi label="Attended" value={detail.meetings.attended} sub={`${detail.meetings.attendanceRate ?? "—"}% show-up`} tone="emerald" />
                      <Kpi label="No-show" value={detail.meetings.noShow} sub={`${detail.meetings.unmarked} unmarked`} tone="rose" />
                      <Kpi label="Upcoming" value={detail.meetings.upcoming} sub="scheduled ahead" />
                      <Kpi label="Hours" value={`${detail.meetings.hours}h`} sub="total booked" />
                    </div>
                    {!detail.meetings.hasLogin && (
                      <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta font-semibold text-amber-600 dark:text-amber-300">
                        This employee has no login account. Meetings are recorded against the employee, so they still count — but they can't be invited by name from the lead panel until a user account is linked.
                      </p>
                    )}
                  </CardShell>

                  <CardShell className="!p-3">
                    <SectionTitle title="Meetings in window" subtitle="Marked per employee, newest first" />
                    {(detail.meetings.recent ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">No meetings recorded for this person in the window.</p>
                    ) : (
                      <TableShell footer={<span className="text-meta text-muted-foreground">{Math.min(detail.meetings.recent.length, 3)} of {detail.meetings.recent.length} shown</span>}>
                        <table className="w-full">
                          <THead><Th>Meeting</Th><Th>Lead</Th><Th>When</Th><Th>Length</Th><Th>Outcome</Th><Th /></THead>
                          <tbody>
                            {detail.meetings.recent.slice(0, 3).map((m: any, i: number) => (
                              <Tr key={m.meetingId} index={i}>
                                <Td className="font-medium">{m.title}</Td>
                                <Td className="text-muted-foreground">{m.lead ?? "—"}{m.company ? ` · ${m.company}` : ""}</Td>
                                <Td className="whitespace-nowrap text-muted-foreground">{formatDate(m.scheduledAt)}</Td>
                                <Td className="tabular-nums text-muted-foreground">{m.durationMins}m</Td>
                                <Td>
                                  <span className={cn(
                                    "rounded-full px-2 py-0.5 text-micro font-bold",
                                    m.myStatus === "ATTENDED" ? "bg-emerald-500/10 text-emerald-500"
                                      : m.myStatus === "NO_SHOW" ? "bg-rose-500/10 text-rose-500"
                                        : "bg-muted text-muted-foreground"
                                  )}>
                                    {m.myStatus.toLowerCase().replace("_", " ")}
                                  </span>
                                </Td>
                                <Td>
                                  {canManagePulse ? (
                                    <Select
                                      value=""
                                      onChange={(e) => {
                                        if (!e.target.value) return;
                                        apiFetch(`/pulse/meetings/${m.meetingId}/attendees/${detail.employee.id}`, {
                                          method: "PATCH",
                                          body: JSON.stringify({ status: e.target.value }),
                                        })
                                          .then(() => { notify("Attendance marked"); reload(); })
                                          .catch((err: any) => notify(err.message ?? "Failed"));
                                      }}
                                      className="!w-32 !py-1 text-meta"
                                    >
                                      <option value="">Mark…</option>
                                      <option value="ATTENDED">Attended</option>
                                      <option value="NO_SHOW">No-show</option>
                                      <option value="INVITED">Reset</option>
                                    </Select>
                                  ) : (
                                    <span className="text-micro text-muted-foreground">view only</span>
                                  )}
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </table>
                      </TableShell>
                    )}
                  </CardShell>
                </>
              ) : (
                <CardShell><p className="text-body text-muted-foreground">No meeting data.</p></CardShell>
              ))}

              {tab === "Shoots" && (detail?.shoots ? (
                <>
                  <CardShell className="!p-3">
                    <SectionTitle title="On set" subtitle="Production days this person was crewed for" icon={<Video className="size-4" />} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Kpi label="Shoot days" value={detail.shoots.days} sub="distinct dates in window" tone="emerald" />
                      <Kpi label="Bookings" value={detail.shoots.total} sub="crew rows" />
                      <Kpi label="Confirmed" value={detail.shoots.confirmed} sub={`${detail.shoots.total - detail.shoots.confirmed} pending`} tone="amber" />
                    </div>
                  </CardShell>

                  <CardShell className="!p-3">
                    <SectionTitle title="Recent shoots" subtitle="Newest first" />
                    {(detail.shoots.recent ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">Not crewed on any shoot in this window.</p>
                    ) : (
                      <TableShell footer={<span className="text-meta text-muted-foreground">{Math.min(detail.shoots.recent.length, 6)} of {detail.shoots.recent.length} shown</span>}>
                        <table className="w-full">
                          <THead><Th>Shoot</Th><Th>Project</Th><Th>Date</Th><Th>Role</Th><Th>Status</Th></THead>
                          <tbody>
                            {detail.shoots.recent.slice(0, 6).map((s: any, i: number) => (
                              <Tr key={s.id} index={i}>
                                <Td className="font-medium">{s.title}{s.location ? <span className="text-meta text-muted-foreground"> · {s.location}</span> : null}</Td>
                                <Td className="text-muted-foreground">{s.project ?? "—"}</Td>
                                <Td className="whitespace-nowrap text-muted-foreground">{formatDate(s.shootDate)}</Td>
                                <Td className="text-muted-foreground">{s.role.toLowerCase().replace(/_/g, " ")}</Td>
                                <Td><StatusBadge status={s.isConfirmed ? "CONFIRMED" : s.status} /></Td>
                              </Tr>
                            ))}
                          </tbody>
                        </table>
                      </TableShell>
                    )}
                  </CardShell>
                </>
              ) : (
                <CardShell><p className="text-body text-muted-foreground">No shoot data in this window.</p></CardShell>
              ))}

              {tab === "Leave" && (detail?.leave ? (
                <>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <CardShell className="!p-3">
                    <SectionTitle title="Leave balances" subtitle="Current quota per leave type" icon={<CalendarDays className="size-4" />} />
                    {(detail.leave.balances ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">No balances initialised for this employee.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.leave.balances.map((b: any) => (
                          <span key={`${b.leaveType}-${b.period}`} className="rounded-full border border-border bg-card px-2.5 py-1 text-meta font-semibold tabular-nums">
                            {b.leaveType}: {b.balanceDays}d <span className="text-muted-foreground">({b.period})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </CardShell>

                  <CardShell className="!p-3">
                    <SectionTitle title="Requests in window" subtitle="Approved, pending and rejected" />
                    {(detail.leave.requests ?? []).length === 0 ? (
                      <p className="text-meta text-muted-foreground">No leave requests overlapping this window.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {detail.leave.requests.slice(0, 3).map((l: any) => (
                          <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                            <div>
                              <p className="text-body font-medium">{l.leaveType}</p>
                              <p className="text-micro text-muted-foreground">
                                {formatDate(l.startDate)} → {formatDate(l.endDate)}
                                {l.workingDays != null ? ` · ${l.workingDays} working day(s)` : ""}
                              </p>
                            </div>
                            <StatusBadge status={l.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardShell>

                  {detail.payroll && (
                    <CardShell className="!p-3">
                      <SectionTitle title="Latest payroll" subtitle={`${detail.payroll.period} · ${detail.payroll.status}`} />
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Kpi label="Net pay" value={formatBDT(detail.payroll.netPay)} sub="last period" />
                        <Kpi label="Deductions" value={formatBDT(detail.payroll.deductions)} sub="total" tone="rose" />
                        <Kpi label="Late cut" value={formatBDT(detail.payroll.lateDeduction)} sub="from attendance" tone="amber" />
                        <Kpi label="Absent cut" value={formatBDT(detail.payroll.absentDeduction)} sub="from attendance" tone="rose" />
                      </div>
                    </CardShell>
                  )}
                </div>
                </>
              ) : null)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "emerald" | "rose" | "amber" | "muted";
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1">
      <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-0.5 font-heading text-section font-bold tabular-nums",
        tone === "emerald" ? "text-emerald-500" : tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : tone === "muted" ? "text-muted-foreground" : ""
      )}>
        {value}
      </p>
      {sub && <p className="text-micro text-muted-foreground">{sub}</p>}
    </div>
  );
}

function BreakdownCard({
  title,
  subtitle,
  rows,
  keyLabel,
  nameKey,
}: {
  title: string;
  subtitle: string;
  rows: { key?: string; name?: string; count: number }[];
  keyLabel: string;
  nameKey?: "name";
}) {
  const list = rows ?? [];
  const max = Math.max(1, ...list.map((r) => r.count));
  return (
    <CardShell>
      <SectionTitle title={title} subtitle={subtitle} icon={<Users className="size-4" />} />
      {list.length === 0 ? (
        <p className="text-meta text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((r) => {
            const name = nameKey ? r.name ?? "—" : r.key ?? "—";
            return (
              <div key={name} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-meta font-semibold capitalize" title={name}>{name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
                <span className="w-6 shrink-0 text-right text-meta font-bold tabular-nums text-muted-foreground">{r.count}</span>
              </div>
            );
          })}
          <p className="pt-0.5 text-micro uppercase tracking-wider text-muted-foreground">{keyLabel}</p>
        </div>
      )}
    </CardShell>
  );
}
