"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Check, Info, ListChecks, Paperclip, SlidersHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import {
  ChipGroup,
  Collapsible,
  CountBadge,
  Field,
  FieldLabel,
  FormActions,
  FormError,
  FormSection,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { ProjectContextPanel } from "@/components/tasks/project-context";
import {
  TASK_STATUS_OPTS as STATUS_OPTS,
  PRIORITIES,
  PRIORITY_META,
  TASK_TYPES,
  TASK_TYPE_META,
  label,
  subtypesFor,
  subtypeLabel,
} from "@/components/tasks/domain";

export type TaskRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  taskType?: string;
  taskSubType?: string | null;
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
export type ProjectLite = { id: string; name: string; clientId?: string | null };
export type ClientLite = { id: string; companyName: string };

// Status/priority/type vocabulary is owned by ./domain — re-exported here so
// existing imports of this module keep working.
export { STATUS_OPTS, PRIORITIES, TASK_TYPES, label };

/** Local YYYY-MM-DD for the quick due-date chips. */
function dayFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DUE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
];

export function TaskFormModal({ open, onClose, initial, tasks, users, projects, clients, onSaved, projectId }: {
  open: boolean; onClose: () => void; initial?: TaskRow | null;
  tasks: TaskRow[]; users: UserLite[]; projects: ProjectLite[]; clients?: ClientLite[]; onSaved: () => void;
  projectId?: string;
}) {
  const [f, setF] = useState({
    title: "", description: "", projectId: "", clientId: "", priority: "MEDIUM", status: "TODO", taskType: "general", taskSubType: "",
    assignedToId: "", extraAssignees: [] as string[], dueDate: "", startDate: "",
    estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
    referenceLinks: [] as { id: string; title: string; url: string }[],
    customFields: [] as { id: string; key: string; value: string }[],
    attachments: [] as { id: string; name: string; url: string; size: string; type: string }[],
  });
  const [busy, setBusy] = useState(false);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [descErr, setDescErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);

  /**
   * Department → allowed task types. Rules are authored at /tasks/setup and
   * enforced server-side too; this only narrows the dropdown so people don't
   * pick something the API will reject.
   */
  const [typeRules, setTypeRules] = useState<{ department: string; taskTypes: string[] }[]>([]);
  useEffect(() => {
    if (!open || typeRules.length) return;
    apiFetch<{ department: string; taskTypes: string[] }[]>("/people/task-type-rules")
      .then((r) => setTypeRules(Array.isArray(r) ? r : []))
      .catch(() => setTypeRules([]));
  }, [open, typeRules.length]);

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
    setTitleErr(null);
    setDescErr(null);
    const linkedProject = projects.find((p) => p.id === (initial?.projectId ?? projectId ?? "")) ?? null;
    setF(initial
      ? {
        title: initial.title, description: initial.description ?? "", projectId: initial.projectId ?? "",
        clientId: linkedProject?.clientId ?? "",
        priority: initial.priority || "MEDIUM", status: initial.status, taskType: initial.taskType ?? "general", taskSubType: initial.taskSubType ?? "",
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
        title: "", description: "", projectId: projectId ?? "", clientId: linkedProject?.clientId ?? "",
        priority: "MEDIUM", status: "TODO", taskType: "general", taskSubType: "",
        assignedToId: "", extraAssignees: [], dueDate: "", startDate: "",
        estimatedHours: "", tags: "", parentTaskId: "", isClientVisible: false, isRecurring: false, recurrenceSchedule: "weekly",
        referenceLinks: [], customFields: [], attachments: [],
      });
  }, [open, initial, projectId]);

  /**
   * Task types the selected assignee's department permits. Empty rule = all
   * types. An employee's department comes from the roster the page already
   * passes in via `users` (which may not carry it), so fall back to the
   * unrestricted list when we can't resolve it.
   */
  const allowedTypes = (() => {
    const dept = (users as any[]).find((u) => u.id === f.assignedToId)?.department as string | undefined;
    if (!dept) return TASK_TYPES as unknown as string[];
    const rule = typeRules.find((r) => r.department.toLowerCase() === dept.toLowerCase());
    if (!rule || rule.taskTypes.length === 0) return TASK_TYPES as unknown as string[];
    // Keep the current value visible while editing an older task.
    const base = rule.taskTypes as string[];
    return base.includes(f.taskType) ? base : [...base, f.taskType];
  })();
  /** Sub-categories under the chosen category — empty for free-form values. */
  const subOptions = subtypesFor(f.taskType);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) {
      setTitleErr("Give the task a clear, action-shaped title");
      return;
    }
    setTitleErr(null);
    // Handing work to someone without a brief is how tasks come back wrong.
    // Enforced on create only so pre-existing thin tasks stay editable.
    if (!editing && !f.description.trim()) {
      setDescErr("The assignee needs to know what done looks like");
      return;
    }
    setDescErr(null);
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(editing ? `/tasks/${initial!.id}` : "/tasks", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          title: f.title.trim(), description: f.description.trim() || undefined,
          projectId: f.projectId || undefined, assignedToId: f.assignedToId || undefined,
          // reporterId is no longer sent — the server sets it from the caller
          status: f.status,
          priority: f.priority, taskType: f.taskType, taskSubType: f.taskSubType || null,
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
  const assigneeName = users.find((u) => u.id === f.assignedToId)?.name;
  const extraCount = f.referenceLinks.length + f.attachments.length + f.customFields.length;
  // Client narrows the project list; a project already implies its client, so
  // picking a different client clears a project that would no longer match.
  const projectChoices = f.clientId ? projects.filter((p) => p.clientId === f.clientId) : projects;
  const selectedClientName = (clients ?? []).find((c) => c.id === f.clientId)?.companyName;
  const onClientChange = (clientId: string) => {
    const current = projects.find((p) => p.id === f.projectId);
    const keepProject = !clientId || !f.projectId || current?.clientId === clientId;
    setF({ ...f, clientId, projectId: keepProject ? f.projectId : "" });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<ListChecks className="size-4" />}
      title={editing ? "Edit task" : "New task"}
      subtitle={
        editing
          ? "Change the brief, the owner or the schedule — status history is kept."
          : "Say what needs to happen and who owns it. Everything else is optional."
      }
      size="lg"
      footer={
        <FormActions
          formId="task-form"
          busy={busy}
          cancel={onClose}
          submitLabel={editing ? "Save changes" : "Create task"}
          submitIcon={<Check className="size-4" />}
          hint={f.dueDate ? `Due ${new Date(f.dueDate).toLocaleDateString()}` : "Fields marked * are required"}
        />
      }
    >
      <form id="task-form" onSubmit={save} className="flex flex-col gap-5">
        <FormError>{err}</FormError>
        {/* ── 1. The brief. This is the whole task in two fields. ── */}
        <div className="flex flex-col gap-3.5">
          <Field label="What needs to happen?" required error={titleErr}>
            <Input
              value={f.title}
              onChange={(e) => {
                setF({ ...f, title: e.target.value });
                if (titleErr) setTitleErr(null);
              }}
              placeholder="Ship the onboarding flow"
              autoFocus
              className="!py-2.5 !text-body-lg font-medium"
            />
          </Field>
          <Field
            label="Brief"
            required={!editing}
            error={descErr}
            hint={editing ? undefined : "The assignee needs to know what done looks like"}
          >
            <Textarea
              value={f.description}
              onChange={(e) => {
                setF({ ...f, description: e.target.value });
                if (descErr) setDescErr(null);
              }}
              placeholder="What needs to happen, and what does done look like?"
              className="!min-h-24"
            />
          </Field>
        </div>

        {/* ── 2. Owner, deadline and urgency. ── */}
        <FormSection icon={<CalendarDays className="size-4" />} title="Owner & schedule">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Assignee" hint={f.assignedToId ? "Only they can move this to Done" : "Leave empty to keep it unassigned"}>
              <Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </Select>
            </Field>
            <Field label="Client" hint="Narrows the project list below">
              <Select value={f.clientId} onChange={(e) => onClientChange(e.target.value)} disabled={!!projectId}>
                <option value="">All clients</option>
                {(clients ?? []).map((c) => (<option key={c.id} value={c.id}>{c.companyName}</option>))}
              </Select>
            </Field>
            <Field label="Project">
              <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} disabled={!!projectId}>
                <option value="">No project</option>
                {projectChoices.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
              {f.clientId && projectChoices.length === 0 && (
                <p className="mt-1 text-meta text-muted-foreground">No projects under {selectedClientName ?? "this client"} yet — create one in Flow.</p>
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Due date</FieldLabel>
              <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {DUE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setF({ ...f, dueDate: dayFromNow(p.days) })}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-micro font-semibold transition-colors",
                      f.dueDate === dayFromNow(p.days)
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/25 hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Priority</FieldLabel>
              <ChipGroup
                value={f.priority}
                onChange={(v) => setF({ ...f, priority: v })}
                options={PRIORITIES.map((p) => ({
                  value: p,
                  label: PRIORITY_META[p].label,
                  tone: PRIORITY_META[p].tone,
                }))}
                size="sm"
              />
            </div>
          </div>

          {/* Hand-off line: who is giving this task, and to whom. Reporter is set
              server-side from the logged-in user, so this is a preview, not a picker. */}
          {f.assignedToId && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2.5">
              <Info className="size-3.5 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-meta">
                <span className="font-bold text-primary">{me?.name ?? "You"}</span>
                <span className="text-muted-foreground">assigns this to</span>
                <span className="font-bold">{assigneeName ?? "—"}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  only {assigneeName ?? "the assignee"} can change status; you and the PM can edit the brief
                </span>
              </div>
            </div>
          )}
        </FormSection>

        {/* Project context: the brief, research and files behind this work */}
        {f.projectId && <ProjectContextPanel projectId={f.projectId} compact />}

        {/* ── 3. Advanced, folded away. ── */}
        <Collapsible
          icon={<SlidersHorizontal className="size-4" />}
          title="Scheduling & details"
          hint="Status, type, estimate, tags, collaboration"
          badge={
            (f.startDate ? 1 : 0) + (f.estimatedHours ? 1 : 0) + (f.tags ? 1 : 0) + (f.extraAssignees.length ? 1 : 0) > 0 ? (
              <CountBadge>{(f.startDate ? 1 : 0) + (f.estimatedHours ? 1 : 0) + (f.tags ? 1 : 0) + (f.extraAssignees.length ? 1 : 0)}</CountBadge>
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={f.taskType} onChange={(e) => setF({ ...f, taskType: e.target.value, taskSubType: "" })}>
                {allowedTypes.map((t) => (
                  <option key={t} value={t}>
                    {(TASK_TYPE_META as Record<string, { label: string }>)[t]?.label ??
                      t.replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Sub-type"
              hint={subOptions.length ? undefined : "This type has no sub-categories yet"}
            >
              <Select
                value={f.taskSubType}
                onChange={(e) => setF({ ...f, taskSubType: e.target.value })}
                disabled={!subOptions.length}
              >
                <option value="">Not set</option>
                {subOptions.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
                {/* An older/renamed value stays visible instead of silently clearing. */}
                {f.taskSubType && !subOptions.some((s) => s.key === f.taskSubType) && (
                  <option value={f.taskSubType}>{subtypeLabel(f.taskType, f.taskSubType)}</option>
                )}
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Estimated hours">
              <Input type="number" min={0} step={0.5} value={f.estimatedHours} onChange={(e) => setF({ ...f, estimatedHours: e.target.value })} placeholder="4" />
            </Field>
            <Field label="Tags" hint="Comma separated">
              <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="design, urgent" />
            </Field>
            <Field label="Parent task">
              <Select value={f.parentTaskId} onChange={(e) => setF({ ...f, parentTaskId: e.target.value })}>
                <option value="">None (top level)</option>
                {tasks.filter((t) => t.id !== initial?.id && (!projectId || t.projectId === projectId)).map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-3.5">
            <FieldLabel>Additional assignees</FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {users.filter((u) => u.id !== f.assignedToId).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleExtra(u.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors",
                    f.extraAssignees.includes(u.id)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {u.name}
                </button>
              ))}
              {users.filter((u) => u.id !== f.assignedToId).length === 0 && (
                <span className="text-meta text-muted-foreground/70">No other team members.</span>
              )}
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Toggle
              checked={f.isClientVisible}
              onChange={(v) => setF({ ...f, isClientVisible: v })}
              label="Client visible"
              hint="Shows in the client portal"
            />
            <Toggle
              checked={f.isRecurring}
              onChange={(v) => setF({ ...f, isRecurring: v })}
              label="Recurring task"
              hint="Re-creates itself on a schedule"
            />
          </div>
          {f.isRecurring && (
            <Field label="Repeat" className="mt-3.5">
              <Select value={f.recurrenceSchedule} onChange={(e) => setF({ ...f, recurrenceSchedule: e.target.value })}>
                {["daily", "weekly", "monthly", "quarterly", "yearly"].map((s) => (
                  <option key={s} value={s}>{s.replace(/^./, (c) => c.toUpperCase())}</option>
                ))}
              </Select>
            </Field>
          )}
        </Collapsible>

        <Collapsible
          icon={<Paperclip className="size-4" />}
          title="References, files & custom fields"
          hint="Anything the assignee needs to do this without asking"
          badge={extraCount > 0 ? <CountBadge>{extraCount}</CountBadge> : undefined}
        >
          <div className="flex flex-col gap-2">
            <FieldLabel>Reference links</FieldLabel>
            {f.referenceLinks.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input
                  value={l.title}
                  onChange={(e) => setF({ ...f, referenceLinks: f.referenceLinks.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x) })}
                  placeholder="Title"
                  className="!w-28 shrink-0"
                />
                <Input
                  value={l.url}
                  onChange={(e) => setF({ ...f, referenceLinks: f.referenceLinks.map((x, xi) => xi === i ? { ...x, url: e.target.value } : x) })}
                  placeholder="https://…"
                  className="min-w-0 flex-1"
                />
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() => setF({ ...f, referenceLinks: f.referenceLinks.filter((_, xi) => xi !== i) })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-rose-400 transition-colors hover:bg-rose-500/10"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setF({ ...f, referenceLinks: [...f.referenceLinks, { id: `l${Date.now()}`, title: "", url: "" }] })}
              className="self-start rounded-lg border border-dashed border-border px-3 py-1 text-meta font-bold text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              + Add reference link
            </button>
            {f.referenceLinks.length === 0 && (
              <p className="text-meta text-muted-foreground/70">No links yet — Figma, Drive, PR links all work.</p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3.5">
            <FieldLabel>Attachments</FieldLabel>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-meta font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
              <Paperclip className="size-3.5" />
              Upload a file the assignee will see
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setF({
                      ...f,
                      attachments: [...f.attachments, {
                        id: `a${Date.now()}`,
                        name: file.name,
                        url: String(reader.result),
                        size: file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1048576).toFixed(1)} MB`,
                        type: file.type,
                      }] as any,
                    });
                  };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
            </label>
            {f.attachments.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-meta">
                <span className="truncate font-medium">{a.name} · {a.size}</span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setF({ ...f, attachments: f.attachments.filter((_, xi) => xi !== i) })}
                  className="shrink-0 text-rose-400"
                >
                  ×
                </button>
              </div>
            ))}
            {f.attachments.length === 0 && <p className="text-meta text-muted-foreground/70">No files yet.</p>}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3.5">
            <FieldLabel>Custom fields</FieldLabel>
            {f.customFields.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <Input
                  value={c.key}
                  onChange={(e) => setF({ ...f, customFields: f.customFields.map((x, xi) => xi === i ? { ...x, key: e.target.value } : x) })}
                  placeholder="Key (e.g. severity)"
                  className="!w-32 shrink-0"
                />
                <Input
                  value={c.value}
                  onChange={(e) => setF({ ...f, customFields: f.customFields.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })}
                  placeholder="Value"
                  className="min-w-0 flex-1"
                />
                <button
                  type="button"
                  aria-label="Remove custom field"
                  onClick={() => setF({ ...f, customFields: f.customFields.filter((_, xi) => xi !== i) })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-rose-400 transition-colors hover:bg-rose-500/10"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setF({ ...f, customFields: [...f.customFields, { id: `cf${Date.now()}`, key: "", value: "" }] })}
              className="self-start rounded-lg border border-dashed border-border px-3 py-1 text-meta font-bold text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              + Add custom field
            </button>
          </div>
        </Collapsible>
      </form>
    </Modal>
  );
}
