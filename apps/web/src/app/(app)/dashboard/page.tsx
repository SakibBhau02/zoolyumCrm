"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Flame,
  HandCoins,
  Landmark,
  ListTodo,
  Plus,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth";
import { formatBDT, formatDate, formatDay, formatNumber, timeAgo } from "@/lib/format";
import { Money, MaskAmounts } from "@/lib/privacy";
import {
  EmptyState,
  FadeIn,
  SkeletonBlock,
  StatusBadge,
  cn,
} from "@/components/shared";
import { PaymentDonut } from "@/components/charts";
import { MyDayWidget } from "@/components/my-day-widget";
import { TeamAttendanceBoard } from "@/components/team-attendance-board";
import { BusinessHealth, ModuleBoard } from "@/components/dashboard/glance";
import { ActionCenter } from "@/components/dashboard/action-center";
import {
  ARAgingPanel,
  CapacityPanel,
  CashRevenuePanel,
  CompletenessPanel,
  ConcentrationPanel,
  PipelineFunnelPanel,
  ProjectHealthPanel,
  TodaysWorkPanel,
  cashRunwayTone,
  kpiSpark,
} from "@/components/dashboard/panels";
import { Figure, KpiCard, Panel, PanelLink, Pill } from "@/components/dashboard/primitives";

/* ────────────────────────────────────────────────────────────────────────────
   Dashboard — decision-first, one shell, one payload per role.

   Reading order on every view: status → change → problem → action → why → who
   → record. The period switcher and the metric definitions are shared, so two
   cards can never quote different versions of the same number.
   ──────────────────────────────────────────────────────────────────────────── */

type View = "owner" | "admin" | "finance" | "manager" | "hr" | "sales" | "employee";
type Period = "month" | "quarter" | "year";

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

const PERIOD_KEY = "zoolyum-dashboard-period";

const VIEW_LABEL: Record<View, string> = {
  owner: "Owner command center",
  admin: "Administrator",
  finance: "Finance desk",
  manager: "Delivery & team",
  hr: "People operations",
  sales: "Revenue pipeline",
  employee: "My workspace",
};

const compact = (n: any) => formatBDT(Number(n ?? 0));

const trendSeries = (trend: any[], key: "invoiced" | "collected" | "expenses") =>
  (trend ?? []).map((m) => Number(m[key] ?? 0));

/* ── Header ───────────────────────────────────────────────────────────────── */

