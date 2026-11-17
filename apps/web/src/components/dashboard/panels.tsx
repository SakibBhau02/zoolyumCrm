"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Flame,
  Gauge,
  HandCoins,
  LineChart,
  PieChart,
  Target,
  TrendingUp,
  Users,
  Workflow,
} from "lucide-react";
import { formatBDT, formatDay } from "@/lib/format";
import { Money } from "@/lib/privacy";
import { StatusBadge, cn } from "@/components/shared";
import { RevenueAreaChart } from "@/components/charts";
import { MiniBars, Sparkline } from "./viz";
import { Figure, Panel, PanelLink, Pill, severityTone } from "./primitives";

/* ────────────────────────────────────────────────────────────────────────────
   The "why" layer: cash, aging, concentration, capacity, completeness, pipeline
   and delivery. Each panel answers one question and ends with a next step.
   ──────────────────────────────────────────────────────────────────────────── */

const healthTone = (level: string) =>
  level === "critical" || level === "DELAYED"
    ? severityTone("critical")
    : level === "warning" || level === "AT_RISK"
      ? severityTone("warning")
      : severityTone("ok");

/* ── Cash & revenue ───────────────────────────────────────────────────────── */

export function CashRevenuePanel({ capital, period }: { capital: any; period: any }) {
  const invoiced = Number(capital?.periodInvoiced ?? 0);
  const collected = Number(capital?.periodCollected ?? 0);
  const expenses = Number(capital?.periodExpenses ?? 0);
  const net = Number(capital?.periodNet ?? invoiced - expenses);
  const margin = Number(capital?.periodMargin ?? 0);
  const target = capital?.targetForPeriod ? Number(capital.targetForPeriod) : null;
  const progress = capital?.targetProgress;
  const trend = capital?.revenueTrend ?? [];

  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const projection =
    period?.key === "month" && dayOfMonth > 0
      ? Math.round((invoiced / dayOfMonth) * daysInMonth)
      : null;

  return (
    <Panel
      title="Cash & revenue"
      subtitle={`${period?.label ?? "This month"} · cash in hand ${formatBDT(capital?.cashPosition ?? 0)}`}
      icon={<LineChart className="size-3.5" />}
      action={<PanelLink href="/capital/reports">Statements</PanelLink>}
      definition="Invoiced is what was billed in the period; collected is cash received; net is invoiced minus approved expenses. The target comes from Control → Finance."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure value={<Money value={invoiced} />} label="Invoiced" hint={target ? `${progress ?? 0}% of target` : undefined} />
        <Figure
          value={<Money value={collected} />}
          label="Collected"
          tone="text-emerald-600 dark:text-emerald-400"
          hint={`${Math.round((collected / Math.max(invoiced, 1)) * 100)}% of invoiced`}
        />
        <Figure value={<Money value={expenses} />} label="Expenses" hint="approved only" />
        <Figure
          value={<Money value={net} />}
          label="Net"
          tone={net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          hint={`${margin}% margin`}
        />
      </div>

      {target != null && (
        <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2 text-meta">
            <span className="font-semibold">Revenue vs target</span>
            <span className="tabular-nums text-muted-foreground">
              <Money value={invoiced} /> / <Money value={target} />
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-border/60">
            <div
              className={cn(
                "h-full rounded-full",
                (progress ?? 0) >= 100 ? "bg-emerald-500" : (progress ?? 0) >= 70 ? "bg-primary" : "bg-amber-500"
              )}
              style={{ width: `${Math.min(100, Math.max(2, progress ?? 0))}%` }}
            />
          </div>
          {projection != null && (
            <p className="mt-1 text-micro text-muted-foreground">
              At this pace the month ends near <Money value={projection} className="font-semibold text-foreground" />.
            </p>
          )}
        </div>
      )}

      <div className="mt-3">
        {trend.length > 0 ? (
          <RevenueAreaChart data={trend} height={170} />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-meta text-muted-foreground">
            No monthly snapshots yet — the first full month will draw this chart.
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ── AR aging ─────────────────────────────────────────────────────────────── */

const AGING_COLORS = ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-rose-500"];

export function ARAgingPanel({ capital }: { capital: any }) {
  const buckets: any[] = capital?.aging ?? [];
  const total = Number(capital?.agingTotal ?? 0);
  const worst = Number(capital?.agingWorstAmount ?? 0);
  const worstCount = Number(capital?.agingWorstCount ?? 0);
  const dso = capital?.dsoDays;
  const max = Math.max(...buckets.map((b) => Number(b.amount)), 1);

  return (
    <Panel
      title="Receivables aging"
      subtitle={`Outstanding ${formatBDT(capital?.outstanding ?? 0)} · DSO ${dso != null ? `${dso}d` : "—"}`}
      icon={<HandCoins className="size-3.5" />}
      tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
      action={<PanelLink href="/capital/invoices">Invoices</PanelLink>}
      definition="Every open invoice bucketed by days past its due date. DSO = outstanding ÷ revenue in the period × days in the period."
    >
      <div className="flex flex-col gap-2.5">
        {buckets.map((bucket, i) => {
          const amount = Number(bucket.amount);
          return (
            <div key={bucket.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-meta text-muted-foreground">
                  {bucket.label} days · {bucket.count} invoice{bucket.count === 1 ? "" : "s"}
                </span>
                <Money value={amount} className="text-body font-semibold" />
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", AGING_COLORS[i])}
                  style={{ width: `${amount > 0 ? Math.max(3, (amount / max) * 100) : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <span className="text-meta text-muted-foreground">
          Total <Money value={total} className="font-semibold text-foreground" />
          {Number(capital?.agingNotDue ?? 0) > 0 && (
            <span className="block text-micro">
              includes <Money value={capital.agingNotDue} /> not yet due
            </span>
          )}
        </span>
        {worstCount > 0 ? (
          <Pill level={worst >= 100000 ? "critical" : "warning"}>
            {worstCount} over 90d · {formatBDT(worst)}
          </Pill>
        ) : (
          <Pill level="ok">Nothing past 90 days</Pill>
        )}
      </div>
    </Panel>
  );
}

/* ── Client concentration ─────────────────────────────────────────────────── */

export function ConcentrationPanel({ concentration }: { concentration: any }) {
  const rows: any[] = concentration?.top ?? concentration?.top3 ?? [];
  const level = concentration?.level ?? "ok";
  const tone = severityTone(level === "critical" ? "critical" : level === "warning" ? "warning" : "ok");
  const max = Math.max(...rows.map((r) => Number(r.share)), 1);

  return (
    <Panel
      title="Clients & concentration"
      subtitle={`Top 3 ${concentration?.top3Share ?? 0}% · top 1 ${concentration?.top1Share ?? 0}% of revenue`}
      icon={<PieChart className="size-3.5" />}
      action={<PanelLink href="/accounts">Clients</PanelLink>}
      definition={`Above ${concentration?.warnAt ?? 50}% from three clients is a concentration warning; above ${concentration?.criticalAt ?? 60}% it is critical. Revenue = recognized invoice value.`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Pill level={level === "critical" ? "critical" : level === "warning" ? "warning" : "ok"}>
          {level === "critical" ? "High dependence" : level === "warning" ? "Watch closely" : "Healthy spread"}
        </Pill>
        <span className="text-micro text-muted-foreground">
          <Money value={concentration?.totalRevenue ?? 0} /> recognised
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-meta text-muted-foreground">No recognised client revenue yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((client) => (
            <div key={client.id}>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/accounts?client=${client.id}`} className="flex min-w-0 items-center gap-1.5 hover:text-primary">
                  <span className="truncate text-meta font-medium">{client.name}</span>
                  {client.healthLevel && <StatusBadge status={client.healthLevel} />}
                </Link>
                <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                  {client.share}% · <Money value={client.revenue} />
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", tone.dot)} style={{ width: `${Math.max(3, (client.share / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── Capacity heatmap ─────────────────────────────────────────────────────── */

const utilTone = (value: number | null) => {
  if (value == null) return "bg-muted/40";
  if (value > 105) return "bg-rose-500/80";
  if (value < 50) return "bg-sky-500/50";
  if (value < 80) return "bg-emerald-500/70";
  return "bg-amber-500/80";
};

export function CapacityPanel({ capacity }: { capacity: any }) {
  const weeks: any[] = capacity?.weeks ?? [];
  const rows: any[] = capacity?.rows ?? [];

  return (
    <Panel
      title="Team capacity"
      subtitle={capacity?.hasData ? "Utilisation by week — red is over 105%" : "No utilisation logged yet"}
      icon={<Users className="size-3.5" />}
      tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
      action={<PanelLink href="/people/utilization">Utilisation</PanelLink>}
      definition="Billable hours ÷ available hours per week, from People → Utilisation. Off-days and approved leave are already excluded."
    >
      {!capacity?.hasData || rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-3">
          <p className="text-meta text-muted-foreground">
            Log time or run a utilisation sync to see who is overloaded this month.
          </p>
          <Link href="/people/utilization" className="inline-flex items-center gap-1 text-meta font-semibold text-primary hover:underline">
            Open utilisation <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-[64px] pb-1 text-left text-micro font-semibold uppercase tracking-wider text-muted-foreground">Team</th>
                  {weeks.map((w) => (
                    <th key={w.key} className="pb-1 text-center text-micro font-medium tabular-nums text-muted-foreground" title={w.label}>
                      {w.key.slice(8, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((row) => (
                  <tr key={row.id}>
                    <td className="truncate pr-1 text-meta" title={`${row.name} · ${row.role}`}>
                      {row.name.split(" ")[0]}
                    </td>
                    {weeks.map((w) => {
                      const value = row.values[w.key] ?? null;
                      return (
                        <td key={w.key} className="text-center">
                          <span
                            title={`${row.name} · ${w.label} · ${value == null ? "no data" : `${value}%`}`}
                            className={cn(
                              "flex h-6 w-full items-center justify-center rounded-[4px] text-micro font-bold tabular-nums",
                              utilTone(value),
                              value != null && value >= 80 ? "text-white" : "text-foreground/70"
                            )}
                          >
                            {value == null ? "·" : value}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-micro text-muted-foreground">
            <span>
              {weeks[0]?.label} – {weeks[weeks.length - 1]?.label}
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-sky-500/60" /> &lt;50%</span>
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-emerald-500" /> 50–79%</span>
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500" /> 80–105%</span>
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-rose-500" /> &gt;105%</span>
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ── Data completeness ────────────────────────────────────────────────────── */

export function CompletenessPanel({ completeness }: { completeness: any }) {
  const score = Number(completeness?.score ?? 0);
  const checks: any[] = completeness?.checks ?? [];
  const failing = checks.filter((c) => c.count > 0);

  return (
    <Panel
      title="Data quality"
      subtitle={`${score}% complete — numbers are only as good as their inputs`}
      icon={<Gauge className="size-3.5" />}
      tone={score >= 85 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}
      action={<PanelLink href="/control">Fix</PanelLink>}
      definition="Checks budgets, estimates, lead next-actions and time logging. Each gap links to the list that needs the missing field."
    >
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", score >= 85 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500")}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>
      {failing.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-3 text-meta text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" /> Every record has the fields it needs.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {failing.map((check) => (
            <li key={check.key}>
              <Link
                href={check.href}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-meta transition-colors hover:bg-muted/60"
              >
                <span className="truncate text-muted-foreground">{check.label}</span>
                <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 text-micro font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {check.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Pipeline funnel ──────────────────────────────────────────────────────── */

const stageLabel = (s: string) =>
  String(s)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function PipelineFunnelPanel({ pulse }: { pulse: any }) {
  const stages: any[] = pulse?.leadsByStage ?? [];
  const open = stages.filter((s) => !["WON", "LOST"].includes(String(s.stage).toUpperCase()));
  const max = Math.max(...open.map((s) => Number(s.value)), 1);
  const totalValue = open.reduce((sum, s) => sum + Number(s.value), 0);
  const totalCount = open.reduce((sum, s) => sum + Number(s.count), 0);

  return (
    <Panel
      title="Pipeline"
      subtitle={`${formatBDT(totalValue)} open · ${totalCount} leads · ${formatBDT(pulse?.weightedForecast ?? 0)} weighted`}
      icon={<Target className="size-3.5" />}
      action={<PanelLink href="/pulse">Pipeline</PanelLink>}
      definition="Stage value excludes Won and Lost. Conversion compares a stage with the one before it."
    >
      {open.length === 0 ? (
        <p className="py-6 text-center text-meta text-muted-foreground">No open leads yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((stage, i) => {
            const value = Number(stage.value);
            const previous = i > 0 ? Number(open[i - 1].count) : null;
            const raw = previous ? Math.round((Number(stage.count) / Math.max(previous, 1)) * 100) : null;
            const conversion = raw == null ? null : Math.min(raw, 100);
            return (
              <div key={stage.stage} className="group">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-meta font-medium">{stageLabel(stage.stage)}</span>
                  <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                    {stage.count} · <Money value={value} />
                    {conversion != null && <span className="ml-1 text-micro">{conversion}%</span>}
                  </span>
                </div>
                <div className="mt-1 h-3 overflow-hidden rounded-[4px] bg-muted">
                  <div
                    className="h-full rounded-[4px] bg-gradient-to-r from-primary/80 to-primary"
                    style={{ width: `${value > 0 ? Math.max(3, (value / max) * 100) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-meta">
        <span className="text-muted-foreground">
          Won {pulse?.won ?? 0} · Lost {pulse?.lost ?? 0}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="size-3.5" /> <Money value={pulse?.weightedForecast ?? 0} />
        </span>
      </div>
    </Panel>
  );
}

/* ── Project health ───────────────────────────────────────────────────────── */

export function ProjectHealthPanel({ flow }: { flow: any }) {
  const counts = flow?.healthStatusCounts ?? {};
  const atRisk: any[] = flow?.atRisk ?? [];
  const tiles = [
    { key: "ON_TRACK", label: "On track", value: counts.ON_TRACK ?? 0, tone: severityTone("ok") },
    { key: "AT_RISK", label: "At risk", value: counts.AT_RISK ?? 0, tone: severityTone("warning") },
    { key: "DELAYED", label: "Delayed", value: counts.DELAYED ?? 0, tone: severityTone("critical") },
  ];

  return (
    <Panel
      title="Project health"
      subtitle={`${flow?.activeProjects ?? 0} active · avg risk ${flow?.avgRisk ?? 0} · ${flow?.onTimeRate ?? 0}% on time`}
      icon={<Workflow className="size-3.5" />}
      tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
      action={<PanelLink href="/flow">All projects</PanelLink>}
      definition="Project health is one state per project: On track / At risk / Delayed. The three counts always add up to active projects."
    >
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className={cn("rounded-xl px-2.5 py-2", tile.tone.tile)}>
            <p className="font-heading text-stat font-bold leading-none tabular-nums">{tile.value}</p>
            <p className="mt-1 truncate text-micro font-semibold uppercase tracking-wider">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {atRisk.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-3 text-meta text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> No project needs intervention.
          </div>
        ) : (
          atRisk.slice(0, 4).map((project) => {
            const tone = healthTone(project.healthStatus);
            return (
              <Link
                key={project.id}
                href={`/flow?project=${project.id}`}
                className="flex items-center gap-2.5 rounded-xl border border-border/50 px-2.5 py-2 transition-colors hover:bg-muted/40"
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", tone.tile)}>
                  <Flame className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{project.name}</span>
                  <span className="block truncate text-micro text-muted-foreground">
                    {String(project.healthStatus).replace(/_/g, " ").toLowerCase()}
                    {project.riskScore != null ? ` · risk ${project.riskScore}` : ""}
                    {project.riskDriver ? ` · ${project.riskDriver}` : ""}
                  </span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              </Link>
            );
          })
        )}
      </div>
    </Panel>
  );
}

/* ── Today's work (compact) ───────────────────────────────────────────────── */

const PRIORITY_DOT: Record<string, string> = {
  URGENT: "bg-rose-500",
  HIGH: "bg-amber-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-muted-foreground/40",
};

export function TodaysWorkPanel({ data, personal }: { data: any; personal: any }) {
  const today = data?.today ?? {};
  const events: any[] = personal?.events ?? today.events ?? [];
  const tasks: any[] = (personal?.tasks ?? []).length ? personal.tasks : today.dueTasks ?? [];
  const approvals = today.approvals ?? {};
  const approvalTotal = (approvals.expenses ?? 0) + (approvals.leave ?? 0) + (approvals.deliverables ?? 0);
  const followUps = today.followUpsCount ?? 0;
  const overdue = personal?.tasksOverdue ?? today.overdueCount ?? 0;

  const chips = [
    { label: "Due today", value: today.dueTodayCount ?? tasks.length, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Overdue", value: overdue, tone: "text-rose-600 dark:text-rose-400" },
    { label: "Follow-ups", value: followUps, tone: "text-primary" },
    { label: "Approvals", value: approvalTotal, tone: "text-violet-600 dark:text-violet-400" },
  ];

  return (
    <Panel
      title="Today"
      subtitle={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
      icon={<CalendarClock className="size-3.5" />}
      action={<PanelLink href="/tasks?mine=true">My tasks</PanelLink>}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {chips.map((chip) => (
          <div key={chip.label} className="rounded-lg bg-muted/50 px-1.5 py-1.5 text-center">
            <p className={cn("font-heading text-section font-bold leading-none tabular-nums", chip.tone)}>{chip.value}</p>
            <p className="mt-1 truncate text-micro text-muted-foreground">{chip.label}</p>
          </div>
        ))}
      </div>

      <p className="mb-1 mt-3 text-micro font-bold uppercase tracking-wider text-muted-foreground">Do first</p>
      <div className="flex flex-col gap-0.5">
        {tasks.slice(0, 3).map((task: any) => (
          <Link
            key={task.id}
            href={`/tasks?task=${task.id}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.LOW)} />
            <span className="min-w-0 flex-1 truncate text-body font-medium">{task.title}</span>
            <span className="shrink-0 text-micro text-muted-foreground">{formatDay(task.dueDate)}</span>
          </Link>
        ))}
        {tasks.length === 0 && (
          <p className="rounded-lg bg-emerald-500/5 px-2.5 py-2 text-meta text-emerald-600 dark:text-emerald-400">
            Nothing assigned to you today.
          </p>
        )}
      </div>

      {events.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-micro font-bold uppercase tracking-wider text-muted-foreground">Calendar</p>
          <div className="flex flex-col gap-1">
            {events.slice(0, 2).map((event: any) => (
              <div key={event.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1.5">
                <CalendarClock className="size-3.5 shrink-0 text-sky-500" />
                <span className="min-w-0 flex-1 truncate text-meta font-medium">{event.title}</span>
                <span className="shrink-0 text-micro capitalize text-muted-foreground">
                  {String(event.type ?? "event").replace(/_/g, " ").toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ── KPI strip helpers ────────────────────────────────────────────────────── */

export function kpiSpark(points: number[] | undefined, fallback: number[] = [0, 0]) {
  const data = (points ?? []).filter((n) => Number.isFinite(n));
  return data.length > 1 ? data : fallback;
}

export function cashRunwayTone(months: number | null | undefined) {
  if (months == null) return "text-muted-foreground";
  if (months < 3) return "text-rose-600 dark:text-rose-400";
  if (months < 6) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export function smallBars(points: number[] | undefined) {
  const data = (points ?? []).slice(-6);
  if (data.length < 2) return null;
  return <Sparkline points={data} height={22} className="text-primary/70" />;
}

export function quarterlyBars(points: number[] | undefined) {
  const data = (points ?? []).slice(-6).map((value, i) => ({ label: String(i + 1), value }));
  if (data.length < 2) return null;
  return <MiniBars data={data} height={22} className="text-primary/60" />;
}
