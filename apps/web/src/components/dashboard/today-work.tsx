"use client";

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  FileText,
  HandCoins,
  Inbox,
  ListTodo,
  Sparkles,
} from "lucide-react";
import { CardShell, StatusBadge, cn } from "@/components/shared";
import { formatBDT, formatDay } from "@/lib/format";
import { MiniBars, Ring, SegmentedBar } from "./viz";

/* ────────────────────────────────────────────────────────────────────────────
   Today's work — the part of the dashboard that answers "what do I do next?"
   Numbers first, lists capped at three, every row one click from the action.
   ──────────────────────────────────────────────────────────────────────────── */

const PRIORITY_DOT: Record<string, string> = {
  URGENT: "bg-rose-500",
  HIGH: "bg-amber-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-muted-foreground/40",
};

function TaskRow({ task, dense = false }: { task: any; dense?: boolean }) {
  return (
    <Link
      href="/tasks?mine=true"
      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.LOW)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">{task.title}</span>
        {!dense && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {task.projectName ?? "No project"}
            {task.dueDate ? ` · due ${formatDay(task.dueDate)}` : ""}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
        {String(task.priority ?? "").replace(/_/g, " ")}
      </span>
    </Link>
  );
}

export function TodayWorkBoard({ data, personal, view }: { data: any; personal: any; view: string }) {
  const isEmployee = view === "employee";
  const t = data?.today ?? null;
  const people = data?.moduleInsights?.people;
  const myTasks: any[] = personal?.tasks ?? [];
  const myEvents: any[] = personal?.events ?? [];
  const myLeaves: any[] = personal?.leaves ?? [];

  const due: any[] = isEmployee ? [] : t?.dueTasks ?? [];
  const overdue: any[] = isEmployee ? [] : t?.overdueTasks ?? [];
  const followUps: any[] = isEmployee ? [] : t?.followUps ?? [];
  const payables = t?.payables ?? null;

  const approvals = t?.approvals ?? { expenses: 0, leave: 0, deliverables: 0 };
  const approvalRows = [
    ...(["owner", "admin", "finance"].includes(view)
      ? [{ label: "Expense approvals", value: approvals.expenses, href: "/capital/expenses", icon: <HandCoins className="size-3.5" /> }]
      : []),
    ...(["owner", "admin", "manager", "hr"].includes(view)
      ? [{ label: "Leave requests", value: approvals.leave, href: "/people/leave", icon: <CalendarDays className="size-3.5" /> }]
      : []),
    ...(["owner", "admin", "manager"].includes(view)
      ? [{ label: "Client deliverables", value: approvals.deliverables, href: "/flow", icon: <FileText className="size-3.5" /> }]
      : []),
  ];
  const approvalTotal = approvalRows.reduce((s, a) => s + a.value, 0);
  const showFollowUps = ["owner", "admin", "manager", "sales"].includes(view);

  const personalFocus = myTasks.slice(0, 3);
  const companyFocus = [...overdue.slice(0, 2), ...due].slice(0, 3);
  const focusTasks = personalFocus.length ? personalFocus : isEmployee ? [] : companyFocus;
  const doFirst = focusTasks[0];
  const restTasks = focusTasks.slice(1);

  const team = t?.team ?? { headcount: 0, present: 0, onLeave: 0, absent: 0 };
  const attendanceRate = team.headcount ? Math.round((team.present / team.headcount) * 100) : 0;
  const attention = (t?.overdueCount ?? 0) + approvalTotal + (t?.followUpsCount ?? 0);

  const chips = isEmployee
    ? [
        { label: "Due", value: personal?.tasksDueToday ?? 0, tone: "text-amber-500" },
        { label: "Overdue", value: personal?.tasksOverdue ?? 0, tone: "text-rose-500" },
        { label: "Events", value: myEvents.length, tone: "text-sky-500" },
        { label: "Leave", value: myLeaves.length, tone: "text-muted-foreground" },
      ]
    : [
        { label: "Due", value: t?.dueTodayCount ?? 0, tone: "text-amber-500" },
        { label: "Overdue", value: t?.overdueCount ?? 0, tone: "text-rose-500" },
        { label: "Follow-ups", value: t?.followUpsCount ?? 0, tone: "text-primary" },
        { label: "Approvals", value: approvalTotal, tone: "text-violet-500" },
        { label: "Events", value: t?.eventCount ?? 0, tone: "text-sky-500" },
      ];

  return (
    <CardShell className="relative overflow-hidden !border-primary/25">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-widest text-primary">
            <Sparkles className="size-3" /> Today&apos;s work
          </p>
          <p className="mt-1 font-heading text-[18px] font-bold">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-baseline gap-1 rounded-full border border-border/60 bg-card px-2.5 py-1">
              <span className={cn("text-[13px] font-bold tabular-nums", c.tone)}>{c.value}</span>
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Do first — the single next action */}
      {doFirst ? (
        <Link
          href="/tasks?mine=true"
          className="mt-3 flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-3 py-2 transition-colors hover:bg-rose-500/[0.08]"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
            <ArrowRight className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-[9.5px] font-bold uppercase tracking-widest text-rose-500">Do first</span>
            <span className="block truncate text-[12.5px] font-semibold">{doFirst.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {doFirst.projectName ?? "No project"}
              {doFirst.dueDate ? ` · ${formatDay(doFirst.dueDate)}` : ""}
              {doFirst.assignee ? ` · ${doFirst.assignee}` : ""}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
            {String(doFirst.priority ?? "").replace(/_/g, " ")}
          </span>
        </Link>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 text-[11.5px] text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" /> {attention > 0 ? "No task due today — clear the items on the right." : "You are clear for today. Nice."}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1 — My focus */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <ListTodo className="size-3" /> My focus
            </p>
            <Link href="/tasks?mine=true" className="text-[10px] font-semibold text-primary hover:underline">
              All
            </Link>
          </div>
          {restTasks.length ? (
            <div className="flex flex-col gap-0.5">
              {restTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-emerald-500/5 px-2 py-3 text-[11px] text-emerald-600 dark:text-emerald-400">
              {focusTasks.length === 0 ? "No open tasks assigned to you." : "Nothing else queued — stay on the task above."}
            </p>
          )}
          {myEvents.length > 0 && (
            <div className="mt-2 border-t border-border/50 pt-2">
              <p className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                <CalendarClock className="size-2.5" /> Today&apos;s meetings
              </p>
              {myEvents.slice(0, 2).map((e: any) => (
                <p key={e.id} className="truncate text-[11px] text-muted-foreground">• {e.title}</p>
              ))}
            </div>
          )}
          {data?.moduleInsights?.tasks && (
            <p className="mt-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
              {data.moduleInsights.tasks.completedThisWeek} done this week · {data.moduleInsights.tasks.hoursThisWeek}h logged
            </p>
          )}
        </div>

        {/* 2 — Team pulse (visual) */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {isEmployee ? <CalendarClock className="size-3" /> : <ClipboardList className="size-3" />}
              {isEmployee ? "My schedule" : "Team today"}
            </p>
            <Link href={isEmployee ? "/calendar" : "/people/attendance"} className="text-[10px] font-semibold text-primary hover:underline">
              Open
            </Link>
          </div>

          {isEmployee ? (
            myEvents.length ? (
              <div className="flex flex-col gap-1">
                {myEvents.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                    <span className="flex size-6 items-center justify-center rounded-md bg-sky-500/10 text-sky-500">
                      <CalendarClock className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px]">{e.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-1 py-3 text-[11px] text-muted-foreground">No events today.</p>
            )
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Ring
                  value={attendanceRate}
                  size={64}
                  stroke={7}
                  className={attendanceRate >= 70 ? "text-emerald-500" : attendanceRate >= 40 ? "text-amber-500" : "text-rose-500"}
                  label={`${attendanceRate}%`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold tabular-nums">
                    {team.present} <span className="text-[10px] font-medium text-muted-foreground">of {team.headcount} in</span>
                  </p>
                  <SegmentedBar
                    height={7}
                    showLegend={false}
                    segments={[
                      { label: "present", value: team.present, className: "bg-emerald-500" },
                      { label: "leave", value: team.onLeave, className: "bg-amber-500" },
                      { label: "absent", value: team.absent, className: "bg-rose-500/60" },
                    ]}
                  />
                  <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                    {team.onLeave} on leave · {team.absent} absent
                  </p>
                </div>
              </div>
              {people?.attendance7d && (
                <div className="mt-2 border-t border-border/50 pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Last 7 days</p>
                    <p className="text-[9px] text-muted-foreground">checked in</p>
                  </div>
                  <MiniBars data={people.attendance7d} className="text-primary" height={34} highlightLast />
                </div>
              )}
            </>
          )}
        </div>

        {/* 3 — Approvals & follow-ups */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isEmployee ? <CalendarDays className="size-3" /> : <Inbox className="size-3" />}
            {isEmployee ? "My leave" : "Waiting on you"}
          </p>

          {isEmployee ? (
            myLeaves.length ? (
              <div className="flex flex-col gap-1">
                {myLeaves.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg px-1 py-1.5 text-[11px]">
                    <span className="capitalize">{String(l.leaveType).replace(/_/g, " ").toLowerCase()}</span>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-1 py-3 text-[11px] text-muted-foreground">No pending leave.</p>
            )
          ) : (
            <>
              {approvalRows.length ? (
                <div className="flex flex-col gap-1">
                  {approvalRows.map((a) => (
                    <Link key={a.label} href={a.href} className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-muted/60">
                      <span className={cn("flex size-6 items-center justify-center rounded-md", a.value > 0 ? "bg-violet-500/10 text-violet-500" : "bg-muted text-muted-foreground")}>
                        {a.icon}
                      </span>
                      <span className="flex-1 text-[11.5px]">{a.label}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", a.value > 0 ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
                        {a.value}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-3 text-[11px] text-muted-foreground">Nothing waiting on you.</p>
              )}

              {["owner", "admin", "finance"].includes(view) && payables && (payables.overdueCount > 0 || payables.dueWeekCount > 0) && (
                <Link
                  href="/capital/liabilities"
                  className="mt-1 flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-1.5 py-1.5 transition-colors hover:bg-rose-500/[0.08]"
                >
                  <span className="flex size-6 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
                    <Banknote className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-medium">Vendor payables</span>
                    <span className="block text-[9.5px] text-muted-foreground">
                      {payables.overdueCount > 0
                        ? `${formatBDT(payables.overdueAmount)} overdue`
                        : `${formatBDT(payables.dueWeekAmount)} due within 7 days`}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                    {payables.overdueCount > 0 ? payables.overdueCount : payables.dueWeekCount}
                  </span>
                </Link>
              )}

              {showFollowUps && (
                <div className="mt-2 border-t border-border/50 pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-primary">
                      {t?.followUpsCount ?? 0} follow-up{(t?.followUpsCount ?? 0) === 1 ? "" : "s"} due
                    </p>
                    <Link href="/pulse" className="text-[9px] font-semibold text-primary hover:underline">Pipeline</Link>
                  </div>
                  {followUps.slice(0, 2).map((l: any) => (
                    <Link key={l.id} href="/pulse" className="block truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-primary">
                      • {l.name}
                      {l.company ? ` · ${l.company}` : ""}
                      <span className="ml-1 font-semibold text-foreground/70">{formatBDT(l.estimatedDealSize)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </CardShell>
  );
}
