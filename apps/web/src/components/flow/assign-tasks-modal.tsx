"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Field, FormError, Modal, Select } from "@/components/ui";
import { cn } from "@/components/shared";
import type { ProjectDeliverable } from "@/lib/types";

type AssignResult = {
  created: number;
  skipped: number;
  failed: number;
  assignee: { id: string; name: string; employmentStatus?: string };
  results: {
    deliverableId: string;
    title: string;
    status: "created" | "skipped" | "failed";
    taskId?: string;
    reason?: string;
  }[];
};

export function AssignTasksModal({
  open,
  onClose,
  projectId,
  deliverables,
  employees,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  deliverables: ProjectDeliverable[];
  employees: { id: string; name: string; roleTitle?: string | null; employmentStatus?: string }[];
  onDone: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [coAssignees, setCoAssignees] = useState<string[]>([]);
  const [priority, setPriority] = useState("MEDIUM");
  const [overrideDate, setOverrideDate] = useState("");
  const [clientVisible, setClientVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setBusy(false);
    setAssignee("");
    setCoAssignees([]);
    setPriority("MEDIUM");
    setOverrideDate("");
    setClientVisible(deliverables.some((d) => d.clientVisible));
    // Reset only when the sheet opens — the parent re-renders on every reload
    // and must not wipe the result panel mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const alreadyLinked = deliverables.filter((d) => (d.tasks?.length ?? 0) > 0).length;
  const willCreate = deliverables.length - alreadyLinked;
  const selectedEmployee = employees.find((e) => e.id === assignee);
  const inactive =
    !!selectedEmployee?.employmentStatus && selectedEmployee.employmentStatus !== "ACTIVE";

  const submit = async () => {
    setError(null);
    if (!assignee) return setError("Pick who is doing the work");
    setBusy(true);
    try {
      const res = await apiFetch<AssignResult>(
        `/flow/projects/${projectId}/deliverables/assign-tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            deliverableIds: deliverables.map((d) => d.id),
            assigneeId: assignee,
            coAssigneeIds: coAssignees,
            priority,
            dueDateOverride: overrideDate || undefined,
            clientVisible,
          }),
        }
      );
      setResult(res);
      onDone(
        `${res.created} task${res.created === 1 ? "" : "s"} created${
          res.skipped ? ` · ${res.skipped} already assigned` : ""
        }${res.failed ? ` · ${res.failed} failed` : ""}`
      );
    } catch (e: any) {
      setError(e?.message ?? "Could not assign the tasks");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={!busy}
      size="lg"
      eyebrow="One-click"
      icon={<ListChecks className="size-5" />}
      title={`Assign ${deliverables.length} deliverable${deliverables.length === 1 ? "" : "s"} as tasks`}
      subtitle="One task per deliverable. Existing links are skipped, never duplicated."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="hidden text-meta text-muted-foreground sm:block">
            {result
              ? `${result.created} created · ${result.skipped} skipped · ${result.failed} failed`
              : `${willCreate} task${willCreate === 1 ? "" : "s"} will be created${
                  alreadyLinked ? ` · ${alreadyLinked} already linked` : ""
                }`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {result ? "Close" : "Cancel"}
            </button>
            {!result && (
              <button
                type="button"
                onClick={submit}
                disabled={busy || willCreate === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-body font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                <UserPlus className="size-3.5" />
                {busy ? "Assigning…" : willCreate ? `Assign ${willCreate}` : "Nothing to assign"}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>

        {result ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              <p className="text-body font-semibold text-emerald-600 dark:text-emerald-400">
                {result.created} created · {result.skipped} skipped · {result.failed} failed
              </p>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border border-border/60">
              {result.results.map((r) => (
                <div
                  key={`${r.deliverableId}-${r.taskId ?? r.status}`}
                  className="flex items-start gap-2 border-b border-border/40 px-3 py-2 last:border-0"
                >
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      r.status === "created"
                        ? "bg-emerald-500"
                        : r.status === "skipped"
                          ? "bg-muted-foreground/40"
                          : "bg-rose-500"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-meta font-semibold">{r.title}</p>
                    <p className="text-micro text-muted-foreground">
                      {r.status === "created"
                        ? "task created"
                        : r.status === "skipped"
                          ? r.reason ?? "already assigned"
                          : r.reason ?? "failed"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Assignee" hint="Required — only this field has to be chosen">
                <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Select person…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.roleTitle ? ` — ${e.roleTitle}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </Select>
              </Field>
            </div>

            {inactive && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-meta text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                This person is not active. The task will be created but nobody may pick it up.
              </p>
            )}

            <Field label="Also assign to" hint="Optional — task appears in their board too">
              <div className="flex flex-wrap gap-1.5">
                {employees
                  .filter((e) => e.id !== assignee)
                  .slice(0, 40)
                  .map((e) => {
                    const on = coAssignees.includes(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() =>
                          setCoAssignees((prev) =>
                            on ? prev.filter((id) => id !== e.id) : [...prev, e.id]
                          )
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-micro font-semibold transition-colors",
                          on
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {e.name}
                        {on && <X className="ml-1 inline size-3" />}
                      </button>
                    );
                  })}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Due date" hint="Leave empty to use each deliverable's own due date">
                <input
                  type="date"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-body-lg outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-3 self-end rounded-xl border border-border/70 bg-card px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold leading-tight">Client-visible tasks</span>
                  <span className="mt-0.5 block text-micro text-muted-foreground">
                    Shows in the client portal timeline
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={clientVisible}
                  onChange={(e) => setClientVisible(e.target.checked)}
                  className="size-4 accent-primary"
                />
              </label>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5">
              <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
                Selected deliverables
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {deliverables.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-meta">
                    <span className="font-semibold">{d.topic ?? d.title}</span>
                    {d.kind && (
                      <span className="rounded-full bg-muted px-1.5 text-micro font-bold text-muted-foreground">
                        {d.kind.toLowerCase()}
                      </span>
                    )}
                    {(d.tasks?.length ?? 0) > 0 && (
                      <span className="text-micro text-amber-500">already linked</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
