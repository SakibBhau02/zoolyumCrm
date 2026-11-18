"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, Circle, Plus, Trash2, UserPlus,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, CardShell, EmptyState, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";
import { Toast, useList, useToast } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";
import { usePeopleAccess } from "../_components/permissions";

const OWNERS = ["HR", "IT", "Finance", "Manager"];

type Item = { id: string; label: string; owner?: string | null; done: boolean; doneAt?: string | null; doneBy?: { name: string } | null };
type Run = {
  id: string;
  kind: "ONBOARDING" | "OFFBOARDING";
  status: "IN_PROGRESS" | "COMPLETED";
  dueDate?: string | null;
  startedAt: string;
  completedAt?: string | null;
  employee: { id: string; name: string; roleTitle: string; department?: string | null; joinDate: string };
  items: Item[];
  progress: { total: number; done: number; percent: number };
};

const FILTERS = ["All", "Onboarding", "Offboarding", "In progress", "Completed"] as const;

export default function OnboardingPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: runs, loading, error } = useList<Run[]>("/people/onboarding", refresh);
  const { data: summary } = useList<any>("/people/onboarding/summary", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [startOpen, setStartOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { flash, notify } = useToast();

  const filtered = useMemo(() => {
    const all = runs ?? [];
    switch (filter) {
      case "Onboarding": return all.filter((r) => r.kind === "ONBOARDING");
      case "Offboarding": return all.filter((r) => r.kind === "OFFBOARDING");
      case "In progress": return all.filter((r) => r.status !== "COMPLETED");
      case "Completed": return all.filter((r) => r.status === "COMPLETED");
      default: return all;
    }
  }, [runs, filter]);

  const toggle = async (run: Run, item: Item) => {
    setBusyId(item.id);
    try {
      await apiFetch(`/people/onboarding/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ done: !item.done }) });
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not update");
    } finally {
      setBusyId(null);
    }
  };

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [stepLabel, setStepLabel] = useState("");
  const { canEdit } = usePeopleAccess();

  const addStep = async (run: Run) => {
    const label = stepLabel.trim();
    if (!label) return;
    try {
      await apiFetch(`/people/onboarding/${run.id}/items`, { method: "POST", body: JSON.stringify({ label, owner: "HR" }) });
      notify("Step added");
      setAddingFor(null);
      setStepLabel("");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not add");
    }
  };

  const removeStep = async (item: Item) => {
    if (!window.confirm(`Remove “${item.label}”?`)) return;
    try {
      await apiFetch(`/people/onboarding/items/${item.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not remove");
    }
  };

  const setStatus = async (run: Run, status: "IN_PROGRESS" | "COMPLETED") => {
    try {
      await apiFetch(`/people/onboarding/${run.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(status === "COMPLETED" ? "Marked complete" : "Reopened");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not update");
    }
  };

  const removeRun = async (run: Run) => {
    if (!window.confirm(`Delete the ${run.kind.toLowerCase()} checklist for ${run.employee.name}?`)) return;
    try {
      await apiFetch(`/people/onboarding/${run.id}`, { method: "DELETE" });
      notify("Checklist deleted");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not delete");
    }
  };

  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        icon={<UserPlus className="size-4" />}
        title="Onboarding & offboarding"
        subtitle="Every join and exit has a checklist — gear, access and paperwork"
        stats={[
          { label: "Active", value: summary?.inProgress ?? "—", sub: "runs", tone: "sky" },
          { label: "Onboarding", value: summary?.ONBOARDING ?? "—", sub: "joins" },
          { label: "Offboarding", value: summary?.OFFBOARDING ?? "—", sub: "exits" },
          { label: "Stale", value: summary?.stale ?? "—", sub: ">7 days", tone: summary?.stale ? "amber" : "default" },
        ]}
        actions={canEdit ? <Btn variant="primary" onClick={() => setStartOpen(true)}><Plus className="size-3.5" /> Start</Btn> : undefined}
      />

      <div className="mt-3 mb-2 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1.5 text-meta font-semibold transition-colors",
              filter === f ? "bg-brand-gradient text-white" : "border border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {error ? (
        <EmptyState title={error} hint="Only Owner / HR can manage onboarding." />
      ) : loading && !runs ? (
        <div className="grid gap-3 xl:grid-cols-2">{[...Array(2)].map((_, i) => <CardShell key={i}><div className="h-40" /></CardShell>)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filter === "All" ? "No onboarding runs yet" : `Nothing ${filter.toLowerCase()}`}
          hint="Adding an employee starts an onboarding run automatically; setting their status to EXITED starts an offboarding run."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((run) => (
            <CardShell key={run.id}>
              <div className="flex flex-wrap items-start gap-2.5">
                <Avatar name={run.employee.name} size="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/people/directory/${run.employee.id}`} className="truncate text-body-lg font-semibold hover:text-primary hover:underline">
                      {run.employee.name}
                    </Link>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide",
                      run.kind === "ONBOARDING" ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                    )}>
                      {run.kind === "ONBOARDING" ? "onboarding" : "offboarding"}
                    </span>
                    {run.status === "COMPLETED" && (
                      <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-micro font-bold uppercase text-emerald-600 dark:text-emerald-300">
                        <CheckCircle2 className="size-3.5" /> done
                      </span>
                    )}
                  </div>
                  <p className="truncate text-micro text-muted-foreground">
                    {run.employee.roleTitle}
                    {run.employee.department ? ` · ${run.employee.department}` : ""}
                    {run.dueDate ? ` · due ${formatDate(run.dueDate)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-body-lg font-bold tabular-nums">{run.progress.done}/{run.progress.total}</p>
                  <p className="text-micro text-muted-foreground">{run.progress.percent}%</p>
                </div>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", run.progress.percent === 100 ? "bg-emerald-500" : run.progress.percent >= 50 ? "bg-brand-gradient" : "bg-amber-400")}
                  style={{ width: `${run.progress.percent}%` }}
                />
              </div>

              <div className="mt-3 flex flex-col gap-1">
                {run.items.map((item) => (
                  <div key={item.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/50">
                    <button
                      onClick={() => toggle(run, item)}
                      disabled={busyId === item.id}
                      aria-label={`${item.done ? "Uncheck" : "Check"} ${item.label}`}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                    >
                      {item.done
                        ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                        : <Circle className="size-4" />}
                    </button>
                    <span className={cn("min-w-0 flex-1 truncate text-body", item.done && "text-muted-foreground line-through")}>
                      {item.label}
                    </span>
                    {item.owner && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-micro font-bold uppercase text-muted-foreground">{item.owner}</span>}
                    {item.done && item.doneBy && <span className="hidden shrink-0 text-micro text-muted-foreground sm:inline">{item.doneBy.name}</span>}
                    <button
                      onClick={() => removeStep(item)}
                      title="Remove step"
                      aria-label={`Remove ${item.label}`}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:text-rose-500"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 border-t border-border/50 pt-2.5">
                {addingFor === run.id ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Input
                      autoFocus
                      value={stepLabel}
                      onChange={(e) => setStepLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addStep(run); if (e.key === "Escape") { setAddingFor(null); setStepLabel(""); } }}
                      placeholder="New step…"
                      aria-label="New checklist step"
                      className="!w-56 !py-1 text-meta"
                    />
                    <Btn variant="primary" className="!px-2 !py-1 text-micro" onClick={() => addStep(run)}>Add</Btn>
                    <Btn variant="ghost" className="!px-2 !py-1 text-micro" onClick={() => { setAddingFor(null); setStepLabel(""); }}>Cancel</Btn>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canEdit && (
                      <>
                        <button onClick={() => setAddingFor(run.id)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-micro font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                          <Plus className="size-3.5" /> Add step
                        </button>
                        {run.status === "COMPLETED" ? (
                          <Btn variant="ghost" className="!px-2 !py-1 text-micro" onClick={() => setStatus(run, "IN_PROGRESS")}>Reopen</Btn>
                        ) : (
                          <Btn variant="outline" className="!px-2 !py-1 text-micro" onClick={() => setStatus(run, "COMPLETED")}>Mark complete</Btn>
                        )}
                      </>
                    )}
                    <Link href={`/people/directory/${run.employee.id}`} className="ml-auto inline-flex items-center gap-1 text-micro font-semibold text-primary hover:underline">
                      Profile <ArrowRight className="size-3.5" />
                    </Link>
                    {canEdit && (
                      <button onClick={() => removeRun(run)} title="Delete checklist" aria-label="Delete checklist" className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </CardShell>
          ))}
        </div>
      )}

      <StartRunModal open={startOpen} onClose={() => setStartOpen(false)} employees={employees ?? []} onSaved={() => { notify("Run started"); reload(); }} />
    </div>
  );
}

function StartRunModal({ open, onClose, employees, onSaved }: { open: boolean; onClose: () => void; employees: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: "", kind: "ONBOARDING", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.employeeId) { setErr("Pick an employee"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/people/onboarding", { method: "POST", body: JSON.stringify({ employeeId: f.employeeId, kind: f.kind, dueDate: f.dueDate || undefined, reset: true }) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Could not start");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Start a run">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Employee *">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">Select…</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name} — {emp.roleTitle}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Runbook">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="ONBOARDING">Onboarding</option>
              <option value="OFFBOARDING">Offboarding</option>
            </Select>
          </Field>
          <Field label="Target date" hint="Optional">
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
        </div>
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-meta text-muted-foreground">
          A run already exists for that person and type — starting again rebuilds the steps from the template and resets progress.
        </p>
        {err && <p className="text-body font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Start" />
      </form>
    </Modal>
  );
}
