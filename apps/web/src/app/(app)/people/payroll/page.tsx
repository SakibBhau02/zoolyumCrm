"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { FileText, Play } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT } from "@/lib/format";
import { Avatar, StatusBadge } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { FormActions, Input, Modal } from "@/components/ui";
import { label, monthNow } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";

export default function PayrollPage() {
  const [period, setPeriod] = useState(monthNow());
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: records, loading, error } = useList<any[]>("/people/payroll?period=" + period, refresh);
  const [runOpen, setRunOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const { flash, notify } = useToast();
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunBusy(true);
    try {
      await apiFetch("/people/payroll/run", { method: "POST", body: JSON.stringify({ period }) });
      notify(`Payroll generated for ${period}`);
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
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-44" />
        <Btn variant="primary" onClick={() => setRunOpen(true)}><Play className="size-3.5" /> Run Payroll</Btn>
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={6}
        footer={<span className="text-[11.5px] text-muted-foreground">{period} · {(records ?? []).length} records</span>}
cols={["Employee", "Basic salary", "Late", "Half-day", "Absent", "Unpaid leave", "Net pay", "Status", "Actions"]}
        rows={(records ?? []).map((r: any, i: number) => (
          <Tr key={r.id} index={i}>
            <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} /><div><p className="font-medium">{r.employee?.name}</p><p className="text-[11px] text-muted-foreground">{r.employee?.roleTitle}{r.employee?.department ? ` · ${r.employee.department}` : ""}</p></div></div></Td>
            <Td className="font-semibold tabular-nums">{formatBDT(r.basicSalary != null ? Number(r.basicSalary) : null)}</Td>
            <Td className="tabular-nums text-amber-600">−{formatBDT(r.lateDeduction != null ? Number(r.lateDeduction) : 0)}</Td>
            <Td className="tabular-nums text-orange-600">−{formatBDT(r.halfDayDeduction != null ? Number(r.halfDayDeduction) : 0)}</Td>
            <Td className="tabular-nums text-rose-600">−{formatBDT(r.absentDeduction != null ? Number(r.absentDeduction) : 0)}</Td>
            <Td className="tabular-nums text-rose-500">−{formatBDT(r.unpaidLeaveDeduction != null ? Number(r.unpaidLeaveDeduction) : 0)}</Td>
            <Td className="font-bold tabular-nums">{formatBDT(r.netPay != null ? Number(r.netPay) : null)}</Td>
            <Td><StatusBadge status={r.status} /></Td>
            <Td>
              <div className="flex items-center gap-1.5">
                <Link href={`/people/payroll/payslip/${r.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"><FileText className="size-3.5" /> Payslip</Link>
                {r.status === "DRAFT" && <Btn variant="outline" onClick={() => setStatus(r, "FINALIZED")}>Finalize</Btn>}
                {r.status === "FINALIZED" && <Btn variant="primary" onClick={() => setStatus(r, "PAID")}>Mark paid</Btn>}
                {r.status === "PAID" && <span className="text-[11.5px] text-muted-foreground">—</span>}
              </div>
            </Td>
          </Tr>
        ))}
      />
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title="Run payroll">
        <form onSubmit={run} className="flex flex-col gap-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Generate payroll records for <span className="font-semibold text-foreground">{period}</span>? Net pay is calculated from salary minus attendance deductions: late arrivals (per the late ladder), half-day LOP, absent days and unpaid leave. Existing records are kept and re-run for missing employees.
          </p>
          <FormActions busy={runBusy} cancel={() => setRunOpen(false)} submitLabel={`Run payroll — ${period}`} />
        </form>
      </Modal>
    </div>
  );
}
