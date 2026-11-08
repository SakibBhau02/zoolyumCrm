"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock,
  FileText,
  Flame,
  Globe2,
  HandCoins,
  Inbox,
  Landmark,
  ListTodo,
  Plus,
  ReceiptText,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth";
import { formatBDT, formatDate, formatDay, formatNumber, timeAgo } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { PaymentDonut, RevenueAreaChart, StageBarChart } from "@/components/charts";
import { MyDayWidget } from "@/components/my-day-widget";
import { typeMeta } from "@/components/notifications-dropdown";
import { TodayWorkBoard } from "@/components/dashboard/today-work";
import { BusinessHealth, DecisionQueue, ModuleBoard } from "@/components/dashboard/glance";

/* ────────────────────────────────────────────────────────────────────────────
   Dashboard — one shell, five role layouts.

   The API (`/dashboard/home`) already narrows the payload per role, so this
   page only decides *how* to present the numbers: an owner gets the full
   command centre, finance gets cash, managers get delivery, HR gets people and
   employees get their own day. Nothing here trusts the client to hide data.
   ──────────────────────────────────────────────────────────────────────────── */

type View = "owner" | "admin" | "finance" | "manager" | "hr" | "sales" | "employee";

const money = (n: any) => `৳${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const compact = (n: any) => formatBDT(Number(n ?? 0));

const priorityTone: Record<string, string> = {
  URGENT: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  HIGH: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  MEDIUM: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  LOW: "bg-muted text-muted-foreground ring-1 ring-border",
};

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "text-foreground",
  tile = "bg-primary/10 text-primary",
  href,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  tone?: string;
  tile?: string;
  href?: string;
  trend?: string;
}) {
  const inner = (
    <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex size-9 items-center justify-center rounded-xl", tile)}>{icon}</span>
        {href && <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-colors group-hover:text-primary" />}
      </div>
      <div className="mt-3">
        <p className={cn("font-heading text-[22px] font-bold leading-none tracking-tight tabular-nums", tone)}>{value}</p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {(hint || trend) && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            {trend && <TrendingUp className="size-3 text-emerald-500" />}
            {trend ?? hint}
          </p>
        )}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-[11.5px] font-semibold text-foreground backdrop-blur transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      {icon} {label}
    </Link>
  );
}

function AttentionRow({ title, sub, tone, icon, href }: { title: string; sub: string; tone: string; icon: React.ReactNode; href?: string }) {
  const body = (
    <div className="flex items-start gap-2.5 rounded-xl p-2 transition-colors hover:bg-muted/50">
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      </div>
      {href && <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function InboxCard() {
  const { data: itemsData, mutate } = useApi<any[]>("/notifications?limit=5");
  const { data: summary, mutate: mutateSummary } = useApi<any>("/notifications/summary");
  const [busy, setBusy] = useState(false);
  const items = itemsData ?? [];

  useEffect(() => {
    const t = setInterval(() => {
      mutate();
      mutateSummary();
    }, 60_000);
    return () => clearInterval(t);
  }, [mutate, mutateSummary]);

  const markAll = async () => {
    setBusy(true);
    try {
      await apiFetch("/notifications/read-all", { method: "PATCH" });
      mutate();
      mutateSummary();
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell className="flex h-full flex-col">
      <SectionTitle
        title="Inbox"
        subtitle={summary ? `${summary.unread} unread · ${summary.today} today` : "Latest updates"}
        action={
          <Link href="/notifications" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
            Open <ArrowRight className="size-3" />
          </Link>
        }
      />
      <div className="flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-muted">
              <CheckCheck className="size-4 text-muted-foreground" />
            </span>
            <p className="text-[12px] font-medium">All caught up</p>
            <p className="text-[11px] text-muted-foreground">Nothing needs your attention.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((n) => {
              const m = typeMeta(n.type);
              const Icon = m.icon;
              return (
                <Link
                  key={n.id}
                  href={n.link || "/notifications"}
                  className="flex items-start gap-2.5 rounded-xl p-2 transition-colors hover:bg-muted/50"
                >
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", m.tone)}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[12px] font-semibold">
                      {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                      <span className="truncate">{n.title}</span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{n.message}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {!!summary?.unread && (
        <button
          onClick={markAll}
          disabled={busy}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <CheckCheck className="size-3.5" /> Mark all read
        </button>
      )}
    </CardShell>
  );
}

function ActivityCard({ items }: { items: any[] }) {
  return (
    <CardShell className="flex h-full flex-col">
      <SectionTitle title="Recent activity" subtitle="Portal, tasks & system" />
      <div className="flex flex-1 flex-col gap-3">
        {items.length === 0 && <p className="text-[12px] text-muted-foreground">No activity yet.</p>}
        {items.slice(0, 7).map((a) => (
          <div key={a.id} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                a.kind === "portal" ? "bg-primary" : a.kind === "task" ? "bg-sky-500" : "bg-emerald-500"
              )}
            />
            <div className="min-w-0">
              <p className="line-clamp-2 text-[12px] leading-snug">{a.text}</p>
              <p className="text-[10.5px] text-muted-foreground">{timeAgo(a.at)}</p>
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

function TopClientsCard({ clients }: { clients: any[] }) {
  return (
    <CardShell className="h-full">
      <SectionTitle
        title="Top clients"
        subtitle="Recognized revenue"
        action={
          <Link href="/accounts" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
            All <ArrowRight className="size-3" />
          </Link>
        }
      />
      <div className="flex flex-col gap-2">
        {clients.length === 0 && <p className="text-[12px] text-muted-foreground">No client revenue yet.</p>}
        {clients.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold", i === 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
              {i === 0 ? <Trophy className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{c.companyName}</p>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (Number(c.revenue) / Math.max(Number(clients[0]?.revenue) || 1, 1)) * 100)}%` }}
                />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12px] font-bold tabular-nums">{compact(c.revenue)}</p>
              <StatusBadge status={c.healthLevel ?? "GREEN"} />
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

