"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Pencil, Play, RefreshCw, Trash2, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT } from "@/lib/format";
import { Avatar, CardShell, EmptyState, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Field, FormActions, Input, Modal } from "@/components/ui";
import { label, monthNow } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { Pager, RowCheck, TableToolbar, useTable } from "../_components/table-kit";
import { PeopleHero } from "../_components/hero";

function EditPayrollModal({ record, onClose, onSaved, notify }: { record: any; onClose: () => void; onSaved: () => void; notify: (m: string) => void }) {
  const [f, setF] = useState({ basicSalary: "", allowances: "", bonus: "", lateDeduction: "", halfDayDeduction: "", absentDeduction: "", unpaidLeaveDeduction: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    setErr(null);
    setF({
      basicSalary: record.basicSalary != null ? String(record.basicSalary) : "",
      allowances: record.allowances != null ? String(record.allowances) : "",
      bonus: record.bonus != null ? String(record.bonus) : "",
      lateDeduction: record.lateDeduction != null ? String(record.lateDeduction) : "",
      halfDayDeduction: record.halfDayDeduction != null ? String(record.halfDayDeduction) : "",
      absentDeduction: record.absentDeduction != null ? String(record.absentDeduction) : "",
      unpaidLeaveDeduction: record.unpaidLeaveDeduction != null ? String(record.unpaidLeaveDeduction) : "",
    });
  }, [record]);

  const num = (v: string) => (v === "" ? undefined : Number(v));
  const preview =
    (num(f.basicSalary) ?? 0) +
    (num(f.allowances) ?? 0) +
    (num(f.bonus) ?? 0) -
    (num(f.lateDeduction) ?? 0) -
    (num(f.halfDayDeduction) ?? 0) -
    (num(f.absentDeduction) ?? 0) -
    (num(f.unpaidLeaveDeduction) ?? 0);

  const save = async (recompute = false) => {
    setBusy(true);
    setErr(null);
    try {
      if (recompute) {
        await apiFetch(`/people/payroll/${record.id}/recompute`, { method: "POST" });
        notify("Recomputed from attendance");
      } else {
        await apiFetch(`/people/payroll/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            basicSalary: num(f.basicSalary),
            allowances: num(f.allowances),
            bonus: num(f.bonus),
            lateDeduction: num(f.lateDeduction),
            halfDayDeduction: num(f.halfDayDeduction),
            absentDeduction: num(f.absentDeduction),
            unpaidLeaveDeduction: num(f.unpaidLeaveDeduction),
          }),
        });
        notify("Payroll updated");
      }
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const audit: any[] = Array.isArray(record?.auditTrail) ? record.auditTrail : [];

  return (
    <Modal closeOnBackdrop={false} open={!!record} onClose={onClose} title={`Edit payroll — ${record?.employee?.name ?? ""} (${record?.period ?? ""})`} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); void save(false); }} className="flex flex-col gap-4">
        {record?.salaryExpense && (
          <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-meta text-sky-600 dark:text-sky-300">
            Already posted to finance — saving here updates the salary expense, ledger and bank automatically.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Basic salary"><Input type="number" min={0} step="0.01" value={f.basicSalary} onChange={(e) => setF({ ...f, basicSalary: e.target.value })} /></Field>
          <Field label="Allowances"><Input type="number" min={0} step="0.01" value={f.allowances} onChange={(e) => setF({ ...f, allowances: e.target.value })} placeholder="0" /></Field>
          <Field label="Bonus"><Input type="number" min={0} step="0.01" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} placeholder="0" /></Field>
          <Field label="Late deduction"><Input type="number" min={0} step="0.01" value={f.lateDeduction} onChange={(e) => setF({ ...f, lateDeduction: e.target.value })} placeholder="0" /></Field>
          <Field label="Half-day deduction"><Input type="number" min={0} step="0.01" value={f.halfDayDeduction} onChange={(e) => setF({ ...f, halfDayDeduction: e.target.value })} placeholder="0" /></Field>
          <Field label="Absent deduction"><Input type="number" min={0} step="0.01" value={f.absentDeduction} onChange={(e) => setF({ ...f, absentDeduction: e.target.value })} placeholder="0" /></Field>
          <Field label="Unpaid leave deduction"><Input type="number" min={0} step="0.01" value={f.unpaidLeaveDeduction} onChange={(e) => setF({ ...f, unpaidLeaveDeduction: e.target.value })} placeholder="0" /></Field>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
          <span className="text-body font-semibold text-muted-foreground">Net pay preview</span>
          <span className="text-section font-bold tabular-nums">{formatBDT(preview)}</span>
        </div>
        {audit.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-meta font-bold uppercase tracking-wider text-muted-foreground">History</p>
            {audit.slice(-4).map((a: any, i: number) => (
              <p key={i} className="text-meta text-muted-foreground">
                {a.action}{a.after?.netPay != null && ` → ${formatBDT(a.after.netPay)}`} · {a.by ?? "system"} · {a.at ? String(a.at).slice(0, 16).replace("T", " ") : ""}
              </p>
            ))}
          </div>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {record?.status !== "PAID" && (
            <Btn variant="outline" onClick={() => void save(true)} disabled={busy}>
              <RefreshCw className="size-3.5" /> Recompute from attendance
            </Btn>
          )}
          <div className="ml-auto flex gap-2">
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={() => void save(false)} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Btn>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function PayrollPage() {
  const [period, setPeriod] = useState(() => {
    if (typeof window === "undefined") return monthNow();
    return new URLSearchParams(window.location.search).get("period") ?? monthNow();
  });
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: records, loading, error } = useList<any[]>("/people/payroll?period=" + period, refresh);
  const [runOpen, setRunOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [editRec, setEditRec] = useState<any | null>(null);
  const { flash, notify } = useToast();
  const { data: status } = useList<any>("/people/payroll/status", refresh);
  // Opening payroll on a fresh month usually means "where did my records go?".
  // If the selected period is empty but an earlier period has data, show that
  // one once (the month picker still lets you go anywhere).
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || loading || !status?.period) return;
    // The auto-jump is a one-shot courtesy on first paint only. It used to be
    // re-armed for as long as the current period had records, which snapped the
    // picker back to the previous month and made "run payroll for a new month"
    // unreachable.
    jumped.current = true;
    if ((records ?? []).length === 0 && status.period !== period) setPeriod(status.period);
  }, [loading, records, status, period]);

  const table = useTable<any>(records, { keys: (r) => [r.employee?.name, r.status, r.period], pageSize: 8 });
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  const allOnPage = table.paged.length > 0 && table.paged.every((r: any) => selected.includes(r.id));
  const setPageSelection = (on: boolean) => {
    const ids = table.paged.map((r: any) => r.id);
    setSelected((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));
  };

  /** Bulk status change — one PATCH per record, all in flight together. */
  const bulkSetStatus = async (target: "FINALIZED" | "PAID") => {
    const ids = selected.filter(Boolean);
    if (!ids.length) return;
    if (target === "PAID" && !window.confirm(`Mark ${ids.length} record(s) as paid? This posts salary expenses to finance.`)) return;
    setRunBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await apiFetch(`/people/payroll/${id}`, { method: "PATCH", body: JSON.stringify({ status: target }) });
        ok++;
      } catch { /* reported below */ }
    }
    notify(`${ok}/${ids.length} marked ${label(target)}`);
    setSelected([]);
    setRunBusy(false);
    reload();
  };
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunBusy(true);
    try {
      const res = await apiFetch<any>("/people/payroll/run", { method: "POST", body: JSON.stringify({ period }) });
      const created = res?.createdCount ?? 0;
      const skipped = res?.skipped ?? 0;
      notify(
        res?.warning
          ? `${created} record(s) created · ${res.warning}`
          : created === 0
            ? `Nothing to do — ${skipped} record(s) already exist for ${period}`
            : `Payroll generated for ${period} · ${created} record(s)${skipped ? ` · ${skipped} already existed` : ""}`
      );
      setRunOpen(false);
      reload();
    } catch (e2: any) { notify(e2.message ?? "Run failed"); setRunOpen(false); } finally { setRunBusy(false); }
  };
  const setStatus = async (r: any, status: string) => {
    try {
      await apiFetch(`/people/payroll/${r.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`Marked ${label(status)}`);
      reload();
    } catch (e2: any) { notify(e2.message ?? "Update failed"); }
  };
  const reopenRec = async (r: any) => {
    if (!window.confirm(`Reopen ${r.employee?.name ?? "record"} (${r.period})? The posted salary expense, ledger entry and bank movement will be reversed.`)) return;
    try {
      await apiFetch(`/people/payroll/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "DRAFT" }) });
      notify("Reopened as draft");
      reload();
    } catch (e2: any) { notify(e2.message ?? "Reopen failed"); }
  };
  const deleteRec = async (r: any) => {
    if (!window.confirm(`Delete DRAFT payroll for ${r.employee?.name ?? "this employee"} (${r.period})?`)) return;
    try {
      await apiFetch(`/people/payroll/${r.id}`, { method: "DELETE" });
      notify("Draft deleted");
      reload();
    } catch (e2: any) { notify(e2.message ?? "Delete failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        icon={<Wallet className="size-4" />}
        title="Payroll"
        subtitle={`${period} · salary minus attendance deductions`}
        stats={[
          { label: "Records", value: (records ?? []).length },
          { label: "Net", value: formatBDT((records ?? []).reduce((s: number, r: any) => s + Number(r.netPay ?? 0), 0)), tone: "emerald" },
          { label: "Paid", value: (records ?? []).filter((r: any) => r.status === "PAID").length, tone: "sky" },
          { label: "Draft", value: (records ?? []).filter((r: any) => r.status === "DRAFT").length, tone: "amber" },
          { label: "Finalized", value: (records ?? []).filter((r: any) => r.status === "FINALIZED").length, tone: "violet" },
        ]}
        actions={
          <div className="flex items-center gap-1.5">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-36 !py-1 text-meta" />
            <Btn variant="primary" onClick={() => setRunOpen(true)} className="!px-2.5 !py-1.5 text-meta"><Play className="size-3.5" /> Run</Btn>
          </div>
        }
      />
      <div className="mt-2">
      {!loading && !error && (records ?? []).length === 0 ? (
        <CardShell>
          <EmptyState
            title={`No payroll records for ${period}`}
            hint="Payroll is generated from salary minus attendance deductions (late ladder, half-day LOP, absents, unpaid leave). Run it once and finalize when the numbers look right."
          />
          <div className="mt-4 flex justify-center">
            <Btn variant="primary" onClick={() => setRunOpen(true)}><Play className="size-3.5" /> Run payroll for {period}</Btn>
          </div>
        </CardShell>
      ) : (
      <>
      <TableToolbar
        q={table.q}
        onQ={table.setQ}
        placeholder="Search employee or status…"
        count={`${table.total} record${table.total === 1 ? "" : "s"} · ${period}`}
        right={
          selected.length > 0 ? (
            <>
              <span className="text-meta font-semibold text-foreground">{selected.length} selected</span>
              <Btn variant="outline" onClick={() => void bulkSetStatus("FINALIZED")} disabled={runBusy} className="!py-1.5">Finalize selected</Btn>
              <Btn variant="primary" onClick={() => void bulkSetStatus("PAID")} disabled={runBusy} className="!py-1.5">Mark paid</Btn>
              <Btn variant="ghost" onClick={() => setSelected([])} className="!py-1.5">Clear</Btn>
            </>
          ) : null
        }
      />
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={6}
        footer={<Pager page={table.page} pages={table.pages} onPage={table.setPage} total={table.total} pageSize={8} label="records" />}
        cols={[
          <span key="sel" className="inline-flex">
            <RowCheck
              checked={allOnPage}
              label="Select all on this page"
              onChange={(v) => setPageSelection(v)}
            />
          </span>,
          "Employee", "Basic salary", "Allow. + Bonus", "Late", "Half-day", "Absent", "Unpaid leave", "Net pay", "Status", "Actions",
        ]}
        rows={table.paged.map((r: any, i: number) => (
          <Tr key={r.id} index={i}>
            <Td><RowCheck checked={selected.includes(r.id)} label={`Select ${r.employee?.name ?? "record"}`} onChange={(v) => toggle(r.id, v)} /></Td>
            <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} /><div><p className="font-medium"><Link href={`/people/attendance/${r.employee?.id}`} className="hover:text-primary hover:underline">{r.employee?.name}</Link></p><p className="text-meta text-muted-foreground">{r.employee?.roleTitle}{r.employee?.department ? ` · ${r.employee.department}` : ""}</p></div></div></Td>
            <Td className="font-semibold tabular-nums">{formatBDT(r.basicSalary != null ? Number(r.basicSalary) : null)}</Td>
            <Td className="tabular-nums text-emerald-600 dark:text-emerald-400">{(Number(r.allowances ?? 0) || Number(r.bonus ?? 0)) ? `+${formatBDT(Number(r.allowances ?? 0) + Number(r.bonus ?? 0))}` : "—"}</Td>
            <Td className="tabular-nums text-amber-600">−{formatBDT(r.lateDeduction != null ? Number(r.lateDeduction) : 0)}</Td>
            <Td className="tabular-nums text-orange-600">−{formatBDT(r.halfDayDeduction != null ? Number(r.halfDayDeduction) : 0)}</Td>
            <Td className="tabular-nums text-rose-600">−{formatBDT(r.absentDeduction != null ? Number(r.absentDeduction) : 0)}</Td>
            <Td className="tabular-nums text-rose-500">−{formatBDT(r.unpaidLeaveDeduction != null ? Number(r.unpaidLeaveDeduction) : 0)}</Td>
            <Td className="font-bold tabular-nums">{formatBDT(r.netPay != null ? Number(r.netPay) : null)}</Td>
            <Td><StatusBadge status={r.status} /></Td>
            <Td>
              <div className="flex items-center gap-1.5">
                <Link href={`/people/payroll/payslip/${r.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"><FileText className="size-3.5" /> Payslip</Link>
                <button onClick={() => setEditRec(r)} title="Edit amounts" aria-label={`Edit ${r.employee?.name ?? "record"}`} className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"><Pencil className="size-3.5" /></button>
                {r.status === "DRAFT" && <Btn variant="outline" onClick={() => setStatus(r, "FINALIZED")}>Finalize</Btn>}
                {r.status === "FINALIZED" && (
                  <>
                    <Btn variant="primary" onClick={() => setStatus(r, "PAID")}>Mark paid</Btn>
                    <Btn variant="ghost" onClick={() => reopenRec(r)}>Reopen</Btn>
                  </>
                )}
                {r.status === "PAID" && <span className="text-meta text-muted-foreground">—</span>}
                {r.status === "DRAFT" && <button onClick={() => deleteRec(r)} title="Delete draft" aria-label="Delete draft" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-rose-500/10 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/50"><Trash2 className="size-3.5" /></button>}
              </div>
              {r.salaryExpense && <p className="mt-1 text-micro text-sky-600 dark:text-sky-300">Posted to finance · <Link href="/capital/expenses" className="font-semibold hover:underline">view expense</Link></p>}
            </Td>
          </Tr>
        ))}
      />
      </>
      )}
      </div>
      <EditPayrollModal record={editRec} onClose={() => setEditRec(null)} onSaved={reload} notify={notify} />
      <Modal closeOnBackdrop={false} open={runOpen} onClose={() => setRunOpen(false)} title="Run payroll">
        <form onSubmit={run} className="flex flex-col gap-4">
          <p className="text-body leading-relaxed text-muted-foreground">
            Generate payroll records for <span className="font-semibold text-foreground">{period}</span>? Net pay is calculated from salary minus attendance deductions: late arrivals (per the late ladder), half-day LOP, absent days and unpaid leave. Existing records are kept and re-run for missing employees.
          </p>
          <FormActions busy={runBusy} cancel={() => setRunOpen(false)} submitLabel={`Run payroll — ${period}`} />
        </form>
      </Modal>
    </div>
  );
}
