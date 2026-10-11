"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";
import { ProjectContextPanel } from "@/components/tasks/project-context";

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
  sprintId?: string | null;
  deliverableId?: string | null;
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
  assignedBy?: { id: string; name: string; roleTitle?: string } | null;
  assignedAt?: string | null;
  deliverable?: { id: string; title: string; status: string } | null;
  sprint?: { id: string; name: string; status: string } | null;
  reporter?: { id: string; name: string } | null;
  checklist?: { id: string; content: string; done: boolean }[];
  _permissions?: { canView: boolean; canEditFull: boolean; canEditProgress: boolean };
  _count?: { timeLogs?: number; comments?: number; checklist?: number };
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
    assignedToId: "", extraAssignees: [] as string[], dueDate: "", startDate: "",
    estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
    referenceLinks: [] as { id: string; title: string; url: string }[],
    customFields: [] as { id: string; key: string; value: string }[],
    attachments: [] as { id: string; name: string; url: string; size: string; type: string }[],
  });
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    // used only for the "X assigns this to Y" preview line
    if (open && !me) {
      apiFetch<{ id: string; name: string }>("/auth/me").then(setMe).catch(() => {});
    }
  }, [open, me]);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(initial
      ? {
        title: initial.title, description: initial.description ?? "", projectId: initial.projectId ?? "",
        priority: initial.priority || "MEDIUM", status: initial.status, taskType: initial.taskType ?? "general",
        assignedToId: initial.assignedToId ?? "",
        extraAssignees: (initial.assignees ?? []).map((a: any) => a.id),
        dueDate: initial.dueDate?.slice(0, 10) ?? "", startDate: initial.startDate?.slice(0, 10) ?? "",
        estimatedHours: initial.estimatedHours != null ? String(initial.estimatedHours) : "",
        tags: (initial.tags ?? []).join(", "), parentTaskId: initial.parentTaskId ?? "",
        isClientVisible: !!initial.isClientVisible, isRecurring: !!initial.isRecurring,
        recurrenceSchedule: initial.recurrenceSchedule ?? "weekly",
        referenceLinks: (initial.referenceLinks ?? []) as any,
        customFields: (initial.customFields ?? []) as any,
        attachments: (initial.attachments ?? []) as any,
      }
      : {
        title: "", description: "", projectId: projectId ?? "", priority: "MEDIUM", status: "TODO", taskType: "general",
        assignedToId: "", extraAssignees: [], dueDate: "", startDate: "",
        estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
        referenceLinks: [], customFields: [], attachments: [],
      });
  }, [open, initial, projectId]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { setErr("Title is required"); return; }
    // Handing work to someone without a brief is how tasks come back wrong.
    // Enforced on create only so pre-existing thin tasks stay editable.
    if (!editing && !f.description.trim()) { setErr("Description is required so the assignee knows what to do"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(editing ? `/tasks/${initial!.id}` : "/tasks", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          title: f.title.trim(), description: f.description.trim() || undefined,
          projectId: f.projectId || undefined, assignedToId: f.assignedToId || undefined,
          // reporterId is no longer sent — the server sets it from the caller
          priority: f.priority, taskType: f.taskType,
          dueDate: f.dueDate || null, startDate: f.startDate || null,
          estimatedHours: f.estimatedHours ? Number(f.estimatedHours) : undefined,
          parentTaskId: f.parentTaskId || undefined,
          tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
          isClientVisible: f.isClientVisible,
          assignees: f.extraAssignees.map((id) => ({ id, name: users.find((u) => u.id === id)?.name ?? id })),
          isRecurring: f.isRecurring, recurrenceSchedule: f.recurrenceSchedule,
          referenceLinks: f.referenceLinks,
          customFields: f.customFields,
          attachments: f.attachments,
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
        <Field label="Description *" hint={editing ? undefined : "The assignee needs to know what done looks like"}>
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What needs to happen, and what does done look like?" />
        </Field>

        {/*
          Hand-off line: who is giving this task, and to whom. Reporter is set
          server-side from the logged-in user, so this is a preview, not a picker.
        */}
        {f.assignedToId && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
            <Info className="size-3.5 shrink-0 text-primary" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="font-bold text-primary">{me?.name ?? "You"}</span>
              <span className="text-muted-foreground">assign this to</span>
              <span className="font-bold">{users.find((u) => u.id === f.assignedToId)?.name ?? "—"}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                only {(users.find((u) => u.id === f.assignedToId)?.name ?? "the assignee")} can change status; you and the PM can edit the brief
              </span>
            </div>
          </div>
        )}

        {/* Project context: the brief, research and files behind this work */}
        <ProjectContextPanel projectId={f.projectId || null} compact />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} disabled={!!projectId}><option value="">No project</option>{projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select></Field>
          <Field label="Type"><Select value={f.taskType} onChange={(e) => setF({ ...f, taskType: e.target.value })}>{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select></Field>
          <Field label="Assignee"><Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
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

        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <span className="text-[11.5px] font-bold text-muted-foreground">Reference Links — visible to assignee (enterprise)</span>
          {f.referenceLinks.map((l, i) => (
            <div key={l.id} className="flex items-center gap-2">
              <Input value={l.title} onChange={(e) => setF({ ...f, referenceLinks: f.referenceLinks.map((x, xi) => xi===i ? { ...x, title: e.target.value } : x) })} placeholder="Title" className="!w-32" />
              <Input value={l.url} onChange={(e) => setF({ ...f, referenceLinks: f.referenceLinks.map((x, xi) => xi===i ? { ...x, url: e.target.value } : x) })} placeholder="https://..." className="flex-1" />
              <button type="button" onClick={() => setF({ ...f, referenceLinks: f.referenceLinks.filter((_, xi) => xi!==i) })} className="flex size-7 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/10">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setF({ ...f, referenceLinks: [...f.referenceLinks, { id: `l${Date.now()}`, title: "", url: "" }] })} className="self-start rounded-lg border border-dashed border-border px-3 py-1 text-[11px] font-bold text-primary hover:border-primary/40">+ Add reference link</button>
          {f.referenceLinks.length===0 && <p className="text-[11px] text-muted-foreground/70">No links — add Figma, Drive, PR links. Assignee will see these in detail.</p>}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <span className="text-[11.5px] font-bold text-muted-foreground">Attachments — visible to assignee</span>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground">
            <input type="file" className="hidden" onChange={(e) => {
              const file=e.target.files?.[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ setF({...f, attachments:[...f.attachments, { id:`a${Date.now()}`, name:file.name, url:String(reader.result), size:file.size<1024? `${file.size} B` : file.size<1048576? `${Math.round(file.size/1024)} KB` : `${(file.size/1048576).toFixed(1)} MB`, type:file.type }] as any}); }; reader.readAsDataURL(file); e.target.value="";
            }} /> + Upload file (assignee will see)
          </label>
          {f.attachments.map((a, i) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-1.5 text-[11px]">
              <span className="truncate font-medium">{a.name} · {a.size}</span>
              <button type="button" onClick={() => setF({ ...f, attachments: f.attachments.filter((_, xi) => xi!==i) })} className="text-rose-400">×</button>
            </div>
          ))}
          {f.attachments.length===0 && <p className="text-[11px] text-muted-foreground/70">No files yet.</p>}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <span className="text-[11.5px] font-bold text-muted-foreground">Custom Fields — visible to assignee</span>
          {f.customFields.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <Input value={c.key} onChange={(e) => setF({ ...f, customFields: f.customFields.map((x, xi) => xi===i ? { ...x, key: e.target.value } : x) })} placeholder="Key (e.g. severity)" className="!w-32" />
              <Input value={c.value} onChange={(e) => setF({ ...f, customFields: f.customFields.map((x, xi) => xi===i ? { ...x, value: e.target.value } : x) })} placeholder="Value" className="flex-1" />
              <button type="button" onClick={() => setF({ ...f, customFields: f.customFields.filter((_, xi) => xi!==i) })} className="flex size-7 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/10">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setF({ ...f, customFields: [...f.customFields, { id:`cf${Date.now()}`, key: "", value: "" }] })} className="self-start rounded-lg border border-dashed border-border px-3 py-1 text-[11px] font-bold text-primary hover:border-primary/40">+ Add custom field</button>
        </div>

        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create task"} />
      </form>
    </Modal>
  );
}