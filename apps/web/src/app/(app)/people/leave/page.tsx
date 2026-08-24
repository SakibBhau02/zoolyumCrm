"use client";
import { useCallback, useState } from "react";
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, SectionTitle, StatusBadge } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { LeaveModal } from "../_components/modals/leave-modal";

export default function LeavePage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: requests, loading, error } = useList<any[]>("/people/leave-requests", refresh);
  const { data: balances, loading: bl, error: be } = useList<any[]>("/people/leave-balances", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [open, setOpen] = useState(false);
  const { flash, notify } = useToast();
  const decide = async (r: any, approved: boolean) => {
    try {
      await apiFetch(`/people/leave-requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ approved }) });
      notify(approved ? "Leave approved" : "Leave rejected");
      reload();
    } catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const days = (s: string, e: string) => Math.max(1, Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1);
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Leave requests" subtitle="Approve or reject pending requests" />
          <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Request Leave</Btn>
        </div>
        <DataTable
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={6}
          footer={<span className="text-[11.5px] text-muted-foreground">{(requests ?? []).length} requests</span>}
          cols={["Employee", "Type", "From", "To", "Days", "Applied", "Status"]}
          rows={(requests ?? []).map((r: any, i: number) => (
            <Tr key={r.id} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} /><div><p className="font-medium">{r.employee?.name}</p><p className="text-[11px] text-muted-foreground">{r.employee?.roleTitle}</p></div></div></Td>
              <Td><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary dark:text-primary">{r.leaveType}</span></Td>
              <Td className="text-muted-foreground">{formatDate(r.startDate)}</Td>
              <Td className="text-muted-foreground">{formatDate(r.endDate)}</Td>
              <Td className="font-semibold tabular-nums">{days(r.startDate, r.endDate)}</Td>
              <Td className="text-muted-foreground">{formatDate(r.appliedAt)}</Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  {r.status === "PENDING" && (
                    <>
                      <button onClick={() => decide(r, true)} className="rounded-lg p-1.5 text-emerald-500 transition-colors hover:bg-emerald-500/10" title="Approve"><CheckCircle2 className="size-4" /></button>
                      <button onClick={() => decide(r, false)} className="rounded-lg p-1.5 text-rose-500 transition-colors hover:bg-rose-500/10" title="Reject"><XCircle className="size-4" /></button>
                    </>
                  )}
                  <StatusBadge status={r.status} />
                </div>
              </Td>
            </Tr>
          ))}
        />
      </div>
      <SectionTitle title="Leave balances" subtitle="Entitlement by type and period" />
      <DataTable
        loading={bl}
        error={be}
        onRetry={reload}
        skeleton={4}
        footer={<span className="text-[11.5px] text-muted-foreground">{(balances ?? []).length} balance rows</span>}
        cols={["Employee", "Type", "Balance (days)", "Period"]}
        rows={(balances ?? []).map((b: any, i: number) => (
          <Tr key={i} index={i}>
            <Td><div className="flex items-center gap-2.5"><Avatar name={b.employee?.name} size="size-7" /><p className="font-medium">{b.employee?.name}</p></div></Td>
            <Td><span className="rounded-full bg-brand-gradient-soft px-2 py-0.5 text-[10px] font-medium text-primary dark:text-primary">{b.leaveType}</span></Td>
            <Td className="font-semibold tabular-nums">{b.balanceDays}</Td>
            <Td className="text-muted-foreground">{b.period}</Td>
          </Tr>
        ))}
      />
      <LeaveModal open={open} onClose={() => setOpen(false)} employees={employees ?? []} onSaved={() => { notify("Leave requested"); reload(); }} />
    </div>
  );
}
