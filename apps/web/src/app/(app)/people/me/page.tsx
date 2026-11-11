"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays, CheckCircle2, Clock, FileText, Fingerprint,
  ListTodo, LogOut, Plus, Send, Target, Video,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate } from "@/lib/format";
import { Avatar, EmptyState, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";
import type { AttendanceDay } from "@/components/people/attendance-heatmap";
import { DenseCard, PeopleHero } from "../_components/hero";
import { LEAVE_TYPES, label } from "../_components/constants";
import { Toast, useToast } from "../_components/hooks";

const fmtDur = (mins?: number | null) => {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};
const time = (t?: string | null) => (t ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—");

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

/** One row of 30 tiny day cells — the old month grid took 576px. */
const DAY_TONE: Record<string, string> = {
  present: "bg-emerald-500/80",
  late: "bg-amber-500/80",
  half: "bg-orange-500/80",
  absent: "bg-rose-500/80",
  leave: "bg-sky-500/80",
  unrecorded: "bg-slate-400/50 dark:bg-slate-600/60",
  holiday: "bg-violet-500/70",
  off: "bg-muted-foreground/20",
  before: "bg-transparent ring-1 ring-inset ring-border/40",
  future: "bg-transparent ring-1 ring-inset ring-border/60",
};
const DAY_LABEL: Record<string, string> = {
  present: "Present", late: "Late", half: "Half day", absent: "Absent", leave: "Leave",
  unrecorded: "No record", holiday: "Holiday", off: "Weekly off", before: "Before joining", future: "Upcoming",
};

function DayStrip({ days }: { days: AttendanceDay[] }) {
  const last = days.slice(-30);
  if (!last.length) return <span className="text-micro text-muted-foreground">No attendance recorded yet.</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {last.map((d) => (
        <span
          key={d.date}
          title={`${d.date} · ${DAY_LABEL[d.kind] ?? d.kind}${d.checkIn ? ` · in ${time(d.checkIn)}` : ""}${d.checkOut ? ` · out ${time(d.checkOut)}` : ""}${d.workedMinutes != null ? ` · ${fmtDur(d.workedMinutes)}` : ""}`}
          className={cn("size-3.5 rounded-[3px] transition-transform hover:scale-125", DAY_TONE[d.kind] ?? "bg-muted")}
        />
      ))}
    </div>
  );
}

export default function MySpacePage() {
  const { data, loading, error, mutate } = useApi<any>("/people/me");
  const { flash, notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const punch = async (action: "in" | "out") => {
    setBusy(true);
    try {
      await apiFetch("/people/me/punch", { method: "POST", body: JSON.stringify({ action }) });
      notify(action === "in" ? "Checked in — have a good one" : "Checked out — nice work");
      mutate();
    } catch (e: any) {
      notify(e.message ?? "Could not record that");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="flex flex-col gap-3">{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-24" />)}</div>;
  }
  if (error || !data) {
    return <EmptyState title={String(error ?? "No employee record")} hint="Ask HR to link your login to an employee profile (Directory → person → Edit)." />;
  }

  const e = data.employee;
  const t = data.today;
  const s = data.attendance.summary;
  const rate = data.attendance.attendanceRate;
  const days: AttendanceDay[] = data.attendance.days ?? [];
  const leave = data.leave;
  const payroll = data.payroll;
  const leaveLeft = (leave.balances ?? []).reduce((sum: number, b: any) => sum + Number(b.balanceDays ?? 0), 0);
  const nextMeeting = data.meetings.today[0] ?? data.meetings.upcoming[0] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <Toast flash={flash} />

      {/* ── Hero: identity, today, month numbers and the 30-day strip in one card ── */}
      <PeopleHero
        icon={<Fingerprint className="size-4" />}
        title={`${greeting()}, ${e.name.split(" ")[0]}`}
        subtitle={
          <span>
            {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            {" · "}{e.roleTitle}
            {e.department ? ` · ${e.department}` : ""}
            {e.shiftStart ? ` · shift ${e.shiftStart}–${e.shiftEnd ?? "?"}` : ""}
          </span>
        }
        stats={[
          { label: "Attendance", value: rate != null ? `${rate}%` : "—", sub: `${s.present + s.late + s.halfDay}/${Math.max(0, s.working - s.unrecorded)}`, tone: "emerald" },
          { label: "Present", value: s.present, sub: `${s.late} late`, tone: "emerald" },
          { label: "Absent", value: s.absent, sub: `${s.leave} leave`, tone: s.absent > 0 ? "rose" : "default" },
          { label: "Worked", value: fmtDur(s.workedMinutes), sub: `${fmtDur(s.overtimeMinutes)} OT` },
          { label: "Late", value: `${s.lateMinutes}m`, sub: `${s.late}x`, tone: s.lateMinutes > 0 ? "amber" : "default" },
          { label: "Leave left", value: `${leaveLeft}d`, tone: "sky" },
          { label: "Open work", value: data.tasks.open, sub: data.tasks.overdue ? `${data.tasks.overdue} overdue` : "on track", tone: data.tasks.overdue ? "rose" : "default" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <TodayPill today={t} />
            {t.isWorkingDay ? (
              t.inside ? (
                <Btn variant="outline" onClick={() => punch("out")} disabled={busy} className="!px-2.5 !py-1.5 text-meta text-rose-500">
                  <LogOut className="size-3.5" /> {busy ? "…" : "Check out"}
                </Btn>
              ) : (
                <Btn variant="primary" onClick={() => punch("in")} disabled={busy} className="!px-2.5 !py-1.5 text-meta">
                  <Fingerprint className="size-3.5" /> {busy ? "…" : t.checkOut ? "Check in again" : "Check in"}
                </Btn>
              )
            ) : (
              <span className="rounded-lg bg-muted px-2.5 py-1.5 text-micro font-semibold text-muted-foreground">
                {t.holiday ? `Holiday · ${t.holiday}` : "Weekly off"}
              </span>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/30 px-2.5 py-1.5">
          <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">My days</span>
          <DayStrip days={days} />
          <span className="ml-auto text-micro text-muted-foreground">last 30 days · hover a day</span>
          <Link href="/people/team" className="text-micro font-bold text-primary hover:underline">History</Link>
        </div>
      </PeopleHero>

      {/* ── Dense grid: everything the old stacked cards held, in two short rows ── */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <DenseCard
          title="Recent days"
          hint="check-in → out → worked"
          icon={<Clock className="size-4" />}
          action={<Link href="/people/team" className="text-micro font-bold text-primary hover:underline">All</Link>}
        >
          <div className="flex flex-col gap-1">
            {days.filter((d) => !["future", "off", "before"].includes(d.kind)).slice(-4).reverse().map((d) => (
              <div key={d.date} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
                <span className="text-meta font-medium">{formatDate(d.date)}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-micro tabular-nums text-muted-foreground">{time(d.checkIn)}→{time(d.checkOut)}</span>
                  {["present", "late", "half", "absent"].includes(d.kind) ? (
                    <StatusBadge status={d.status ?? (d.kind === "half" ? "HALF_DAY" : d.kind.toUpperCase())} />
                  ) : d.kind === "unrecorded" ? (
                    <span className="rounded-full bg-muted px-1.5 py-px text-micro font-bold text-muted-foreground">no record</span>
                  ) : (
                    <span className="rounded-full bg-sky-500/10 px-1.5 py-px text-micro font-bold capitalize text-sky-500">{d.kind}</span>
                  )}
                  <span className="w-10 text-right text-micro font-bold tabular-nums">{fmtDur(d.workedMinutes)}</span>
                </span>
              </div>
            ))}
            {days.filter((d) => !["future", "off", "before"].includes(d.kind)).length === 0 && (
              <p className="py-2 text-meta text-muted-foreground">No days recorded yet.</p>
            )}
          </div>
        </DenseCard>

        <DenseCard
          title="My work"
          hint={`${data.tasks.open} open · ${data.tasks.dueToday} due today`}
          icon={<ListTodo className="size-4" />}
          action={<Link href={`/tasks?assignee=${e.id}`} className="text-micro font-bold text-primary hover:underline">Board</Link>}
        >
          {data.tasks.list.length === 0 ? (
            <p className="py-2 text-meta text-muted-foreground">Nothing assigned. Enjoy the quiet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {data.tasks.list.slice(0, 3).map((task: any) => {
                const overdue = task.dueDate && new Date(task.dueDate).getTime() < Date.now();
                return (
                  <Link
                    key={task.id}
                    href={`/tasks?task=${task.id}`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-2 py-1 transition-colors hover:border-primary/40",
                      overdue ? "border-rose-500/30 bg-rose-500/5" : "border-border/60"
                    )}
                  >
                    <span className="min-w-0 truncate text-meta font-medium">{task.title}</span>
                    <span className={cn("shrink-0 text-micro tabular-nums", overdue ? "font-semibold text-rose-500" : "text-muted-foreground")}>
                      {task.dueDate ? formatDate(task.dueDate) : "no due"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </DenseCard>

        <DenseCard
          title="Meetings"
          hint={nextMeeting ? `next · ${time(nextMeeting.at)}` : "today & upcoming"}
          icon={<Video className="size-4" />}
        >
          {data.meetings.today.length === 0 && data.meetings.upcoming.length === 0 ? (
            <p className="py-2 text-meta text-muted-foreground">No meetings booked.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {data.meetings.today.slice(0, 2).map((m: any) => <MeetingRow key={m.id} m={m} today />)}
              {data.meetings.upcoming.slice(0, 1).map((m: any) => <MeetingRow key={m.id} m={m} />)}
            </div>
          )}
        </DenseCard>

        <DenseCard
          title="Leave"
          hint="balances & requests"
          icon={<CalendarDays className="size-4" />}
          action={<Btn variant="outline" onClick={() => setLeaveOpen(true)} className="!px-2 !py-1 text-micro"><Plus className="size-3.5" /> Request</Btn>}
        >
          <div className="mb-1.5 flex flex-wrap gap-1">
            {leave.balances.length === 0 && <span className="text-micro text-muted-foreground">No balances yet.</span>}
            {leave.balances.map((b: any) => (
              <span key={b.leaveType} className={cn(
                "rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums",
                Number(b.balanceDays) <= 2 ? "bg-amber-500/10 text-amber-600 dark:text-amber-300" : "bg-muted text-foreground"
              )}>
                {label(b.leaveType)} · {b.balanceDays}d
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {leave.requests.slice(0, 2).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
                <span className="min-w-0 truncate text-micro">
                  <span className="font-medium">{label(l.leaveType)}</span>
                  <span className="text-muted-foreground"> · {formatDate(l.startDate)}</span>
                </span>
                <StatusBadge status={l.status} />
              </div>
            ))}
            {leave.requests.length === 0 && <p className="text-micro text-muted-foreground">No leave applied for.</p>}
          </div>
        </DenseCard>

        <DenseCard title="Payslip" hint="latest salary statement" icon={<FileText className="size-4" />}>
          {!payroll.latest ? (
            <p className="py-2 text-meta text-muted-foreground">No payslip yet.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-gradient-soft px-2.5 py-1.5">
                <div>
                  <p className="text-micro font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">Net · {payroll.latest.period}</p>
                  <p className="font-heading text-section font-extrabold tabular-nums text-violet-800 dark:text-violet-200">{formatBDT(payroll.latest.netPay)}</p>
                </div>
                <Link href={`/people/payroll/payslip/${payroll.latest.id}`} className="text-micro font-bold text-primary hover:underline">View</Link>
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {payroll.history.slice(1, 3).map((p: any) => (
                  <Link key={p.id} href={`/people/payroll/payslip/${p.id}`} className="flex items-center justify-between rounded px-1 text-micro hover:bg-muted/60">
                    <span className="text-muted-foreground">{p.period}</span>
                    <span className="font-semibold tabular-nums">{formatBDT(p.netPay)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </DenseCard>

        <DenseCard title="My goals" hint="quarter progress" icon={<Target className="size-4" />}>
          {data.okrs.length === 0 ? (
            <p className="py-2 text-meta text-muted-foreground">No OKRs assigned.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.okrs.slice(0, 3).map((o: any) => (
                <div key={o.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-meta font-medium">{o.title}</p>
                    <span className="shrink-0 text-micro font-bold tabular-nums text-muted-foreground">{Math.round(o.progress ?? 0)}%</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", (o.progress ?? 0) >= 70 ? "bg-emerald-500" : (o.progress ?? 0) >= 40 ? "bg-amber-400" : "bg-rose-500")} style={{ width: `${Math.min(o.progress ?? 0, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </DenseCard>

        <DenseCard title="Telegram" hint="your day in chat" icon={<Send className="size-4" />}>
          <SelfTelegram linked={data.telegram.linked} username={data.telegram.username} notify={notify} reload={mutate} />
        </DenseCard>
      </div>

      <SelfLeaveModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onSaved={() => { notify("Leave requested — your approver has been notified"); mutate(); }}
      />
    </div>
  );
}

function TodayPill({ today }: { today: any }) {
  if (!today.status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-micro font-semibold text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" /> Not checked in
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-semibold",
        today.inside ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-border bg-card text-muted-foreground"
      )}>
        <span className={cn("size-1.5 rounded-full", today.inside ? "bg-emerald-500" : "bg-muted-foreground/50")} />
        {today.inside ? `In since ${time(today.checkIn)}` : `In ${time(today.checkIn)} · out ${time(today.checkOut)}`}
      </span>
      {today.punches > 2 && <span className="text-micro text-muted-foreground">{today.punches} punches</span>}
    </span>
  );
}

function MeetingRow({ m, today }: { m: any; today?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
      <div className="min-w-0">
        <p className="truncate text-meta font-medium">{m.title}</p>
        <p className="text-micro text-muted-foreground">
          {today ? time(m.at) : formatDate(m.at)} · {m.mins}m{m.company ? ` · ${m.company}` : ""}
        </p>
      </div>
      {m.link ? (
        <a href={m.link} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-micro font-semibold text-primary hover:border-primary/40">
          Join
        </a>
      ) : (
        <span className="shrink-0 text-micro text-muted-foreground">{today ? "today" : ""}</span>
      )}
    </div>
  );
}

function SelfTelegram({ linked, username, notify, reload }: { linked: boolean; username?: string | null; notify: (m: string) => void; reload: () => void }) {
  const [code, setCode] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setCode(await apiFetch("/people/me/telegram", { method: "POST" }));
    } catch (e: any) {
      notify(e.message ?? "Could not create a link");
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const off = async () => {
    if (!window.confirm("Disconnect Telegram from your account?")) return;
    setBusy(true);
    try {
      await apiFetch("/people/me/telegram", { method: "DELETE" });
      notify("Telegram disconnected");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not disconnect");
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 px-2 py-1.5">
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-meta font-semibold text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" /> Connected{username ? ` · @${username}` : ""}
          </span>
          <span className="block truncate text-micro text-muted-foreground">Reminders arrive in chat.</span>
        </span>
        <Btn variant="ghost" onClick={off} disabled={busy} className="!px-2 !py-1 text-micro text-rose-500 hover:bg-rose-500/10">Off</Btn>
      </div>
    );
  }

  if (code?.deepLink) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-micro text-muted-foreground">Open once in Telegram · expires in {code.ttlMinutes}m.</p>
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-micro">{code.deepLink}</code>
          <Btn variant="outline" onClick={async () => { await navigator.clipboard.writeText(code.deepLink).catch(() => null); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }} className="!px-2 !py-1 text-micro">
            {copied ? "Copied" : "Copy"}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-micro text-muted-foreground">Not connected. One tap to link.</p>
      <Btn variant="outline" onClick={generate} disabled={busy} className="!px-2 !py-1 text-micro"><Send className="size-3.5" /> {busy ? "…" : "Connect"}</Btn>
    </div>
  );
}

function SelfLeaveModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ leaveType: "CASUAL", startDate: "", endDate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setErr(null); setF({ leaveType: "CASUAL", startDate: "", endDate: "" }); }
  }, [open]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!f.startDate || !f.endDate) { setErr("Pick both dates"); return; }
    if (f.endDate < f.startDate) { setErr("End date must be on or after the start date"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/people/me/leave", { method: "POST", body: JSON.stringify(f) });
      setF({ leaveType: "CASUAL", startDate: "", endDate: "" });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Request leave">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Leave type">
          <Select value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date *"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End date *"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        {err && <p className="text-body font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Submit request" />
      </form>
    </Modal>
  );
}
