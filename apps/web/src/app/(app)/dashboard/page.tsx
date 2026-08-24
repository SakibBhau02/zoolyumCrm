"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Flame,
  ListTodo,
  Trophy,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import type { DashboardOverview } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { formatBDT, formatDay, formatNumber, timeAgo } from "@/lib/format";
import {
  CardShell,
  EmptyState,
  FadeIn,
  GradientBadge,
  SectionTitle,
  SkeletonBlock,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/shared";
import {
  PaymentDonut,
  ProgressRing,
  RevenueAreaChart,
  StageBarChart,
  UtilizationHeatmap,
} from "@/components/charts";

const EASE = [0.22, 1, 0.36, 1] as const;

function RiskFlagRow({
  icon,
  tone,
  title,
  sub,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl p-2 transition-colors hover:bg-muted/50">
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", tone)}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: overview, loading } = useApi<DashboardOverview>("/dashboard/overview");
  const { data: employees } = useApi<any[]>("/people/employees");
  const { data: utilization } = useApi<any>("/people/utilization");

  const roleKey = (user?.roleName ?? user?.role ?? "").toLowerCase();
  const isOwner = roleKey.includes("owner") || roleKey === "admin";
  const isSales = roleKey.includes("sales") || roleKey.includes("bd");
  const isPm = roleKey.includes("project") || roleKey.includes("pm") || roleKey.includes("team");
  const myLeadsPath = !isOwner && isSales && user?.id ? `/pulse/leads?assignedToId=${user.id}` : null;
  const myTasksPath = !isOwner && !isSales && isPm && user?.id ? "/tasks?mine=true" : null;
  const { data: myLeads } = useApi<any[]>(myLeadsPath);
  const { data: myTasks } = useApi<any[]>(myTasksPath);

  if (loading) return <DashboardSkeleton />;

  if (!overview) return <EmptyState title="Dashboard data unavailable" />;

  const { pulse, accounts, flow, tasks, people, capital, insight, recentActivity, topClients } =
    overview;

  const healthDonutData = [
    { name: "Healthy", value: accounts.health.GREEN ?? 0, fill: "var(--chart-3)" },
    { name: "Watch", value: accounts.health.YELLOW ?? 0, fill: "var(--chart-4)" },
    { name: "At risk", value: accounts.health.RED ?? 0, fill: "var(--chart-5)" },
  ].filter((d) => d.value > 0);

  const heatRows =
    utilization?.rows?.map((r: any) => ({
      name: r.name.split(" ")[0],
      values: r.values,
    })) ?? [];

  const riskFeed = [
    ...flow.atRisk.map((p) => ({
      key: `p-${p.id}`,
      icon: <Flame className="size-3.5 text-rose-500" />,
      tone: "bg-rose-500/10",
      title: p.name,
      sub: `${p.healthStatus.replace(/_/g, " ")} · risk ${p.riskScore ?? "—"} · ${p.riskDriver ?? ""}`,
    })),
    ...capital.overdueInvoices.map((i) => ({
      key: `i-${i.id}`,
      icon: <AlertTriangle className="size-3.5 text-amber-500" />,
      tone: "bg-amber-500/10",
      title: `${i.invoiceNumber} overdue`,
      sub: `${formatBDT(i.amount)} · due ${formatDay(i.dueDate)}`,
    })),
    ...(accounts.health.RED > 0
      ? [
          {
            key: "clients-red",
            icon: <Building2 className="size-3.5 text-rose-500" />,
            tone: "bg-rose-500/10",
            title: `${accounts.health.RED} client${accounts.health.RED > 1 ? "s" : ""} in the red`,
            sub: "Churn risk watchlist active",
          },
        ]
      : []),
  ].slice(0, 6);

  const myOpenLeads = (myLeads ?? []).filter((l: any) => l.stage !== "WON" && l.stage !== "LOST");
  const myPipelineValue = myOpenLeads.reduce((s: number, l: any) => s + (Number(l.estimatedDealSize) || 0), 0);
  const myFollowUps = myOpenLeads.filter(
    (l: any) => l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= Date.now()
  ).length;

  const myOpenTasks = (myTasks ?? []).filter((t: any) => t.status !== "DONE");
  const todayIso = new Date().toISOString().slice(0, 10);
  const myDueToday = myOpenTasks.filter((t: any) => String(t.dueDate ?? "").slice(0, 10) === todayIso).length;
  const myInReview = myOpenTasks.filter((t: any) => t.status === "IN_REVIEW").length;

  return (
    <div>
      {/* ── Hero banner ── */}
      <FadeIn>
        <div className="relative mb-6 overflow-hidden rounded-3xl bg-sidebar p-7 text-white">
          <div className="pointer-events-none absolute -left-16 -top-20 size-64 animate-pulse-glow rounded-full bg-primary/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 right-10 size-72 animate-pulse-glow rounded-full bg-indigo-500/20 blur-3xl" style={{ animationDelay: "1.5s" }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 grid-pattern opacity-60" />
          <div className="relative">
            <div className="mb-4 flex items-center gap-2">
              <GradientBadge>FY 2026</GradientBadge>
              {user?.roleName && (
                <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80">
                  {user.roleName}
                </span>
              )}
              <span className="text-[11px] font-medium text-white/50">
                Updated {timeAgo(overview.generatedAt)}
              </span>
            </div>
            <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              Assalamu Alaikum, {user?.name?.split(" ")[0]}! 👋
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] text-white/60">
              <span className="font-semibold text-emerald-400">
                ৳{formatNumber(pulse.weightedForecast / 1000)}k weighted pipeline
              </span>{" "}
              · {tasks.dueToday} task{tasks.dueToday === 1 ? "" : "s"} due today ·{" "}
              {capital.overdueInvoices.length} overdue invoice{capital.overdueInvoices.length === 1 ? "" : "s"}.
              The whole loop — lead to cash — in one place.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link
                href="/tasks"
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:scale-[1.02]"
              >
                <ListTodo className="size-4" /> Log time
              </Link>
              <Link
                href="/capital"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
              >
                <Wallet className="size-4" /> Create invoice
              </Link>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pipeline Value"
          value={formatBDT(pulse.pipelineValue)}
          sub={`${pulse.activeLeads} active leads`}
          delta="+12.4%"
          icon={<Zap className="size-5" />}
          index={0}
        />
        <StatCard
          label="Recognized Revenue"
          value={formatBDT(capital.recognizedRevenue)}
          sub="invoiced this period"
          delta="+9.8%"
          icon={<Wallet className="size-5" />}
          index={1}
        />
        <StatCard
          label="Active Projects"
          value={formatNumber(flow.activeProjects)}
          sub={`${flow.atRisk.length} at risk`}
          delta="+2"
          icon={<Workflow className="size-5" />}
          index={2}
        />
        <StatCard
          label="Team Utilization"
          value={`${people.avgUtilization}%`}
          sub={`${people.overloaded} overloaded`}
          delta="+3.2%"
          icon={<Users className="size-5" />}
          index={3}
        />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <CardShell>
            <SectionTitle
              title="Revenue Trend"
              subtitle="Invoiced vs collected — last 8 months"
              action={
                <Link href="/capital" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  View full report <ArrowRight className="size-3" />
                </Link>
              }
            />
            <RevenueAreaChart data={capital.revenueTrend} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell>
            <SectionTitle title="Payment Split" subtitle="By method — bKash, Nagad, bank" />
            {capital.paymentSplit.length ? (
              <PaymentDonut data={capital.paymentSplit} />
            ) : (
              <EmptyState title="No payments recorded yet" />
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-4">
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Cash position</p>
                <p className="text-[15px] font-heading font-bold tabular-nums">{formatBDT(capital.cashPosition)}</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Pending approvals</p>
                <p className="text-[15px] font-heading font-bold tabular-nums">{capital.pendingExpenses}</p>
              </div>
            </div>
          </CardShell>
        </FadeIn>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <CardShell>
            <SectionTitle
              title="Pipeline by Stage"
              subtitle={`Weighted forecast ৳${formatNumber(pulse.weightedForecast / 1000)}k · ${pulse.hotLeads} hot leads`}
              action={
                <Link href="/pulse" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  Open pipeline <ArrowRight className="size-3" />
                </Link>
              }
            />
            <StageBarChart data={pulse.leadsByStage} />
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          {myLeadsPath ? (
            <CardShell>
              <SectionTitle
                title="My Pipeline"
                subtitle="Leads I own"
                action={
                  <Link href="/pulse" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                    Pipeline <ArrowRight className="size-3" />
                  </Link>
                }
              />
              <p className="text-[22px] font-heading font-bold tabular-nums text-gradient">{formatBDT(myPipelineValue)}</p>
              <p className="text-[11px] text-muted-foreground">weighted value · {myOpenLeads.length} open lead{myOpenLeads.length === 1 ? "" : "s"}</p>
              <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><Flame className="size-3.5 text-primary" /> Open</span>
                  <span className="font-bold tabular-nums">{myOpenLeads.length}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="size-3.5 text-amber-500" /> Follow-ups due</span>
                  <span className={cn("font-bold tabular-nums", myFollowUps > 0 && "text-rose-400")}>{myFollowUps}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><Trophy className="size-3.5 text-emerald-500" /> Won</span>
                  <span className="font-bold tabular-nums">{(myLeads ?? []).filter((l: any) => l.stage === "WON").length}</span>
                </div>
              </div>
            </CardShell>
          ) : myTasksPath ? (
            <CardShell>
              <SectionTitle
                title="My Tasks"
                subtitle="Assigned to me"
                action={
                  <Link href="/tasks" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                    Tasks <ArrowRight className="size-3" />
                  </Link>
                }
              />
              <p className="text-[22px] font-heading font-bold tabular-nums text-gradient">{myOpenTasks.length}</p>
              <p className="text-[11px] text-muted-foreground">open task{myOpenTasks.length === 1 ? "" : "s"} in flight</p>
              <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="size-3.5 text-amber-500" /> Due today</span>
                  <span className={cn("font-bold tabular-nums", myDueToday > 0 && "text-rose-400")}>{myDueToday}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><Zap className="size-3.5 text-sky-500" /> In review</span>
                  <span className="font-bold tabular-nums">{myInReview}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><ListTodo className="size-3.5 text-emerald-500" /> Done</span>
                  <span className="font-bold tabular-nums">{(myTasks ?? []).filter((t: any) => t.status === "DONE").length}</span>
                </div>
              </div>
            </CardShell>
          ) : (
            <CardShell>
              <SectionTitle title="Risk Flags" subtitle="Needs attention today" />
              <div className="flex flex-col gap-0.5">
                {riskFeed.length ? (
                  riskFeed.map(({ key, ...rest }) => <RiskFlagRow key={key} {...rest} />)
                ) : (
                  <EmptyState title="All quiet — nothing at risk" />
                )}
              </div>
            </CardShell>
          )}
        </FadeIn>
      </div>

      {/* ── Charts row 3 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <CardShell>
            <SectionTitle
              title="Team Utilization"
              subtitle={`Last 4 weeks · avg ${people.avgUtilization}% · ${people.overloaded} over 105%`}
              action={
                <Link href="/people" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  Open People <ArrowRight className="size-3" />
                </Link>
              }
            />
            {heatRows.length ? (
              <UtilizationHeatmap rows={heatRows} weeks={utilization?.weeks ?? []} />
            ) : (
              <EmptyState title="No utilization data" />
            )}
            <div className="mt-4 flex items-center justify-end gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> &lt;85%</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" /> 85–94%</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" /> 95–104%</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" /> 105%+</span>
            </div>
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell>
            <SectionTitle
              title="Client Health"
              subtitle={`Avg score ${accounts.avgHealth}/100`}
              action={
                <Link href="/accounts" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  Accounts <ArrowRight className="size-3" />
                </Link>
              }
            />
            <div className="flex items-center gap-6">
              <div className="relative h-[150px] w-[150px] shrink-0">
                <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                  <circle cx="32" cy="32" r="26" fill="none" stroke="oklch(0.9 0.01 285)" strokeWidth="8" />
                  <motion.circle
                    cx="32" cy="32" r="26" fill="none" stroke="var(--chart-3)" strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 26}
                    initial={{ strokeDashoffset: 2 * Math.PI * 26 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 26 * (1 - (accounts.health.GREEN ?? 0) / Math.max(accounts.totalClients, 1)) }}
                    transition={{ duration: 1.2, ease: EASE }}
                  />
                  <motion.circle
                    cx="32" cy="32" r="26" fill="none" stroke="var(--chart-4)" strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 26}
                    initial={{ strokeDashoffset: 2 * Math.PI * 26 }}
                    animate={{
                      strokeDashoffset: 2 * Math.PI * 26 * (1 - (accounts.health.GREEN ?? 0) / Math.max(accounts.totalClients, 1) - (accounts.health.YELLOW ?? 0) / Math.max(accounts.totalClients, 1)),
                    }}
                    transition={{ duration: 1.2, ease: EASE }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-heading font-bold tabular-nums">{accounts.totalClients}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">clients</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2.5">
                {healthDonutData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: d.fill }} />
                    <span className="flex-1 text-[12px] capitalize text-muted-foreground">{d.name}</span>
                    <span className="text-[12.5px] font-bold tabular-nums">{d.value}</span>
                  </div>
                ))}
                <div className="mt-1 rounded-xl bg-muted/60 p-2.5">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
                    <CalendarClock className="size-3.5 text-primary" />
                    {accounts.renewalsNext30} renewal{accounts.renewalsNext30 === 1 ? "" : "s"} in 30 days
                  </p>
                </div>
              </div>
            </div>
          </CardShell>
        </FadeIn>
      </div>

      {/* ── Top clients strip ── */}
      <FadeIn delay={0.1}>
        <CardShell className="relative mt-4 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
          <SectionTitle
            title="Top Clients by Revenue"
            subtitle="Recognized revenue · ranked"
            action={
              <Link href="/accounts" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                All clients <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {topClients.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  "relative rounded-2xl border border-border/60 p-4 transition-transform hover:-translate-y-1",
                  i === 0 && "bg-amber-500/10 border-amber-500/30"
                )}
              >
                {i === 0 && (
                  <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-brand-gradient px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
                    <Trophy className="size-3" /> Topper
                  </span>
                )}
                <p className="truncate text-[13px] font-heading font-semibold">{c.companyName}</p>
                <p className="mt-0.5 text-[18px] font-heading font-bold tabular-nums text-gradient">
                  {formatBDT(c.revenue)}
                </p>
                <div className="mt-2">
                  <StatusBadge status={c.healthLevel} />
                </div>
              </div>
            ))}
          </div>
        </CardShell>
      </FadeIn>

      {/* ── Insight cards + recent activity ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <CardShell>
            <SectionTitle
              title="New Insights"
              subtitle="Cross-module correlations surfaced by the engine"
              action={
                <Link href="/insight" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  Insight <ArrowRight className="size-3" />
                </Link>
              }
            />
            <div className="flex flex-col gap-2.5">
              {insight.insights.slice(0, 3).map((ins) => (
                <div key={ins.id} className="rounded-xl bg-brand-gradient-soft p-3.5">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient">
                      <Zap className="size-3.5 text-white" />
                    </span>
                    <div>
                      <p className="text-[12.5px] font-medium leading-snug">{ins.description}</p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        {ins.confidenceLevel ? `${Math.round(ins.confidenceLevel * 100)}% confidence` : "New"} · {timeAgo(ins.surfacedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardShell>
        </FadeIn>
        <FadeIn delay={0.1}>
          <CardShell>
            <SectionTitle title="Recent Activity" subtitle="Portal, tasks & system" />
            <div className="flex flex-col gap-3">
              {recentActivity.slice(0, 7).map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      a.kind === "portal" ? "bg-primary" : a.kind === "task" ? "bg-sky-500" : "bg-emerald-500"
                    )}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] leading-snug">{a.text}</p>
                    <p className="text-[10.5px] text-muted-foreground">{timeAgo(a.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardShell>
        </FadeIn>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <SkeletonBlock className="h-40 rounded-3xl" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-28" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonBlock className="h-72 lg:col-span-2" />
        <SkeletonBlock className="h-72" />
      </div>
    </div>
  );
}