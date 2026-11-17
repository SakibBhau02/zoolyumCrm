"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { ExportSection, ProvisionSection, RevenueSection, TreasurySection } from "./_components/accounting-extra";

type Section = "periods" | "journals" | "assets" | "vat" | "bank" | "fx" | "revenue" | "provision" | "treasury" | "export";

const SECTIONS: { key: Section; label: string; hint: string }[] = [
  { key: "periods", label: "Period Close", hint: "Close and lock the books month by month" },
  { key: "journals", label: "Manual Journals", hint: "Adjustments, accruals and reclasses" },
  { key: "assets", label: "Fixed Assets", hint: "Register, depreciation and disposal" },
  { key: "revenue", label: "Revenue", hint: "Deferred revenue and monthly recognition" },
  { key: "provision", label: "Provision", hint: "Bad-debt allowance from AR ageing" },
  { key: "vat", label: "VAT & TDS", hint: "Mushak 6.3 sales / purchase registers and the return" },
  { key: "bank", label: "Bank Statement", hint: "Import, match and reconcile" },
  { key: "fx", label: "FX Revaluation", hint: "Restate open foreign-currency receivables" },
  { key: "treasury", label: "Treasury", hint: "DSO / DPO / CCC, cash forecast and petty cash" },
  { key: "export", label: "Audit Export", hint: "CSV packs for the auditor" },
];

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-meta outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const thCls = "text-left text-micro font-semibold uppercase tracking-wide text-muted-foreground";
const num = (v: any) => Number(v ?? 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStr = () => new Date().toISOString().slice(0, 7);

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</section>;
}
function Title({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-heading font-semibold">{title}</h2>
        {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      </div>
      {right}
    </div>
  );
}
function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    open: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20",
    closed: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20",
    locked: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20",
    muted: "bg-muted text-muted-foreground ring-1 ring-border",
  };
  return <span className={`rounded-md px-2 py-0.5 text-micro font-semibold ${tones[tone] ?? tones.muted}`}>{children}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-meta text-muted-foreground">{children}</div>;
}