function Header({
  data,
  userName,
  period,
  onPeriod,
  onRefresh,
  refreshing,
}: {
  data: any;
  userName?: string;
  period: Period;
  onPeriod: (p: Period) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const view: View = data.view ?? "employee";
  const c = data.capital ?? {};
  const today = data.today ?? {};
  const flow = data.flow ?? {};
  const pulse = data.pulse ?? {};

  const brief = useMemo(() => {
    const parts: string[] = [];
    const overdueCount = c.overdueInvoices?.length ?? 0;
    const approvals =
      (today.approvals?.expenses ?? 0) +
      (today.approvals?.leave ?? 0) +
      (today.approvals?.deliverables ?? 0);
    if (overdueCount) parts.push(`${overdueCount} invoice${overdueCount === 1 ? "" : "s"} overdue (${compact(c.overdueAmount)})`);
    if (flow.atRisk?.length) parts.push(`${flow.atRisk.length} project${flow.atRisk.length === 1 ? "" : "s"} at risk`);
    if (approvals) parts.push(`${approvals} approval${approvals === 1 ? "" : "s"} waiting`);
    if (today.followUpsCount) parts.push(`${today.followUpsCount} follow-up${today.followUpsCount === 1 ? "" : "s"} due`);
    if (parts.length) return parts.join(" · ") + ".";
    if (view === "sales") return `${pulse.activeLeads ?? 0} open leads · every one has a next action.`;
    if (view === "employee") return "Your day is clear — nothing overdue, nothing waiting on you.";
    return "Everything is within bounds — pipeline, delivery and cash are on track.";
  }, [c.overdueAmount, c.overdueInvoices, flow.atRisk, pulse.activeLeads, today.approvals, today.followUpsCount, view]);

  const actions =
    view === "owner" || view === "admin" ? (
      <>
        <QuickAction href="/capital/invoices" label="Invoice" icon={<ReceiptText className="size-4" />} primary />
        <QuickAction href="/pulse?tab=pipeline" label="Lead" icon={<Zap className="size-4" />} />
        <QuickAction href="/tasks" label="Task" icon={<Plus className="size-4" />} />
      </>
    ) : view === "finance" ? (
      <>
        <QuickAction href="/capital/invoices" label="Invoice" icon={<ReceiptText className="size-4" />} primary />
        <QuickAction href="/capital/expenses" label="Expense" icon={<Wallet className="size-4" />} />
      </>
    ) : view === "manager" ? (
      <>
        <QuickAction href="/tasks" label="Task" icon={<Plus className="size-4" />} primary />
        <QuickAction href="/flow" label="Projects" icon={<Workflow className="size-4" />} />
      </>
    ) : view === "hr" ? (
      <>
        <QuickAction href="/people" label="People" icon={<Users className="size-4" />} primary />
        <QuickAction href="/people/leave" label="Leave" icon={<CalendarClock className="size-4" />} />
      </>
    ) : view === "sales" ? (
      <>
        <QuickAction href="/pulse?tab=pipeline" label="Lead" icon={<Zap className="size-4" />} primary />
        <QuickAction href="/accounts" label="Clients" icon={<Building2 className="size-4" />} />
      </>
    ) : (
      <>
        <QuickAction href="/tasks?mine=true" label="My tasks" icon={<ListTodo className="size-4" />} primary />
        <QuickAction href="/people/leave" label="Leave" icon={<CalendarDays className="size-4" />} />
      </>
    );

  return (
    <FadeIn>
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-primary">
              <Sparkles className="size-3.5" /> {VIEW_LABEL[view]}
            </span>
            <span className="text-micro text-muted-foreground">
              Updated {timeAgo(data.generatedAt)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center rounded-xl border border-border bg-muted/40 p-0.5" role="group" aria-label="Reporting period">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onPeriod(p.key)}
                    aria-pressed={period === p.key}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-micro font-bold transition-colors",
                      period === p.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Refresh dashboard"
                className="flex size-8 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-page font-bold tracking-tight sm:text-hero">
                {greeting()}, {userName?.split(" ")[0] ?? "there"}
              </h1>
              <p className="mt-1 max-w-2xl text-body leading-relaxed text-muted-foreground">
                <MaskAmounts text={brief} />
              </p>
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function QuickAction({
  href,
  label,
  icon,
  primary,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-meta font-semibold transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border/70 bg-card text-foreground hover:border-primary/40 hover:bg-primary/5"
      )}
    >
      {icon} {label}
    </Link>
  );
}

/* ── KPI strips ───────────────────────────────────────────────────────────── */

function OwnerKpis({ data }: { data: any }) {
  const c = data.capital ?? {};
  const flow = data.flow ?? {};
  const pulse = data.pulse ?? {};
  const trend = c.revenueTrend ?? [];
  const atRisk = flow.atRisk?.length ?? 0;
  const runway = c.runwayMonths;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="Revenue"
        value={<Money value={c.periodRevenue ?? 0} />}
        hint={c.targetForPeriod ? `${c.targetProgress ?? 0}% of ${compact(c.targetForPeriod)}` : "No target set"}
        delta={c.revenueDelta}
        deltaSuffix=" vs prev."
        icon={<CircleDollarSign className="size-4" />}
        href="/capital/reports"
        spark={kpiSpark(trendSeries(trend, "invoiced"))}
        sparkTone="text-primary"
        definition="Revenue recognised in the selected period (invoice value excluding pass-through costs). The target is Control → Finance → Monthly revenue target."
      />
      <KpiCard
        label="Collected"
        value={<Money value={c.periodCollected ?? 0} />}
        hint={`${Math.round((Number(c.periodCollected ?? 0) / Math.max(Number(c.periodInvoiced ?? 0), 1)) * 100)}% of invoiced`}
        delta={c.collectedDelta}
        icon={<HandCoins className="size-4" />}
        href="/capital/income"
        spark={kpiSpark(trendSeries(trend, "collected"))}
        sparkTone="text-emerald-500"
        tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        definition="Cash actually received in the period (payments, net of refunds)."
      />
      <KpiCard
        label="Overdue"
        value={<Money value={c.overdueAmount ?? 0} />}
        hint={`${c.overdueInvoices?.length ?? 0} invoice${(c.overdueInvoices?.length ?? 0) === 1 ? "" : "s"} past due`}
        icon={<AlertTriangle className="size-4" />}
        href="/capital/invoices"
        tone="bg-rose-500/10 text-rose-600 dark:text-rose-400"
        status={
          (c.overdueInvoices?.length ?? 0) > 0 ? (
            <Pill level={(c.agingWorstAmount ?? 0) > 0 ? "critical" : "warning"}>
              {(c.agingWorstCount ?? 0) > 0 ? `${c.agingWorstCount} over 90d` : "Chase today"}
            </Pill>
          ) : (
            <Pill level="ok">Within terms</Pill>
          )
        }
        definition="Unpaid balance whose due date has passed. Every number opens the invoice list."
      />
      <KpiCard
        label="Cash & runway"
        value={<Money value={c.cashPosition ?? 0} />}
        hint={
          runway != null
            ? `${runway} mo · ${compact(c.monthlyBurn ?? 0)}/mo`
            : "Add fixed cost in Control"
        }
        icon={<Landmark className="size-4" />}
        href="/capital/accounts"
        tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
        status={
          runway != null ? (
            <span className={cn("text-meta font-semibold", cashRunwayTone(runway))}>
              {runway < 3 ? "Critical runway" : runway < 6 ? "Watch runway" : "Healthy runway"}
            </span>
          ) : undefined
        }
        definition="Bank + wallet balances. Runway = cash ÷ average monthly spend (trailing three months, or the fixed cost in Control, whichever is higher)."
      />
      <KpiCard
        label="Pipeline"
        value={<Money value={pulse.weightedForecast ?? 0} />}
        hint={`${pulse.activeLeads ?? 0} active · ${compact(pulse.pipelineValue ?? 0)} open`}
        icon={<Target className="size-4" />}
        href="/pulse"
        spark={kpiSpark((pulse.leadsByStage ?? []).map((s: any) => Number(s.value ?? 0)))}
        sparkTone="text-primary"
        definition="Open lead value × stage probability. Excludes Won and Lost."
      />
      <KpiCard
        label="At risk"
        value={formatNumber(atRisk)}
        hint={`${flow.activeProjects ?? 0} active · ${flow.healthStatusCounts?.DELAYED ?? 0} delayed`}
        icon={<Flame className="size-4" />}
        href="/flow"
        tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        status={
          atRisk > 0 ? (
            <Pill level={atRisk > 2 ? "critical" : "warning"}>Needs action</Pill>
          ) : (
            <Pill level="ok">All on track</Pill>
          )
        }
        definition="Projects whose health is At risk or Delayed. The list, with the reason, is in the Project health panel."
      />
    </div>
  );
}

function FinanceKpis({ data }: { data: any }) {
  const c = data.capital ?? {};
  const trend = c.revenueTrend ?? [];
  const collectionRate = Math.round(
    (Number(c.periodCollected ?? 0) / Math.max(Number(c.periodInvoiced ?? 0), 1)) * 100
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="Collected" value={<Money value={c.periodCollected ?? 0} />} hint="cash received" delta={c.collectedDelta} icon={<HandCoins className="size-4" />} href="/capital/income" spark={kpiSpark(trendSeries(trend, "collected"))} sparkTone="text-emerald-500" />
      <KpiCard label="Overdue" value={<Money value={c.overdueAmount ?? 0} />} hint={`${c.overdueInvoices?.length ?? 0} invoices`} icon={<AlertTriangle className="size-4" />} href="/capital/invoices" tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      <KpiCard label="Outstanding" value={<Money value={c.outstanding ?? 0} />} hint={`DSO ${c.dsoDays != null ? `${c.dsoDays}d` : "—"}`} icon={<ReceiptText className="size-4" />} href="/capital/invoices" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
      <KpiCard label="Cash & runway" value={<Money value={c.cashPosition ?? 0} />} hint={c.runwayMonths != null ? `${c.runwayMonths} months` : "Set fixed cost"} icon={<Landmark className="size-4" />} href="/capital/accounts" tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" />
      <KpiCard label="Expenses" value={<Money value={c.periodExpenses ?? 0} />} hint={`${c.pendingExpenses ?? 0} pending approval`} delta={c.expensesDelta} goodWhenUp={false} icon={<Wallet className="size-4" />} href="/capital/expenses" />
      <KpiCard label="Collection rate" value={`${collectionRate}%`} hint="of invoiced · includes backlog" icon={<TrendingUp className="size-4" />} href="/capital/reports" spark={kpiSpark(trendSeries(trend, "collected"))} sparkTone="text-emerald-500" tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
    </div>
  );
}

function ManagerKpis({ data }: { data: any }) {
  const flow = data.flow ?? {};
  const tasks = data.tasks ?? {};
  const people = data.people ?? {};
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="Active projects" value={flow.activeProjects ?? 0} hint={`${flow.totalProjects ?? 0} total`} icon={<Workflow className="size-4" />} href="/flow" />
      <KpiCard label="At risk" value={flow.atRisk?.length ?? 0} hint={`${flow.healthStatusCounts?.DELAYED ?? 0} delayed`} icon={<Flame className="size-4" />} href="/flow" tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      <KpiCard label="Open tasks" value={tasks.openTasks ?? 0} hint={`${tasks.hoursThisWeek ?? 0}h logged`} icon={<ClipboardList className="size-4" />} href="/tasks" tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" />
      <KpiCard label="Due today" value={tasks.dueToday ?? 0} hint={`${tasks.overdue ?? 0} overdue`} icon={<CalendarClock className="size-4" />} href="/tasks" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
      <KpiCard label="Capacity" value={`${people.avgUtilization ?? 0}%`} hint={`${people.overloaded ?? 0} overloaded`} icon={<Users className="size-4" />} href="/people/utilization" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
      <KpiCard label="Blocked" value={tasks.blocked ?? 0} hint="waiting on a reason" icon={<AlertTriangle className="size-4" />} href="/tasks" />
    </div>
  );
}

