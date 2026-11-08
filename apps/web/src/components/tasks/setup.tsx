"use client";

/**
 * Task setup surfaces — templates, automation rules, team workload and
 * estimation accuracy.
 *
 * These used to live at the bottom of the daily board. They are "configure once
 * a month" tooling, and showing them under the board made the work screen feel
 * long and cluttered (see Linear's "don't compete for attention you haven't
 * earned"). They now render on their own route: /tasks/setup.
 *
 * Every panel fetches its own data, so this module has no shared state with the
 * workspace page.
 */
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Minus, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, cn } from "@/components/shared";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";
import { EstimationPanel } from "@/components/tasks/estimation";
import {
  PRIORITIES,
  TASK_STATUS_OPTS,
  TASK_TYPES,
  label,
  normalizePriority,
} from "@/components/tasks/domain";

export type Template = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  benchmarkDurationDays?: number | null;
  benchmarkHours?: number | null;
  defaultTasks?: any[];
};
export type Rule = {
  id: string;
  name: string;
  trigger?: string;
  action?: string;
  config?: any;
  enabled?: boolean;
};
export type UserLite = { id: string; name: string; roleTitle?: string };
type WorkloadRow = {
  id: string;
  name: string;
  allocated?: number;
  capacity?: number;
  baseCapacity?: number;
  leaveDaysInWindow?: number;
  weeklyOffDaysInWindow?: number;
  overbookedReason?: string | null;
  utilization?: number;
  taskCount?: number;
  overbooked?: boolean;
  urgent?: number;
  overdue?: number;
  tasks?: { title: string; hours: number; priority: string; due: string | null }[];
};

/** Mirrors the backend isPM() rule — authoring plan-shaping config is PM-only. */
export function useCanPlan() {
  const { data: me } = useApi<{ roleName?: string }>("/auth/me");
  return !!me && ["Owner", "Admin", "HR/Admin", "Project Manager"].includes(me.roleName ?? "");
}

// ── Template creation ───────────────────────────────────────────────────
export function TemplateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [benchDays, setBenchDays] = useState("");
  const [benchHours, setBenchHours] = useState("");
  const [rows, setRows] = useState<
    { title: string; priority: string; estimatedHours: string; taskType: string }[]
  >([{ title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setName("");
    setDescription("");
    setCategory("");
    setBenchDays("");
    setBenchHours("");
    setRows([{ title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }]);
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Template name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/tasks/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          benchmarkDurationDays: benchDays ? Number(benchDays) : undefined,
          benchmarkHours: benchHours ? Number(benchHours) : undefined,
          defaultTasks: rows
            .filter((r) => r.title.trim())
            .map((r) => ({
              title: r.title.trim(),
              priority: r.priority,
              estimatedHours: r.estimatedHours ? Number(r.estimatedHours) : undefined,
              taskType: r.taskType,
            })),
        }),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const patchRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  return (
    <Modal open={open} onClose={onClose} title="New template" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website launch" autoFocus />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="launch, bugfix, onboarding…" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kickoff checklist" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Benchmark days">
              <Input type="number" min={0} value={benchDays} onChange={(e) => setBenchDays(e.target.value)} placeholder="5" />
            </Field>
            <Field label="Benchmark hours">
              <Input type="number" min={0} step={0.5} value={benchHours} onChange={(e) => setBenchHours(e.target.value)} placeholder="20" />
            </Field>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Default tasks</span>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={r.title} onChange={(e) => patchRow(i, { title: e.target.value })} placeholder="Task title" />
              <Select value={r.taskType} onChange={(e) => patchRow(i, { taskType: e.target.value })} className="!w-32">
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Select value={r.priority} onChange={(e) => patchRow(i, { priority: e.target.value })} className="!w-28">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={r.estimatedHours}
                onChange={(e) => patchRow(i, { estimatedHours: e.target.value })}
                placeholder="hrs"
                className="!w-20"
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, xi) => xi !== i))}
                className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
              >
                <Minus className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows([...rows, { title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }])}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add task
          </button>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create template" />
      </form>
    </Modal>
  );
}

