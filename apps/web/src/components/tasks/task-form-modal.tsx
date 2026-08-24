"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";

export type TaskRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  taskType?: string;
  dueDate?: string | null;
  startDate?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  assignedToId?: string | null;
  reporterId?: string | null;
  parentTaskId?: string | null;
  projectId?: string | null;
  tags?: string[];
  isBlocked?: boolean;
  isClientVisible?: boolean;
  isRecurring?: boolean;
  recurrenceSchedule?: string | null;
  archivedAt?: string | null;
  referenceLinks?: any[];
  attachments?: any[];
  assignees?: any[];
  customFields?: any[];
  activityLog?: any[];
  subtaskCount?: number;
  createdAt?: string;
  project?: { id: string; name: string } | null;
  assignedTo?: { id: string; name: string } | null;
  reporter?: { id: string; name: string } | null;
  _count?: { timeLogs?: number; comments?: number };
};

export type UserLite = { id: string; name: string; roleTitle?: string };
export type ProjectLite = { id: string; name: string };

export const STATUS_OPTS = [
  { value: "BACKLOG", label: "Backlog" },
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
];
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const TASK_TYPES = ["general", "bug", "feature", "improvement", "research", "design", "documentation"];
export const label = (v?: string) => (v ?? "").replace(/_/g, " ").toLowerCase();

export function TaskFormModal({ open, onClose, initial, tasks, users, projects, onSaved, projectId }: {
  open: boolean; onClose: () => void; initial?: TaskRow | null;
  tasks: TaskRow[]; users: UserLite[]; projects: ProjectLite[]; onSaved: () => void;
  projectId?: string;
}) {
  const [f, setF] = useState({
    title: "", description: "", projectId: "", priority: "MEDIUM", status: "TODO", taskType: "general",
    assignedToId: "", reporterId: "", extraAssignees: [] as string[], dueDate: "", startDate: "",
    estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(initial
      ? {
        title: initial.title, description: initial.description ?? "", projectId: initial.projectId ?? "",
        priority: initial.priority || "MEDIUM", status: initial.status, taskType: initial.taskType ?? "general",
        assignedToId: initial.assignedToId ?? "", reporterId: initial.reporterId ?? "",
        extraAssignees: (initial.assignees ?? []).map((a: any) => a.id),
        dueDate: initial.dueDate?.slice(0, 10) ?? "", startDate: initial.startDate?.slice(0, 10) ?? "",
        estimatedHours: initial.estimatedHours != null ? String(initial.estimatedHours) : "",
        tags: (initial.tags ?? []).join(", "), parentTaskId: initial.parentTaskId ?? "",
        isClientVisible: !!initial.isClientVisible, isRecurring: !!initial.isRecurring,
        recurrenceSchedule: initial.recurrenceSchedule ?? "weekly",
      }
      : {
        title: "", description: "", projectId: projectId ?? "", priority: "MEDIUM", status: "TODO", taskType: "general",
        assignedToId: "", reporterId: "", extraAssignees: [], dueDate: "", startDate: "",
        estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
      });
  }, [open, initial, projectId]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { setErr("Title is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(editing ? `/tasks/${initial!.id}` : "/tasks", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          title: f.title.trim(), description: f.description.trim() || undefined,
          projectId: f.projectId || undefined, assignedToId: f.assignedToId || undefined,
          reporterId: f.reporterId || undefined, priority: f.priority, taskType: f.taskType,
          dueDate: f.dueDate || null, startDate: f.startDate || null,
          estimatedHours: f.estimatedHours ? Number(f.estimatedHours) : undefined,
          parentTaskId: f.parentTaskId || undefined,
          tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
          isClientVisible: f.isClientVisible,
          assignees: f.extraAssignees.map((id) => ({ id, name: users.find((u) => u.id === id)?.name ?? id })),
          isRecurring: f.isRecurring, recurrenceSchedule: f.recurrenceSchedule,
        }),
      });
      onSaved();
      onClose();
    } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  const toggleExtra = (id: string) => setF({ ...f, extraAssignees: f.extraAssignees.includes(id) ? f.extraAssignees.filter((x) => x !== id) : [...f.extraAssignees, id] });
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit task" : "New task"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ship the onboarding flow" autoFocus /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What needs to happen…" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} disabled={!!projectId}><option value="">No project</option>{projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select></Field>
          <Field label="Type"><Select value={f.taskType} onChange={(e) => setF({ ...f, taskType: e.target.value })}>{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select></Field>
          <Field label="Assignee"><Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
          <Field label="Reporter"><Select value={f.reporterId} onChange={(e) => setF({ ...f, reporterId: e.target.value })}><option value="">None</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Estimated hours"><Input type="number" min={0} step={0.5} value={f.estimatedHours} onChange={(e) => setF({ ...f, estimatedHours: e.target.value })} placeholder="4" /></Field>
          <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="design, urgent" /></Field>
          <Field label="Parent task"><Select value={f.parentTaskId} onChange={(e) => setF({ ...f, parentTaskId: e.target.value })}><option value="">None (top level)</option>{tasks.filter((t) => t.id !== initial?.id && (!projectId || t.projectId === projectId)).map((t) => (<option key={t.id} value={t.id}>{t.title}</option>))}</Select></Field>
        </div>
        <div>
          <span className="text-[11.5px] font-semibold text-muted-foreground">Additional assignees</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {users.filter((u) => u.id !== f.assignedToId).map((u) => (
              <button key={u.id} type="button" onClick={() => toggleExtra(u.id)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors", f.extraAssignees.includes(u.id) ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{u.name}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <input type="checkbox" checked={f.isClientVisible} onChange={(e) => setF({ ...f, isClientVisible: e.target.checked })} className="size-3.5 accent-primary" /> Client visible
          </label>
          <label className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <input type="checkbox" checked={f.isRecurring} onChange={(e) => setF({ ...f, isRecurring: e.target.checked })} className="size-3.5 accent-primary" /> Recurring
          </label>
          {f.isRecurring && (
            <Select value={f.recurrenceSchedule} onChange={(e) => setF({ ...f, recurrenceSchedule: e.target.value })} className="!w-32">
              {["daily", "weekly", "monthly", "quarterly", "yearly"].map((s) => (<option key={s} value={s}>{s}</option>))}
            </Select>
          )}
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create task"} />
      </form>
    </Modal>
  );
}