function OverdueTable({ invoices }: { invoices: any[] }) {
  return (
    <CardShell>
      <SectionTitle
        title="Overdue receivables"
        subtitle={invoices.length ? `${invoices.length} invoice(s) need chasing` : "Nothing overdue"}
        action={
          <Link href="/capital/invoices" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
            Invoices <ArrowRight className="size-3" />
          </Link>
        }
      />
      {invoices.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-4 text-[12px] text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" /> Every invoice is within terms.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Invoice</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 6).map((i) => (
                <tr key={i.id} className="border-t border-border/50 text-[12px]">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/capital/invoices?id=${i.id}`} className="hover:text-primary hover:underline">{i.invoiceNumber}</Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDay(i.dueDate)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-rose-500">{money(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

function TaskList({ tasks, empty }: { tasks: any[]; empty: string }) {
  if (!tasks.length) return <EmptyState title={empty} />;
  return (
    <div className="flex flex-col gap-1.5">
      {tasks.map((t) => (
        <Link key={t.id} href="/tasks" className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2 transition-colors hover:bg-muted/40">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{t.title}</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">
              {t.project?.name ?? "No project"} · due {formatDay(t.dueDate)}
            </span>
          </span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold", priorityTone[t.priority] ?? priorityTone.LOW)}>
            {String(t.priority ?? "LOW").replace(/_/g, " ")}
          </span>
          <StatusBadge status={t.status} />
        </Link>
      ))}
    </div>
  );
}

function EventList({ events }: { events: any[] }) {
  if (!events.length) return <EmptyState title="No events today" hint="Meetings and deadlines will appear here." />;
  return (
    <div className="flex flex-col gap-1.5">
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <CalendarClock className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium">{e.title}</p>
            <p className="text-[10.5px] text-muted-foreground">{String(e.type ?? "event").replace(/_/g, " ")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

function Hero({ data, userName, roleName }: { data: any; userName?: string; roleName?: string }) {
  const view: View = data.view;
  const p = data.personal ?? {};
  const label =
    view === "owner" ? "Owner command center" :
    view === "admin" ? "Administrator" :
    view === "finance" ? "Finance desk" :
    view === "manager" ? "Delivery & team" :
    view === "hr" ? "People operations" :
    view === "sales" ? "Revenue pipeline" : "My workspace";

  const line =
    view === "owner" || view === "admin"
      ? `${compact(data.capital?.recognizedRevenue)} revenue · ${data.capital?.overdueInvoices?.length ?? 0} overdue · ${data.tasks?.dueToday ?? 0} tasks due today`
      : view === "finance"
        ? `${compact(data.capital?.collected)} collected · ${compact(data.capital?.outstanding)} outstanding · ${compact(data.capital?.overdueAmount)} overdue`
        : view === "manager"
          ? `${data.flow?.activeProjects ?? 0} active projects · ${data.flow?.atRisk?.length ?? 0} at risk · ${data.tasks?.openTasks ?? 0} open tasks`
          : view === "hr"
            ? `${data.people?.presentToday ?? 0} present · ${data.people?.onLeaveToday ?? 0} on leave · ${data.people?.avgUtilization ?? 0}% utilization`
            : view === "sales"
              ? `${compact(data.pulse?.pipelineValue)} pipeline · ${compact(data.pulse?.weightedForecast)} weighted · ${data.pulse?.hotLeads ?? 0} hot leads`
              : `${p.tasks?.length ?? 0} tasks assigned · ${p.tasksOverdue ?? 0} overdue · ${p.followUpsDueCount ?? 0} follow-ups due`;

  const actions =
    view === "owner" || view === "admin" ? (
      <>
        <QuickAction href="/capital/invoices" label="New invoice" icon={<ReceiptText className="size-3.5" />} />
        <QuickAction href="/pulse" label="New lead" icon={<Zap className="size-3.5" />} />
        <QuickAction href="/flow" label="Projects" icon={<Workflow className="size-3.5" />} />
        <QuickAction href="/control" label="Admin panel" icon={<Settings2 className="size-3.5" />} />
      </>
    ) : view === "finance" ? (
      <>
        <QuickAction href="/capital/invoices" label="New invoice" icon={<ReceiptText className="size-3.5" />} />
        <QuickAction href="/capital/expenses" label="Record expense" icon={<Wallet className="size-3.5" />} />
        <QuickAction href="/capital/reports" label="Reports" icon={<FileText className="size-3.5" />} />
        <QuickAction href="/capital" label="Finance" icon={<CircleDollarSign className="size-3.5" />} />
      </>
    ) : view === "manager" ? (
      <>
        <QuickAction href="/tasks" label="New task" icon={<Plus className="size-3.5" />} />
        <QuickAction href="/flow" label="Projects" icon={<Workflow className="size-3.5" />} />
        <QuickAction href="/people/attendance" label="Attendance" icon={<Clock className="size-3.5" />} />
        <QuickAction href="/calendar" label="Calendar" icon={<CalendarClock className="size-3.5" />} />
      </>
    ) : view === "hr" ? (
      <>
        <QuickAction href="/people" label="People" icon={<Users className="size-3.5" />} />
        <QuickAction href="/people/leave" label="Leave" icon={<CalendarClock className="size-3.5" />} />
        <QuickAction href="/people/payroll" label="Payroll" icon={<Wallet className="size-3.5" />} />
        <QuickAction href="/people/attendance" label="Attendance" icon={<Clock className="size-3.5" />} />
      </>
    ) : view === "sales" ? (
      <>
        <QuickAction href="/pulse" label="New lead" icon={<Zap className="size-3.5" />} />
        <QuickAction href="/pulse" label="Pipeline" icon={<Target className="size-3.5" />} />
        <QuickAction href="/accounts" label="Clients" icon={<Building2 className="size-3.5" />} />
        <QuickAction href="/calendar" label="Calendar" icon={<CalendarClock className="size-3.5" />} />
      </>
    ) : (
      <>
        <QuickAction href="/tasks" label="My tasks" icon={<ListTodo className="size-3.5" />} />
        <QuickAction href="/people/me" label="My profile" icon={<UserCheck className="size-3.5" />} />
        <QuickAction href="/people/leave" label="Leave" icon={<CalendarClock className="size-3.5" />} />
        <QuickAction href="/calendar" label="Calendar" icon={<CalendarClock className="size-3.5" />} />
      </>
    );

  return (
    <FadeIn>
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/[0.10] via-card to-card p-6 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 grid-pattern opacity-40" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="size-3" /> {label}
            </span>
            {roleName && (
              <span className="rounded-full border border-border bg-card/70 px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">
                {roleName}
              </span>
            )}
            <span className="text-[10.5px] text-muted-foreground">
              Updated {timeAgo(data.generatedAt)}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-[26px] font-bold tracking-tight sm:text-[30px]">
                Welcome back, {userName?.split(" ")[0] ?? "there"}
              </h1>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">{line}</p>
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/* ── Role views ───────────────────────────────────────────────────────────── */

function OwnerView({ data }: { data: any }) {
  const c = data.capital ?? {};
  const people = data.people ?? {};
  const attention = useMemo(() => {
    const rows: any[] = [];
    for (const i of (c.overdueInvoices ?? []).slice(0, 3)) {
      rows.push({ key: `i-${i.id}`, title: `${i.invoiceNumber} overdue`, sub: `${money(i.amount)} · due ${formatDay(i.dueDate)}`, tone: "bg-rose-500/10 text-rose-500", icon: <AlertTriangle className="size-3.5" />, href: "/capital/invoices" });
    }
    for (const p of (data.flow?.atRisk ?? []).slice(0, 3)) {
      rows.push({ key: `p-${p.id}`, title: p.name, sub: `${String(p.healthStatus).replace(/_/g, " ")} · risk ${p.riskScore ?? "—"}`, tone: "bg-amber-500/10 text-amber-500", icon: <Flame className="size-3.5" />, href: "/flow" });
    }
    if ((c.pendingExpenses ?? 0) > 0) {
      rows.push({ key: "exp", title: `${c.pendingExpenses} expense(s) awaiting approval`, sub: "Finance approvals queue", tone: "bg-sky-500/10 text-sky-500", icon: <HandCoins className="size-3.5" />, href: "/capital/expenses" });
    }
    if (!rows.length) {
      rows.push({ key: "ok", title: "No urgent items", sub: "Pipeline, delivery and cash are on track", tone: "bg-emerald-500/10 text-emerald-500", icon: <Check className="size-3.5" /> });
    }
    return rows;
  }, [c, data.flow]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Revenue" value={compact(c.recognizedRevenue)} hint="recognized this period" icon={<CircleDollarSign className="size-4" />} href="/capital" />
        <Kpi label="Collected" value={compact(c.collected)} hint={`${Math.round((c.collected / Math.max(c.totalInvoiced, 1)) * 100)}% of invoiced`} tone="text-emerald-600 dark:text-emerald-400" tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon={<HandCoins className="size-4" />} href="/capital/income" />
        <Kpi label="Outstanding" value={compact(c.outstanding)} hint={`${money(c.overdueAmount)} overdue`} tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<ReceiptText className="size-4" />} href="/capital/invoices" />
        <Kpi label="Pipeline" value={compact(data.pulse?.weightedForecast)} hint={`${data.pulse?.activeLeads ?? 0} active leads`} icon={<Target className="size-4" />} href="/pulse" />
        <Kpi label="Active projects" value={data.flow?.activeProjects ?? 0} hint={`${data.flow?.atRisk?.length ?? 0} at risk`} tile="bg-sky-500/10 text-sky-600 dark:text-sky-400" icon={<Workflow className="size-4" />} href="/flow" />
        <Kpi label="Utilization" value={`${people.avgUtilization ?? 0}%`} hint={`${people.overloaded ?? 0} overloaded`} tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<Users className="size-4" />} href="/people" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle
              title="Revenue trend"
              subtitle="Invoiced vs collected vs expenses — last 8 months"
              action={<Link href="/capital/reports" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">Report <ArrowRight className="size-3" /></Link>}
            />
            <RevenueAreaChart data={c.revenueTrend ?? []} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle
              title="Pipeline by stage"
              subtitle={`${compact(data.pulse?.pipelineValue)} total · ${compact(data.pulse?.weightedForecast)} weighted`}
              action={<Link href="/pulse" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">Pipeline <ArrowRight className="size-3" /></Link>}
            />
            <StageBarChart data={data.pulse?.leadsByStage ?? []} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell className="h-full">
            <SectionTitle title="Needs attention" subtitle="Today's watchlist" />
            <div className="flex flex-col gap-0.5">
              {attention.map(({ key, ...rest }) => <AttentionRow key={key} {...rest} />)}
            </div>
          </CardShell>
        </FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2"><TopClientsCard clients={data.topClients ?? []} /></FadeIn>
        <FadeIn delay={0.1}><ActivityCard items={data.recentActivity ?? []} /></FadeIn>
      </div>
    </div>
  );
}

function FinanceView({ data }: { data: any }) {
  const c = data.capital ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Collected" value={compact(c.collected)} hint="cash received" tone="text-emerald-600 dark:text-emerald-400" tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon={<HandCoins className="size-4" />} href="/capital/income" />
        <Kpi label="Outstanding" value={compact(c.outstanding)} hint="not yet collected" tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<ReceiptText className="size-4" />} href="/capital/invoices" />
        <Kpi label="Overdue" value={compact(c.overdueAmount)} hint={`${c.overdueInvoices?.length ?? 0} invoices`} tone="text-rose-600 dark:text-rose-400" tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" icon={<AlertTriangle className="size-4" />} href="/capital/invoices" />
        <Kpi label="Expenses MTD" value={compact(c.expensesMonth)} hint={`${c.pendingExpenses ?? 0} pending`} icon={<Wallet className="size-4" />} href="/capital/expenses" />
        <Kpi label="Cash position" value={compact(c.cashPosition)} hint="bank + wallets" tile="bg-sky-500/10 text-sky-600 dark:text-sky-400" icon={<Landmark className="size-4" />} href="/capital/accounts" />
        <Kpi label="Collection rate" value={`${Math.round((c.collected / Math.max(c.totalInvoiced, 1)) * 100)}%`} hint="of invoiced" tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<TrendingUp className="size-4" />} href="/capital/reports" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="Cash movement" subtitle="Invoiced vs collected vs expenses" action={<Link href="/capital/reports" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">Statements <ArrowRight className="size-3" /></Link>} />
            <RevenueAreaChart data={c.revenueTrend ?? []} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell className="h-full">
            <SectionTitle title="Payment mix" subtitle="Collections by method" />
            {c.paymentSplit?.length ? <PaymentDonut data={c.paymentSplit} /> : <EmptyState title="No payments recorded yet" />}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-4">
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Cash position</p>
                <p className="text-[15px] font-heading font-bold tabular-nums">{compact(c.cashPosition)}</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Pending approvals</p>
                <p className="text-[15px] font-heading font-bold tabular-nums">{c.pendingExpenses ?? 0}</p>
              </div>
            </div>
          </CardShell>
        </FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2"><OverdueTable invoices={c.overdueInvoices ?? []} /></FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2"><TopClientsCard clients={data.topClients ?? []} /></FadeIn>
        <FadeIn delay={0.1}><ActivityCard items={data.recentActivity ?? []} /></FadeIn>
      </div>
    </div>
  );
}

function ManagerView({ data }: { data: any }) {
  const p = data.personal ?? {};
  const f = data.flow ?? {};
  const t = data.tasks ?? {};
  const people = data.people ?? {};
  const health = [
    { name: "On track", value: f.healthStatusCounts?.ON_TRACK ?? 0 },
    { name: "At risk", value: f.healthStatusCounts?.AT_RISK ?? 0 },
    { name: "Delayed", value: f.healthStatusCounts?.DELAYED ?? 0 },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Active projects" value={f.activeProjects ?? 0} hint={`${f.totalProjects ?? 0} total`} icon={<Workflow className="size-4" />} href="/flow" />
        <Kpi label="At risk" value={f.atRisk?.length ?? 0} hint="need intervention" tone="text-rose-600 dark:text-rose-400" tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" icon={<Flame className="size-4" />} href="/flow" />
        <Kpi label="Open tasks" value={t.openTasks ?? 0} hint={`${t.hoursThisWeek ?? 0}h logged this week`} tile="bg-sky-500/10 text-sky-600 dark:text-sky-400" icon={<ClipboardList className="size-4" />} href="/tasks" />
        <Kpi label="Due today" value={t.dueToday ?? 0} hint={`${t.overdue ?? 0} overdue`} tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<CalendarClock className="size-4" />} href="/tasks" />
        <Kpi label="Utilization" value={`${people.avgUtilization ?? 0}%`} hint={`${people.overloaded ?? 0} overloaded`} tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<Users className="size-4" />} href="/people/utilization" />
        <Kpi label="My tasks" value={p.tasks?.length ?? 0} hint={`${p.tasksOverdue ?? 0} overdue`} icon={<ListTodo className="size-4" />} href="/tasks?mine=true" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="Project health" subtitle={`${f.activeProjects ?? 0} active · ${f.atRisk?.length ?? 0} at risk · avg risk ${f.avgRisk ?? 0}`} action={<Link href="/flow" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">All projects <ArrowRight className="size-3" /></Link>} />
            <div className="grid grid-cols-3 gap-3">
              {health.map((h) => (
                <div key={h.name} className="rounded-xl border border-border/60 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{h.name}</p>
                  <p className="mt-1 font-heading text-[20px] font-bold tabular-nums">{h.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              {(f.atRisk ?? []).length === 0 && <p className="rounded-xl bg-emerald-500/5 px-3 py-3 text-[12px] text-emerald-600 dark:text-emerald-400">No projects at risk.</p>}
              {(f.atRisk ?? []).map((pr: any) => (
                <Link key={pr.id} href={`/flow?project=${pr.id}`} className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2 transition-colors hover:bg-muted/40">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500"><Flame className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{pr.name}</span>
                    <span className="block text-[10.5px] text-muted-foreground">{String(pr.healthStatus).replace(/_/g, " ")} · risk {pr.riskScore ?? "—"}{pr.riskDriver ? ` · ${pr.riskDriver}` : ""}</span>
                  </span>
                  <ChevronRight className="size-3.5 text-muted-foreground/50" />
                </Link>
              ))}
            </div>
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="My tasks" subtitle="Assigned to me — nearest due first" action={<Link href="/tasks?mine=true" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">All tasks <ArrowRight className="size-3" /></Link>} />
            <TaskList tasks={p.tasks ?? []} empty="No open tasks assigned to you" />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell className="h-full">
            <SectionTitle title="Today" subtitle="Meetings & deadlines" />
            <EventList events={p.events ?? []} />
          </CardShell>
        </FadeIn>
      </div>
    </div>
  );
}

function PeopleView({ data }: { data: any }) {
  const p = data.personal ?? {};
  const people = data.people ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Employees" value={people.totalEmployees ?? 0} hint="active roster" icon={<Users className="size-4" />} href="/people" />
        <Kpi label="Present" value={people.presentToday ?? 0} hint="checked in today" tone="text-emerald-600 dark:text-emerald-400" tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon={<UserCheck className="size-4" />} href="/people/attendance" />
        <Kpi label="On leave" value={people.onLeaveToday ?? 0} hint="approved today" tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<CalendarClock className="size-4" />} href="/people/leave" />
        <Kpi label="Utilization" value={`${people.avgUtilization ?? 0}%`} hint="team average" tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<TrendingUp className="size-4" />} href="/people/utilization" />
        <Kpi label="Overloaded" value={people.overloaded ?? 0} hint="over 105%" tone="text-rose-600 dark:text-rose-400" tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" icon={<Flame className="size-4" />} href="/people/utilization" />
        <Kpi label="Pending leave" value={p.leaves?.length ?? 0} hint="awaiting decision" icon={<ClipboardList className="size-4" />} href="/people/leave" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="Team attendance" subtitle="Today's check-in snapshot" action={<Link href="/people/attendance" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">Attendance <ArrowRight className="size-3" /></Link>} />
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-500/5 px-3 py-3 text-center"><p className="font-heading text-[22px] font-bold text-emerald-600 dark:text-emerald-400">{people.presentToday ?? 0}</p><p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Present</p></div>
              <div className="rounded-xl bg-amber-500/5 px-3 py-3 text-center"><p className="font-heading text-[22px] font-bold text-amber-600 dark:text-amber-400">{people.onLeaveToday ?? 0}</p><p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">On leave</p></div>
              <div className="rounded-xl bg-muted px-3 py-3 text-center"><p className="font-heading text-[22px] font-bold">{Math.max((people.totalEmployees ?? 0) - (people.presentToday ?? 0) - (people.onLeaveToday ?? 0), 0)}</p><p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Absent</p></div>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">My pending leave</p>
              {(p.leaves ?? []).length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No pending leave requests.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(p.leaves ?? []).map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2 text-[12px]">
                      <span className="font-medium capitalize">{String(l.leaveType).replace(/_/g, " ").toLowerCase()}</span>
                      <span className="text-muted-foreground">{formatDate(l.startDate)} → {formatDate(l.endDate)}</span>
                      <StatusBadge status={l.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2"><CardShell><SectionTitle title="My tasks" subtitle="Work assigned to me" /><TaskList tasks={p.tasks ?? []} empty="No open tasks assigned to you" /></CardShell></FadeIn>
        <FadeIn delay={0.1}><ActivityCard items={data.recentActivity ?? []} /></FadeIn>
      </div>
    </div>
  );
}

function SalesView({ data }: { data: any }) {
  const p = data.personal ?? {};
  const pulse = data.pulse ?? {};
  const myOpen = (p.leads ?? []).filter((l: any) => l.stage !== "WON" && l.stage !== "LOST");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="My pipeline" value={compact(myOpen.reduce((s: number, l: any) => s + Number(l.estimatedDealSize ?? 0), 0))} hint={`${myOpen.length} open leads`} icon={<Target className="size-4" />} href="/pulse" />
        <Kpi label="Weighted forecast" value={compact(pulse.weightedForecast)} hint="company-wide" tone="text-emerald-600 dark:text-emerald-400" tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon={<TrendingUp className="size-4" />} href="/pulse" />
        <Kpi label="Active leads" value={pulse.activeLeads ?? 0} hint={`${pulse.hotLeads ?? 0} hot`} tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<Zap className="size-4" />} href="/pulse" />
        <Kpi label="Follow-ups" value={p.followUpsDueCount ?? 0} hint="due now" tone="text-rose-600 dark:text-rose-400" tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" icon={<CalendarClock className="size-4" />} href="/pulse" />
        <Kpi label="My tasks" value={p.tasks?.length ?? 0} hint={`${p.tasksDueToday ?? 0} due today`} tile="bg-sky-500/10 text-sky-600 dark:text-sky-400" icon={<ListTodo className="size-4" />} href="/tasks?mine=true" />
        <Kpi label="Won this period" value={pulse.won ?? 0} hint={`${pulse.lost ?? 0} lost`} tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<Trophy className="size-4" />} href="/pulse" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="Pipeline by stage" subtitle={`${compact(pulse.pipelineValue)} total · ${compact(pulse.weightedForecast)} weighted`} action={<Link href="/pulse" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">Open pipeline <ArrowRight className="size-3" /></Link>} />
            <StageBarChart data={pulse.leadsByStage ?? []} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="My leads" subtitle="Nearest follow-up first" action={<Link href="/pulse" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">All leads <ArrowRight className="size-3" /></Link>} />
            {myOpen.length === 0 ? (
              <EmptyState title="No open leads assigned to you" hint="New assignments will show up here." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {myOpen.slice(0, 7).map((l: any) => (
                  <Link key={l.id} href="/pulse" className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2 transition-colors hover:bg-muted/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{l.name}{l.company ? ` · ${l.company}` : ""}</span>
                      <span className="block text-[10.5px] text-muted-foreground">{String(l.stage).replace(/_/g, " ")} · score {l.leadScore ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-[12px] font-bold tabular-nums">{compact(l.estimatedDealSize)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><ActivityCard items={data.recentActivity ?? []} /></FadeIn>
      </div>
    </div>
  );
}

function EmployeeView({ data }: { data: any }) {
  const p = data.personal ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="My open tasks" value={p.tasks?.length ?? 0} hint="assigned to me" icon={<ListTodo className="size-4" />} href="/tasks?mine=true" />
        <Kpi label="Due today" value={p.tasksDueToday ?? 0} hint="finish these first" tone="text-amber-600 dark:text-amber-400" tile="bg-amber-500/10 text-amber-600 dark:text-amber-400" icon={<CalendarClock className="size-4" />} href="/tasks?mine=true" />
        <Kpi label="Overdue" value={p.tasksOverdue ?? 0} hint="past due" tone="text-rose-600 dark:text-rose-400" tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" icon={<AlertTriangle className="size-4" />} href="/tasks?mine=true" />
        <Kpi label="Follow-ups" value={p.followUpsDueCount ?? 0} hint="leads needing a call" tile="bg-sky-500/10 text-sky-600 dark:text-sky-400" icon={<Zap className="size-4" />} href="/pulse" />
        <Kpi label="Today's events" value={p.events?.length ?? 0} hint="meetings & deadlines" tile="bg-violet-500/10 text-violet-600 dark:text-violet-400" icon={<CalendarClock className="size-4" />} href="/calendar" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FadeIn delay={0.05} className="xl:col-span-2">
          <CardShell>
            <SectionTitle title="My tasks" subtitle="Nearest due first" action={<Link href="/tasks?mine=true" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">All tasks <ArrowRight className="size-3" /></Link>} />
            <TaskList tasks={p.tasks ?? []} empty="No open tasks assigned to you" />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}><InboxCard /></FadeIn>
      </div>
    </div>
  );
}

/* ── Root ─────────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading } = useApi<any>("/dashboard/home");

  if (loading) return <DashboardSkeleton />;

  if (!data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        hint="The API could not be reached. Check that the server is running, then refresh."
      />
    );
  }

  const view: View = data.view ?? "employee";

  return (
    <div className="flex flex-col gap-5">
      <Hero data={data} userName={user?.name} roleName={user?.roleName ?? user?.role} />
      <MyDayWidget userName={user?.name} />
      <TodayWorkBoard data={data} personal={data.personal ?? {}} view={view} />
      {data.alerts ? (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
          {data.scorecard && <BusinessHealth scorecard={data.scorecard} alerts={data.alerts} />}
          <div className={data.scorecard ? "xl:col-span-2" : "xl:col-span-3"}>
            <DecisionQueue alerts={data.alerts} />
          </div>
        </div>
      ) : null}
      <ModuleBoard modules={data.moduleInsights} moduleAlerts={data.moduleAlerts} full={data} />
      {view === "owner" || view === "admin" ? (
        <OwnerView data={data} />
      ) : view === "finance" ? (
        <FinanceView data={data} />
      ) : view === "hr" ? (
        <PeopleView data={data} />
      ) : view === "sales" ? (
        <SalesView data={data} />
      ) : view === "manager" ? (
        <ManagerView data={data} />
      ) : (
        <EmployeeView data={data} />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonBlock className="h-40 rounded-3xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-28" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SkeletonBlock className="h-80 xl:col-span-2" />
        <SkeletonBlock className="h-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SkeletonBlock className="h-72 xl:col-span-2" />
        <SkeletonBlock className="h-72" />
      </div>
    </div>
  );
}