// ── Automation rule creation ────────────────────────────────────────────
export function AutomationModal({
  open,
  onClose,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("status-change");
  const [triggerValue, setTriggerValue] = useState("IN_PROGRESS");
  const [action, setAction] = useState("change-status");
  const [actionValue, setActionValue] = useState("IN_PROGRESS");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setName("");
    setTrigger("status-change");
    setTriggerValue("IN_PROGRESS");
    setAction("change-status");
    setActionValue("IN_PROGRESS");
    setExtra({});
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Rule name is required");
      return;
    }
    if (action === "assign-to" && !actionValue) {
      setErr("Pick an assignee");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const config: any = {};
      if (trigger === "status-change") config.toStatus = triggerValue;
      if (trigger === "priority-change") config.toPriority = triggerValue;
      if (trigger === "assigned") config.assigneeId = triggerValue || undefined;
      if (action === "change-status") config.toStatus = actionValue;
      if (action === "change-priority") config.toPriority = actionValue;
      if (action === "assign-to") config.assignToId = actionValue;
      if (action === "create-task") {
        config.title = extra.title || undefined;
        config.dueOffsetDays = extra.dueOffsetDays ? Number(extra.dueOffsetDays) : 0;
        config.priority = extra.priority || "MEDIUM";
      }
      await apiFetch("/tasks/automation", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          trigger:
            trigger === "status-change" ? "status-changed" : trigger === "priority-change" ? "priority-changed" : "assigned",
          action,
          config,
        }),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add automation rule">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Rule name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Move to dev on start" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="When">
            <Select
              value={trigger}
              onChange={(e) => {
                setTrigger(e.target.value);
                setTriggerValue(
                  e.target.value === "status-change" ? "IN_PROGRESS" : e.target.value === "priority-change" ? "HIGH" : ""
                );
              }}
            >
              <option value="status-change">Status changes to</option>
              <option value="priority-change">Priority changes to</option>
              <option value="assigned">Task is assigned</option>
            </Select>
          </Field>
          {trigger === "status-change" ? (
            <Field label="To status">
              <Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                {TASK_STATUS_OPTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : trigger === "priority-change" ? (
            <Field label="To priority">
              <Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Assignee">
              <Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Then">
            <Select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setActionValue(
                  e.target.value === "change-status" ? "IN_PROGRESS" : e.target.value === "change-priority" ? "HIGH" : ""
                );
              }}
            >
              <option value="change-status">Change status</option>
              <option value="change-priority">Change priority</option>
              <option value="assign-to">Assign to</option>
              <option value="notify">Notify assignee</option>
              <option value="create-task">Create follow-up task</option>
              <option value="archive">Archive task</option>
            </Select>
          </Field>
          {action === "change-status" ? (
            <Field label="To status">
              <Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}>
                {TASK_STATUS_OPTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : action === "change-priority" ? (
            <Field label="To priority">
              <Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : action === "assign-to" ? (
            <Field label="Assignee">
              <Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}>
                <option value="">Pick user</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : action === "create-task" ? (
            <Field label="Follow-up title">
              <Input
                value={extra.title ?? ""}
                onChange={(e) => setExtra({ ...extra, title: e.target.value })}
                placeholder="Auto follow-up"
              />
            </Field>
          ) : (
            <div />
          )}
        </div>
        {action === "create-task" && (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Due in days">
              <Input
                type="number"
                min={0}
                value={extra.dueOffsetDays ?? ""}
                onChange={(e) => setExtra({ ...extra, dueOffsetDays: e.target.value })}
                placeholder="2"
              />
            </Field>
            <Field label="Priority">
              <Select value={extra.priority ?? "MEDIUM"} onChange={(e) => setExtra({ ...extra, priority: e.target.value })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add rule" />
      </form>
    </Modal>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────
export function TemplatesPanel({ onNotify }: { onNotify?: (m: string) => void }) {
  const [aux, setAux] = useState(0);
  const canPlan = useCanPlan();
  const { data: templates, error } = useApi<Template[]>(`/tasks/templates?v=${aux}`);
  const [open, setOpen] = useState(false);

  const useTemplate = (t: Template) => {
    apiFetch(`/tasks/templates/${t.id}/use`, { method: "POST" })
      .then(() => onNotify?.("Tasks created from template"))
      .catch((e: any) => onNotify?.(e.message ?? "Failed"));
  };
  const deleteTemplate = (t: Template) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    apiFetch(`/tasks/templates/${t.id}`, { method: "DELETE" })
      .then(() => setAux((a) => a + 1))
      .catch((e: any) => onNotify?.(e.message ?? "Failed"));
  };

  return (
    <CardShell>
      <SectionTitle
        title="Templates"
        subtitle="Reusable task checklists — spin up a whole plan in one click"
        action={canPlan ? <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> New</Btn> : null}
      />
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState title={error} />
          <Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn>
        </div>
      ) : !templates ? (
        <div className="flex flex-col gap-2">{[...Array(2)].map((_, i) => <SkeletonBlock key={i} className="h-16" />)}</div>
      ) : templates.length === 0 ? (
        <EmptyState title="No templates yet" hint="Create one to spin up standard task lists" />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-bold">{t.name}</p>
                  {t.description && <p className="truncate text-[11px] text-muted-foreground">{t.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => useTemplate(t)} title="Use template" className="flex size-7 items-center justify-center rounded-lg text-emerald-400 transition-colors hover:bg-emerald-500/10">
                    <Play className="size-3.5" />
                  </button>
                  {canPlan && (
                    <button onClick={() => deleteTemplate(t)} title="Delete template" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {t.category && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">{t.category}</span>}
                {t.benchmarkHours != null && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">~{t.benchmarkHours}h</span>}
                {t.benchmarkDurationDays != null && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{t.benchmarkDurationDays} days</span>}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{(t.defaultTasks ?? []).length} tasks</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <TemplateModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          onNotify?.("Template created");
          setAux((a) => a + 1);
        }}
      />
    </CardShell>
  );
}

function ruleSummary(r: Rule) {
  const c = r.config ?? {};
  const parts: string[] = [];
  if (r.trigger === "status-changed") parts.push(c.toStatus ? `${label(c.fromStatus)} → ${label(c.toStatus)}` : `to ${label(c.toStatus ?? "")}`);
  if (r.trigger === "priority-changed") parts.push(`to ${label(c.toPriority ?? "")}`);
  if (r.action === "change-status") parts.push(`set status ${label(c.toStatus ?? "")}`);
  if (r.action === "change-priority") parts.push(`set priority ${label(c.toPriority ?? "")}`);
  if (r.action === "create-task") parts.push(`create "${c.title ?? "follow-up"}"${c.dueOffsetDays ? ` in ${c.dueOffsetDays}d` : ""}`);
  if (r.action === "archive") parts.push("archive it");
  return parts.filter(Boolean).join(" · ");
}

export function AutomationPanel({ users, onNotify }: { users: UserLite[]; onNotify?: (m: string) => void }) {
  const [aux, setAux] = useState(0);
  const canPlan = useCanPlan();
  const { data: rules, error } = useApi<Rule[]>(`/tasks/automation?v=${aux}`);
  const [open, setOpen] = useState(false);

  const toggleRule = (r: Rule) => {
    apiFetch(`/tasks/automation/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) })
      .then(() => setAux((a) => a + 1))
      .catch((e: any) => onNotify?.(e.message ?? "Failed"));
  };
  const deleteRule = (r: Rule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    apiFetch(`/tasks/automation/${r.id}`, { method: "DELETE" })
      .then(() => setAux((a) => a + 1))
      .catch((e: any) => onNotify?.(e.message ?? "Failed"));
  };

  return (
    <CardShell>
      <SectionTitle
        title="Automation"
        subtitle="Rules that fire on status, priority or assignee changes"
        action={canPlan ? <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add rule</Btn> : null}
      />
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState title={error} />
          <Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn>
        </div>
      ) : !rules ? (
        <div className="flex flex-col gap-2">{[...Array(2)].map((_, i) => <SkeletonBlock key={i} className="h-16" />)}</div>
      ) : rules.length === 0 ? (
        <EmptyState title="No rules yet" hint="Automate status, priority, notifications or follow-ups" />
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-bold">{r.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">{label(r.trigger ?? "")}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">{label(r.action ?? "")}</span>
                  <span>{ruleSummary(r)}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canPlan ? (
                  <>
                    <button onClick={() => toggleRule(r)} className={cn("relative h-5 w-9 rounded-full transition-colors", r.enabled ? "bg-primary" : "bg-muted")} title={r.enabled ? "Disable" : "Enable"}>
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", r.enabled ? "left-[18px]" : "left-0.5")} />
                    </button>
                    <button onClick={() => deleteRule(r)} title="Delete rule" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", r.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground")}>{r.enabled ? "on" : "off"}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <AutomationModal
        open={open}
        onClose={() => setOpen(false)}
        users={users}
        onSaved={() => {
          onNotify?.("Rule added");
          setAux((a) => a + 1);
        }}
      />
    </CardShell>
  );
}

export function WorkloadPanel({ onNotify }: { onNotify?: (m: string) => void }) {
  const [aux, setAux] = useState(0);
  const { data: workload, error } = useApi<any>(`/tasks/workload?v=${aux}`);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <SectionTitle title="Team Workload" subtitle="Capacity vs assigned hours this week — leave and off-days reduce capacity" />
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState title={error} />
          <Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn>
        </div>
      ) : !workload ? (
        <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-bold text-primary">Team utilization {workload?.teamUtilization ?? 0}%</span>
            <span className={cn("rounded-full px-2.5 py-1 text-[10.5px] font-bold", (workload?.overbookedCount ?? 0) > 0 ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400")}>
              {workload?.overbookedCount ?? 0} overbooked
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground">{workload?.totalAllocated ?? 0}h allocated</span>
          </div>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{(workload?.rows ?? []).length} people · click a row to expand</span>}>
            <table className="w-full">
              <THead>
                <Th>Employee</Th><Th>Open Tasks</Th><Th>Hours / Capacity</Th><Th>Utilization</Th><Th>Status</Th><Th>Urgent</Th><Th>Overdue</Th>
              </THead>
              <tbody>
                {(workload?.rows ?? []).map((w: WorkloadRow, i: number) => {
                  const pct = Math.round((w.utilization ?? 0) * 100);
                  const cap = w.capacity ?? w.baseCapacity ?? 40;
                  const bar = Math.min(100, cap ? ((w.allocated ?? 0) / cap) * 100 : 0);
                  const expanded = open.has(w.id);
                  return (
                    <Fragment key={w.id}>
                      <Tr index={i} onClick={() => toggle(w.id)} className="cursor-pointer">
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <button onClick={() => toggle(w.id)} className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted">
                              <ChevronDown className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} />
                            </button>
                            <Avatar name={w.name} size="size-7" />
                            <span className="font-medium">{w.name}</span>
                          </div>
                        </Td>
                        <Td className="tabular-nums">{w.taskCount ?? 0}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div className={cn("h-full rounded-full transition-all", w.overbooked ? "bg-rose-500" : pct >= 90 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${bar}%` }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {w.allocated ?? 0}h / {cap}h
                              {(w.leaveDaysInWindow || w.weeklyOffDaysInWindow) ? (
                                <span className="ml-1 text-amber-400" title={[w.leaveDaysInWindow ? `${w.leaveDaysInWindow} leave day(s)` : null, w.weeklyOffDaysInWindow ? `${w.weeklyOffDaysInWindow} weekly off day(s)` : null].filter(Boolean).join(" + ") + " reduced capacity"}>
                                  · {[w.leaveDaysInWindow ? `${w.leaveDaysInWindow}d leave` : null, w.weeklyOffDaysInWindow ? `${w.weeklyOffDaysInWindow}d off` : null].filter(Boolean).join(" + ")}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        </Td>
                        <Td className="font-bold tabular-nums">{pct}%</Td>
                        <Td>
                          {w.overbooked ? (
                            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-400" title={w.overbookedReason ?? undefined}>Overbooked</span>
                          ) : pct >= 90 ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">Near capacity</span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">OK</span>
                          )}
                        </Td>
                        <Td className="tabular-nums text-muted-foreground">{w.urgent ?? 0}</Td>
                        <Td className={cn("tabular-nums", (w.overdue ?? 0) > 0 ? "font-bold text-rose-400" : "text-muted-foreground")}>{w.overdue ?? 0}</Td>
                      </Tr>
                      {expanded && (
                        <Tr index={i + 0.5}>
                          <Td className="!whitespace-normal">
                            <div className="py-2 pl-12">
                              {(w.tasks ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No open tasks.</p>}
                              <div className="flex flex-wrap gap-1.5">
                                {(w.tasks ?? []).map((task, ti) => (
                                  <span key={ti} className={cn("flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold", "border-border bg-muted/60 text-muted-foreground")}>
                                    <span className="max-w-40 truncate">{task.title}</span>
                                    <span className="tabular-nums text-muted-foreground">{task.hours}h</span>
                                    {task.due && new Date(task.due).getTime() < Date.now() && <span className="text-rose-400">overdue</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </>
      )}
      <button className="hidden" onClick={() => onNotify?.("")} />
    </div>
  );
}

export function EstimationAccuracyPanel({ users }: { users: UserLite[] }) {
  const [aux] = useState(0);
  return (
    <div>
      <SectionTitle title="Estimation Accuracy" subtitle="Estimated vs actual hours — where our estimates drift" />
      <EstimationPanel refreshKey={aux} employees={users} />
    </div>
  );
}

// ── Department → allowed task types ─────────────────────────────────────
/**
 * Per-department allow-list for task types. The server enforces this on create
 * and update (TasksService.assertTaskTypeAllowed), so this panel is where the
 * rule is authored, not merely a suggestion.
 *
 * A department with no row — or an empty selection — is unrestricted.
 */
type TypeRule = { department: string; taskTypes: string[] };

export function TaskTypeRulesPanel({ onNotify }: { onNotify?: (m: string) => void }) {
  const canPlan = useCanPlan();
  const { data: employees } = useApi<UserLite[]>("/people/employees");
  const [aux, setAux] = useState(0);
  const { data: saved } = useApi<TypeRule[]>(`/people/task-type-rules?v=${aux}`);
  const [draft, setDraft] = useState<TypeRule[] | null>(null);
  const [busy, setBusy] = useState(false);

  const rules: TypeRule[] = draft ?? saved ?? [];
  // Departments actually present in the roster, so the picker is never empty.
  const departments = [...new Set((employees ?? []).map((e: any) => e.department).filter(Boolean))] as string[];

  const setRule = (department: string, taskTypes: string[]) =>
    setDraft(
      rules.some((r) => r.department === department)
        ? rules.map((r) => (r.department === department ? { ...r, taskTypes } : r))
        : [...rules, { department, taskTypes }]
    );

  const toggleType = (department: string, type: string) => {
    const current = rules.find((r) => r.department === department)?.taskTypes ?? [];
    setRule(department, current.includes(type) ? current.filter((t) => t !== type) : [...current, type]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await apiFetch("/people/task-type-rules", {
        method: "PATCH",
        body: JSON.stringify({ rules: rules.filter((r) => r.taskTypes.length > 0) }),
      });
      onNotify?.("Department rules saved");
      setDraft(null);
      setAux((a) => a + 1);
    } catch (e: any) {
      onNotify?.(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell>
      <SectionTitle
        title="Task types by department"
        subtitle="Leave a department empty for no restriction. Rules are enforced on create and edit."
        action={
          canPlan ? (
            <Btn variant="primary" onClick={save} disabled={busy || !draft}>
              {busy ? "Saving…" : draft ? "Save rules" : "Saved"}
            </Btn>
          ) : null
        }
      />
      {!employees ? (
        <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}</div>
      ) : departments.length === 0 ? (
        <EmptyState title="No departments yet" hint="Set a department on each employee in Directory first" />
      ) : (
        <div className="flex flex-col gap-2">
          {departments.map((d) => {
            const active = rules.find((r) => r.department === d)?.taskTypes ?? [];
            return (
              <div key={d} className="rounded-xl border border-border/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-24 text-[12px] font-bold">{d}</span>
                  {active.length === 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      unrestricted
                    </span>
                  )}
                  <div className={cn("ml-auto flex flex-wrap gap-1", !canPlan && "pointer-events-none opacity-60")}>
                    {TASK_TYPES.map((t) => {
                      const on = active.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleType(d, t)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize transition-colors",
                            on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}