function PeopleKpis({ data }: { data: any }) {
  const people = data.people ?? {};
  const personal = data.personal ?? {};
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="Employees" value={people.totalEmployees ?? 0} hint="active roster" icon={<Users className="size-4" />} href="/people" />
      <KpiCard label="Present" value={people.presentToday ?? 0} hint="checked in today" icon={<Users className="size-4" />} href="/people/attendance" tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
      <KpiCard label="On leave" value={people.onLeaveToday ?? 0} hint="approved today" icon={<CalendarClock className="size-4" />} href="/people/leave" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
      <KpiCard label="Utilization" value={`${people.avgUtilization ?? 0}%`} hint="team average" icon={<TrendingUp className="size-4" />} href="/people/utilization" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
      <KpiCard label="Overloaded" value={people.overloaded ?? 0} hint="over 105%" icon={<Flame className="size-4" />} href="/people/utilization" tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      <KpiCard label="Pending leave" value={personal.leaves?.length ?? 0} hint="awaiting decision" icon={<ClipboardList className="size-4" />} href="/people/leave" />
    </div>
  );
}

function SalesKpis({ data }: { data: any }) {
  const pulse = data.pulse ?? {};
  const personal = data.personal ?? {};
  const myOpen = (personal.leads ?? []).filter((l: any) => !["WON", "LOST"].includes(l.stage));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="My pipeline" value={<Money value={myOpen.reduce((s: number, l: any) => s + Number(l.estimatedDealSize ?? 0), 0)} />} hint={`${myOpen.length} open leads`} icon={<Target className="size-4" />} href="/pulse" />
      <KpiCard label="Weighted forecast" value={<Money value={pulse.weightedForecast ?? 0} />} hint="company-wide" icon={<TrendingUp className="size-4" />} href="/pulse" tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
      <KpiCard label="Active leads" value={pulse.activeLeads ?? 0} hint={`${pulse.hotLeads ?? 0} hot`} icon={<Zap className="size-4" />} href="/pulse" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
      <KpiCard label="Follow-ups" value={personal.followUpsDueCount ?? 0} hint="due now" icon={<CalendarClock className="size-4" />} href="/pulse" tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      <KpiCard label="My tasks" value={personal.tasks?.length ?? 0} hint={`${personal.tasksDueToday ?? 0} due today`} icon={<ListTodo className="size-4" />} href="/tasks?mine=true" tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" />
      <KpiCard label="Won" value={pulse.won ?? 0} hint={`${pulse.lost ?? 0} lost`} icon={<Trophy className="size-4" />} href="/pulse" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
    </div>
  );
}

