"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  FileText,
  FolderKanban,
  Lightbulb,
  Pencil,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, percent, timeAgo } from "@/lib/format";
import {
  CardShell,
  cn,
  EmptyState,
  FadeIn,
  PageHeader,
  SectionTitle,
  SkeletonBlock,
  StatCard,
  StatusBadge,
} from "@/components/shared";
import { Btn, TableShell, THead, Th, Tr, Td } from "@/components/table";
import { Field, FormActions, Input, Modal, ScoreBar, Segmented, Select } from "@/components/ui";
import { PaymentDonut, RevenueAreaChart } from "@/components/charts";

type Tab = "overview" | "library" | "health" | "tax" | "performance" | "correlations";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "library", label: "Library" },
  { value: "health", label: "Client Health" },
  { value: "tax", label: "Tax" },
  { value: "performance", label: "Performance" },
  { value: "correlations", label: "Correlations" },
];

const METRIC_OPTIONS = [
  { value: "invoiced", label: "Invoiced" },
  { value: "collected", label: "Collected" },
  { value: "expenses", label: "Expenses" },
  { value: "conversion_rate", label: "Conversion Rate" },
  { value: "health_avg", label: "Client Health Avg" },
];

const SCHEDULE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function ErrorCard({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <CardShell className="flex flex-col items-center gap-3 py-12">
      <p className="text-body-lg text-muted-foreground">{msg}</p>
      <Btn variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" /> Retry
      </Btn>
    </CardShell>
  );
}

function useReload() {
  const [key, setKey] = useState(0);
  return { key, retry: () => setKey((k) => k + 1) };
}

const MONTH_RANK: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function monthRank(label: unknown): number {
  return MONTH_RANK[String(label ?? "").slice(0, 3).toLowerCase()] ?? -1;
}

/**
 * The insight endpoints bucket the trend in a Map and then sort the *labels*
 * (`month.localeCompare`) before slicing, so the series arrives as
 * Nov → Oct → Sep (audit UX-15). Labels carry no year, so we rebuild the
 * chronological order from the month ranks and rotate at the largest gap —
 * that gap is the year boundary — instead of trusting the server order.
 */
function orderTrend<T extends { month?: string | null }>(rows: T[] | null | undefined): T[] {
  const list = rows ?? [];
  const ranked = list.filter((r) => monthRank(r.month) >= 0);
  if (ranked.length < 2) return [...list];
  const sorted = [...ranked].sort((a, b) => monthRank(a.month) - monthRank(b.month));
  let wrapAt = sorted.length - 1;
  let widest = -1;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const gap = (monthRank(next.month) - monthRank(sorted[i].month) + 12) % 12 || 12;
    if (gap > widest) {
      widest = gap;
      wrapAt = i;
    }
  }
  return [...sorted.slice(wrapAt + 1), ...sorted.slice(0, wrapAt + 1)];
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <p className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-stat font-heading font-bold tabular-nums">{value}</p>
    </div>
  );
}

