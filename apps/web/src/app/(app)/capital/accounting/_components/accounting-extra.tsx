"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-meta outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
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

type Runner = (fn: () => Promise<void>) => Promise<void>;

/* ── Revenue recognition ─────────────────────────────────────────────── */
export function RevenueSection({ run, notify }: { run: Runner; notify: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [period, setPeriod] = useState(monthStr());
  const [invoiceId, setInvoiceId] = useState("");
  const [periods, setPeriods] = useState("12");

  const load = useCallback(async () => {
    const list = await apiFetch<any[]>("/capital/revenue-schedules");
    setRows(Array.isArray(list) ? list : []);
  }, []);
  useEffect(() => { void run(load); }, [run, load]);

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="Deferred Revenue"
          hint="Reclass an issued invoice into Deferred Revenue and recognise it over N months."
          right={
            <div className="flex items-end gap-2">
              <input className={`${inputCls} w-36`} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              <Btn variant="outline" onClick={() => run(async () => { const r = await apiFetch<any>("/capital/revenue-schedules/recognize", { method: "POST", body: JSON.stringify({ period }) }); notify(`Recognised ${formatBDT(r.total)} for ${period}`); await load(); })}>Run recognition</Btn>
            </div>
          }
        />
        <div className="grid gap-2 sm:grid-cols-5">
          <input className={`${inputCls} sm:col-span-3`} placeholder="Invoice id" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
          <input className={inputCls} placeholder="Months" type="number" value={periods} onChange={(e) => setPeriods(e.target.value)} />
          <Btn variant="primary" onClick={() => run(async () => {
            await apiFetch("/capital/revenue-schedules", { method: "POST", body: JSON.stringify({ invoiceId: invoiceId.trim(), periods: Number(periods) }) });
            notify("Revenue schedule created"); setInvoiceId(""); await load();
          })}>Defer</Btn>
        </div>
      </Card>

      <Card>
        <Title title="Schedules" hint="Remaining = total − recognised" />
        {rows.length === 0 ? <Empty>No deferred revenue schedules.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Invoice</Th><Th>Client</Th><Th>Start</Th><Th className="text-right">Total</Th><Th className="text-right">Recognised</Th><Th className="text-right">Remaining</Th><Th className="text-right">/month</Th><Th>Status</Th><Th className="text-right">Actions</Th></THead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium">{s.invoiceNumber ?? s.invoiceId}</Td>
                    <Td className="text-muted-foreground">{s.clientName ?? "—"}</Td>
                    <Td>{formatDate(s.startDate)}</Td>
                    <Td className="text-right">{formatBDT(s.totalAmount)}</Td>
                    <Td className="text-right">{formatBDT(s.recognizedAmount)}</Td>
                    <Td className="text-right font-medium">{formatBDT(s.remaining)}</Td>
                    <Td className="text-right text-muted-foreground">{formatBDT(s.monthlyAmount)}</Td>
                    <Td><Pill tone={s.status === "ACTIVE" ? "open" : s.status === "COMPLETED" ? "muted" : "locked"}>{s.status}</Pill></Td>
                    <Td className="text-right">
                      {s.status !== "CANCELLED" && <Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/revenue-schedules/${s.id}/cancel`, { method: "POST", body: JSON.stringify({}) }); notify("Schedule cancelled"); await load(); })}>Cancel</Btn>}
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

/* ── Bad-debt provision ──────────────────────────────────────────────── */
export function ProvisionSection({ run, notify }: { run: Runner; notify: (m: string) => void }) {
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = useCallback(async () => {
    const rows = await apiFetch<any[]>("/capital/provision/history");
    setHistory(Array.isArray(rows) ? rows : []);
  }, []);
  useEffect(() => { void run(loadHistory); }, [run, loadHistory]);

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="Bad-debt Provision"
          hint="Required allowance from AR ageing minus what is already booked."
          right={<div className="flex items-end gap-2">
            <input className={`${inputCls} w-40`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <Btn variant="outline" onClick={() => run(async () => setData(await apiFetch("/capital/provision/preview", { method: "POST", body: JSON.stringify({ asOf }) })))}>Preview</Btn>
            <Btn variant="primary" onClick={() => run(async () => {
              const r = await apiFetch<any>("/capital/provision", { method: "POST", body: JSON.stringify({ asOf }) });
              notify(r.posted ? `Provision adjusted by ${formatBDT(r.adjustment)}` : "Already in line");
              setData(r); await loadHistory();
            })}>Post</Btn>
          </div>}
        />
        {!data ? <Empty>Preview to see the required allowance.</Empty> : (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-4">
              {[
                ["Receivable", formatBDT(data.totalReceivable)],
                ["Required allowance", formatBDT(data.requiredAllowance)],
                ["Already booked", formatBDT(data.bookedAllowance)],
                ["Adjustment", formatBDT(data.adjustment)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-micro uppercase tracking-wide text-muted-foreground">{l}</p>
                  <p className="mt-1 text-heading font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <TableShell>
              <table className="w-full">
                <THead><Th>Ageing</Th><Th className="text-right">Balance</Th><Th className="text-right">Rate %</Th><Th className="text-right">Provision</Th></THead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <Tr key={r.bucket}>
                      <Td className="font-medium">{r.bucket}</Td>
                      <Td className="text-right">{formatBDT(r.amount)}</Td>
                      <Td className="text-right">{r.rate}%</Td>
                      <Td className="text-right font-medium">{formatBDT(r.provision)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </>
        )}
      </Card>

      <Card>
        <Title title="Provision Runs" />
        {history.length === 0 ? <Empty>No runs yet.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>As of</Th><Th className="text-right">Adjustment</Th><Th>Posted</Th></THead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.id}>
                    <Td>{formatDate(h.asOfDate)}</Td>
                    <Td className="text-right font-medium">{formatBDT(h.amount)}</Td>
                    <Td>{formatDate(h.createdAt)}</Td>
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

/* ── Treasury ────────────────────────────────────────────────────────── */
export function TreasurySection({ run, notify }: { run: Runner; notify: (m: string) => void }) {
  const [ratios, setRatios] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [petty, setPetty] = useState<any>(null);
  const [entry, setEntry] = useState({ direction: "OUT", amount: "", description: "", category: "" });

  const load = useCallback(async () => {
    const [r, f, p] = await Promise.all([
      apiFetch<any>("/capital/treasury/ratios"),
      apiFetch<any>("/capital/treasury/forecast?weeks=13"),
      apiFetch<any>("/capital/petty-cash"),
    ]);
    setRatios(r); setForecast(f); setPetty(p);
  }, []);
  useEffect(() => { void run(load); }, [run, load]);

  return (
    <div className="space-y-4">
      <Card>
        <Title title="Working Capital" hint="Trailing 90-day DSO / DPO and the cash conversion cycle." />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["DSO (days)", ratios?.dso == null ? "—" : String(ratios.dso)],
            ["DPO (days)", ratios?.dpo == null ? "—" : String(ratios.dpo)],
            ["CCC (days)", ratios?.ccc == null ? "—" : String(ratios.ccc)],
            ["Receivable", formatBDT(ratios?.receivable)],
            ["Payable", formatBDT(ratios?.payable)],
            ["Cash", formatBDT(ratios?.cash)],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-micro uppercase tracking-wide text-muted-foreground">{l}</p>
              <p className="mt-1 text-heading font-semibold">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Title title="13-week Cash Forecast" hint={`Opening ${formatBDT(forecast?.opening)} → closing ${formatBDT(forecast?.closing)}`} />
        {!forecast?.weeks?.length ? <Empty>No forecast data.</Empty> : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Week</Th><Th>Starts</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Net</Th><Th className="text-right">Closing</Th></THead>
              <tbody>
                {forecast.weeks.map((w: any) => (
                  <Tr key={w.week}>
                    <Td className="font-medium">{w.week}</Td>
                    <Td>{formatDate(w.weekStart)}</Td>
                    <Td className="text-right text-emerald-600 dark:text-emerald-400">{formatBDT(w.inflow)}</Td>
                    <Td className="text-right text-rose-600 dark:text-rose-400">{formatBDT(w.outflow)}</Td>
                    <Td className="text-right">{formatBDT(w.net)}</Td>
                    <Td className="text-right font-medium">{formatBDT(w.closing)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      <Card>
        <Title title="Petty Cash" hint={`Float balance ${formatBDT(petty?.balance)}`} />
        <div className="grid gap-2 sm:grid-cols-5">
          <select className={inputCls} value={entry.direction} onChange={(e) => setEntry({ ...entry, direction: e.target.value })}>
            <option value="OUT">Spend</option>
            <option value="IN">Top up</option>
          </select>
          <input className={inputCls} placeholder="Description" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
          <input className={inputCls} placeholder="Amount" type="number" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
          <input className={inputCls} placeholder="Category (optional)" value={entry.category} onChange={(e) => setEntry({ ...entry, category: e.target.value })} />
          <Btn variant="primary" onClick={() => run(async () => {
            await apiFetch("/capital/petty-cash", { method: "POST", body: JSON.stringify({ ...entry, amount: Number(entry.amount), category: entry.category || undefined }) });
            notify("Petty cash recorded"); setEntry({ ...entry, amount: "", description: "", category: "" }); await load();
          })}>Record</Btn>
        </div>
        {!petty?.entries?.length ? <div className="mt-3"><Empty>No petty cash movement yet.</Empty></div> : (
          <div className="mt-3">
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right" /></THead>
                <tbody>
                  {petty.entries.map((e: any) => (
                    <Tr key={e.id}>
                      <Td>{formatDate(e.date)}</Td>
                      <Td className="font-medium">{e.description}</Td>
                      <Td className="text-muted-foreground">{e.category ?? "—"}</Td>
                      <Td className="text-right">{e.direction === "IN" ? formatBDT(e.amount) : "—"}</Td>
                      <Td className="text-right">{e.direction === "OUT" ? formatBDT(e.amount) : "—"}</Td>
                      <Td className="text-right"><Btn variant="ghost" onClick={() => run(async () => { await apiFetch(`/capital/petty-cash/${e.id}`, { method: "DELETE" }); notify("Entry removed"); await load(); })}>Delete</Btn></Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Audit export ────────────────────────────────────────────────────── */
export function ExportSection({ run }: { run: Runner }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayStr());
  const [dept, setDept] = useState<any>(null);

  const download = (path: string) => {
    void run(async () => {
      const token = typeof window !== "undefined" ? window.localStorage.getItem("zoolyum_token") : null;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = path.split("/").pop()?.split("?")[0] ?? "export.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <Title
          title="Auditor Pack"
          hint="Trial balance, general ledger and journal listing as CSV (UTF-8 with BOM so Excel opens it correctly)."
          right={<div className="flex items-end gap-2">
            <input className={`${inputCls} w-40`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className={`${inputCls} w-40`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>}
        />
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" onClick={() => download(`/capital/export/general-ledger?from=${from}&to=${to}`)}>General ledger CSV</Btn>
          <Btn variant="outline" onClick={() => download(`/capital/export/trial-balance?from=${from}&to=${to}`)}>Trial balance CSV</Btn>
          <Btn variant="outline" onClick={() => download(`/capital/export/journal-listing?from=${from}&to=${to}`)}>Journal listing CSV</Btn>
          <Btn variant="ghost" onClick={() => run(async () => setDept(await apiFetch(`/capital/reports/by-department?from=${from}&to=${to}`)))}>Cost by department</Btn>
        </div>
      </Card>

      {dept && (
        <Card>
          <Title title="Cost by Department" hint={`${dept.label} · total ${formatBDT(dept.total)}`} />
          {!dept.rows?.length ? <Empty>No approved expenses in this window.</Empty> : (
            <TableShell>
              <table className="w-full">
                <THead><Th>Department</Th><Th className="text-right">Direct cost</Th><Th className="text-right">Overhead</Th><Th className="text-right">Billable</Th><Th className="text-right">Total</Th><Th className="text-right">Share</Th></THead>
                <tbody>
                  {dept.rows.map((r: any) => (
                    <Tr key={r.department}>
                      <Td className="font-medium">{r.department}</Td>
                      <Td className="text-right">{formatBDT(r.directCost)}</Td>
                      <Td className="text-right">{formatBDT(r.overhead)}</Td>
                      <Td className="text-right">{formatBDT(r.billable)}</Td>
                      <Td className="text-right font-medium">{formatBDT(r.total)}</Td>
                      <Td className="text-right text-muted-foreground">{r.share}%</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>
      )}
    </div>
  );
}