export default function AccountingPage() {
  const [section, setSection] = useState<Section>("periods");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notify = (m: string) => { setFlash(m); setError(null); setTimeout(() => setFlash(null), 3500); };
  const fail = (e: any) => setError(e?.message ?? String(e));

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) { fail(e); }
    },
    []
  );

  return (
    <div className="space-y-4">
      <div className="scroll-x scroll-x-hint gap-1 rounded-xl border border-border bg-card p-1 sm:flex-wrap sm:overflow-visible">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-meta font-semibold transition-colors ${
              section === s.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {flash && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-meta text-emerald-600 dark:text-emerald-400">{flash}</div>}
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-400">{error}</div>}

      {section === "periods" && <PeriodsSection run={run} notify={notify} />}
      {section === "journals" && <JournalsSection run={run} notify={notify} />}
      {section === "assets" && <AssetsSection run={run} notify={notify} />}
      {section === "revenue" && <RevenueSection run={run} notify={notify} />}
      {section === "provision" && <ProvisionSection run={run} notify={notify} />}
      {section === "vat" && <VatSection run={run} />}
      {section === "bank" && <BankSection run={run} notify={notify} />}
      {section === "fx" && <FxSection run={run} notify={notify} />}
      {section === "treasury" && <TreasurySection run={run} notify={notify} />}
      {section === "export" && <ExportSection run={run} />}
    </div>
  );
}

/* ── Periods ─────────────────────────────────────────────────────────── */
function PeriodsSection({ run, notify }: { run: any; notify: (m: string) => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [periods, setPeriods] = useState<any[]>([]);
  const [checklist, setChecklist] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await apiFetch<any[]>(`/capital/periods?year=${year}`);
    setPeriods(Array.isArray(rows) ? rows : []);
  }, [year]);

  useEffect(() => { void run(load); }, [run, load]);

  const act = (id: string, action: string) =>
    run(async () => {
      setBusy(true);
      try {
        await apiFetch(`/capital/periods/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
        notify(`Period ${action}ed`);
        await load();
      } finally { setBusy(false); }
    });

  const showChecklist = (id: string) => run(async () => setChecklist(await apiFetch(`/capital/periods/${id}/checklist`)));

  return (
    <Card>
      <Title
        title="Fiscal Periods"
        hint="A CLOSED period blocks every new posting. LOCKED also blocks reopening."
        right={
          <div className="flex items-end gap-2">
            <input className={`${inputCls} w-24`} type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            <Btn variant="outline" onClick={() => run(async () => { const r = await apiFetch<any>("/capital/periods/generate", { method: "POST", body: JSON.stringify({ year }) }); notify(`${r.created} periods created`); await load(); })}>
              Generate year
            </Btn>
          </div>
        }
      />
      {periods.length === 0 ? (
        <Empty>No periods for {year}. Generate the calendar first.</Empty>
      ) : (
        <TableShell>
          <table className="w-full">
            <THead><Th>Period</Th><Th>Range</Th><Th>Status</Th><Th className="text-right">Actions</Th></THead>
            <tbody>
              {periods.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-muted-foreground">{formatDate(p.startDate)} → {formatDate(p.endDate)}</Td>
                  <Td><Pill tone={p.status === "OPEN" ? "open" : p.status === "CLOSED" ? "closed" : "locked"}>{p.status}</Pill></Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Btn variant="ghost" onClick={() => showChecklist(p.id)}>Checklist</Btn>
                      {p.status === "OPEN" && <Btn variant="outline" disabled={busy} onClick={() => act(p.id, "close")}>Close</Btn>}
                      {p.status === "CLOSED" && <Btn variant="outline" disabled={busy} onClick={() => act(p.id, "reopen")}>Reopen</Btn>}
                      {p.status !== "LOCKED" && <Btn variant="outline" disabled={busy} onClick={() => act(p.id, "lock")}>Lock</Btn>}
                      {p.status === "LOCKED" && <Btn variant="outline" disabled={busy} onClick={() => act(p.id, "unlock")}>Unlock</Btn>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
      {checklist && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-meta font-semibold">{checklist.period?.name} — close checklist</p>
            <Pill tone={checklist.canClose ? "open" : "closed"}>{checklist.canClose ? "Ready to close" : "Blocked"}</Pill>
          </div>
          <ul className="space-y-1 text-meta text-muted-foreground">
            {(checklist.items || []).map((i: any) => (
              <li key={i.key}>{i.count > 0 ? "•" : "✓"} {i.count} — {i.label.replace(/^\d+\s/, "")} <span className="text-micro">({i.severity})</span></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── Manual journals ─────────────────────────────────────────────────── */
function JournalsSection({ run, notify }: { run: any; notify: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string; memo: string }[]>([
    { accountId: "", debit: "", credit: "", memo: "" },
    { accountId: "", debit: "", credit: "", memo: "" },
  ]);

  const load = useCallback(async () => {
    const [j, a] = await Promise.all([apiFetch<any[]>("/capital/journals"), apiFetch<any[]>("/capital/journals/accounts")]);
    setRows(Array.isArray(j) ? j : []);
    setAccounts(Array.isArray(a) ? a : []);
  }, []);
  useEffect(() => { void run(load); }, [run, load]);

  const totalDebit = useMemo(() => lines.reduce((s, l) => s + num(l.debit), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((s, l) => s + num(l.credit), 0), [lines]);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const submit = () =>
    run(async () => {
      const body = {
        entryDate: date,
        memo,
        lines: lines.filter((l) => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0)).map((l) => ({
          accountId: l.accountId,
          debit: num(l.debit),
          credit: num(l.credit),
          memo: l.memo || undefined,
        })),
      };
      const created = await apiFetch<any>("/capital/journals", { method: "POST", body: JSON.stringify(body) });
      await apiFetch(`/capital/journals/${created.id}/post`, { method: "POST", body: JSON.stringify({}) });
      notify(`Journal ${created.reference} posted`);
      setLines([{ accountId: "", debit: "", credit: "", memo: "" }, { accountId: "", debit: "", credit: "", memo: "" }]);
      setMemo("");
      await load();
    });

  return (
    <div className="space-y-4">
      <Card>
        <Title title="New Manual Journal" hint="Post an adjustment directly to the general ledger. It must balance." />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-meta"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="text-meta"><span className="mb-1 block text-muted-foreground">Memo</span><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Monthly depreciation top-up" /></label>
        </div>
        <div className="mt-3 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <select className={`${inputCls} sm:col-span-5`} value={l.accountId} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
              <input className={`${inputCls} sm:col-span-2`} placeholder="Debit" type="number" value={l.debit} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: "" } : x)))} />
              <input className={`${inputCls} sm:col-span-2`} placeholder="Credit" type="number" value={l.credit} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: "" } : x)))} />
              <input className={`${inputCls} sm:col-span-3`} placeholder="Line memo" value={l.memo} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-meta text-muted-foreground">
            Debit {formatBDT(totalDebit)} · Credit {formatBDT(totalCredit)} ·{" "}
            <span className={balanced ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{balanced ? "balanced" : "not balanced"}</span>
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => setLines((p) => [...p, { accountId: "", debit: "", credit: "", memo: "" }])}>Add line</Btn>
            <Btn variant="primary" disabled={!balanced} onClick={submit}>Post journal</Btn>
          </div>
        </div>
      </Card>

      <Card>
        <Title title="Journal History" hint="Drafts, posted entries and voids." />
        {rows.length === 0 ? <Empty>No manual journals yet.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Reference</Th><Th>Date</Th><Th>Memo</Th><Th>Lines</Th><Th>Status</Th><Th className="text-right">Actions</Th></THead>
              <tbody>
                {rows.map((j) => (
                  <Tr key={j.id}>
                    <Td className="font-medium">{j.reference}</Td>
                    <Td>{formatDate(j.entryDate)}</Td>
                    <Td className="max-w-[240px] truncate text-muted-foreground">{j.memo || "—"}</Td>
                    <Td className="text-muted-foreground">
                      {(j.lines || []).map((l: any) => `${l.account?.code ?? ""} ${num(l.debit) > 0 ? `Dr ${formatBDT(num(l.debit))}` : `Cr ${formatBDT(num(l.credit))}`}`).join(" · ")}
                    </Td>
                    <Td><Pill tone={j.status === "POSTED" ? "open" : j.status === "VOID" ? "locked" : "muted"}>{j.status}</Pill></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {j.status === "DRAFT" && <Btn variant="outline" onClick={() => run(async () => { await apiFetch(`/capital/journals/${j.id}/post`, { method: "POST", body: JSON.stringify({}) }); notify("Journal posted"); await load(); })}>Post</Btn>}
                        {j.status === "POSTED" && <Btn variant="outline" onClick={() => run(async () => { await apiFetch(`/capital/journals/${j.id}/void`, { method: "POST", body: JSON.stringify({}) }); notify("Journal voided"); await load(); })}>Void</Btn>}
                        {j.status === "DRAFT" && <Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/journals/${j.id}`, { method: "DELETE" }); notify("Draft deleted"); await load(); })}>Delete</Btn>}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