function BarList({ items, valueKey = "revenue", barClass = "bg-brand-gradient" }: any) {
  const max = Math.max(...items.map((i: any) => i[valueKey] ?? 0), 1);
  return (
    <div className="flex flex-col gap-3">
      {items.map((it: any) => (
        <div key={it.name} className="flex items-center gap-3">
          <span className="w-32 truncate text-body text-muted-foreground">{it.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", barClass)}
              style={{ width: `${(it[valueKey] / max) * 100}%` }}
            />
          </div>
          <span className="w-20 text-right text-body font-bold tabular-nums">
            {formatBDT(it[valueKey])}
          </span>
        </div>
      ))}
      {!items.length && <p className="text-body text-muted-foreground">No data yet</p>}
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const ovReload = useReload();
  const libReload = useReload();
  const healthReload = useReload();
  const taxReload = useReload();
  const perfReload = useReload();
  const corrReload = useReload();

  const { data: ov, error: ovErr, loading: ovLoading } = useApi<any>(
    tab === "overview" ? `/insight/report/overview?t=${ovReload.key}` : null
  );
  const { data: health, error: healthErr, loading: healthLoading } = useApi<any[]>(
    tab === "health" ? `/insight/report/client-health?t=${healthReload.key}` : null
  );
  const { data: tax, error: taxErr, loading: taxLoading } = useApi<any>(
    tab === "tax" ? `/insight/report/tax?t=${taxReload.key}` : null
  );
  const { data: perf, error: perfErr, loading: perfLoading } = useApi<any>(
    tab === "performance" ? `/insight/report/performance?t=${perfReload.key}` : null
  );
  const { data: metrics, error: metricsErr } = useApi<any[]>(
    tab === "correlations" ? `/insight/metrics?t=${corrReload.key}` : null
  );
  const { data: corrData, error: corrErr } = useApi<any[]>(
    tab === "correlations" ? `/insight/correlations?t=${corrReload.key}` : null
  );
  const { data: digests, error: digestsErr } = useApi<any[]>(
    tab === "correlations" ? `/insight/digests?t=${corrReload.key}` : null
  );
  const { data: reportsData, loading: libLoading, error: libErr } = useApi<any[]>(
    tab === "library" ? `/insight/reports?t=${libReload.key}` : null
  );

  const [reports, setReports] = useState<any[]>([]);
  const [corr, setCorr] = useState<any[]>([]);
  useEffect(() => {
    if (reportsData) setReports(reportsData);
  }, [reportsData]);
  useEffect(() => {
    if (corrData) setCorr(corrData);
  }, [corrData]);

  const [formOpen, setFormOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    metrics: string[];
    schedule: string;
    runNow: boolean;
  }>({ name: "", metrics: [], schedule: "", runNow: false });

  function openCreate() {
    setForm({ name: "", metrics: [], schedule: "", runNow: false });
    setFormErr(null);
    setFormOpen(true);
  }

  function openEdit(r: any) {
    setForm({
      id: r.id,
      name: r.name,
      metrics: r.metrics ?? [],
      schedule: r.schedule ?? "",
      runNow: false,
    });
    setFormErr(null);
    setFormOpen(true);
  }

  function toggleMetric(v: string) {
    setForm((f) => ({
      ...f,
      metrics: f.metrics.includes(v) ? f.metrics.filter((m) => m !== v) : [...f.metrics, v],
    }));
  }

  async function saveReport(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    try {
      const body: any = {
        name: form.name,
        metrics: form.metrics,
        schedule: form.schedule || undefined,
      };
      if (form.id) {
        const updated = await apiFetch(`/insight/reports/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, runNow: form.runNow }),
        });
        setReports((rs) => rs.map((r) => (r.id === form.id ? { ...r, ...updated } : r)));
      } else {
        const created = await apiFetch("/insight/reports", {
          method: "POST",
          body: JSON.stringify(body),
        });
        let report = created;
        if (form.runNow) {
          const run = await apiFetch(`/insight/reports/${created.id}/run`, { method: "POST" });
          report = run.report;
          setResult(run);
        }
        setReports((rs) => [report, ...rs]);
      }
      setFormOpen(false);
    } catch (e: any) {
      setFormErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runReport(r: any) {
    setActionErr(null);
    try {
      const res = await apiFetch(`/insight/reports/${r.id}/run`, { method: "POST" });
      setResult(res);
      setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, lastRunAt: res.report.lastRunAt } : x)));
    } catch (e: any) {
      setActionErr(e.message);
    }
  }

  async function deleteReport(r: any) {
    setActionErr(null);
    try {
      await apiFetch(`/insight/reports/${r.id}`, { method: "DELETE" });
      setReports((rs) => rs.filter((x) => x.id !== r.id));
    } catch (e: any) {
      setActionErr(e.message);
    }
    setConfirmId(null);
  }

  async function dismissInsight(id: string) {
    try {
      await apiFetch(`/insight/correlations/${id}/dismiss`, { method: "PATCH" });
      setCorr((cs) => cs.filter((c) => c.id !== id));
    } catch {
      setActionErr("Could not dismiss insight");
    }
  }

  const revenueMetric = metrics?.find((m) => m.metric === "monthly_invoiced");
  const trendData = (revenueMetric?.points ?? []).map((p: any, i: number) => ({
    month: new Date(p.date).toLocaleDateString("en-US", { month: "short" }),
    invoiced: p.value,
    collected: metrics?.find((m) => m.metric === "monthly_collected")?.points?.[i]?.value ?? 0,
    expenses: metrics?.find((m) => m.metric === "monthly_expenses")?.points?.[i]?.value ?? 0,
  }));

  const r = result?.result;

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Executive overview, saved report library, and cross-module analytics."
        actions={
          <Btn variant="primary" onClick={openCreate}>
            <Plus className="size-3.5" /> New Report
          </Btn>
        }
      />

      <div className="mb-6 overflow-x-auto pb-1">
        <Segmented<Tab> options={TABS} value={tab} onChange={setTab} />
      </div>

      {actionErr && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-body text-rose-600 dark:text-rose-300">
          {actionErr}
        </div>
      )}

      {tab === "overview" && (
        <div>
          {ovLoading && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-28" />
              ))}
            </div>
          )}
          {ovErr && <ErrorCard msg={ovErr} onRetry={ovReload.retry} />}
          {!ovLoading && !ovErr && ov && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Revenue This Month" value={formatBDT(ov.summary.revenueThisMonth)} sub="invoiced" icon={<TrendingUp className="size-4" />} index={0} />
                <StatCard label="Collected" value={formatBDT(ov.summary.collectedThisMonth)} sub="this month" icon={<Wallet className="size-4" />} index={1} />
                <StatCard label="Expenses" value={formatBDT(ov.summary.expensesThisMonth)} sub="this month" icon={<Receipt className="size-4" />} index={2} />
                <StatCard label="Active Clients" value={ov.summary.activeClients} sub="total clients" icon={<Users className="size-4" />} index={3} />
                <StatCard label="Active Projects" value={ov.summary.activeProjects} sub="active + planning" icon={<FolderKanban className="size-4" />} index={0} />
                <StatCard label="Lead Conversion" value={percent(ov.summary.conversionRate)} sub="won of all leads" icon={<Target className="size-4" />} index={1} />
                <StatCard label="Outstanding" value={formatBDT(ov.summary.outstanding)} sub="unpaid balance" icon={<AlertCircle className="size-4" />} index={2} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <FadeIn className="xl:col-span-2">
                  <CardShell>
                    <SectionTitle title="Revenue Trend" subtitle="Invoiced vs collected over time" />
                    <RevenueAreaChart data={orderTrend(ov.trend)} />
                  </CardShell>
                </FadeIn>
                <FadeIn delay={0.1}>
                  <CardShell>
                    <SectionTitle title="Payment Methods" subtitle="Split of collected revenue" />
                    {ov.paymentMethods.length ? (
                      <PaymentDonut data={ov.paymentMethods} />
                    ) : (
                      <p className="text-body text-muted-foreground">No payments recorded yet</p>
                    )}
                  </CardShell>
                </FadeIn>
                <FadeIn className="xl:col-span-3">
                  <CardShell>
                    <SectionTitle title="Top Clients" subtitle="By invoiced revenue" />
                    <div className="flex flex-col gap-2.5">
                      {ov.topClients.map((c: any, i: number) => (
                        <div key={c.name} className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-bold",
                              i < 3
                                ? "bg-brand-gradient text-white"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {i + 1}
                          </span>
                          <span className="flex-1 truncate text-body font-medium">{c.name}</span>
                          <span className="text-body font-bold tabular-nums">{formatBDT(c.revenue)}</span>
                        </div>
                      ))}
                      {!ov.topClients.length && (
                        <p className="text-body text-muted-foreground">No client revenue yet</p>
                      )}
                    </div>
                  </CardShell>
                </FadeIn>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "library" && (
        <div>
          {libLoading && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-16" />
              ))}
            </div>
          )}
          {libErr && <ErrorCard msg={libErr} onRetry={libReload.retry} />}
          {!libLoading && !libErr && (
            <>
              {!reports.length ? (
                <EmptyState title="No saved reports yet" hint="Create one to pin your favorite view" />
              ) : (
                <TableShell>
                  <table className="w-full">
                    <THead>
                      <Th>Name</Th>
                      <Th>Metrics</Th>
                      <Th>Schedule</Th>
                      <Th>Last Run</Th>
                      <Th className="text-right">Actions</Th>
                    </THead>
                    <tbody>
                      {reports.map((rpt, i) => (
                        <Tr key={rpt.id} index={i}>
                          <Td className="font-semibold">{rpt.name}</Td>
                          <Td className="max-w-64">
                            <span className="block truncate text-body text-muted-foreground">
                              {(rpt.metrics ?? []).join(", ") || "—"}
                            </span>
                          </Td>
                          <Td>
                            {rpt.schedule ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-meta font-semibold text-primary dark:text-primary">
                                <BarChart3 className="size-3.5" />
                                {SCHEDULE_LABELS[rpt.schedule] ?? rpt.schedule}
                              </span>
                            ) : (
                              <span className="text-body text-muted-foreground">No schedule</span>
                            )}
                          </Td>
                          <Td>
                            <span className="text-body tabular-nums text-muted-foreground">
                              {timeAgo(rpt.lastRunAt)}
                            </span>
                          </Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1">
                              <Btn variant="ghost" onClick={() => runReport(rpt)}>
                                <Play className="size-3.5" />
                              </Btn>
                              <Btn variant="ghost" onClick={() => openEdit(rpt)}>
                                <Pencil className="size-3.5" />
                              </Btn>
                              <Btn
                                variant="ghost"
                                className={cn(
                                  confirmId === rpt.id && "text-rose-500 hover:bg-rose-500/10"
                                )}
                                onClick={() =>
                                  confirmId === rpt.id ? deleteReport(rpt) : setConfirmId(rpt.id)
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Btn>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
              <p className="mt-3 text-meta text-muted-foreground">
                Click delete twice to confirm removal.
              </p>
            </>
          )}
        </div>
      )}

      {tab === "health" && (
        <div>
          {healthLoading && <SkeletonBlock className="h-72" />}
          {healthErr && <ErrorCard msg={healthErr} onRetry={healthReload.retry} />}
          {!healthLoading && !healthErr && (
            <>
              {!health?.length ? (
                <EmptyState title="No clients yet" />
              ) : (
                <TableShell>
                  <table className="w-full">
                    <THead>
                      <Th>Company</Th>
                      <Th>Health Score</Th>
                      <Th>Level</Th>
                      <Th>Renewal</Th>
                      <Th>Projects</Th>
                      <Th>Total Revenue</Th>
                      <Th>Last Note</Th>
                    </THead>
                    <tbody>
                      {health.map((c: any, i: number) => (
                        <Tr key={c.id} index={i}>
                          <Td className="font-semibold">{c.companyName}</Td>
                          <Td>
                            <ScoreBar score={c.healthScore} />
                          </Td>
                          <Td>
                            <StatusBadge status={c.healthLevel ?? "GREEN"} />
                          </Td>
                          <Td>
                            <span className="text-body tabular-nums">{formatDate(c.renewalDate)}</span>
                          </Td>
                          <Td>
                            <span className="tabular-nums">{c.activeProjects}</span>
                          </Td>
                          <Td className="font-semibold tabular-nums">{formatBDT(c.totalRevenue)}</Td>
                          <Td>
                            <span className="block max-w-56 truncate text-body text-muted-foreground" title={c.lastNote ?? ""}>
                              {c.lastNote ?? "—"}
                            </span>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </>
          )}
        </div>
      )}

      {tab === "tax" && (
        <div>
          {taxLoading && <SkeletonBlock className="h-72" />}
          {taxErr && <ErrorCard msg={taxErr} onRetry={taxReload.retry} />}
          {!taxLoading && !taxErr && tax && (
            <>
              {!tax.rows.length ? (
                <EmptyState title="No taxable activity yet" />
              ) : (
                <TableShell>
                  <table className="w-full">
                    <THead>
                      <Th>Quarter</Th>
                      <Th className="text-right">Invoiced</Th>
                      <Th className="text-right">Collected</Th>
                      <Th className="text-right">Expenses</Th>
                      <Th className="text-right">Net</Th>
                      <Th className="text-right">Estimated Tax</Th>
                    </THead>
                    <tbody>
                      {tax.rows.map((row: any, i: number) => (
                        <Tr key={row.label} index={i}>
                          <Td className="font-semibold">{row.label}</Td>
                          <Td className="text-right tabular-nums">{formatBDT(row.invoiced)}</Td>
                          <Td className="text-right tabular-nums">{formatBDT(row.collected)}</Td>
                          <Td className="text-right tabular-nums">{formatBDT(row.expenses)}</Td>
                          <Td className="text-right font-semibold tabular-nums">{formatBDT(row.net)}</Td>
                          <Td className="text-right font-semibold tabular-nums text-primary dark:text-primary">
                            {formatBDT(row.estimatedTax)}
                          </Td>
                        </Tr>
                      ))}
                      <Tr className="bg-muted/40 font-semibold">
                        <Td className="font-bold">Total · FY {tax.fiscalYear}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.invoiced)}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.collected)}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.expenses)}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.net)}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.estimatedTax)}</Td>
                      </Tr>
                    </tbody>
                  </table>
                </TableShell>
              )}
              <p className="mt-3 text-meta text-muted-foreground">
                Estimated tax @ {Math.round(tax.taxRate * 100)}% of net (collected − expenses).
              </p>
            </>
          )}
        </div>
      )}

      {tab === "performance" && (
        <div>
          {perfLoading && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2">
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
            </div>
          )}
          {perfErr && <ErrorCard msg={perfErr} onRetry={perfReload.retry} />}
          {!perfLoading && !perfErr && perf && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Avg Deal Value" value={formatBDT(perf.avgDealValue)} sub="won deals" icon={<Briefcase className="size-4" />} index={0} />
                <StatCard label="Team Size" value={perf.teamSize} sub="employees" icon={<Users className="size-4" />} index={1} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <FadeIn>
                  <CardShell>
                    <SectionTitle title="Top Clients" subtitle="By invoiced revenue" />
                    <BarList items={perf.topClients} />
                  </CardShell>
                </FadeIn>
                <FadeIn delay={0.08}>
                  <CardShell>
                    <SectionTitle title="Revenue by Industry" subtitle="Where revenue comes from" />
                    <BarList items={perf.revenueByIndustry} barClass="bg-gradient-to-r from-primary to-fuchsia-500" />
                  </CardShell>
                </FadeIn>
              </div>

              <div className="mt-4">
                <FadeIn delay={0.12}>
                  <CardShell>
                    <SectionTitle title="Sales Reps" subtitle="Won deals by owner" />
                    <TableShell>
                      <table className="w-full">
                        <THead>
                          <Th>Rep</Th>
                          <Th className="text-right">Deals Won</Th>
                          <Th className="text-right">Value</Th>
                        </THead>
                        <tbody>
                          {(perf.salesReps ?? []).map((s: any, i: number) => (
                            <Tr key={s.name} index={i}>
                              <Td className="font-semibold">{s.name}</Td>
                              <Td className="text-right tabular-nums">{s.count}</Td>
                              <Td className="text-right font-semibold tabular-nums">{formatBDT(s.value)}</Td>
                            </Tr>
                          ))}
                          {!perf.salesReps?.length && (
                            <Tr>
                              <Td className="text-muted-foreground">No won deals yet</Td>
                              <Td />
                              <Td />
                            </Tr>
                          )}
                        </tbody>
                      </table>
                    </TableShell>
                  </CardShell>
                </FadeIn>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "correlations" && (
        <div>
          {(metricsErr || corrErr || digestsErr) && (
            <ErrorCard msg={metricsErr ?? corrErr ?? digestsErr ?? ""} onRetry={corrReload.retry} />
          )}
          {!metricsErr && !corrErr && !digestsErr && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Active Insights" value={corr?.length ?? "—"} sub="correlation engine" icon={<Lightbulb className="size-4" />} index={0} />
                <StatCard label="Digests Delivered" value={digests?.length ?? "—"} sub="executive summaries" icon={<FileText className="size-4" />} index={1} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <FadeIn className="xl:col-span-2">
                  <CardShell>
                    <SectionTitle title="Metric Snapshots" subtitle="Invoiced vs collected from snapshots" />
                    {trendData.length ? (
                      <RevenueAreaChart data={trendData} />
                    ) : (
                      <SkeletonBlock className="h-60" />
                    )}
                  </CardShell>
                </FadeIn>

                <FadeIn delay={0.1}>
                  <CardShell>
                    <SectionTitle title="Correlation Insights" subtitle="Dismissible — surfaced by the engine" />
                    <div className="flex flex-col gap-3">
                      {corr?.map((ins) => (
                        <div key={ins.id} className={cn("rounded-xl p-3.5", ins.dismissedAt ? "bg-muted/40 opacity-60" : "bg-brand-gradient-soft")}>
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient">
                              <Lightbulb className="size-3.5 text-white" />
                            </span>
                            <div className="flex-1">
                              <p className="text-body font-medium leading-snug">{ins.description}</p>
                              <p className="mt-1 text-micro text-muted-foreground">
                                {ins.confidenceLevel ? `${Math.round(ins.confidenceLevel * 100)}% confidence` : "New"} · {timeAgo(ins.surfacedAt)}
                                {ins.dismissedAt ? " · dismissed" : ""}
                              </p>
                            </div>
                            {!ins.dismissedAt && (
                              <button
                                onClick={() => dismissInsight(ins.id)}
                                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                title="Dismiss"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {!corr?.length && (
                        <p className="text-body text-muted-foreground">No insights yet — data history accumulates</p>
                      )}
                    </div>
                  </CardShell>
                </FadeIn>
              </div>

              <div className="mt-4">
                <FadeIn delay={0.15}>
                  <CardShell>
                    <SectionTitle title="Executive Digests" subtitle="Recently generated summaries" />
                    <div className="flex flex-col gap-2.5">
                      {digests?.map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-gradient-soft">
                              <FileText className="size-4 text-primary dark:text-primary" />
                            </span>
                            <div>
                              <p className="text-body font-semibold">{d.period}</p>
                              <p className="text-micro text-muted-foreground">{timeAgo(d.generatedAt)}</p>
                            </div>
                          </div>
                          <StatusBadge status={d.deliveryStatus ?? "SENT"} />
                        </div>
                      ))}
                      {!digests?.length && (
                        <p className="text-body text-muted-foreground">No digests generated yet</p>
                      )}
                    </div>
                  </CardShell>
                </FadeIn>
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={form.id ? "Edit Report" : "New Report"} size="md">
        <form onSubmit={saveReport} className="flex flex-col gap-4">
          <Field label="Report name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Monthly executive summary"
              required
            />
          </Field>
          <Field label="Metrics">
            <div className="flex flex-wrap gap-2">
              {METRIC_OPTIONS.map((m) => {
                const on = form.metrics.includes(m.value);
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => toggleMetric(m.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-body font-semibold transition-all",
                      on
                        ? "border-primary/50 bg-primary/10 text-primary dark:text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Schedule">
            <Select
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            >
              <option value="">No schedule</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
            <input
              type="checkbox"
              checked={form.runNow}
              onChange={(e) => setForm({ ...form, runNow: e.target.checked })}
              className="size-4 accent-primary"
            />
            Run immediately after saving
          </label>
          {formErr && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-body text-rose-600 dark:text-rose-300">
              {formErr}
            </p>
          )}
          <FormActions busy={busy} cancel={() => setFormOpen(false)} submitLabel={form.id ? "Save" : "Create"} />
        </form>
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} title={`${result?.report?.name ?? "Report"} · Result`} size="xl">
        {r && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <MiniStat label="Revenue" value={formatBDT(r.summary.revenueThisMonth)} />
              <MiniStat label="Collected" value={formatBDT(r.summary.collectedThisMonth)} />
              <MiniStat label="Expenses" value={formatBDT(r.summary.expensesThisMonth)} />
              <MiniStat label="Active Clients" value={r.summary.activeClients} />
              <MiniStat label="Active Projects" value={r.summary.activeProjects} />
              <MiniStat label="Lead Conversion" value={percent(r.summary.conversionRate)} />
              <MiniStat label="Outstanding" value={formatBDT(r.summary.outstanding)} />
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div>
                <p className="mb-2 text-body font-semibold text-muted-foreground">Revenue Trend</p>
                <RevenueAreaChart data={orderTrend(r.trend)} height={200} />
              </div>
              <div>
                <p className="mb-2 text-body font-semibold text-muted-foreground">Payment Methods</p>
                {r.paymentMethods.length ? (
                  <PaymentDonut data={r.paymentMethods} />
                ) : (
                  <p className="text-body text-muted-foreground">No payments recorded</p>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-body font-semibold text-muted-foreground">Top Clients</p>
              <BarList items={r.topClients} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}