"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote,
  Building2,
  CircleDollarSign,
  Eye,
  Info,
  Plus,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";
import { useCapital } from "../_components/capital-context";
import { formatBDT, formatDate, formatDay } from "@/lib/format";
import { CardShell, EmptyState, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { PAYMENT_METHODS, label } from "../_components/constants";
import { MiniBars } from "@/components/dashboard/viz";

/* ────────────────────────────────────────────────────────────────────────────
   Dollar Desk — selling USD to clients at a spread.

   profit = BDT received − (USD × configured cost rate)

   A client buys currency directly; no project is involved. The rate applied to
   each sale is snapshotted, so later rate changes never rewrite past profit.
   ──────────────────────────────────────────────────────────────────────────── */

const usd = (n: any) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

function Kpi({
  label: l,
  value,
  hint,
  icon,
  tone,
  tile,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: string;
  tile?: string;
}) {
  return (
    <CardShell className="relative overflow-hidden">
      <span className={cn("flex size-9 items-center justify-center rounded-xl", tile ?? "bg-primary/10 text-primary")}>{icon}</span>
      <p className={cn("mt-3 font-heading text-[22px] font-bold leading-none tracking-tight tabular-nums", tone)}>{value}</p>
      <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
      <p className="mt-1 truncate text-[10.5px] text-muted-foreground">{hint}</p>
    </CardShell>
  );
}

export default function DollarDeskPage() {
  const { data, loading, mutate } = useApi<any>("/capital/dollar/sales");
  const c = useCapital();
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const rows: any[] = data?.rows ?? [];
  const summary = data?.summary ?? {};
  const rate = data?.rate ?? { costRate: 130, configured: false };
  const costRate = Number(rate.costRate ?? 130);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (clientId && r.clientId !== clientId) return false;
      if (!needle) return true;
      const hay = `${r.reference} ${r.client?.companyName ?? ""} ${r.notes ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, clientId]);
  // Live row for the detail drawer.
  const detail = useMemo(() => rows.find((r) => r.id === detailId) ?? null, [rows, detailId]);

  const month = summary.month ?? {};
  const allTime = summary.allTime ?? {};

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/capital/dollar/sales/${id}`, { method: "DELETE" });
      setConfirmId(null);
      mutate();
      c.reload();
      c.notify("Dollar sale reversed");
    } catch (e: any) {
      c.notify(e.message ?? "Could not delete");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-[15px] font-semibold">Dollar desk</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              <CircleDollarSign className="size-3" /> 1 USD = ৳{costRate}
            </span>
            {!rate.configured && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                Default rate — set it in Control
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Clients buy dollars directly. Profit = BDT received − (USD × cost rate); the rate is frozen on every sale.
          </p>
        </div>
        <Link
          href="/control?tab=settings&section=financeConfig"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2 text-[11.5px] font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <Settings2 className="size-3.5" /> Set cost rate
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Profit this month"
          value={formatBDT(month.profit ?? 0)}
          hint={`${month.count ?? 0} sale(s) · ${month.marginPct ?? 0}% margin`}
          icon={<TrendingUp className="size-4" />}
          tone={(month.profit ?? 0) < 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}
          tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
        <Kpi
          label="USD sold this month"
          value={usd(month.usd ?? 0)}
          hint={`at avg ৳${month.avgSellRate ?? costRate} per $1`}
          icon={<CircleDollarSign className="size-4" />}
          tile="bg-sky-500/10 text-sky-600 dark:text-sky-400"
        />
        <Kpi
          label="BDT received"
          value={formatBDT(month.bdt ?? 0)}
          hint={`cost ${formatBDT(month.cost ?? 0)} at ৳${costRate}`}
          icon={<Wallet className="size-4" />}
        />
        <Kpi
          label="All-time profit"
          value={formatBDT(allTime.profit ?? 0)}
          hint={`${usd(allTime.usd ?? 0)} sold · ${summary.clientCount ?? 0} clients`}
          icon={<Banknote className="size-4" />}
          tile="bg-violet-500/10 text-violet-600 dark:text-violet-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SaleForm
            costRate={costRate}
            clients={c.clients ?? []}
            bankAccounts={c.bankAccounts ?? []}
            onSaved={() => {
              mutate();
              c.reload();
              c.notify("Dollar sale recorded");
            }}
          />
        </div>

        <CardShell>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <TrendingUp className="size-3.5" /> Profit trend
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Last 6 months of FX spread.</p>
          <div className="mt-3">
            <MiniBars data={data?.monthly ?? []} className="text-emerald-500" height={72} highlightLast showLabels />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-2.5">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              {formatBDT(allTime.profit ?? 0)} lifetime
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {summary.clientCount ?? 0} clients
            </span>
            {(summary.lossCount ?? 0) > 0 && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {summary.lossCount} below cost
              </span>
            )}
          </div>
          <div className="mt-3 rounded-xl bg-muted/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
            The cost rate is snapshotted at sale time. Changing it in Control never rewrites profit on past sales.
          </div>
        </CardShell>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or reference…" className="w-[240px] pl-8" />
        </div>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-[200px]">
          <option value="">All clients</option>
          {(c.clients ?? []).map((cl: any) => (
            <option key={cl.id} value={cl.id}>{cl.companyName}</option>
          ))}
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} of {rows.length} sales</span>
      </div>

      {loading && !data ? (
        <CardShell><p className="py-10 text-center text-[12px] text-muted-foreground">Loading sales…</p></CardShell>
      ) : filtered.length === 0 ? (
        <CardShell>
          <EmptyState
            title={rows.length === 0 ? "No dollar sales yet" : "Nothing matches these filters"}
            hint={rows.length === 0 ? "Record a sale above — e.g. a client pays ৳4,500 for $30. Profit appears instantly." : "Clear the search or client filter."}
          />
        </CardShell>
      ) : (
        <TableShell
          footer={
            <>
              <span className="text-[11px] text-muted-foreground">Deleting a sale reverses its journal entry and bank receipt.</span>
              <span className="text-[11px] font-semibold tabular-nums">Profit shown: {formatBDT(filtered.reduce((s, r) => s + r.profit, 0))}</span>
            </>
          }
        >
          <table className="w-full">
            <THead>
              <Th>Reference</Th>
              <Th>Client</Th>
              <Th className="text-right">USD</Th>
              <Th className="text-right">BDT received</Th>
              <Th className="text-right">Sell rate</Th>
              <Th className="text-right">Cost rate</Th>
              <Th className="text-right">Profit</Th>
              <Th className="hidden lg:table-cell text-right">Margin</Th>
              <Th className="hidden lg:table-cell">Date</Th>
              <Th />
            </THead>
            <tbody>
              {filtered.map((r, i) => (
                <Tr key={r.id} index={i} onClick={() => setDetailId(r.id)} className={cn("cursor-pointer", detailId === r.id && "bg-primary/[0.04]")}>
                  <Td>
                    <p className="font-medium">{r.reference}</p>
                    <p className="text-[10px] text-muted-foreground">{r.paymentMethod ? label(r.paymentMethod) : "—"}</p>
                  </Td>
                  <Td>
                    <p className="flex items-center gap-1.5"><Building2 className="size-3 text-muted-foreground" /> {r.client?.companyName ?? "—"}</p>
                    {r.notes && <p className="max-w-[220px] truncate text-[10px] text-muted-foreground">{r.notes}</p>}
                  </Td>
                  <Td className="text-right tabular-nums">{usd(r.usdAmount)}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.bdtAmount)}</Td>
                  <Td className="text-right tabular-nums">৳{Number(r.effectiveRate).toFixed(2)}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">৳{Number(r.costRate).toFixed(2)}</Td>
                  <Td className={cn("text-right font-semibold tabular-nums", r.profit < 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>
                    {formatBDT(r.profit)}
                  </Td>
                  <Td className={cn("hidden lg:table-cell text-right tabular-nums", r.profit < 0 ? "text-rose-500" : "text-muted-foreground")}>
                    {Number(r.marginPct).toFixed(1)}%
                  </Td>
                  <Td className="hidden lg:table-cell text-muted-foreground">{formatDay(r.date)}</Td>
                  <Td className="text-right" onClick={(ev) => ev.stopPropagation()}>
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        onClick={() => setDetailId(r.id)}
                        className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-primary"
                        title="View details"
                      >
                        <Eye className="size-3.5" />
                      </button>
                    {confirmId === r.id ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          onClick={() => void remove(r.id)}
                          disabled={busyId === r.id}
                          className="rounded-lg bg-rose-500 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                        >
                          {busyId === r.id ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmId(null)} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted">
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(r.id)}
                        className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                        title="Reverse this sale"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow="Dollar sale"
        icon={<CircleDollarSign className="size-4" />}
        title={detail?.reference ?? ""}
        subtitle={detail ? `${formatDate(detail.date)} · ${detail.client?.companyName ?? "—"}` : undefined}
        size="lg"
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-teal-500/10 to-transparent p-4">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">USD sold</p>
              <p className="mt-0.5 text-[26px] font-bold leading-tight tabular-nums">{usd(detail.usdAmount)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", Number(detail.profit) < 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300")}>
                  Profit {formatBDT(detail.profit)}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{Number(detail.marginPct).toFixed(1)}% margin</span>
              </div>
            </div>

            <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
              <header className="border-b border-border/50 bg-muted/20 px-3.5 py-2"><h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sale</h4></header>
              <div className="px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Reference</span><span className="text-right text-[11.5px] font-mono">{detail.reference}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Client</span><span className="text-right text-[11.5px] font-medium">{detail.client?.companyName ?? "—"}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Date</span><span className="text-right text-[11.5px] font-medium">{formatDate(detail.date)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Method</span><span className="text-right text-[11.5px] font-medium">{detail.paymentMethod ? label(detail.paymentMethod) : "—"}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Bank</span><span className="text-right text-[11.5px] font-medium">{detail.bankAccount?.accountName ?? "—"}</span></div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
              <header className="border-b border-border/50 bg-muted/20 px-3.5 py-2"><h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">FX &amp; profit</h4></header>
              <div className="px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">USD</span><span className="text-right font-mono text-[11.5px]">{usd(detail.usdAmount)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">BDT received</span><span className="text-right font-mono text-[11.5px]">{formatBDT(detail.bdtAmount)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Sell rate</span><span className="text-right font-mono text-[11.5px]">৳{Number(detail.effectiveRate).toFixed(2)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Cost rate</span><span className="text-right font-mono text-[11.5px]">৳{Number(detail.costRate).toFixed(2)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Profit</span><span className={cn("text-right font-mono text-[11.5px] font-bold", Number(detail.profit) < 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>{formatBDT(detail.profit)}</span></div>
                <div className="flex items-start justify-between gap-4 py-1"><span className="text-[11px] text-muted-foreground">Margin</span><span className="text-right font-mono text-[11.5px]">{Number(detail.marginPct).toFixed(1)}%</span></div>
              </div>
            </section>

            {detail.notes && (
              <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                <header className="border-b border-border/50 bg-muted/20 px-3.5 py-2"><h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes</h4></header>
                <div className="px-3.5 py-2.5"><p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{detail.notes}</p></div>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ── New sale form with live profit preview ──────────────────────────────── */

function SaleForm({
  costRate,
  clients,
  bankAccounts,
  onSaved,
}: {
  costRate: number;
  clients: any[];
  bankAccounts: any[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>({
    clientId: "",
    usdAmount: "",
    bdtAmount: "",
    date: todayStr(),
    paymentMethod: "BANK_TRANSFER",
    bankAccountId: bankAccounts[0]?.id ?? "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const usdAmount = Number(form.usdAmount) || 0;
  const bdtAmount = Number(form.bdtAmount) || 0;
  const cost = usdAmount * costRate;
  const profit = bdtAmount - cost;
  const margin = bdtAmount > 0 ? (profit / bdtAmount) * 100 : 0;
  const effective = usdAmount > 0 ? bdtAmount / usdAmount : 0;
  const loss = profit < 0 && usdAmount > 0 && bdtAmount > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/capital/dollar/sales", {
        method: "POST",
        body: JSON.stringify({
          clientId: form.clientId,
          usdAmount,
          bdtAmount,
          date: form.date,
          paymentMethod: form.paymentMethod,
          bankAccountId: form.bankAccountId || undefined,
          notes: form.notes || undefined,
        }),
      });
      setForm((f: any) => ({ ...f, clientId: "", usdAmount: "", bdtAmount: "", notes: "" }));
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Could not record the sale");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell className="relative overflow-hidden !border-primary/20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-widest text-primary">
          <Plus className="size-3" /> Record a dollar sale
        </p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          Client-level · no project needed
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Client *">
          <Select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
            <option value="">Select a client</option>
            {clients.map((cl: any) => (
              <option key={cl.id} value={cl.id}>{cl.companyName}</option>
            ))}
          </Select>
        </Field>
        <Field label="USD given *">
          <Input type="number" min="0" step="0.01" value={form.usdAmount} onChange={(e) => set("usdAmount", e.target.value)} placeholder="30" />
        </Field>
        <Field label="BDT received *">
          <Input type="number" min="0" step="0.01" value={form.bdtAmount} onChange={(e) => set("bdtAmount", e.target.value)} placeholder="4500" />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </Select>
        </Field>
        <Field label="Receive into">
          <Select value={form.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
            <option value="">Default account</option>
            {bankAccounts.map((b: any) => (
              <option key={b.id} value={b.id}>{b.accountName} · {formatBDT(b.currentBalance)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={cn(
          "rounded-xl border p-3 lg:col-span-2",
          loss ? "border-rose-500/30 bg-rose-500/[0.04]" : "border-emerald-500/25 bg-emerald-500/[0.04]"
        )}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">
                {loss ? "Loss at this rate" : "Profit on this sale"}
              </p>
              <p className={cn("mt-0.5 font-heading text-[28px] font-bold leading-none tabular-nums", loss ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>
                {bdtAmount > 0 || usdAmount > 0 ? formatBDT(profit) : "৳0"}
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {usdAmount > 0 && bdtAmount > 0
                  ? `${usd(usdAmount)} · sell ৳${effective.toFixed(2)} vs cost ৳${costRate} · margin ${margin.toFixed(1)}%`
                  : "Enter USD and BDT to see the spread"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
                Cost {formatBDT(cost)}
              </span>
              <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
                Rate ৳{costRate}/$
              </span>
            </div>
          </div>
          {loss && (
            <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-600 dark:text-rose-300">
              Selling below the ৳{costRate} cost rate. You can still record it, but it will show as a loss.
            </p>
          )}
        </div>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Client settling a foreign vendor, cash pickup…" className="min-h-[86px]" />
        </Field>
      </div>

      {error && <p className="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Info className="size-3" /> The journal posts bank + FX gain/loss automatically.
        </p>
        <Btn variant="primary" onClick={() => void submit()} disabled={busy || !form.clientId || usdAmount <= 0 || bdtAmount <= 0}>
          {busy ? "Recording…" : "Record sale"}
        </Btn>
      </div>
    </CardShell>
  );
}
