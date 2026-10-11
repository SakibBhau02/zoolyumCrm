"use client";
import { useCallback, useState } from "react";
import { CheckCircle2, History, Plus, Wallet, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Drawer, Field, Textarea } from "@/components/ui";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { LeaveModal } from "../_components/modals/leave-modal";

export default function LeavePage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: requests, loading, error } = useList<any[]>("/people/leave-requests", refresh);
  const { data: balances, loading: bl, error: be } = useList<any[]>("/people/leave-balances", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const { flash, notify } = useToast();
  const decide = async (r: any, approved: boolean) => {
    try {
      await apiFetch(`/people/leave-requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ approved }) });
      notify(approved ? "Leave approved" : "Leave rejected");
      reload();
    } catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const decideDetail = async (approved: boolean) => {
    if (!selectedId || deciding) return;
    setDeciding(true);
    try {
      await apiFetch(`/people/leave-requests/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ approved, note: note.trim() || undefined }),
      });
      notify(approved ? "Leave approved — balance deducted" : "Leave rejected");
      setNote("");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Failed");
    } finally {
      setDeciding(false);
    }
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
            <Tr key={r.id} index={i} onClick={() => setSelectedId(r.id)} className="cursor-pointer">
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
                      <button onClick={(e) => { e.stopPropagation(); decide(r, true); }} className="rounded-lg p-1.5 text-emerald-500 transition-colors hover:bg-emerald-500/10" title="Approve"><CheckCircle2 className="size-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); decide(r, false); }} className="rounded-lg p-1.5 text-rose-500 transition-colors hover:bg-rose-500/10" title="Reject"><XCircle className="size-4" /></button>
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
      <LeaveDetailDrawer
        id={selectedId}
        onClose={() => { setSelectedId(null); setNote(""); }}
        note={note}
        setNote={setNote}
        deciding={deciding}
        onDecide={decideDetail}
      />
    </div>
  );
}

/**
 * Leave request detail — the full story an approver needs: who, what type,
 * which days (working vs off), what it costs from the balance, and the
 * applied → decided timeline. Approve/reject happens here with a note.
 */
function LeaveDetailDrawer({ id, onClose, note, setNote, deciding, onDecide }: {
  id: string | null;
  onClose: () => void;
  note: string;
  setNote: (v: string) => void;
  deciding: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const { data: d, loading, error } = useList<any>(id ? `/people/leave-requests/${id}` : null, 0);
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? `${d.employee?.name ?? "Leave"} · ${d.leaveType}` : "Leave request"}>
      {!id ? null : loading ? (
        <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : error || !d ? (
        <EmptyState title={String(error ?? "Not found")} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Avatar name={d.employee?.name} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">{d.employee?.name}</p>
              <p className="text-[11px] text-muted-foreground">{d.employee?.roleTitle}{d.employee?.department ? ` · ${d.employee.department}` : ""}</p>
            </div>
            <StatusBadge status={d.status} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Period</p>
              <p className="mt-0.5 text-[12px] font-bold">{formatDate(d.from)} → {formatDate(d.to)}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Working days</p>
              <p className="mt-0.5 text-[12px] font-bold tabular-nums">{d.workingDays ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">{d.calendarDays ?? 0} calendar{d.nonWorkingDays ? ` · ${d.nonWorkingDays} off/holiday` : ""}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Balance impact</p>
              {d.leaveType === "UNPAID" ? (
                <p className="mt-0.5 text-[12px] font-bold">Unpaid — no balance</p>
              ) : d.balance ? (
                <>
                  <p className="mt-0.5 text-[12px] font-bold tabular-nums">{d.balance.days} days left</p>
                  <p className="text-[10px] text-muted-foreground">
                    {d.status === "APPROVED" && d.deductedDays != null
                      ? `${d.balanceBefore ?? "?"} → ${d.balanceAfter ?? "?"} (−${d.deductedDays})`
                      : `−${d.workingDays ?? 0} on approve`}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-[12px] text-muted-foreground">No balance row — will seed on approve</p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              <History className="size-3" /> Timeline
            </p>
            <div className="flex flex-col gap-1.5">
              {(d.timeline ?? []).map((t: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", t.event === "approved" ? "bg-emerald-500" : t.event === "rejected" ? "bg-rose-500" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] capitalize">{t.event} <span className="text-muted-foreground">· {t.by}</span></p>
                    {t.note && <p className="text-[11px] text-muted-foreground">{t.note}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(t.at)}</span>
                </div>
              ))}
            </div>
          </div>

          {d.status === "PENDING" ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
              <Field label="Decision note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason shown to the employee…" /></Field>
              <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={() => onDecide(true)} disabled={deciding} className="bg-emerald-600 hover:bg-emerald-500">
                  <CheckCircle2 className="size-3.5" /> {deciding ? "Working…" : "Approve"}
                </Btn>
                <Btn variant="outline" onClick={() => onDecide(false)} disabled={deciding} className="text-rose-500">
                  <XCircle className="size-3.5" /> Reject
                </Btn>
              </div>
              <p className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <Wallet className="size-3" />
                {d.leaveType === "UNPAID" ? "Unpaid — approving marks attendance leave with no deduction." : `Approving deducts ${d.workingDays ?? 0} working day(s) from the ${d.leaveType} balance.`}
              </p>
            </div>
          ) : (
            d.decisionNote && (
              <p className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[11.5px] text-muted-foreground">
                <span className="font-bold text-foreground">Decision note: </span>{d.decisionNote}
              </p>
            )
          )}
        </div>
      )}
    </Drawer>
  );
}
