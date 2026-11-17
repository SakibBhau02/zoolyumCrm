"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Globe2,
  HandCoins,
  Info,
  ListTodo,
  Settings2,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { CardShell, cn } from "@/components/shared";
import { Modal } from "@/components/ui";
import { formatBDT, formatDate, formatDay, formatNumber } from "@/lib/format";
import { MeterRow, MiniBars, Ring, SegmentedBar, Sparkline } from "./viz";

/* ────────────────────────────────────────────────────────────────────────────
   The dashboard's decision layer.

   Everything here is server-scoped: a role only receives the modules and
   alerts it is allowed to see, so the UI never has to hide sensitive numbers.
   ──────────────────────────────────────────────────────────────────────────── */

type Severity = "critical" | "warning" | "info";

const SEV: Record<Severity, { label: string; dot: string; text: string; tile: string; border: string }> = {
  critical: {
    label: "Critical",
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    border: "border-rose-500/30",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30",
  },
  info: {
    label: "Info",
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    border: "border-sky-500/30",
  },
};

function alertMetric(a: any) {
  if (a.kind === "money") return formatBDT(a.metric);
  if (a.kind === "percent") return `${Math.round(a.metric)}%`;
  if (a.kind === "ratio") return `${a.metric}x`;
  return formatNumber(a.metric);
}

function scoreTone(score: number) {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-rose-500";
}

/* ── Business health ──────────────────────────────────────────────────────── */