/* ── Fixed assets ────────────────────────────────────────────────────── */
function AssetsSection({ run, notify }: { run: any; notify: (m: string) => void }) {
  const [data, setData] = useState<any>({ assets: [], totals: {} });
  const [form, setForm] = useState({ name: "", category: "EQUIPMENT", cost: "", salvageValue: "", usefulLifeMonths: "24", purchaseDate: todayStr() });
  const [period, setPeriod] = useState(monthStr());

  const load = useCallback(async () => setData(await apiFetch("/capital/assets")), []);
  useEffect(() => { void run(load); }, [run, load]);

  return (
    <div className="space-y-4">
      <Card>
        <Title title="Add Asset" hint="Posts Dr Fixed Assets / Cr Bank unless you say the purchase is already booked." />
        <div className="grid gap-2 sm:grid-cols-6">
          <input className={`${inputCls} sm:col-span-2`} placeholder="Asset name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder="Cost" type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <input className={inputCls} placeholder="Salvage" type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} />
          <input className={inputCls} placeholder="Life (months)" type="number" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} />
          <input className={inputCls} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2">
          <div className="text-meta text-muted-foreground">
            Cost {formatBDT(data.totals?.cost)} · Book value {formatBDT(data.totals?.bookValue)} · Monthly depreciation {formatBDT(data.totals?.monthlyDepreciation)}
          </div>
          <Btn variant="primary" onClick={() => run(async () => {
            await apiFetch("/capital/assets", { method: "POST", body: JSON.stringify({ ...form, cost: num(form.cost), salvageValue: num(form.salvageValue), usefulLifeMonths: Number(form.usefulLifeMonths) }) });
            notify("Asset added"); setForm({ ...form, name: "", cost: "" }); await load();
          })}>Add asset</Btn>
        </div>
      </Card>

      <Card>
        <Title
          title="Register"
          hint="Depreciation is idempotent per asset per period."
          right={
            <div className="flex items-end gap-2">
              <input className={`${inputCls} w-32`} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              <Btn variant="outline" onClick={() => run(async () => { const r = await apiFetch<any>("/capital/depreciation/run", { method: "POST", body: JSON.stringify({ period }) }); notify(`Depreciation posted: ${formatBDT(r.total)}`); await load(); })}>Run depreciation</Btn>
            </div>
          }
        />
        {data.assets.length === 0 ? <Empty>No assets registered.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Asset</Th><Th>Purchased</Th><Th className="text-right">Cost</Th><Th className="text-right">Accum. dep.</Th><Th className="text-right">Book value</Th><Th className="text-right">Monthly</Th><Th>Status</Th><Th className="text-right">Actions</Th></THead>
              <tbody>
                {data.assets.map((a: any) => (
                  <Tr key={a.id}>
                    <Td className="font-medium">{a.name}<div className="text-micro text-muted-foreground">{a.category}{a.serialNumber ? ` · ${a.serialNumber}` : ""}</div></Td>
                    <Td>{formatDate(a.purchaseDate)}</Td>
                    <Td className="text-right">{formatBDT(a.cost)}</Td>
                    <Td className="text-right">{formatBDT(a.accumulatedDepreciation)}</Td>
                    <Td className="text-right font-medium">{formatBDT(a.bookValue)}</Td>
                    <Td className="text-right text-muted-foreground">{formatBDT(a.monthlyDepreciation)}</Td>
                    <Td><Pill tone={a.status === "ACTIVE" ? "open" : "muted"}>{a.status}</Pill></Td>
                    <Td className="text-right">
                      {a.status === "ACTIVE" && (
                        <Btn variant="outline" onClick={() => run(async () => {
                          const proceeds = Number(window.prompt(`Disposal proceeds for ${a.name}? (book value ${a.bookValue})`, "0") ?? "0");
                          if (!Number.isFinite(proceeds)) return;
                          const r = await apiFetch<any>(`/capital/assets/${a.id}/dispose`, { method: "POST", body: JSON.stringify({ proceeds, disposedAt: todayStr() }) });
                          notify(r.gain >= 0 ? `Disposed with gain ${formatBDT(r.gain)}` : `Disposed with loss ${formatBDT(Math.abs(r.gain))}`);
                          await load();
                        })}>Dispose</Btn>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

/* ── VAT ─────────────────────────────────────────────────────────────── */
function VatSection({ run }: { run: any }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayStr());
  const [ret, setRet] = useState<any>(null);
  const [sales, setSales] = useState<any>(null);
  const [purchases, setPurchases] = useState<any>(null);
  const [wh, setWh] = useState<any>(null);

  const load = useCallback(async () => {
    const q = `?from=${from}&to=${to}`;
    const [r, s, p, w] = await Promise.all([
      apiFetch<any>(`/capital/vat/return${q}`),
      apiFetch<any>(`/capital/vat/sales-register${q}`),
      apiFetch<any>(`/capital/vat/purchase-register${q}`),
      apiFetch<any>(`/capital/vat/withholding${q}`),
    ]);
    setRet(r); setSales(s); setPurchases(p); setWh(w);
  }, [from, to]);
  useEffect(() => { void run(load); }, [run, load]);

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="VAT Return (Mushak 9.1)"
          hint="Output VAT − input VAT. Control accounts are shown so a filing ties to the ledger."
          right={<div className="flex items-end gap-2">
            <input className={`${inputCls} w-40`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className={`${inputCls} w-40`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>}
        />
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Output VAT", ret?.outputVat, "text-foreground"],
            ["Input VAT", ret?.inputVat, "text-foreground"],
            ["Net payable", ret?.netPayable, num(ret?.netPayable) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"],
            ["GL controls", ret?.gl ? `2100 ${formatBDT(ret.gl.outputVatPayable)} / 1300 ${formatBDT(ret.gl.inputVatReceivable)}` : "—", "text-muted-foreground"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-micro uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className={`mt-1 text-heading font-semibold ${tone}`}>{typeof value === "number" ? formatBDT(value) : (value as string) ?? "—"}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Title title="Sales Register (Mushak 6.3)" hint={`${sales?.totals?.count ?? 0} invoices · VAT ${formatBDT(sales?.totals?.vatAmount)}`} />
        {!sales?.rows?.length ? <Empty>No issued invoices in this window.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Invoice</Th><Th>Date</Th><Th>Client</Th><Th className="text-right">Taxable</Th><Th className="text-right">VAT</Th><Th className="text-right">Total</Th></THead>
              <tbody>
                {sales.rows.slice(0, 100).map((r: any) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.invoiceNumber}</Td>
                    <Td>{formatDate(r.issueDate)}</Td>
                    <Td className="text-muted-foreground">{r.clientName}</Td>
                    <Td className="text-right">{formatBDT(r.taxableValue)}</Td>
                    <Td className="text-right">{formatBDT(r.vatAmount)}</Td>
                    <Td className="text-right font-medium">{formatBDT(r.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      <Card>
        <Title title="Purchase Register" hint={`${purchases?.totals?.count ?? 0} bills · input VAT ${formatBDT(purchases?.totals?.vatAmount)}`} />
        {!purchases?.rows?.length ? <Empty>No recoverable VAT in this window. Flag an expense as VAT-recoverable to include it.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Date</Th><Th>Description</Th><Th>Vendor</Th><Th className="text-right">Taxable</Th><Th className="text-right">VAT</Th><Th className="text-right">Total</Th></THead>
              <tbody>
                {purchases.rows.slice(0, 100).map((r: any) => (
                  <Tr key={r.id}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td className="font-medium">{r.description}</Td>
                    <Td className="text-muted-foreground">{r.vendorName ?? "—"}</Td>
                    <Td className="text-right">{formatBDT(r.taxableValue)}</Td>
                    <Td className="text-right">{formatBDT(r.vatAmount)}</Td>
                    <Td className="text-right font-medium">{formatBDT(r.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      <Card>
        <Title title="Withholding (TDS / VDS)" hint={`${wh?.rows?.length ?? 0} entries · withheld ${formatBDT(wh?.totalWithheld)} · GL 2200 payable ${formatBDT(wh?.glPayable)}`} />
        {!wh?.rows?.length ? <Empty>No tax withheld in this window.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Date</Th><Th>Type</Th><Th>Party</Th><Th>Reference</Th><Th className="text-right">Gross</Th><Th className="text-right">Withheld</Th></THead>
              <tbody>
                {wh.rows.slice(0, 100).map((r: any, i: number) => (
                  <Tr key={i}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td><Pill>{r.kind}</Pill></Td>
                    <Td className="text-muted-foreground">{r.party}</Td>
                    <Td className="text-muted-foreground">{r.reference}</Td>
                    <Td className="text-right">{formatBDT(r.gross)}</Td>
                    <Td className="text-right font-medium">{formatBDT(r.withheld)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

/* ── Bank statement ──────────────────────────────────────────────────── */
function BankSection({ run, notify }: { run: any; notify: (m: string) => void }) {
  const [banks, setBanks] = useState<any[]>([]);
  const [bankId, setBankId] = useState("");
  const [data, setData] = useState<any>(null);
  const [csv, setCsv] = useState("date,description,reference,debit,credit\n");

  useEffect(() => {
    void run(async () => {
      const rows = await apiFetch<any[]>("/capital/bank-accounts");
      const list = Array.isArray(rows) ? rows : [];
      setBanks(list);
      if (!bankId && list[0]) setBankId(list[0].id);
    });
  }, [run, bankId]);

  const load = useCallback(async () => {
    if (!bankId) return;
    setData(await apiFetch(`/capital/bank-accounts/${bankId}/statement`));
  }, [bankId]);
  useEffect(() => { void run(load); }, [run, load]);

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="Import Bank Statement"
          hint="CSV columns: date, description, reference, debit (money in), credit (money out)."
          right={<select className={`${inputCls} w-56`} value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.accountName}</option>)}
          </select>}
        />
        <textarea className={`${inputCls} min-h-32 font-mono`} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="mt-2 flex flex-wrap justify-between gap-2">
          <div className="text-meta text-muted-foreground">
            Statement in {formatBDT(data?.summary?.statementIn)} · out {formatBDT(data?.summary?.statementOut)} · unmatched {data?.summary?.unmatched ?? 0}
          </div>
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => run(async () => { const r = await apiFetch<any>(`/capital/bank-accounts/${bankId}/statement/auto-match`, { method: "POST", body: JSON.stringify({}) }); notify(`${r.matched} matched, ${r.remaining} left`); await load(); })}>Auto-match</Btn>
            <Btn variant="primary" onClick={() => run(async () => {
              const r = await apiFetch<any>(`/capital/bank-accounts/${bankId}/statement/import`, { method: "POST", body: JSON.stringify({ csv }) });
              notify(`Imported ${r.imported}, skipped ${r.skipped}, matched ${r.matched}`);
              await load();
            })}>Import</Btn>
          </div>
        </div>
      </Card>

      <Card>
        <Title title="Statement Lines" hint="Match each row to the payment or expense it represents." />
        {!data?.lines?.length ? <Empty>No statement imported for this account.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Date</Th><Th>Description</Th><Th>Reference</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th>Status</Th><Th className="text-right">Actions</Th></THead>
              <tbody>
                {data.lines.map((l: any) => (
                  <Tr key={l.id}>
                    <Td>{formatDate(l.statementDate)}</Td>
                    <Td className="font-medium">{l.description}</Td>
                    <Td className="text-muted-foreground">{l.reference ?? "—"}</Td>
                    <Td className="text-right">{num(l.debit) ? formatBDT(l.debit) : "—"}</Td>
                    <Td className="text-right">{num(l.credit) ? formatBDT(l.credit) : "—"}</Td>
                    <Td><Pill tone={l.status === "MATCHED" ? "open" : l.status === "IGNORED" ? "muted" : "closed"}>{l.status}</Pill></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {l.status !== "UNMATCHED" && <Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/statement-lines/${l.id}/unmatch`, { method: "PATCH" }); notify("Unmatched"); await load(); })}>Unmatch</Btn>}
                        {l.status === "UNMATCHED" && <Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/statement-lines/${l.id}/ignore`, { method: "PATCH", body: JSON.stringify({}) }); notify("Ignored"); await load(); })}>Ignore</Btn>}
                        <Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/statement-lines/${l.id}`, { method: "DELETE" }); notify("Removed"); await load(); })}>Delete</Btn>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

/* ── FX revaluation ──────────────────────────────────────────────────── */
function FxSection({ run, notify }: { run: any; notify: (m: string) => void }) {
  const [asOf, setAsOf] = useState(todayStr());
  const [usd, setUsd] = useState("125");
  const [preview, setPreview] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = useCallback(async () => {
    const rows = await apiFetch<any[]>("/capital/fx/revaluation/history");
    setHistory(Array.isArray(rows) ? rows : []);
  }, []);
  useEffect(() => { void run(loadHistory); }, [run, loadHistory]);

  const body = () => JSON.stringify({ asOf, rates: { USD: Number(usd) } });

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="Revalue Open Receivables"
          hint="Restates foreign-currency invoices at the closing rate and books the unrealized difference."
          right={<div className="flex items-end gap-2">
            <input className={`${inputCls} w-40`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <input className={`${inputCls} w-28`} type="number" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="USD rate" />
          </div>}
        />
        <div className="flex flex-wrap justify-between gap-2">
          <div className="text-meta text-muted-foreground">
            {preview ? `Gain ${formatBDT(preview.gain)} · Loss ${formatBDT(preview.loss)}` : "Preview first, then post."}
          </div>
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => run(async () => setPreview(await apiFetch("/capital/fx/revaluation/preview", { method: "POST", body: body() })))}>Preview</Btn>
            <Btn variant="primary" onClick={() => run(async () => {
              const r = await apiFetch<any>("/capital/fx/revaluation", { method: "POST", body: body() });
              notify(`Revalued ${r.posted} currency(ies)`);
              setPreview(null);
              await loadHistory();
            })}>Post revaluation</Btn>
          </div>
        </div>
        {preview?.rows?.length > 0 && (
          <div className="mt-3">
          <TableShell>
            <table className="w-full">
              <THead><Th>Currency</Th><Th className="text-right">Invoices</Th><Th className="text-right">Book value</Th><Th className="text-right">Revalued</Th><Th className="text-right">Gain</Th><Th className="text-right">Loss</Th></THead>
              <tbody>
                {preview.rows.map((r: any) => (
                  <Tr key={r.currency}>
                    <Td className="font-medium">{r.currency}</Td>
                    <Td className="text-right">{r.invoices}</Td>
                    <Td className="text-right">{formatBDT(r.bookValue)}</Td>
                    <Td className="text-right">{formatBDT(r.revaluedValue)}</Td>
                    <Td className="text-right text-emerald-600 dark:text-emerald-400">{r.gain ? formatBDT(r.gain) : "—"}</Td>
                    <Td className="text-right text-rose-600 dark:text-rose-400">{r.loss ? formatBDT(r.loss) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          </div>
        )}
      </Card>

      <Card>
        <Title title="History" hint="Each run is reversible by re-running the same date." />
        {history.length === 0 ? <Empty>No revaluation runs yet.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>As of</Th><Th>Currency</Th><Th className="text-right">Rate</Th><Th className="text-right">Gain</Th><Th className="text-right">Loss</Th><Th className="text-right">Invoices</Th></THead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.id}>
                    <Td>{formatDate(h.asOfDate)}</Td>
                    <Td className="font-medium">{h.currency}</Td>
                    <Td className="text-right">{Number(h.rate)}</Td>
                    <Td className="text-right text-emerald-600 dark:text-emerald-400">{num(h.gain) ? formatBDT(h.gain) : "—"}</Td>
                    <Td className="text-right text-rose-600 dark:text-rose-400">{num(h.loss) ? formatBDT(h.loss) : "—"}</Td>
                    <Td className="text-right">{h.invoiceCount}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