function EmployeeKpis({ data }: { data: any }) {
  const personal = data.personal ?? {};
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard label="My tasks" value={personal.tasks?.length ?? 0} hint="assigned to me" icon={<ListTodo className="size-4" />} href="/tasks?mine=true" />
      <KpiCard label="Due today" value={personal.tasksDueToday ?? 0} hint="finish these first" icon={<CalendarClock className="size-4" />} href="/tasks?mine=true" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
      <KpiCard label="Overdue" value={personal.tasksOverdue ?? 0} hint="past due" icon={<AlertTriangle className="size-4" />} href="/tasks?mine=true" tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      <KpiCard label="Follow-ups" value={personal.followUpsDueCount ?? 0} hint="leads needing a call" icon={<Zap className="size-4" />} href="/pulse" tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" />
      <KpiCard label="Today's events" value={personal.events?.length ?? 0} hint="meetings & deadlines" icon={<CalendarDays className="size-4" />} href="/calendar" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
    </div>
  );
}

/* ── Supporting panels (finance / people) ─────────────────────────────────── */

function PaymentMixPanel({ capital }: { capital: any }) {
  return (
    <Panel
      title="Payment mix"
      subtitle="How clients actually paid"
      icon={<Banknote className="size-3.5" />}
      action={<PanelLink href="/capital/income">Income</PanelLink>}
    >
      {capital?.paymentSplit?.length ? (
        <PaymentDonut data={capital.paymentSplit} />
      ) : (
        <p className="py-6 text-center text-meta text-muted-foreground">No payments recorded yet.</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
        <Figure value={<Money value={capital?.cashPosition ?? 0} />} label="Cash position" />
        <Figure value={capital?.pendingExpenses ?? 0} label="Pending expenses" />
      </div>
    </Panel>
  );
}

function ActivityPanel({ items }: { items: any[] }) {
  return (
    <Panel title="Activity" subtitle="Portal, tasks & system" icon={<Clock className="size-3.5" />} tone="bg-muted text-muted-foreground">
      {items.length === 0 ? (
        <p className="text-meta text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.slice(0, 6).map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.kind === "portal" ? "bg-primary" : item.kind === "task" ? "bg-sky-500" : "bg-emerald-500")} />
              <div className="min-w-0">
                <p className="line-clamp-2 text-meta leading-snug">{item.text}</p>
                <p className="text-micro text-muted-foreground">{timeAgo(item.at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MyTasksPanel({ personal }: { personal: any }) {
  const tasks: any[] = personal?.tasks ?? [];
  return (
    <Panel title="My tasks" subtitle="Nearest due first" icon={<ListTodo className="size-3.5" />} action={<PanelLink href="/tasks?mine=true">All tasks</PanelLink>}>
      {tasks.length === 0 ? (
        <p className="rounded-xl bg-emerald-500/5 px-3 py-3 text-meta text-emerald-600 dark:text-emerald-400">No open tasks assigned to you.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {tasks.slice(0, 6).map((task) => (
            <Link key={task.id} href={`/tasks?task=${task.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
              <span className="min-w-0 flex-1 truncate text-body font-medium">{task.title}</span>
              <span className="shrink-0 text-micro text-muted-foreground">{formatDay(task.dueDate)}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MyLeavePanel({ personal }: { personal: any }) {
  const leaves: any[] = personal?.leaves ?? [];
  return (
    <Panel title="My leave" subtitle="Requests & decisions" icon={<CalendarDays className="size-3.5" />} action={<PanelLink href="/people/leave">Apply</PanelLink>}>
      {leaves.length === 0 ? (
        <p className="text-meta text-muted-foreground">No pending leave requests.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {leaves.map((leave) => (
            <div key={leave.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-meta">
              <span className="font-medium capitalize">{String(leave.leaveType).replace(/_/g, " ").toLowerCase()}</span>
              <span className="text-muted-foreground">{formatDate(leave.startDate)} → {formatDate(leave.endDate)}</span>
              <StatusBadge status={leave.status} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── Collapsible launcher & personal day ──────────────────────────────────── */

function Collapsible({
  title,
  subtitle,
  children,
  defaultOpen = false,
  icon,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">{title}</span>
          <span className="block truncate text-micro text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border/60 p-3 sm:p-4">{children}</div>}
    </section>
  );
}

/* ── Root ─────────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PERIOD_KEY);
      if (saved === "month" || saved === "quarter" || saved === "year") setPeriod(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const { data, loading, mutate } = useApi<any>(`/dashboard/home?period=${period}`);

  const changePeriod = (next: Period) => {
    setPeriod(next);
    try {
      localStorage.setItem(PERIOD_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    mutate();
    setTimeout(() => setRefreshing(false), 700);
  };

  if (loading && !data) return <DashboardSkeleton />;

  if (!data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        hint="The API could not be reached. Check that the server is running, then refresh."
      />
    );
  }

  const view: View = data.view ?? "employee";
  const personal = data.personal ?? {};
  const isOwner = view === "owner" || view === "admin";

  return (
    <div className="flex flex-col gap-4">
      <Header
        data={data}
        userName={user?.name}
        period={period}
        onPeriod={changePeriod}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {isOwner ? <OwnerKpis data={data} /> : null}
      {view === "finance" ? <FinanceKpis data={data} /> : null}
      {view === "manager" ? <ManagerKpis data={data} /> : null}
      {view === "hr" ? <PeopleKpis data={data} /> : null}
      {view === "sales" ? <SalesKpis data={data} /> : null}
      {view === "employee" ? <EmployeeKpis data={data} /> : null}

      {/* Z3 — health + action: the two blocks that answer "am I safe / what now" */}
      {view !== "employee" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <FadeIn delay={0.04}>
            <div className="flex flex-col gap-4">
              {data.scorecard && <BusinessHealth scorecard={data.scorecard} alerts={data.alerts} />}
            </div>
          </FadeIn>
          <FadeIn delay={0.08} className="xl:col-span-2">
            <ActionCenter data={data} onChanged={mutate} />
          </FadeIn>
        </div>
      )}

      {isOwner && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><TodaysWorkPanel data={data} personal={personal} /></FadeIn>
            <FadeIn delay={0.08} className="xl:col-span-2">
              <CashRevenuePanel capital={data.capital} period={data.period} />
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <FadeIn delay={0.04}><PipelineFunnelPanel pulse={data.pulse} /></FadeIn>
            <FadeIn delay={0.08}><ProjectHealthPanel flow={data.flow} /></FadeIn>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <FadeIn delay={0.04}><ARAgingPanel capital={data.capital} /></FadeIn>
            <FadeIn delay={0.06}><ConcentrationPanel concentration={data.concentration} /></FadeIn>
            <FadeIn delay={0.08}><CapacityPanel capacity={data.capacity} /></FadeIn>
            <FadeIn delay={0.1}><CompletenessPanel completeness={data.completeness} /></FadeIn>
          </div>
        </>
      )}

      {view === "finance" && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04} className="xl:col-span-2">
              <CashRevenuePanel capital={data.capital} period={data.period} />
            </FadeIn>
            <FadeIn delay={0.08}><ARAgingPanel capital={data.capital} /></FadeIn>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><ConcentrationPanel concentration={data.concentration} /></FadeIn>
            <FadeIn delay={0.06}><PaymentMixPanel capital={data.capital} /></FadeIn>
            <FadeIn delay={0.08}><CompletenessPanel completeness={data.completeness} /></FadeIn>
          </div>
        </>
      )}

      {view === "manager" && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><ProjectHealthPanel flow={data.flow} /></FadeIn>
            <FadeIn delay={0.06}><PipelineFunnelPanel pulse={data.pulse} /></FadeIn>
            <FadeIn delay={0.08}><CapacityPanel capacity={data.capacity} /></FadeIn>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><TodaysWorkPanel data={data} personal={personal} /></FadeIn>
            <FadeIn delay={0.06}><CompletenessPanel completeness={data.completeness} /></FadeIn>
            <FadeIn delay={0.08}><ActivityPanel items={data.recentActivity ?? []} /></FadeIn>
          </div>
        </>
      )}

      {view === "hr" && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04} className="xl:col-span-2"><CapacityPanel capacity={data.capacity} /></FadeIn>
            <FadeIn delay={0.08}><CompletenessPanel completeness={data.completeness} /></FadeIn>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <FadeIn delay={0.04}><TodaysWorkPanel data={data} personal={personal} /></FadeIn>
            <FadeIn delay={0.06}><MyLeavePanel personal={personal} /></FadeIn>
          </div>
        </>
      )}

      {view === "sales" && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04} className="xl:col-span-2"><PipelineFunnelPanel pulse={data.pulse} /></FadeIn>
            <FadeIn delay={0.08}><ConcentrationPanel concentration={data.concentration ?? emptyConcentration()} /></FadeIn>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><TodaysWorkPanel data={data} personal={personal} /></FadeIn>
            <FadeIn delay={0.06}><CompletenessPanel completeness={data.completeness} /></FadeIn>
            <FadeIn delay={0.08}><MyTasksPanel personal={personal} /></FadeIn>
          </div>
          <FadeIn delay={0.04}><ActivityPanel items={data.recentActivity ?? []} /></FadeIn>
        </>
      )}

      {view === "employee" && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <FadeIn delay={0.04}><TodaysWorkPanel data={data} personal={personal} /></FadeIn>
            <FadeIn delay={0.08} className="xl:col-span-2"><MyTasksPanel personal={personal} /></FadeIn>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <FadeIn delay={0.04}><MyLeavePanel personal={personal} /></FadeIn>
            <FadeIn delay={0.08}>
              <Panel title="My attendance" subtitle="Clock in, clock out, worked hours" icon={<Clock className="size-3.5" />} action={<PanelLink href="/people/me">Open</PanelLink>}>
                <MyDayWidget userName={user?.name} />
              </Panel>
            </FadeIn>
          </div>
        </>
      )}

      {/* Z5 — modules, ordered by what needs attention. Collapsed by default. */}
      {data.moduleInsights && Object.keys(data.moduleInsights).length > 0 && (
        <Collapsible
          title="All modules"
          subtitle={`${Object.keys(data.moduleInsights).length} modules · open a card for the breakdown`}
          icon={<ClipboardList className="size-4" />}
        >
          <ModuleBoard modules={data.moduleInsights} moduleAlerts={data.moduleAlerts} full={data} />
        </Collapsible>
      )}

      {/* Z6 — record & personal, collapsed so they never compete with decisions. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Collapsible
          title="Activity feed"
          subtitle="What happened recently — alerts are in the Action Center"
          icon={<Clock className="size-4" />}
        >
          <ActivityPanel items={data.recentActivity ?? []} />
        </Collapsible>
        <Collapsible
          title="My day & team attendance"
          subtitle="Time clock, punches and who is in today"
          icon={<Users className="size-4" />}
        >
          <div className="flex flex-col gap-4">
            <MyDayWidget userName={user?.name} />
            <TeamAttendanceBoard />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

/** Sales payload omits concentration; keep the panel honest instead of blank. */
function emptyConcentration() {
  return {
    top3Share: 0,
    top1Share: 0,
    top3: [],
    level: "ok",
    warnAt: 50,
    criticalAt: 60,
  };
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonBlock className="h-36 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-32" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64 xl:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-72 xl:col-span-2" />
      </div>
    </div>
  );
}