export function BusinessHealth({ scorecard, alerts }: { scorecard: any; alerts?: any[] }) {
  if (!scorecard) return null;
  const { score, grade, components } = scorecard;
  const tone = scoreTone(score);
  const barTone = (v: number) => (v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-rose-500");
  const counts = {
    critical: (alerts ?? []).filter((a) => a.severity === "critical").length,
    warning: (alerts ?? []).filter((a) => a.severity === "warning").length,
    info: (alerts ?? []).filter((a) => a.severity === "info").length,
  };
  const lowest = [...components].sort((a: any, b: any) => a.value - b.value)[0];

  return (
    <CardShell className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-primary/5 blur-2xl" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-widest text-muted-foreground">
            <ShieldAlert className="size-3.5" /> Business health
          </p>
          <p className="mt-0.5 text-meta text-muted-foreground">Weighted from cash, delivery, team &amp; clients</p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide", score >= 80 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : score >= 60 ? SEV.warning.tile : SEV.critical.tile)}>
          {grade}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Ring value={score} size={92} stroke={7} label={String(score)} sublabel="/ 100" className={tone} />
        <div className="min-w-0 flex-1 space-y-2.5">
          {components.map((c: any) => (
            <div key={c.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-micro text-muted-foreground">{c.label}</span>
                <span className="text-meta font-bold tabular-nums">{Math.round(c.value)}</span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", barTone(c.value))} style={{ width: `${Math.max(2, Math.min(100, c.value))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Signals</span>
        {(Object.keys(counts) as Severity[]).map((s) => (
          <span key={s} className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-bold tabular-nums", SEV[s].tile)}>
            <span className={cn("size-1.5 rounded-full", SEV[s].dot)} />
            {counts[s]} {SEV[s].label.toLowerCase()}
          </span>
        ))}
      </div>

      {lowest && (
        <div className="mt-auto pt-3">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Biggest drag</p>
          <p className="mt-1 rounded-xl bg-muted/50 px-2.5 py-2 text-meta">
            <span className="font-semibold text-foreground">{lowest.label}</span>
            <span className="text-muted-foreground"> is pulling the score down ({Math.round(lowest.value)}/100).</span>
          </p>
        </div>
      )}
    </CardShell>
  );
}

/* ── Decision queue ───────────────────────────────────────────────────────── */

export function DecisionQueue({ alerts }: { alerts: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const list = alerts ?? [];
  const counts = {
    critical: list.filter((a) => a.severity === "critical").length,
    warning: list.filter((a) => a.severity === "warning").length,
    info: list.filter((a) => a.severity === "info").length,
  };
  const visible = expanded ? list : list.slice(0, 4);

  return (
    <CardShell className="relative overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-widest text-muted-foreground">
            <AlertTriangle className="size-3.5" /> Needs attention
          </p>
          <p className="mt-0.5 text-meta text-muted-foreground">Ranked by severity, then impact — act top-down.</p>
        </div>
        <div className="flex items-center gap-1">
          {(["critical", "warning", "info"] as Severity[]).map((s) =>
            counts[s] ? (
              <span key={s} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold tabular-nums", SEV[s].tile)}>
                <span className={cn("size-1.5 rounded-full", SEV[s].dot)} />
                {counts[s]}
              </span>
            ) : null
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-4 text-body text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" /> Nothing is on fire. Keep the momentum.
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {visible.map((a) => {
            const sev = SEV[a.severity as Severity] ?? SEV.info;
            return (
              <Link
                key={a.id}
                href={a.href}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", sev.tile)}>
                  <span className={cn("size-2 rounded-full", sev.dot)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-body font-semibold">{a.label}</span>
                    <span className={cn("shrink-0 text-body-lg font-bold tabular-nums", sev.text)}>{alertMetric(a)}</span>
                  </span>
                  <span className="block truncate text-meta text-muted-foreground">{a.hint}</span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 text-micro font-semibold text-primary sm:flex">
                  {a.action}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
          {list.length > 4 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 self-start rounded-lg px-2 py-1 text-micro font-semibold text-primary hover:underline"
            >
              {expanded ? "Show less" : `Show all ${list.length} signals`}
            </button>
          )}
        </div>
      )}
    </CardShell>
  );
}

/* ── Module board ─────────────────────────────────────────────────────────── */

type ModuleDef = {
  key: string;
  title: string;
  subtitle: string;
  href: string;
  icon: ReactNode;
  tile: string;
  accent: string;
  primary: (m: any) => { value: ReactNode; label: string };
  viz: (m: any) => ReactNode;
  /** Short caption above the mini chart — what the marks represent. */
  vizLabel: (m: any) => string;
  /** Optional right-hand hint (peak, range, last value). */
  vizHint?: (m: any) => string;
  note: (m: any) => string;
};

/** Pipeline stages are too long for a 42px-tall mini chart. */
const shortStage = (s: string) => {
  const key = s.toUpperCase().replace(/\s+/g, "_");
  return (
    ({
      NEW: "New",
      CONTACTED: "Cont.",
      QUALIFIED: "Qual.",
      PROPOSAL_SENT: "Prop.",
      NEGOTIATION: "Neg.",
      WON: "Won",
      LOST: "Lost",
    } as Record<string, string>)[key] ?? s.replace(/_/g, " ").slice(0, 6)
  );
};

const MODULES: ModuleDef[] = [
  {
    key: "pulse",
    title: "Pulse",
    subtitle: "CRM & pipeline",
    href: "/pulse",
    icon: <Zap className="size-4" />,
    tile: "bg-primary/10 text-primary",
    accent: "text-primary",
    primary: (m) => ({ value: m.activeLeads, label: "active leads" }),
    viz: (m) => (
      <MiniBars
        data={(m.leadsByStage ?? []).slice(0, 7).map((s: any) => ({ label: shortStage(s.stage), value: s.count }))}
        className="text-primary"
        height={42}
        showLabels
      />
    ),
    vizLabel: () => "Leads by stage",
    vizHint: (m) => {
      const top = [...(m.leadsByStage ?? [])].sort((a: any, b: any) => b.count - a.count)[0];
      return top ? `peak ${top.count} · ${shortStage(top.stage)}` : "";
    },
    note: (m) => `${m.hotLeads} hot · ${m.staleLeads} stale · ${m.followUpsDue} to follow up`,
  },
  {
    key: "accounts",
    title: "Accounts",
    subtitle: "Clients & health",
    href: "/accounts",
    icon: <Building2 className="size-4" />,
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    accent: "text-sky-500",
    primary: (m) => ({ value: `${m.avgHealth}`, label: "avg health / 100" }),
    viz: (m) => (
      <SegmentedBar
        height={8}
        segments={[
          { label: "healthy", value: m.green, className: "bg-emerald-500" },
          { label: "watch", value: m.yellow, className: "bg-amber-500" },
          { label: "at risk", value: m.red, className: "bg-rose-500" },
        ]}
      />
    ),
    vizLabel: () => "Client health mix",
    vizHint: (m) => `${(m.green ?? 0) + (m.yellow ?? 0) + (m.red ?? 0)} clients`,
    note: (m) => `${m.renewals30} renewals 30d · ${m.churnRisks} churn risk`,
  },
  {
    key: "flow",
    title: "Flow",
    subtitle: "Projects & delivery",
    href: "/flow",
    icon: <Workflow className="size-4" />,
    tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    accent: "text-violet-500",
    primary: (m) => ({ value: m.active, label: "active projects" }),
    viz: (m) => (
      <SegmentedBar
        height={8}
        segments={[
          { label: "on track", value: m.onTrack, className: "bg-emerald-500" },
          { label: "at risk", value: m.atRisk, className: "bg-amber-500" },
          { label: "delayed", value: m.delayed, className: "bg-rose-500" },
        ]}
      />
    ),
    vizLabel: () => "Delivery health",
    vizHint: (m) => `${m.active} active`,
    note: (m) => `${m.upcomingMilestones} milestones 30d${m.onTimeRate != null ? ` · ${m.onTimeRate}% on time` : ""}`,
  },
  {
    key: "tasks",
    title: "Tasks",
    subtitle: "Work in progress",
    href: "/tasks",
    icon: <ListTodo className="size-4" />,
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    accent: "text-emerald-500",
    primary: (m) => ({ value: m.open, label: "open tasks" }),
    viz: (m) => (
      <MiniBars
        data={[
          { label: "To do", value: m.byStatus?.TODO ?? 0 },
          { label: "Doing", value: m.byStatus?.IN_PROGRESS ?? 0 },
          { label: "Review", value: m.byStatus?.REVIEW ?? 0 },
          { label: "Blocked", value: m.byStatus?.BLOCKED ?? 0 },
        ]}
        className="text-emerald-500"
        height={42}
        showLabels
      />
    ),
    vizLabel: () => "Tasks by status",
    vizHint: (m) => `${m.open} open · ${m.overdue} overdue`,
    note: (m) => `${m.overdue} overdue · ${m.completedThisWeek} done this week`,
  },
  {
    key: "people",
    title: "People",
    subtitle: "Team & attendance",
    href: "/people",
    icon: <Users className="size-4" />,
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    accent: "text-amber-500",
    primary: (m) => ({ value: m.present, label: `of ${m.headcount} checked in` }),
    viz: (m) => <MiniBars data={m.attendance7d ?? []} className="text-amber-500" height={42} highlightLast showLabels />,
    vizLabel: () => "Checked in · last 7 days",
    vizHint: (m) => `${m.attendanceRate}% today`,
    note: (m) => `${m.attendanceRate}% today · ${m.utilization}% utilization · ${m.pendingLeave} leave`,
  },
  {
    key: "capital",
    title: "Capital",
    subtitle: "Cash & collections",
    href: "/capital",
    icon: <Wallet className="size-4" />,
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    accent: "text-emerald-500",
    primary: (m) => ({ value: formatBDT(m.collected), label: "collected" }),
    viz: (m) => (
      <Sparkline
        points={(m.trend ?? []).map((t: any) => t.value)}
        className={m.trend?.length > 1 && m.trend[m.trend.length - 1].value >= m.trend[0].value ? "text-emerald-500" : "text-rose-500"}
        height={42}
      />
    ),
    vizLabel: () => "Collected trend",
    vizHint: (m) => ((m.trend ?? []).length > 1 ? `${m.trend[0].label} → ${m.trend[m.trend.length - 1].label}` : "no history"),
    note: (m) => `${formatBDT(m.outstanding)} due · ${formatBDT(m.overdue)} overdue`,
  },
  {
    key: "liabilities",
    title: "Liabilities",
    subtitle: "Vendor payables",
    href: "/capital/liabilities",
    icon: <HandCoins className="size-4" />,
    tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    accent: "text-orange-500",
    primary: (m) => ({ value: formatBDT(m.totalOwed ?? m.payable), label: "total owed to vendors" }),
    viz: (m) => (
      <SegmentedBar
        height={8}
        segments={[
          { label: "paid", value: m.paid, className: "bg-emerald-500" },
          { label: "open", value: Math.max((m.payable ?? 0) - (m.overdue ?? 0), 0), className: "bg-amber-500" },
          { label: "overdue", value: m.overdue, className: "bg-rose-500" },
        ]}
      />
    ),
    vizLabel: () => "Paid / open / overdue",
    vizHint: (m) => `${m.vendors ?? 0} vendors`,
    note: (m) =>
      `${formatBDT(m.overdue ?? 0)} overdue · ${formatBDT(m.dueWeek ?? 0)} due 7d · ${m.vendors ?? 0} vendors`,
  },
  {
    key: "dollar",
    title: "Dollar Desk",
    subtitle: "FX sales & spread",
    href: "/capital/dollar",
    icon: <CircleDollarSign className="size-4" />,
    tile: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    accent: "text-teal-500",
    primary: (m) => ({ value: formatBDT(m.profitMtd ?? 0), label: "dollar profit this month" }),
    viz: (m) => <MiniBars data={m.monthly ?? []} className="text-teal-500" height={42} highlightLast showLabels />,
    vizLabel: () => "Profit · last 6 months",
    vizHint: (m) => `${m.marginMtd ?? 0}% margin`,
    note: (m) =>
      `$${formatNumber(Math.round(m.usdMtd ?? 0))} sold · ${m.marginMtd ?? 0}% margin · rate ৳${m.costRate ?? 130}`,
  },
  {
    key: "insight",
    title: "Insight",
    subtitle: "Ads & analytics",
    href: "/insight",
    icon: <Sparkles className="size-4" />,
    tile: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    accent: "text-fuchsia-500",
    primary: (m) => ({ value: m.adRoas != null ? `${m.adRoas}x` : "—", label: "ad return (ROAS)" }),
    viz: (m) => <MiniBars data={m.adTrend ?? []} className="text-fuchsia-500" height={42} highlightLast showLabels />,
    vizLabel: () => "Ad spend · 6 months",
    vizHint: (m) => (m.adRoas != null ? `${m.adRoas}x ROAS` : ""),
    note: (m) => `${formatBDT(m.adSpend)} spent MTD · ${formatNumber(m.adConversions)} conversions`,
  },
  {
    key: "calendar",
    title: "Calendar",
    subtitle: "Meetings & milestones",
    href: "/calendar",
    icon: <CalendarDays className="size-4" />,
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    accent: "text-sky-500",
    primary: (m) => ({ value: m.todayEvents, label: "events today" }),
    viz: (m) => <MiniBars data={m.next7 ?? []} className="text-sky-500" height={42} showLabels />,
    vizLabel: () => "Events · next 7 days",
    vizHint: (m) => `${m.todayEvents} today`,
    note: (m) => `${m.upcomingMilestones} milestones in 30 days`,
  },
  {
    key: "portal",
    title: "Portal",
    subtitle: "Client self-service",
    href: "/portal",
    icon: <Globe2 className="size-4" />,
    tile: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    accent: "text-cyan-500",
    primary: (m) => ({ value: m.activeUsers, label: "active client users" }),
    viz: (m) => <MiniBars data={m.commentsSeries ?? []} className="text-cyan-500" height={42} highlightLast showLabels />,
    vizLabel: () => "Client comments · 7 days",
    vizHint: (m) => `${m.comments7d} total`,
    note: (m) => `${m.comments7d} comments 7d · ${m.pendingDeliverables} to approve`,
  },
  {
    key: "control",
    title: "Control",
    subtitle: "Admin & security",
    href: "/control",
    icon: <Settings2 className="size-4" />,
    tile: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    accent: "text-slate-500",
    primary: (m) => ({ value: m.activeUsers, label: "staff accounts" }),
    viz: (m) => (
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <p className="text-body-lg font-bold tabular-nums leading-none">{m.connectedIntegrations}</p>
          <p className="mt-0.5 text-micro text-muted-foreground">integrations</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <p className="text-body-lg font-bold tabular-nums leading-none">{m.auditToday}</p>
          <p className="mt-0.5 text-micro text-muted-foreground">audit events</p>
        </div>
      </div>
    ),
    vizLabel: () => "Workspace signals",
    note: () => "Workspace health & audit trail",
  },
];

type Signal = { text: string; tone?: "rose" | "amber" | "emerald" | "sky" };
const SIGNAL_DOT: Record<string, string> = {
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
};

/** Plain-language reading of the module's numbers, shown in the drill-down. */
function moduleSignals(id: string, m: any, data: Record<string, any>): Signal[] {
  switch (id) {
    case "pulse": {
      const stages = m.leadsByStage ?? [];
      const total = stages.reduce((s: number, x: any) => s + Number(x.count ?? 0), 0);
      const top = [...stages].sort((a: any, b: any) => Number(b.count) - Number(a.count))[0];
      const decided = Number(m.won ?? 0) + Number(m.lost ?? 0);
      const winRate = decided ? Math.round((Number(m.won ?? 0) / decided) * 100) : null;
      return [
        { text: `${m.activeLeads} active leads worth ${formatBDT(m.pipelineValue)} in pipeline; weighted forecast ${formatBDT(m.weightedForecast)}.` },
        top && total ? { text: `Largest stage is ${shortStage(top.stage)} — ${top.count} leads (${Math.round((Number(top.count) / total) * 100)}% of the board).`, tone: "sky" } : null,
        Number(m.staleLeads ?? 0) > 0
          ? (() => {
              const stale = Number(m.staleLeads ?? 0);
              const due = Number(m.followUpsDue ?? 0);
              return { text: `${stale} lead${stale === 1 ? "" : "s"} have gone 7+ days without contact and ${due} follow-up${due === 1 ? " is" : "s are"} due.`, tone: "amber" as const };
            })()
          : { text: "No stale leads — follow-up hygiene is clean.", tone: "emerald" },
        winRate != null
          ? { text: `Win rate ${winRate}% (${m.won} won · ${m.lost} lost); ${m.hotLeads} hot leads are in play.`, tone: winRate >= 50 ? "emerald" : "amber" }
          : null,
      ].filter(Boolean) as Signal[];
    }
    case "accounts": {
      const total = Number(m.green ?? 0) + Number(m.yellow ?? 0) + Number(m.red ?? 0);
      const riskPct = total ? Math.round((Number(m.red ?? 0) / total) * 100) : 0;
      return [
        { text: `${total} clients with an average health score of ${m.avgHealth}/100.` },
        { text: `Health mix: ${m.green} healthy · ${m.yellow} watch · ${m.red} at risk${riskPct ? ` (${riskPct}% of the book)` : ""}.`, tone: riskPct >= 25 ? "rose" : riskPct > 0 ? "amber" : "emerald" },
        { text: Number(m.renewals30 ?? 0) > 0 ? `${m.renewals30} renewals fall in the next 30 days — start those conversations now.` : "No renewals in the next 30 days.", tone: Number(m.renewals30 ?? 0) > 0 ? "amber" : "emerald" },
        { text: Number(m.churnRisks ?? 0) > 0 ? `${m.churnRisks} client(s) are flagged churn-risk by the health engine.` : "No churn-risk flags right now.", tone: Number(m.churnRisks ?? 0) > 0 ? "rose" : "emerald" },
      ];
    }
    case "flow":
      return [
        { text: `${m.active} active projects: ${m.onTrack} on track · ${m.atRisk} at risk · ${m.delayed} delayed.`, tone: Number(m.delayed ?? 0) > 0 ? "rose" : Number(m.atRisk ?? 0) > 0 ? "amber" : "emerald" },
        { text: `${m.onTimeRate != null ? `${m.onTimeRate}% of milestones are on time` : "On-time rate is not available yet"} · average risk ${m.avgRisk}.` },
        { text: `${m.upcomingMilestones} milestones are due in the next 30 days.`, tone: Number(m.upcomingMilestones ?? 0) > 0 ? "sky" : undefined },
      ];
    case "tasks":
      return [
        { text: `${m.open} open tasks: ${m.dueToday} due today, ${m.overdue} overdue, ${m.blocked} blocked.`, tone: Number(m.overdue ?? 0) > 0 ? "rose" : Number(m.blocked ?? 0) > 0 ? "amber" : "emerald" },
        { text: `${m.completedThisWeek} completed this week and ${m.hoursThisWeek}h logged by the team.` },
        { text: Number(m.highPriority ?? 0) > 0 ? `${m.highPriority} high/urgent tasks are still open — clear those before new work.` : "No high-priority tasks waiting.", tone: Number(m.highPriority ?? 0) > 0 ? "amber" : "emerald" },
      ];
    case "people":
      return [
        { text: `${m.present} of ${m.headcount} checked in today (${m.attendanceRate}%).`, tone: Number(m.attendanceRate ?? 0) < 60 ? "amber" : "emerald" },
        { text: `${m.onLeave} on leave · ${m.absent} absent · ${m.pendingLeave} leave request(s) pending.`, tone: Number(m.pendingLeave ?? 0) > 0 ? "amber" : undefined },
        { text: `Utilization averages ${m.utilization}% · ${m.overloaded} people are overloaded · ${m.newJoiners} new joiner(s).`, tone: Number(m.overloaded ?? 0) > 0 ? "amber" : undefined },
      ];
    case "capital":
      return [
        { text: `${formatBDT(m.collected)} collected against ${formatBDT(m.invoiced)} invoiced${m.collectionRate != null ? ` (${m.collectionRate}% collection rate)` : ""}.`, tone: Number(m.collectionRate ?? 0) >= 80 ? "emerald" : "amber" },
        { text: `${formatBDT(m.outstanding)} outstanding, of which ${formatBDT(m.overdue)} is overdue.`, tone: Number(m.overdue ?? 0) > 0 ? "rose" : "emerald" },
        { text: `${formatBDT(m.cash)} cash on hand · ${formatBDT(m.expensesMonth)} expenses MTD · ${m.pendingExpenses} expense(s) awaiting approval.` },
      ];
    case "liabilities":
      return [
        { text: `${formatBDT(m.totalOwed ?? m.payable)} owed across ${m.vendors} vendors.` },
        { text: Number(m.overdue ?? 0) > 0 ? `${formatBDT(m.overdue)} is overdue across ${m.overdueCount} commitment(s) — settle these first.` : "No overdue vendor balances.", tone: Number(m.overdue ?? 0) > 0 ? "rose" : "emerald" },
        { text: Number(m.dueWeek ?? 0) > 0 ? `${formatBDT(m.dueWeek)} falls due within 7 days (${m.dueWeekCount}).` : "Nothing falls due this week.", tone: Number(m.dueWeek ?? 0) > 0 ? "amber" : "emerald" },
      ];
    case "dollar": {
      const avgSell = Number(m.usdMtd ?? 0) ? Number(m.bdtMtd ?? 0) / Number(m.usdMtd) : null;
      return [
        { text: `${formatBDT(m.profitMtd ?? 0)} profit this month on $${formatNumber(Math.round(m.usdMtd ?? 0))} sold (${m.marginMtd ?? 0}% margin).`, tone: Number(m.profitMtd ?? 0) < 0 ? "rose" : "emerald" },
        { text: avgSell != null ? `Average sell rate ৳${avgSell.toFixed(2)} against a ৳${m.costRate ?? 130} cost rate.` : "No USD sold this month." },
        { text: Number(m.lossCount ?? 0) > 0 ? `${m.lossCount} sale(s) went below cost — ${formatBDT(m.lossAmount ?? 0)} spread lost.` : "Every sale cleared the cost rate.", tone: Number(m.lossCount ?? 0) > 0 ? "amber" : "emerald" },
      ];
    }
    case "insight":
      return [
        { text: `${m.adRoas != null ? `${m.adRoas}x ROAS` : "ROAS unavailable"} on ${formatBDT(m.adSpend)} spent this month.`, tone: m.adRoas == null ? undefined : m.adRoas >= 1.5 ? "emerald" : "rose" },
        { text: `${formatNumber(m.adConversions)} conversions worth ${formatBDT(m.adConversionValue)}.` },
        { text: `${m.reports} saved report(s) · ${m.adAccounts} ad account(s) connected · ${m.correlations} correlation(s) found.` },
      ];
    case "calendar":
      return [
        { text: `${m.todayEvents} event(s) today and ${m.upcomingMilestones} milestone(s) in the next 30 days.` },
        { text: data.nextMilestone?.name ? `Next milestone: ${data.nextMilestone.name}${data.nextMilestone.dueDate ? ` — due ${formatDay(data.nextMilestone.dueDate)}` : ""}.` : "No upcoming milestone recorded." },
      ];
    case "portal":
      return [
        { text: `${m.activeUsers} active client user(s) · ${m.comments7d} comment(s) in the last 7 days.` },
        { text: Number(m.pendingDeliverables ?? 0) > 0 ? `${m.pendingDeliverables} deliverable(s) are waiting on client approval.` : "No deliverables waiting on the client.", tone: Number(m.pendingDeliverables ?? 0) > 0 ? "amber" : "emerald" },
      ];
    case "control":
      return [
        { text: `${m.activeUsers} staff account(s) and ${m.connectedIntegrations} connected integration(s).` },
        { text: `${m.auditToday} audit event(s) recorded today.` },
      ];
    default:
      return [];
  }
}

function ModuleSignals({ id, m, data }: { id: string; m: any; data: Record<string, any> }) {
  const items = moduleSignals(id, m, data);
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" /> What this means
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-body leading-relaxed">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SIGNAL_DOT[s.tone ?? "sky"])} />
            <span className="text-foreground/85">{s.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModuleAlerts({ alerts }: { alerts: any[] }) {
  if (!alerts.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle className="size-3.5 text-amber-500" /> Live signals
      </p>
      {alerts.map((a) => {
        const sev = SEV[a.severity as Severity] ?? SEV.info;
        return (
          <div key={a.id} className={cn("rounded-xl border px-3 py-2.5", sev.border)}>
            <div className="flex items-start justify-between gap-2">
              <span className={cn("text-meta font-bold leading-snug", sev.text)}>{a.label}</span>
              <span className={cn("shrink-0 text-body font-bold tabular-nums", sev.text)}>
                {a.kind === "money" ? formatBDT(a.metric) : a.kind === "percent" ? `${a.metric}%` : a.kind === "ratio" ? `${a.metric}x` : a.metric}
              </span>
            </div>
            <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">{a.hint}</p>
            {a.href && (
              <Link href={a.href} className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold text-primary hover:underline">
                {a.action ?? "Open"} <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        );
      })}
    </section>
  );
}


export function ModuleBoard({
  modules,
  moduleAlerts,
  full,
}: {
  modules: Record<string, any> | undefined;
  moduleAlerts?: Record<string, any>;
  full?: Record<string, any>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const visible = MODULES.filter((d) => modules?.[d.key]);
  if (!visible.length) return null;
  const selected = visible.find((d) => d.key === open);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-heading text-section font-semibold">Every module at a glance</p>
          <p className="text-meta text-muted-foreground">Tap a card for the breakdown and the decisions behind it.</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-primary">
          {visible.length} modules live
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {visible.map((d) => {
          const m = modules![d.key];
          const primary = d.primary(m);
          const alert = moduleAlerts?.[d.key];
          return (
            <button
              key={d.key}
              onClick={() => setOpen(d.key)}
              className={cn(
                "group flex flex-col rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                alert?.severity === "critical"
                  ? "border-rose-500/30"
                  : alert?.severity === "warning"
                    ? "border-amber-500/25"
                    : "border-border/60"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", d.tile)}>{d.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-semibold leading-tight">{d.title}</span>
                    <span className="block truncate text-micro text-muted-foreground">{d.subtitle}</span>
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {alert && (
                    <span
                      title={`${alert.count} ${alert.severity} signal${alert.count === 1 ? "" : "s"} in ${d.title}`}
                      aria-label={`${alert.count} ${alert.severity} signal${alert.count === 1 ? "" : "s"}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-bold uppercase",
                        SEV[alert.severity as Severity]?.tile
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", SEV[alert.severity as Severity]?.dot)} />
                      {alert.count}
                    </span>
                  )}
                  <ChevronRight className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline gap-1.5">
                <span className="font-heading text-page font-bold leading-none tracking-tight tabular-nums">{primary.value}</span>
              </div>
              <p className="mt-1 text-micro font-medium uppercase tracking-wide text-muted-foreground">{primary.label}</p>

              <div className="mt-3 flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-micro font-bold uppercase tracking-wider text-muted-foreground">{d.vizLabel(m)}</span>
                  {d.vizHint && <span className="shrink-0 text-micro font-semibold text-muted-foreground/80">{d.vizHint(m)}</span>}
                </div>
                {d.viz(m)}
              </div>
              <p className="mt-2.5 truncate text-micro text-muted-foreground">{d.note(m)}</p>
            </button>
          );
        })}
      </div>

      <Modal
        open={!!selected}
        onClose={() => setOpen(null)}
        size="3xl"
        title={
          selected ? (
            <span className="flex items-start gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", selected.tile)}>{selected.icon}</span>
              <span className="min-w-0">
                <span className="block truncate font-heading text-title font-bold leading-tight">{selected.title}</span>
                <span className="block text-meta text-muted-foreground">{selected.subtitle}</span>
              </span>
              <span className="ml-auto hidden shrink-0 flex-col items-end sm:flex">
                <span className="font-heading text-stat font-bold leading-none tabular-nums">{selected.primary(modules![selected.key]).value}</span>
                <span className="mt-0.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">{selected.primary(modules![selected.key]).label}</span>
              </span>
            </span>
          ) : null
        }
        footer={
          selected ? (
            <Link
              href={selected.href}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-body font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open {selected.title} <ArrowUpRight className="size-3.5" />
            </Link>
          ) : null
        }
      >
        {selected && (() => {
          const m = modules![selected.key];
          const alerts = ((full?.alerts ?? []) as any[]).filter((a) => a.module === selected.key);
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-w-0 flex-col gap-4">
                <ModuleSignals id={selected.key} m={m} data={full ?? {}} />
                <ModuleDetail id={selected.key} m={m} data={full ?? {}} />
              </div>
              <aside className="flex min-w-0 flex-col gap-3">
                <ModuleAlerts alerts={alerts} />
                <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                  <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">At a glance</p>
                  <p className="mt-1 text-body leading-relaxed text-muted-foreground">{selected.note(m)}</p>
                  <Link href={selected.href} className="mt-2 inline-flex items-center gap-1 text-meta font-bold text-primary hover:underline">
                    Open {selected.title} <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </aside>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/* ── Drill-down detail ────────────────────────────────────────────────────── */

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
      <p className={cn("text-section font-bold tabular-nums leading-tight", tone)}>{value}</p>
      <p className="mt-0.5 text-micro uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function Rows({ items }: { items: { label: string; value: ReactNode; sub?: string; tone?: string }[] }) {
  if (!items.length) return <p className="py-6 text-center text-meta text-muted-foreground">Nothing to show.</p>;
  return (
    <div className="flex flex-col divide-y divide-border/50">
      {items.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-body font-medium">{r.label}</span>
            {r.sub && <span className="block truncate text-micro text-muted-foreground">{r.sub}</span>}
          </span>
          <span className={cn("shrink-0 text-body font-semibold tabular-nums", r.tone)}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function ModuleDetail({ id, m, data }: { id: string; m: any; data: Record<string, any> }) {
  const health = data.accounts ?? {};

  if (id === "pulse") {
    const stages = m.leadsByStage ?? [];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Active leads" value={m.activeLeads} />
          <Stat label="Pipeline" value={formatBDT(m.pipelineValue)} />
          <Stat label="Weighted" value={formatBDT(m.weightedForecast)} />
          <Stat label="New this week" value={m.newThisWeek ?? 0} tone="text-primary" />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Pipeline by stage</p>
          <div className="space-y-2">
            {stages.map((s: any) => (
              <MeterRow key={s.stage} label={s.stage} value={s.count} max={Math.max(...stages.map((x: any) => x.count), 1)} display={`${s.count} · ${formatBDT(s.value)}`} tone="bg-primary" />
            ))}
          </div>
        </div>
        {stages.length > 0 && (
          <div>
            <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Share of active leads</p>
            <div className="space-y-2">
              {stages.map((s: any) => {
                const total = stages.reduce((n: number, x: any) => n + Number(x.count ?? 0), 0) || 1;
                const pct = Math.round((Number(s.count ?? 0) / total) * 100);
                return (
                  <MeterRow
                    key={s.stage}
                    label={shortStage(s.stage)}
                    value={pct}
                    max={100}
                    display={`${pct}% · ${s.count}`}
                    tone={s.stage?.toUpperCase().includes("WON") ? "bg-emerald-500" : s.stage?.toUpperCase().includes("LOST") ? "bg-rose-500" : "bg-primary"}
                  />
                );
              })}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Signal</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Hot leads" value={m.hotLeads} tone="text-rose-500" />
            <Stat label="Stale >7d" value={m.staleLeads} tone="text-amber-500" />
            <Stat label="Won" value={m.won} tone="text-emerald-500" />
            <Stat label="Lost" value={m.lost} tone="text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  if (id === "accounts") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Clients" value={m.total} />
          <Stat label="Avg health" value={`${m.avgHealth}/100`} />
          <Stat label="Renewals 30d" value={m.renewals30} tone={m.renewals30 ? "text-amber-500" : undefined} />
          <Stat label="Churn risk" value={m.churnRisks} tone="text-rose-500" />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Health mix</p>
          <SegmentedBar
            height={12}
            segments={[
              { label: "healthy", value: m.green, className: "bg-emerald-500" },
              { label: "watch", value: m.yellow, className: "bg-amber-500" },
              { label: "at risk", value: m.red, className: "bg-rose-500" },
            ]}
          />
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Renewals &amp; churn</p>
          <Rows
            items={[
              { label: "Renewals in 30 days", value: m.renewals30, sub: "Start renewal conversations early" },
              { label: "Churn-risk clients", value: m.churnRisks, sub: "Health flagged by the risk engine", tone: m.churnRisks ? "text-rose-500" : undefined },
              { label: "Health distribution", value: `${m.green} / ${m.yellow} / ${m.red}`, sub: "healthy / watch / at risk" },
            ]}
          />
        </div>
        <div className="flex gap-1.5">
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-semibold text-emerald-600 dark:text-emerald-400">avg {health.avgHealth ?? m.avgHealth}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold text-muted-foreground">{m.total} accounts</span>
        </div>
      </div>
    );
  }

  if (id === "flow") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Active" value={m.active} />
          <Stat label="At risk" value={m.atRisk} tone="text-rose-500" />
          <Stat label="On time" value={m.onTimeRate != null ? `${m.onTimeRate}%` : "—"} />
          <Stat label="Milestones 30d" value={m.upcomingMilestones} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Delivery health</p>
          <SegmentedBar
            height={12}
            segments={[
              { label: "on track", value: m.onTrack, className: "bg-emerald-500" },
              { label: "at risk", value: m.atRisk, className: "bg-amber-500" },
              { label: "delayed", value: m.delayed, className: "bg-rose-500" },
            ]}
          />
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Projects needing a decision</p>
          <Rows
            items={(data.flow?.atRisk ?? []).map((p: any) => ({
              label: p.name,
              sub: p.riskDriver ?? p.healthStatus?.replace(/_/g, " ").toLowerCase(),
              value: `${p.riskScore ?? 0}%`,
              tone: "text-rose-500",
            }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Milestones 30d" value={m.upcomingMilestones} />
          <Stat label="Avg risk" value={m.avgRisk} />
        </div>
      </div>
    );
  }

  if (id === "tasks") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Open" value={m.open} />
          <Stat label="Due today" value={m.dueToday} tone={m.dueToday ? "text-amber-500" : undefined} />
          <Stat label="Overdue" value={m.overdue} tone="text-rose-500" />
          <Stat label="Blocked" value={m.blocked} tone="text-amber-500" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Done this week" value={m.completedThisWeek} tone="text-emerald-500" />
          <Stat label="Hours logged" value={`${m.hoursThisWeek ?? 0}h`} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Work distribution</p>
          <SegmentedBar
            height={12}
            segments={[
              { label: "to do", value: m.byStatus?.TODO ?? 0, className: "bg-slate-400" },
              { label: "doing", value: m.byStatus?.IN_PROGRESS ?? 0, className: "bg-primary" },
              { label: "review", value: m.byStatus?.REVIEW ?? 0, className: "bg-sky-500" },
              { label: "blocked", value: m.byStatus?.BLOCKED ?? 0, className: "bg-rose-500" },
              { label: "done", value: m.byStatus?.DONE ?? 0, className: "bg-emerald-500" },
            ]}
          />
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Priority mix (open)</p>
          <div className="space-y-2">
            {[
              { label: "Urgent", value: m.byPriority?.URGENT ?? 0, tone: "bg-rose-500" },
              { label: "High", value: m.byPriority?.HIGH ?? 0, tone: "bg-amber-500" },
              { label: "Medium", value: m.byPriority?.MEDIUM ?? 0, tone: "bg-sky-500" },
              { label: "Low", value: m.byPriority?.LOW ?? 0, tone: "bg-slate-400" },
            ].map((r) => (
              <MeterRow key={r.label} label={r.label} value={r.value} max={Math.max(m.open, 1)} display={r.value} tone={r.tone} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Highest priority open</p>
          <Rows
            items={(data.tasks?.highPriority ?? []).map((t: any) => ({
              label: t.title,
              sub: `${t.status?.replace(/_/g, " ")}${t.dueDate ? ` · due ${formatDay(t.dueDate)}` : ""}`,
              value: t.priority,
              tone: t.priority === "URGENT" ? "text-rose-500" : "text-amber-500",
            }))}
          />
        </div>
      </div>
    );
  }

  if (id === "people") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Present" value={`${m.present}/${m.headcount}`} />
          <Stat label="Attendance" value={`${m.attendanceRate}%`} tone={m.attendanceRate < 60 ? "text-rose-500" : "text-emerald-500"} />
          <Stat label="On leave" value={m.onLeave} tone={m.onLeave ? "text-amber-500" : undefined} />
          <Stat label="Utilization" value={`${m.utilization}%`} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Last 7 days</p>
          <MiniBars data={m.attendance7d ?? []} className="text-amber-500" height={64} highlightLast showLabels />
        </div>
        <SegmentedBar
          height={12}
          segments={[
            { label: "present", value: m.present, className: "bg-emerald-500" },
            { label: "on leave", value: m.onLeave, className: "bg-amber-500" },
            { label: "absent", value: m.absent, className: "bg-rose-500" },
          ]}
        />
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Overloaded" value={m.overloaded} tone={m.overloaded ? "text-amber-500" : undefined} />
          <Stat label="Pending leave" value={m.pendingLeave} />
          <Stat label="New joiners" value={m.newJoiners} />
        </div>
      </div>
    );
  }

  if (id === "capital") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Collected" value={formatBDT(m.collected)} tone="text-emerald-500" />
          <Stat label="Outstanding" value={formatBDT(m.outstanding)} tone="text-amber-500" />
          <Stat label="Overdue" value={formatBDT(m.overdue)} tone="text-rose-500" />
          <Stat label="Cash" value={formatBDT(m.cash)} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Collected by month</p>
          {(m.trend ?? []).length > 1 ? (
            <div>
              <Sparkline points={(m.trend ?? []).map((t: any) => t.value)} className="text-emerald-500" height={64} />
              <div className="mt-1 flex justify-between text-micro text-muted-foreground">
                <span>{m.trend[0].label}</span>
                <span>{m.trend[m.trend.length - 1].label}</span>
              </div>
            </div>
          ) : (
            <p className="text-meta text-muted-foreground">Not enough history yet.</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Collection health</p>
          <div className="space-y-2">
            <MeterRow label="Collection rate" value={m.collectionRate} display={`${m.collectionRate}%`} tone={m.collectionRate >= 80 ? "bg-emerald-500" : "bg-amber-500"} />
            <MeterRow label="Monthly recurring" value={m.monthlyRecurring} max={Math.max(m.monthlyRecurring, m.collected, 1)} display={formatBDT(m.monthlyRecurring)} tone="bg-primary" />
            <MeterRow label="Cash position" value={m.cash} max={Math.max(m.cash, m.outstanding, 1)} display={formatBDT(m.cash)} tone="bg-sky-500" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Overdue invoices</p>
          <Rows
            items={(data.capital?.overdueInvoices ?? []).slice(0, 6).map((i: any) => ({
              label: i.invoiceNumber,
              sub: i.dueDate ? `due ${formatDate(i.dueDate)}` : undefined,
              value: formatBDT(i.amount),
              tone: "text-rose-500",
            }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Expenses MTD" value={formatBDT(m.expensesMonth)} />
          <Stat label="Pending expenses" value={m.pendingExpenses} tone={m.pendingExpenses ? "text-amber-500" : undefined} />
        </div>
      </div>
    );
  }

  if (id === "insight") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Ad spend MTD" value={formatBDT(m.adSpend)} />
          <Stat label="ROAS" value={m.adRoas != null ? `${m.adRoas}x` : "—"} tone={(m.adRoas ?? 0) >= 1.5 ? "text-emerald-500" : "text-rose-500"} />
          <Stat label="Conversions" value={formatNumber(m.adConversions)} />
          <Stat label="Conv. value" value={formatBDT(m.adConversionValue)} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Spend last 6 months</p>
          <MiniBars data={m.adTrend ?? []} className="text-fuchsia-500" height={64} highlightLast showLabels />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Conversion value" value={formatBDT(m.adConversionValue)} />
          <Stat label="Ad accounts" value={m.adAccounts} />
          <Stat label="Saved reports" value={m.reports} />
          <Stat label="Correlations" value={m.correlations} />
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Latest insights</p>
          <Rows
            items={(data.insight?.insights ?? []).map((i: any) => ({
              label: i.description,
              sub: `${i.confidenceLevel ?? "—"} confidence · ${formatDate(i.surfacedAt)}`,
              value: "",
            }))}
          />
        </div>
      </div>
    );
  }

  if (id === "calendar") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Events today" value={m.todayEvents} />
          <Stat label="Milestones 30d" value={m.upcomingMilestones} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Next 7 days</p>
          <MiniBars data={m.next7 ?? []} className="text-sky-500" height={64} showLabels />
        </div>
        <div>
          <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Today</p>
          <Rows
            items={(data.today?.events ?? []).map((e: any) => ({
              label: e.title,
              sub: [e.projectName, e.clientName].filter(Boolean).join(" · ") || e.type?.replace(/_/g, " ").toLowerCase(),
              value: e.type?.replace(/_/g, " ").toLowerCase() ?? "",
            }))}
          />
        </div>
      </div>
    );
  }

  if (id === "portal") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Active users" value={m.activeUsers} />
          <Stat label="Comments 7d" value={m.comments7d} />
          <Stat label="Deliverables" value={m.pendingDeliverables} tone={m.pendingDeliverables ? "text-amber-500" : undefined} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Client comments, last 7 days</p>
          <MiniBars data={m.commentsSeries ?? []} className="text-cyan-500" height={64} highlightLast showLabels />
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold"><Info className="size-3.5 text-cyan-500" /> What to do</p>
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            {m.pendingDeliverables > 0
              ? `${m.pendingDeliverables} deliverable${m.pendingDeliverables === 1 ? "" : "s"} waiting on client approval — nudge the client or follow up in the portal.`
              : "No approvals pending. Keep the portal fresh with progress updates so clients stay engaged."}
          </p>
        </div>
      </div>
    );
  }

  if (id === "dollar") {
    const avgSell = m.usdMtd ? m.bdtMtd / m.usdMtd : null;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Profit MTD" value={formatBDT(m.profitMtd ?? 0)} tone={(m.profitMtd ?? 0) < 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"} />
          <Stat label="USD sold MTD" value={`$${formatNumber(Math.round(m.usdMtd ?? 0))}`} />
          <Stat label="BDT received" value={formatBDT(m.bdtMtd ?? 0)} />
          <Stat label="All-time profit" value={formatBDT(m.profitAll ?? 0)} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Profit, last 6 months</p>
          <MiniBars data={m.monthly ?? []} className="text-teal-500" height={64} highlightLast showLabels />
        </div>
        <Rows
          items={[
            { label: "Cost rate", value: `৳${m.costRate ?? 130}`, sub: "Set in Control → Finance" },
            { label: "Average sell rate", value: avgSell ? `৳${avgSell.toFixed(2)}` : "—", sub: "BDT received ÷ USD sold this month" },
            { label: "Margin this month", value: `${m.marginMtd ?? 0}%`, sub: `${m.countMtd ?? 0} sale(s) · ${m.clients ?? 0} client(s)` },
            { label: "All-time profit", value: formatBDT(m.profitAll ?? 0), sub: `$${formatNumber(Math.round(m.usdAll ?? 0))} sold in total` },
            {
              label: "Sales below cost",
              value: m.lossCount ?? 0,
              sub: (m.lossCount ?? 0) > 0 ? `${formatBDT(m.lossAmount ?? 0)} spread lost this month` : "Everything sold above the cost rate",
              tone: (m.lossCount ?? 0) > 0 ? "text-rose-500" : undefined,
            },
          ]}
        />
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold"><CircleDollarSign className="size-3.5 text-teal-500" /> Next action</p>
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            {(m.lossCount ?? 0) > 0
              ? "Review the loss-making sales — either the sell rate was too low or the cost rate changed."
              : (m.countMtd ?? 0) === 0
                ? "No dollar sales this month. Sales are client-level, so no project is needed."
                : "Spread is healthy. Keep the cost rate current so profit stays accurate."}
          </p>
        </div>
      </div>
    );
  }

  if (id === "liabilities") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total owed" value={formatBDT(m.totalOwed ?? m.payable)} />
          <Stat label="Overdue" value={formatBDT(m.overdue ?? 0)} tone={(m.overdue ?? 0) > 0 ? "text-rose-500" : undefined} />
          <Stat label="Due 7 days" value={formatBDT(m.dueWeek ?? 0)} tone={(m.dueWeek ?? 0) > 0 ? "text-amber-500" : undefined} />
          <Stat label="Vendors" value={m.vendors ?? 0} />
        </div>
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Paid vs still owed</p>
          <SegmentedBar
            height={12}
            segments={[
              { label: "paid", value: m.paid, className: "bg-emerald-500" },
              { label: "open", value: Math.max((m.payable ?? 0) - (m.overdue ?? 0), 0), className: "bg-amber-500" },
              { label: "overdue", value: m.overdue, className: "bg-rose-500" },
            ]}
          />
        </div>
        <Rows
          items={[
            { label: "Committed to vendors", value: formatBDT(m.committed ?? 0), sub: "Agreed contract value" },
            { label: "Advance outstanding", value: formatBDT(m.advanceOutstanding ?? 0), sub: "Paid but work not yet delivered" },
            { label: "Retention held", value: formatBDT(m.retentionHeld ?? 0), sub: "Withheld until sign-off" },
            { label: "Other vendor bills", value: formatBDT(m.otherPayables ?? 0), sub: `${m.otherOverdue ? `${formatBDT(m.otherOverdue)} overdue` : "No overdue bills"}`, tone: (m.otherOverdue ?? 0) > 0 ? "text-rose-500" : undefined },
            { label: "Vendors with open balance", value: m.vendors ?? 0, sub: `${m.overdueCount ?? 0} contract(s) past due`, tone: (m.overdueCount ?? 0) > 0 ? "text-rose-500" : undefined },
          ]}
        />
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold"><HandCoins className="size-3.5 text-orange-500" /> Next action</p>
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            {(m.overdue ?? 0) > 0
              ? "Settle the overdue balances first — vendors stop prioritising teams that pay late."
              : (m.dueWeek ?? 0) > 0
                ? "Plan this week's vendor payments so the balance does not turn overdue."
                : "Nothing urgent. Keep advances recorded so the remaining liability stays accurate."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Staff accounts" value={m.activeUsers} />
        <Stat label="Integrations" value={m.connectedIntegrations} />
        <Stat label="Audit today" value={m.auditToday} />
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
        <p className="flex items-center gap-1.5 text-meta font-semibold"><Settings2 className="size-3.5" /> Admin implies action</p>
        <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
          {m.connectedIntegrations === 0
            ? "No integrations connected. Connect the tools the team already uses so data stays in one place."
            : "Review audit events weekly and keep the integration list current."}
        </p>
      </div>
      <Rows
        items={[
          { label: "Active staff", value: m.activeUsers, sub: "Accounts that can sign in" },
          { label: "Connected integrations", value: m.connectedIntegrations, sub: "Slack, calendar, payments…" },
          { label: "Audit events today", value: m.auditToday, sub: "Security-relevant changes" },
        ]}
      />
    </div>
  );
}
