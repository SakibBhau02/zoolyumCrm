"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlarmClock, Archive, ArrowUp, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Copy, ExternalLink, FileText, Flame, FolderKanban, GitBranch, Link2, ListTodo, MessageSquare, Minus, MoreHorizontal, Paperclip, Play,
  Plus, RefreshCw, Search, ShieldAlert, Smile, Timer, Trash2, Upload, UserRound, X, Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDay, formatDate, timeAgo } from "@/lib/format";
import { Avatar, CardShell, EmptyState, FadeIn, PageHeader, SectionTitle, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Drawer, Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { TaskFormModal } from "@/components/tasks/task-form-modal";

type TaskRow = {
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
type TaskDetail = TaskRow & {
  subtasks?: TaskRow[];
  comments?: {
    id: string; content: string; parentId?: string | null; createdAt?: string;
    author?: { id: string; name: string } | null;
    reactions?: { emoji: string; userIds: string[] }[];
    replies?: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[] }[];
  }[];
  timeLogs?: { id: string; date: string; hours: number; description?: string | null; loggedVia?: string; isBillable?: boolean; employee?: { id: string; name: string } | null }[];
  dependencies?: { id: string; type?: string; dependsOnTask: { id: string; title: string; status: string } }[];
  dependents?: { id: string; type?: string; task: { id: string; title: string; status: string } }[];
};
type Stats = { total?: number; open?: number; done?: number; inProgress?: number; overdue?: number; dueToday?: number; highPriority?: number; review?: number; blocked?: number; hoursThisWeek?: number };
type UserLite = { id: string; name: string; roleTitle?: string };
type ProjectLite = { id: string; name: string };
type Template = { id: string; name: string; description?: string | null; category?: string | null; benchmarkDurationDays?: number | null; benchmarkHours?: number | null; defaultTasks?: any[] };
type Rule = { id: string; name: string; trigger?: string; action?: string; config?: any; enabled?: boolean };
type WorkloadRow = { id: string; name: string; roleTitle?: string; taskCount?: number; allocated?: number; utilization?: number; overbooked?: boolean; urgent?: number; overdue?: number; tasks?: { title: string; hours: number; priority: string; due: string }[] };

const BOARD_COLUMNS = [
  { key: "BACKLOG", label: "Backlog", dot: "bg-muted" },
  { key: "TODO", label: "To Do", dot: "bg-sky-400" },
  { key: "IN_PROGRESS", label: "In Progress", dot: "bg-primary" },
  { key: "IN_REVIEW", label: "In Review", dot: "bg-amber-400" },
  { key: "BLOCKED", label: "Blocked", dot: "bg-rose-400" },
  { key: "DONE", label: "Done", dot: "bg-emerald-500" },
];
const STATUS_OPTS = BOARD_COLUMNS.map((c) => ({ value: c.key, label: c.label }));
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TASK_TYPES = ["general", "bug", "feature", "improvement", "research", "design", "documentation"];
const SWIMLANES = [
  { value: "none", label: "No lanes" },
  { value: "project", label: "By project" },
  { value: "assignee", label: "By assignee" },
  { value: "priority", label: "By priority" },
];
const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👏", "🚀"];
const PRIORITY_TONES: Record<string, string> = {
  URGENT: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  HIGH: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  MEDIUM: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  LOW: "border-border bg-muted/60 text-muted-foreground",
};
const TYPE_TONES: Record<string, string> = {
  bug: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  feature: "border-primary/30 bg-primary/10 text-primary",
  improvement: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  research: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  design: "border-pink-500/30 bg-pink-500/10 text-pink-400",
  documentation: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  general: "border-border bg-muted/60 text-muted-foreground",
};
const STATUS_CHIP: Record<string, string> = {
  BACKLOG: "bg-muted text-muted-foreground",
  TODO: "bg-sky-500/15 text-sky-400",
  IN_PROGRESS: "bg-primary/15 text-primary",
  IN_REVIEW: "bg-amber-500/15 text-amber-400",
  DONE: "bg-emerald-500/15 text-emerald-400",
  BLOCKED: "bg-rose-500/15 text-rose-400",
};
const label = (v?: string) => (v ?? "").replace(/_/g, " ").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");
const localKey = (d: string | Date) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const todayKey = () => localKey(new Date());
const fmtElapsed = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fileIcon = (type?: string) => {
  const t = (type ?? "").toLowerCase();
  if (t.includes("image")) return <span className="shrink-0 rounded-lg bg-sky-500/15 p-1.5 text-sky-400"><CalendarDays className="size-3.5" /></span>;
  if (t.includes("pdf")) return <span className="shrink-0 rounded-lg bg-rose-500/15 p-1.5 text-rose-400"><FileText className="size-3.5" /></span>;
  if (t.includes("video")) return <span className="shrink-0 rounded-lg bg-primary/15 p-1.5 text-primary"><Play className="size-3.5" /></span>;
  if (t.includes("sheet") || t.includes("csv")) return <span className="shrink-0 rounded-lg bg-emerald-500/15 p-1.5 text-emerald-400"><FileText className="size-3.5" /></span>;
  return <span className="shrink-0 rounded-lg bg-muted p-1.5 text-muted-foreground"><Paperclip className="size-3.5" /></span>;
};
const CURRENT_USER_ID = "current-user";

function TemplateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [benchDays, setBenchDays] = useState("");
  const [benchHours, setBenchHours] = useState("");
  const [rows, setRows] = useState<{ title: string; priority: string; estimatedHours: string; taskType: string }[]>([{ title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setErr(null); setName(""); setDescription(""); setCategory(""); setBenchDays(""); setBenchHours(""); setRows([{ title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }]); } }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Template name is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/tasks/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(), description: description.trim() || undefined, category: category.trim() || undefined,
          benchmarkDurationDays: benchDays ? Number(benchDays) : undefined, benchmarkHours: benchHours ? Number(benchHours) : undefined,
          defaultTasks: rows.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), priority: r.priority, estimatedHours: r.estimatedHours ? Number(r.estimatedHours) : undefined, taskType: r.taskType })),
        }),
      });
      onSaved();
      onClose();
    } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New template" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website launch" autoFocus /></Field>
          <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="launch, bugfix, onboarding…" /></Field>
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kickoff checklist" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Benchmark days"><Input type="number" min={0} value={benchDays} onChange={(e) => setBenchDays(e.target.value)} placeholder="5" /></Field>
            <Field label="Benchmark hours"><Input type="number" min={0} step={0.5} value={benchHours} onChange={(e) => setBenchHours(e.target.value)} placeholder="20" /></Field>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Default tasks</span>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={r.title} onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))} placeholder="Task title" />
              <Select value={r.taskType} onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, taskType: e.target.value } : x)))} className="!w-32">{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select>
              <Select value={r.priority} onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, priority: e.target.value } : x)))} className="!w-28">{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
              <Input type="number" min={0} step={0.5} value={r.estimatedHours} onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, estimatedHours: e.target.value } : x)))} placeholder="hrs" className="!w-20" />
              <button type="button" onClick={() => setRows(rows.filter((_, xi) => xi !== i))} className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Minus className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { title: "", priority: "MEDIUM", estimatedHours: "", taskType: "general" }])} className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><Plus className="size-3.5" /> Add task</button>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create template" />
      </form>
    </Modal>
  );
}

function AutomationModal({ open, onClose, users, onSaved }: { open: boolean; onClose: () => void; users: UserLite[]; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("status-change");
  const [triggerValue, setTriggerValue] = useState("IN_PROGRESS");
  const [action, setAction] = useState("change-status");
  const [actionValue, setActionValue] = useState("IN_PROGRESS");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setErr(null); setName(""); setTrigger("status-change"); setTriggerValue("IN_PROGRESS"); setAction("change-status"); setActionValue("IN_PROGRESS"); setExtra({}); } }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Rule name is required"); return; }
    if (action === "assign-to" && !actionValue) { setErr("Pick an assignee"); return; }
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
      if (action === "create-task") { config.title = extra.title || undefined; config.dueOffsetDays = extra.dueOffsetDays ? Number(extra.dueOffsetDays) : 0; config.priority = extra.priority || "MEDIUM"; }
      await apiFetch("/tasks/automation", { method: "POST", body: JSON.stringify({ name: name.trim(), trigger: trigger === "status-change" ? "status-changed" : trigger === "priority-change" ? "priority-changed" : "assigned", action, config }) });
      onSaved();
      onClose();
    } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add automation rule">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Rule name *"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Move to dev on start" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="When"><Select value={trigger} onChange={(e) => { setTrigger(e.target.value); setTriggerValue(e.target.value === "status-change" ? "IN_PROGRESS" : e.target.value === "priority-change" ? "HIGH" : ""); }}>
            <option value="status-change">Status changes to</option>
            <option value="priority-change">Priority changes to</option>
            <option value="assigned">Task is assigned</option>
          </Select></Field>
          {trigger === "status-change" ? (
            <Field label="To status"><Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select></Field>
          ) : trigger === "priority-change" ? (
            <Field label="To priority"><Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select></Field>
          ) : (
            <Field label="Assignee"><Select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}><option value="">Anyone</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
          )}
          <Field label="Then"><Select value={action} onChange={(e) => { setAction(e.target.value); setActionValue(e.target.value === "change-status" ? "IN_PROGRESS" : e.target.value === "change-priority" ? "HIGH" : ""); }}>
            <option value="change-status">Change status</option>
            <option value="change-priority">Change priority</option>
            <option value="assign-to">Assign to</option>
            <option value="notify">Notify assignee</option>
            <option value="create-task">Create follow-up task</option>
            <option value="archive">Archive task</option>
          </Select></Field>
          {action === "change-status" ? (
            <Field label="To status"><Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select></Field>
          ) : action === "change-priority" ? (
            <Field label="To priority"><Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select></Field>
          ) : action === "assign-to" ? (
            <Field label="Assignee"><Select value={actionValue} onChange={(e) => setActionValue(e.target.value)}><option value="">Pick user</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
          ) : action === "create-task" ? (
            <Field label="Follow-up title"><Input value={extra.title ?? ""} onChange={(e) => setExtra({ ...extra, title: e.target.value })} placeholder="Auto follow-up" /></Field>
          ) : (
            <div />
          )}
        </div>
        {action === "create-task" && (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Due in days"><Input type="number" min={0} value={extra.dueOffsetDays ?? ""} onChange={(e) => setExtra({ ...extra, dueOffsetDays: e.target.value })} placeholder="2" /></Field>
            <Field label="Priority"><Select value={extra.priority ?? "MEDIUM"} onChange={(e) => setExtra({ ...extra, priority: e.target.value })}>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select></Field>
          </div>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add rule" />
      </form>
    </Modal>
  );
}

function CommentItem({ c, replyTo, replyText, setReplyTo, setReplyText, onPostReply, onToggleReaction, onDelete }: {
  c: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[];
       replies?: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[] }[] };
  replyTo: string | null; replyText: string;
  setReplyTo: (v: string | null) => void; setReplyText: (v: string) => void;
  onPostReply: () => void; onToggleReaction: (emoji: string) => void; onDelete: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const body = (cc: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[] }, isReply: boolean) => (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2.5", isReply && "border-border/40 bg-muted/20")}>
      <Avatar name={cc.author?.name ?? "?"} size="size-7" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[11.5px] font-semibold">{cc.author?.name ?? "System"}<span className="text-[10px] font-normal text-muted-foreground/70">{timeAgo(cc.createdAt)}</span></p>
        <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed">{cc.content}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(cc.reactions ?? []).map((r) => {
            const mine = (r.userIds ?? []).includes(CURRENT_USER_ID);
            return (
              <button key={r.emoji} onClick={() => onToggleReaction(r.emoji)} className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors", mine ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/30")}>
                <span>{r.emoji}</span><span className="tabular-nums">{(r.userIds ?? []).length}</span>
              </button>
            );
          })}
          <button onClick={() => setPicker((v) => !v)} className={cn("flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground", picker && "border-primary/50 text-primary")} title="React"><Smile className="size-3" /></button>
          {!isReply && (
            <button onClick={() => setReplyTo(replyTo === cc.id ? null : cc.id)} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"><MessageSquare className="size-2.5" /> Reply</button>
          )}
          <button onClick={onDelete} className="flex size-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete"><Trash2 className="size-3" /></button>
        </div>
        {picker && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {REACTION_EMOJIS.map((emo) => (
              <button key={emo} onClick={() => { onToggleReaction(emo); setPicker(false); }} className="flex size-7 items-center justify-center rounded-lg border border-border text-[13px] transition-all hover:scale-110 hover:border-primary/40">{emo}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {body(c, false)}
      {(c.replies ?? []).map((r) => (
        <div key={r.id} className="pl-6">
          {body(r, true)}
          {replyTo === r.id && (
            <div className="mt-2 flex gap-2 pl-10">
              <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onPostReply()} placeholder="Reply…" className="!py-1.5" />
              <Btn variant="primary" onClick={onPostReply} className="!px-3 !py-1.5">Post</Btn>
            </div>
          )}
        </div>
      ))}
      {replyTo === c.id && (
        <div className="mt-1 flex gap-2 pl-6">
          <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onPostReply()} placeholder="Reply…" className="!py-1.5" />
          <Btn variant="primary" onClick={onPostReply} className="!px-3 !py-1.5">Post</Btn>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ t, i, expanded, hasChildren, childrenList, onToggleExpand, selected, onSelect, onOpen, onChanged, renderChild }: {
  t: TaskRow; i: number; expanded: boolean; hasChildren: boolean; childrenList: TaskRow[];
  onToggleExpand: () => void; selected: boolean; onSelect: () => void; onOpen: () => void; onChanged: () => void;
  renderChild: (c: TaskRow, ci: number) => React.ReactNode;
}) {
  const overdue = t.dueDate && t.status !== "DONE" && localKey(t.dueDate) < todayKey();
  const dueLabel = t.dueDate ? formatDay(t.dueDate) : "—";
  return (
    <>
      <Tr index={i} onClick={onOpen} className="cursor-pointer group">
        <Td>
          <div className="flex items-center gap-1">
            <input type="checkbox" checked={selected} onChange={(e) => { e.stopPropagation(); onSelect(); }} className="size-3.5 accent-primary" />
            {hasChildren && (
              <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted">
                <ChevronDown className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} />
              </button>
            )}
          </div>
        </Td>
        <Td>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="max-w-56 truncate font-semibold leading-none">{t.title}</p>
              {t.isBlocked && <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-400">BLOCKED</span>}
              {t.parentTaskId && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">subtask</span>}
              {t.isClientVisible && <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-400">client</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.project?.name ? <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"><FolderKanban className="size-2.5" />{t.project.name}</span> : <span className="text-[10px] text-muted-foreground/50">No project</span>}
              {t.dueDate && <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", overdue ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}><CalendarDays className="size-2.5" />{dueLabel}</span>}
              {(t.estimatedHours != null || t.actualHours != null) && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary"><Timer className="size-2.5" />{Number(t.actualHours ?? 0).toFixed(1)}/{t.estimatedHours ?? "—"}h</span>}
              <span className="hidden items-center gap-1 text-[10px] tabular-nums text-muted-foreground group-hover:inline-flex"><MessageSquare className="size-2.5" />{t._count?.comments ?? 0} · <Timer className="size-2.5" />{t._count?.timeLogs ?? 0}{t.subtaskCount ? <> · <ListTodo className="size-2.5" />{t.subtaskCount}</> : null}</span>
            </div>
          </div>
        </Td>
        <Td>{t.taskType ? <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold capitalize", TYPE_TONES[t.taskType] ?? TYPE_TONES.general)}><span className="size-1.5 rounded-full bg-current opacity-60" />{t.taskType}</span> : <span className="text-muted-foreground/50">—</span>}</Td>
        <Td><StatusBadge status={t.status} /></Td>
        <Td>
          <Select value={t.priority} onChange={(e) => { e.stopPropagation(); apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ priority: e.target.value }) }).then(() => onChanged()).catch(() => {}); }} className="!w-28 !py-1" onClick={(e) => e.stopPropagation()}>
            {PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
          </Select>
        </Td>
        <Td className={cn("font-medium tabular-nums text-[12px]", overdue ? "text-rose-500" : "text-muted-foreground")}>{dueLabel}</Td>
        <Td>
          <div className="flex items-center gap-2">
            {t.assignedTo?.name ? <><Avatar name={t.assignedTo.name} size="size-6" /><span className="max-w-24 truncate text-[12px] font-medium">{t.assignedTo.name}</span></> : <span className="flex items-center gap-1.5 text-muted-foreground"><span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border"><UserRound className="size-3" /></span>Unassigned</span>}
          </div>
        </Td>
        <Td>
          {t.project?.name ? <span className="inline-flex max-w-28 items-center gap-1.5 truncate rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] font-semibold"><FolderKanban className="size-3 shrink-0 text-muted-foreground" />{t.project.name}</span> : <span className="text-muted-foreground">—</span>}
        </Td>
      </Tr>
      {expanded && hasChildren && childrenList.map((c, ci) => renderChild(c, ci))}
    </>
  );
}

export default function TasksPage() {
  const [refresh, setRefresh] = useState(0);
  const [aux, setAux] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const [flash, setFlash] = useState<string | null>(null);
  const notify = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 3000); };
  const [view, setView] = useState<"board" | "list" | "calendar" | "gantt">("board");
  const [swimlane, setSwimlane] = useState("none");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fType, setFType] = useState("");
  const [fProject, setFProject] = useState("");
  const [sort, setSort] = useState("due");
  const [mine, setMine] = useState(false);
  const [myDayOnly, setMyDayOnly] = useState(false);

  const { data: stats } = useApi<Stats>("/tasks/stats");
  const { data: employees } = useApi<UserLite[]>("/people/employees");
  const users = employees ?? [];
  const { data: projects } = useApi<ProjectLite[]>("/flow/projects");
  const { data: templates, error: tplErr } = useApi<Template[]>(`/tasks/templates?v=${aux}`);
  const { data: rules, error: rulesErr } = useApi<Rule[]>(`/tasks/automation?v=${aux}`);
  const { data: workload, error: wlErr } = useApi<any>(`/tasks/workload?v=${aux}`);
  const { data: myDay } = useApi<any[]>(`/tasks/my-day?v=${aux}`);

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [reloadTasks, setReloadTasks] = useState(0);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (fStatus) p.set("status", fStatus);
    if (fPriority) p.set("priority", fPriority);
    if (fType) p.set("taskType", fType);
    if (fProject) p.set("projectId", fProject);
    if (mine) p.set("mine", "true");
    p.set("sort", sort);
    return p.toString();
  }, [q, fStatus, fPriority, fType, fProject, mine, sort]);
  useEffect(() => {
    let cancelled = false;
    setTasksErr(null);
    apiFetch<TaskRow[]>(`/tasks${query ? `?${query}` : ""}`)
      .then((d) => !cancelled && setTasks(d))
      .catch((e) => !cancelled && setTasksErr(e.message));
    return () => { cancelled = true; };
  }, [query, refresh, reloadTasks]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("task");
    if (t) setSelectedId(t);
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "subtasks" | "comments" | "time" | "deps" | "files">("overview");
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(null); setTab("overview"); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    apiFetch<TaskDetail>(`/tasks/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => { if (!cancelled) { setDetailError(e.message ?? "Failed to load"); setDetail(null); } })
      .finally(() => !cancelled && setDetailLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  const patchDetail = async (patch: any, msg?: string) => {
    if (!selectedId) return;
    setBusy(true);
    try { await apiFetch(`/tasks/${selectedId}`, { method: "PATCH", body: JSON.stringify(patch) }); if (msg) notify(msg); reload(); }
    catch (e: any) { notify(e.message ?? "Save failed"); } finally { setBusy(false); }
  };
  const changeStatus = (s: string) => {
    if (!selectedId || s === detail?.status) return;
    apiFetch(`/tasks/${selectedId}/status`, { method: "PATCH", body: JSON.stringify({ status: s }) })
      .then(() => { notify(`Moved to ${label(s)}`); reload(); })
      .catch((e: any) => notify(e.message ?? "Move failed"));
  };
  const cloneTask = () => {
    if (!selectedId) return;
    apiFetch(`/tasks/${selectedId}/clone`, { method: "POST" })
      .then(() => { notify("Task cloned"); setSelectedId(null); reload(); })
      .catch((e: any) => notify(e.message ?? "Clone failed"));
  };
  const archiveTask = () => {
    if (!selectedId) return;
    if (!window.confirm("Archive this task? It will disappear from the board.")) return;
    apiFetch(`/tasks/${selectedId}`, { method: "PATCH", body: JSON.stringify({ archivedAt: true }) })
      .then(() => { notify("Task archived"); setSelectedId(null); reload(); })
      .catch((e: any) => notify(e.message ?? "Archive failed"));
  };
  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/tasks?task=${id}`)
      .then(() => notify("Link copied"))
      .catch(() => notify("Copy failed"));
  };
  const deleteTask = (id: string) => {
    if (!window.confirm("Delete this task and its children?")) return;
    apiFetch(`/tasks/${id}`, { method: "DELETE" })
      .then(() => { notify("Task deleted"); if (selectedId === id) setSelectedId(null); reload(); })
      .catch((e: any) => notify(e.message ?? "Delete failed"));
  };

  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const postComment = async (parentId?: string) => {
    const text = parentId ? replyText : commentText;
    if (!text.trim()) return;
    try {
      await apiFetch(`/tasks/${selectedId}/comments`, { method: "POST", body: JSON.stringify({ content: text.trim(), parentId: parentId || undefined }) });
      if (parentId) { setReplyText(""); setReplyTo(null); } else setCommentText("");
      notify("Comment posted"); reload();
    } catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const toggleReaction = async (commentId: string, emoji: string) => {
    try { await apiFetch(`/tasks/${selectedId}/comments/${commentId}/reactions`, { method: "PATCH", body: JSON.stringify({ emoji, userId: CURRENT_USER_ID }) }); reload(); }
    catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const deleteComment = (commentId: string) => {
    if (!window.confirm("Delete this comment?")) return;
    apiFetch(`/tasks/${selectedId}/comments/${commentId}`, { method: "DELETE" })
      .then(() => { notify("Comment deleted"); reload(); })
      .catch((e: any) => notify(e.message ?? "Failed"));
  };

  const [subTitle, setSubTitle] = useState("");
  const [subAssignee, setSubAssignee] = useState("");
  const [subDue, setSubDue] = useState("");
  const addSubtask = async () => {
    if (!subTitle.trim()) return;
    try {
      await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title: subTitle.trim(), parentTaskId: selectedId, assignedToId: subAssignee || undefined, dueDate: subDue || null }) });
      setSubTitle(""); setSubAssignee(""); setSubDue(""); notify("Subtask added"); reload();
    } catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const toggleSubtask = (s: TaskRow) => {
    apiFetch(`/tasks/${s.id}/status`, { method: "PATCH", body: JSON.stringify({ status: s.status === "DONE" ? "TODO" : "DONE" }) })
      .then(() => reload())
      .catch((e: any) => notify(e.message ?? "Failed"));
  };
  const moveSubtask = (idx: number, dir: number) => {
    const arr = [...(detail?.subtasks ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    const a = arr[idx], b = arr[j];
    apiFetch(`/tasks/${a.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: j }) }).catch(() => {});
    apiFetch(`/tasks/${b.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: idx }) }).catch(() => {});
    setDetail((d) => (d ? { ...d, subtasks: arr.map((x, i) => (i === idx ? b : i === j ? a : x)) } : d));
  };

  const [logDate, setLogDate] = useState(todayKey());
  const [logHours, setLogHours] = useState("");
  const [logDesc, setLogDesc] = useState("");
  const [logBillable, setLogBillable] = useState(true);
  const addTimeLog = async () => {
    if (!logHours || Number(logHours) <= 0) { notify("Enter hours"); return; }
    try {
      await apiFetch(`/tasks/${selectedId}/time-logs`, { method: "POST", body: JSON.stringify({ date: logDate, hours: Number(logHours), description: logDesc.trim() || undefined, loggedVia: "MANUAL", isBillable: logBillable }) });
      setLogHours(""); setLogDesc(""); notify("Time logged"); reload();
    } catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const deleteLog = (logId: string) => {
    apiFetch(`/tasks/${selectedId}/time-logs/${logId}`, { method: "DELETE" })
      .then(() => { notify("Log removed"); reload(); })
      .catch((e: any) => notify(e.message ?? "Failed"));
  };

  const [timerOn, setTimerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!timerOn) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [timerOn]);
  const startTimer = () => { setElapsed(0); setTimerOn(true); };
  const stopTimer = async () => {
    setTimerOn(false);
    const hours = Math.round((elapsed / 3600) * 100) / 100;
    if (hours < 0.05) { notify("Timer too short — nothing logged"); return; }
    try { await apiFetch(`/tasks/${selectedId}/time-logs`, { method: "POST", body: JSON.stringify({ date: todayKey(), hours, loggedVia: "TIMER", isBillable: true }) }); notify(`${hours}h logged from timer`); reload(); }
    catch (e: any) { notify(e.message ?? "Failed"); }
  };

  const [depId, setDepId] = useState("");
  const [depType, setDepType] = useState("blocked-by");
  const addDependency = async () => {
    if (!depId) return;
    try { await apiFetch(`/tasks/${selectedId}/dependencies`, { method: "POST", body: JSON.stringify({ dependsOnTaskId: depId, type: depType }) }); setDepId(""); notify("Dependency added"); reload(); }
    catch (e: any) { notify(e.message ?? "Failed"); }
  };
  const removeDependency = (dep: { id: string }) => {
    apiFetch(`/tasks/${selectedId}/dependencies/${dep.id}`, { method: "DELETE" })
      .then(() => { notify("Dependency removed"); reload(); })
      .catch((e: any) => notify(e.message ?? "Failed"));
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId || !detail) return;
    const reader = new FileReader();
    reader.onload = () => {
      const att = {
        id: `a${Date.now()}`, name: file.name, url: String(reader.result), size: fmtBytes(file.size),
        type: file.type || "application/octet-stream", uploadedByName: "You", uploadedAt: new Date().toISOString(),
      };
      patchDetail({ attachments: [...((detail.attachments ?? []) as any[]), att] }, "Attachment added");
    };
    reader.readAsDataURL(file);
  };
  const removeAttachment = (attId: string) => {
    if (!detail) return;
    patchDetail({ attachments: ((detail.attachments ?? []) as any[]).filter((a) => a.id !== attId) }, "Attachment removed");
  };

  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const addLink = () => {
    if (!linkUrl.trim() || !detail) return;
    const link = { id: `l${Date.now()}`, title: linkTitle.trim() || linkUrl.trim(), url: linkUrl.trim(), type: "reference" };
    patchDetail({ referenceLinks: [...((detail.referenceLinks ?? []) as any[]), link] }, "Link added");
    setLinkTitle(""); setLinkUrl("");
  };
  const removeLink = (linkId: string) => {
    if (!detail) return;
    patchDetail({ referenceLinks: ((detail.referenceLinks ?? []) as any[]).filter((l) => l.id !== linkId) }, "Link removed");
  };

  const [cfKey, setCfKey] = useState("");
  const [cfValue, setCfValue] = useState("");
  const addField = () => {
    if (!cfKey.trim() || !detail) return;
    const field = { id: `cf${Date.now()}`, key: cfKey.trim(), value: cfValue.trim() };
    patchDetail({ customFields: [...((detail.customFields ?? []) as any[]), field] }, "Field added");
    setCfKey(""); setCfValue("");
  };
  const removeField = (fieldId: string) => {
    if (!detail) return;
    patchDetail({ customFields: ((detail.customFields ?? []) as any[]).filter((f) => f.id !== fieldId) }, "Field removed");
  };

  const useTemplate = (t: Template) => {
    apiFetch(`/tasks/templates/${t.id}/use`, { method: "POST" })
      .then(() => { notify(`Template "${t.name}" applied`); reload(); })
      .catch((e: any) => notify(e.message ?? "Failed"));
  };
  const deleteTemplate = (t: Template) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    apiFetch(`/tasks/templates/${t.id}`, { method: "DELETE" })
      .then(() => { notify("Template deleted"); setAux((a) => a + 1); })
      .catch((e: any) => notify(e.message ?? "Failed"));
  };
  const toggleRule = (r: Rule) => {
    apiFetch(`/tasks/automation/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) })
      .then(() => setAux((a) => a + 1))
      .catch((e: any) => notify(e.message ?? "Failed"));
  };
  const deleteRule = (r: Rule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    apiFetch(`/tasks/automation/${r.id}`, { method: "DELETE" })
      .then(() => setAux((a) => a + 1))
      .catch((e: any) => notify(e.message ?? "Failed"));
  };
  const ruleSummary = (r: Rule) => {
    const c = r.config ?? {};
    const parts: string[] = [];
    if (r.trigger === "status-changed") parts.push(c.fromStatus ? `${label(c.fromStatus)} → ${label(c.toStatus)}` : `to ${label(c.toStatus ?? "")}`);
    if (r.trigger === "priority-changed") parts.push(`to ${label(c.toPriority ?? "")}`);
    if (r.trigger === "assigned") parts.push(c.assigneeId ? `to ${users.find((u) => u.id === c.assigneeId)?.name ?? "someone"}` : "to anyone");
    if (r.action === "change-status") parts.push(`set status ${label(c.toStatus ?? "")}`);
    if (r.action === "change-priority") parts.push(`set priority ${label(c.toPriority ?? "")}`);
    if (r.action === "assign-to") parts.push(`assign ${users.find((u) => u.id === c.assignToId)?.name ?? c.assignToId}`);
    if (r.action === "notify") parts.push("notify assignee");
    if (r.action === "create-task") parts.push(`create "${c.title ?? "follow-up"}"`);
    if (r.action === "archive") parts.push("archive");
    return parts.join(" · ") || "—";
  };

  const myDayIds = useMemo(() => new Set((myDay ?? []).map((t: any) => t.id ?? t.taskId)), [myDay]);
  const shownTasks = useMemo(() => {
    let list = tasks ?? [];
    if (myDayOnly) list = list.filter((t) => myDayIds.has(t.id));
    return list;
  }, [tasks, myDayOnly, myDayIds]);

  // ── Board (lanes + order + DnD) ──────────────────────────────────────
  const laneKeyOf = (t: TaskRow) => swimlane === "project" ? (t.project?.name ?? "No project")
    : swimlane === "assignee" ? (t.assignedTo?.name ?? "Unassigned")
      : swimlane === "priority" ? (t.priority ?? "MEDIUM") : "all";
  const [laneOrder, setLaneOrder] = useState<Record<string, string[]>>({});
  useEffect(() => {
    setLaneOrder((prev) => {
      const next = { ...prev };
      (tasks ?? []).forEach((t) => {
        const k = `${t.status}|${laneKeyOf(t)}`;
        if (!next[k]) next[k] = [];
        if (!next[k].includes(t.id)) next[k].push(t.id);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, swimlane]);
  const moveToTop = (t: TaskRow) => {
    const k = `${t.status}|${laneKeyOf(t)}`;
    setLaneOrder((prev) => ({ ...prev, [k]: [t.id, ...(prev[k] ?? []).filter((id) => id !== t.id)] }));
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dropTask = (status: string, lane: string) => {
    if (!dragId) return;
    const k = `${status}|${lane}`;
    apiFetch(`/tasks/${dragId}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
      .then(() => {
        setLaneOrder((prev) => {
          const next: Record<string, string[]> = {};
          Object.keys(prev).forEach((kk) => {
            if (kk === k) return;
            if (prev[kk].includes(dragId!)) next[kk] = prev[kk].filter((id) => id !== dragId);
            else next[kk] = prev[kk];
          });
          next[k] = [dragId!, ...(prev[k] ?? []).filter((id) => id !== dragId)];
          return next;
        });
        notify(`Moved to ${label(status)}`);
        reload();
      })
      .catch((e: any) => notify(e.message ?? "Move failed"))
      .finally(() => setDragId(null));
  };
  const boardLanes = useMemo(() => {
    const lanes = new Set(shownTasks.map(laneKeyOf));
    return [...lanes].sort();
  }, [shownTasks, swimlane]);
  const tasksIn = (col: string, lane: string) => {
    const list = (shownTasks ?? []).filter((t) => t.status === col && laneKeyOf(t) === lane);
    const order = laneOrder[`${col}|${lane}`] ?? [];
    return [...list].sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  };

  // ── List (bulk + expand) ─────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = selected.length > 0 && (shownTasks ?? []).length > 0 && selected.length === shownTasks.filter((t) => !t.parentTaskId).length;
  const bulkPatch = (patch: any, msg: string) => {
    if (!selected.length) return;
    Promise.all(selected.map((id) => apiFetch(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) })))
      .then(() => { notify(msg); setSelected([]); reload(); })
      .catch((e: any) => notify(e.message ?? "Bulk action failed"));
  };
  const bulkDelete = () => {
    if (!selected.length || !window.confirm(`Delete ${selected.length} task(s)?`)) return;
    Promise.all(selected.map((id) => apiFetch(`/tasks/${id}`, { method: "DELETE" })))
      .then(() => { notify("Tasks deleted"); setSelected([]); reload(); })
      .catch((e: any) => notify(e.message ?? "Bulk delete failed"));
  };
  const childMap = useMemo(() => {
    const m: Record<string, TaskRow[]> = {};
    (tasks ?? []).forEach((t) => { if (t.parentTaskId) (m[t.parentTaskId] = m[t.parentTaskId] ?? []).push(t); });
    return m;
  }, [tasks]);

  // ── Calendar ─────────────────────────────────────────────────────────
  const [cal, setCal] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  const calCells = useMemo(() => {
    const first = new Date(cal.y, cal.m, 1);
    const startDow = first.getDay();
    const days = new Date(cal.y, cal.m + 1, 0).getDate();
    const prevDays = new Date(cal.y, cal.m, 0).getDate();
    const cells: { key: string; day: number; inMonth: boolean; dateKey: string }[] = [];
    for (let i = startDow - 1; i >= 0; i--) cells.push({ key: `p${i}`, day: prevDays - i, inMonth: false, dateKey: "" });
    for (let d = 1; d <= days; d++) cells.push({ key: `${cal.y}-${cal.m}-${d}`, day: d, inMonth: true, dateKey: `${cal.y}-${pad(cal.m + 1)}-${pad(d)}` });
    let nx = 1;
    while (cells.length % 7 !== 0) cells.push({ key: `n${nx}`, day: nx, inMonth: false, dateKey: "" });
    return cells;
  }, [cal]);
  const byDay = useMemo(() => {
    const m: Record<string, TaskRow[]> = {};
    (tasks ?? []).forEach((t) => { if (t.dueDate) { const k = localKey(t.dueDate); (m[k] = m[k] ?? []).push(t); } });
    return m;
  }, [tasks]);
  const monthLabel = new Date(cal.y, cal.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekCells = useMemo(() => {
    const cells: { key: string; day: number; dateKey: string; inMonth: boolean }[] = [];
    const startDow = new Date(cal.y, cal.m, 1).getDay();
    const base = new Date(cal.y, cal.m, 1 - startDow);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      cells.push({ key: d.toISOString(), day: d.getDate(), dateKey: localKey(d), inMonth: d.getMonth() === cal.m });
    }
    return cells;
  }, [cal]);

  // ── Gantt ────────────────────────────────────────────────────────────
  const gantt = useMemo(() => {
    const top = (shownTasks ?? []).filter((t) => !t.parentTaskId);
    const CELL = 26;
    const now = new Date();
    let min = new Date(now); min.setDate(min.getDate() - 7);
    let max = new Date(now); max.setDate(max.getDate() + 14);
    const spans = new Map<string, { start: Date; end: Date }>();
    top.forEach((t) => {
      const s = t.startDate ? new Date(t.startDate) : t.createdAt ? new Date(t.createdAt) : now;
      const e = t.dueDate ? new Date(t.dueDate) : s;
      const start = s.getTime() < e.getTime() ? s : e;
      const end = e.getTime() > s.getTime() ? e : s;
      spans.set(t.id, { start, end });
      if (start < min) min = start;
      if (end > max) max = end;
    });
    const start0 = new Date(min); start0.setHours(0, 0, 0, 0);
    const end0 = new Date(max); end0.setHours(23, 59, 59, 999);
    const totalDays = Math.max(1, Math.min(400, Math.round((end0.getTime() - start0.getTime()) / 86400000) + 1));
    const months: { label: string; startDay: number; days: number }[] = [];
    let cur: { label: string; startDay: number; days: number } | null = null;
    for (let d = 0; d < totalDays; d++) {
      const date = new Date(start0.getTime() + d * 86400000);
      const lab = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      if (!cur || cur.label !== lab) { cur = { label: lab, startDay: d, days: 0 }; months.push(cur); }
      cur.days++;
    }
    const todayOffset = Math.max(0, Math.round((new Date(todayKey()).getTime() - start0.getTime()) / 86400000));
    const laneOf = (t: TaskRow) => swimlane === "assignee" ? (t.assignedTo?.name ?? "Unassigned")
      : swimlane === "project" ? (t.project?.name ?? "No project") : "all";
    const lanes: { label: string; tasks: TaskRow[] }[] = [];
    if (swimlane === "none") {
      lanes.push({ label: "All tasks", tasks: top });
    } else {
      const groups = new Map<string, TaskRow[]>();
      top.forEach((t) => { const k = laneOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t); });
      [...groups.keys()].sort().forEach((k) => lanes.push({ label: k, tasks: groups.get(k)! }));
    }
    return { CELL, totalDays, months, spans, start0, todayOffset, lanes };
  }, [shownTasks, swimlane]);

  const dueBadge = (t: TaskRow) => {
    if (!t.dueDate || t.status === "DONE") return null;
    const k = localKey(t.dueDate);
    const today = todayKey();
    return (
      <span className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold", k === today ? "bg-amber-500/15 text-amber-400" : k < today ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}>
        <CalendarDays className="size-2.5" />{k === today ? "today" : formatDay(t.dueDate)}
      </span>
    );
  };

  const cardMenu = (t: TaskRow) => menuFor === t.id && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
      <div className="absolute right-2 top-9 z-50 w-40 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl shadow-black/20">
        <button onClick={() => { copyLink(t.id); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-semibold transition-colors hover:bg-muted"><Link2 className="size-3.5 text-muted-foreground" /> Copy link</button>
        <button onClick={() => { moveToTop(t); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-semibold transition-colors hover:bg-muted"><ArrowUp className="size-3.5 text-muted-foreground" /> Move to top</button>
        <button onClick={() => { apiFetch(`/tasks/${t.id}/clone`, { method: "POST" }).then(() => { notify("Task cloned"); reload(); }).catch((e: any) => notify(e.message ?? "Failed")); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-semibold transition-colors hover:bg-muted"><Copy className="size-3.5 text-muted-foreground" /> Clone</button>
        <button onClick={() => { deleteTask(t.id); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-semibold text-rose-400 transition-colors hover:bg-rose-500/10"><Trash2 className="size-3.5" /> Delete</button>
      </div>
    </>
  );

  const assigneeStack = (t: TaskRow) => {
    const all = [t.assignedTo ? { name: t.assignedTo.name } : null, ...((t.assignees ?? []) as any[]).map((a: any) => ({ name: a.name }))].filter(Boolean);
    if (!all.length) return <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"><UserRound className="size-3" /></span>;
    return (
      <div className="flex">
        {all.slice(0, 3).map((a: any, i: number) => (
          <div key={i} className={cn("-ml-1.5 first:ml-0", i > 0 && "rounded-full ring-2 ring-card")}><Avatar name={a.name} size="size-6" /></div>
        ))}
      </div>
    );
  };

  const taskCard = (t: TaskRow) => {
    const overdue = t.dueDate && t.status !== "DONE" && localKey(t.dueDate) < todayKey();
    const progress = t.estimatedHours ? Math.min(100, (Number(t.actualHours ?? 0) / Math.max(1, Number(t.estimatedHours))) * 100) : null;
    return (
      <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
        onClick={() => setSelectedId(t.id)}
        className={cn("group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10", overdue ? "border-rose-500/30 bg-rose-500/[0.03]" : "border-border/60", dragId === t.id && "opacity-40")}>
        {/* Project breadcrumb — at-a-glance */}
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", t.project?.name ? "border-border/60 bg-muted/40" : "border-dashed border-border bg-transparent")}>
            <FolderKanban className="size-2.5" />{t.project?.name ?? "No project"}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold capitalize" style={{ borderColor: "var(--border)" }}><span className={cn("size-1.5 rounded-full", TYPE_TONES[t.taskType ?? "general"]?.includes("rose") ? "bg-rose-400" : TYPE_TONES[t.taskType ?? "general"]?.includes("primary") ? "bg-primary" : "bg-muted-foreground")} />{t.taskType ?? "general"}</span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 line-clamp-2 flex-1 text-[12.5px] font-bold leading-snug">{t.title}</p>
          <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }} className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted group-hover:text-foreground"><MoreHorizontal className="size-3.5" /></button>
        </div>
        {cardMenu(t)}
        {t.description && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/80">{t.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {t.priority && <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide", PRIORITY_TONES[t.priority] ?? PRIORITY_TONES.MEDIUM)}>{t.priority}</span>}
          {dueBadge(t)}
          {t.isBlocked && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold text-rose-400">BLOCKED</span>}
          {t.isClientVisible && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[9px] font-bold text-sky-400">client</span>}
          {t.parentTaskId && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">subtask</span>}
        </div>
        {/* Hours progress — hierarchy */}
        {(t.estimatedHours != null || t.actualHours != null) && progress !== null && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", Number(t.actualHours ?? 0) > Number(t.estimatedHours ?? 0) ? "bg-rose-500" : "bg-primary")} style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">{Number(t.actualHours ?? 0).toFixed(1)}/{t.estimatedHours ?? "—"}h</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {(t.tags ?? []).slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">#{tag}</span>)}
            {(t.tags ?? []).length > 2 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">+{(t.tags ?? []).length - 2}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground"><MessageSquare className="size-3" />{t._count?.comments ?? 0}</span>
            <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground"><Timer className="size-3" />{t._count?.timeLogs ?? 0}</span>
            {(t.subtaskCount ?? 0) > 0 && <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground"><ListTodo className="size-3" />{t.subtaskCount}</span>}
            {assigneeStack(t)}
          </div>
        </div>
      </div>
    );
  };

  const renderBoard = () => (
    <FadeIn>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented value={swimlane} onChange={setSwimlane} options={SWIMLANES} />
        <span className="text-[11px] font-semibold text-muted-foreground">{shownTasks.length} tasks</span>
      </div>
      {swimlane === "none" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex min-w-max gap-3">
            {BOARD_COLUMNS.map((col) => {
              const items = tasksIn(col.key, "all");
              return (
                <div key={col.key} className="flex w-[280px] shrink-0 flex-col" onDragOver={(e) => e.preventDefault()} onDrop={() => dropTask(col.key, "all")}>
                  <div className={cn("mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-2", dragId && "border-dashed")}>
                    <span className="flex items-center gap-2 text-[11.5px] font-bold"><span className={cn("size-2 rounded-full", col.dot)} />{col.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/60">{dragId ? "Drop here" : "No tasks"}</p>}
                    {items.map(taskCard)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {boardLanes.map((lane) => (
            <div key={lane}>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary">{lane}</span>
                <span className="text-[10.5px] font-semibold text-muted-foreground">{shownTasks.filter((t) => laneKeyOf(t) === lane).length} tasks</span>
              </div>
              <div className="-mx-4 overflow-x-auto px-4 pb-2">
                <div className="flex min-w-max gap-3">
                  {BOARD_COLUMNS.map((col) => {
                    const items = tasksIn(col.key, lane);
                    return (
                      <div key={col.key} className="flex w-[280px] shrink-0 flex-col" onDragOver={(e) => e.preventDefault()} onDrop={() => dropTask(col.key, lane)}>
                        <div className={cn("mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-2", dragId && "border-dashed")}>
                          <span className="flex items-center gap-2 text-[11.5px] font-bold"><span className={cn("size-2 rounded-full", col.dot)} />{col.label}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">{items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {items.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/60">{dragId ? "Drop here" : "No tasks"}</p>}
                          {items.map(taskCard)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </FadeIn>
  );

  const renderList = () => (
    <FadeIn>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2">
          <span className="text-[11.5px] font-bold text-primary">{selected.length} selected</span>
          <Select value="" onChange={(e) => e.target.value && bulkPatch({ status: e.target.value }, `Moved ${selected.length} task(s)`)} className="!w-36 !py-1.5"><option value="">Move to…</option>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select>
          <Select value="" onChange={(e) => e.target.value && bulkPatch({ priority: e.target.value }, `Priority updated for ${selected.length} task(s)`)} className="!w-32 !py-1.5"><option value="">Priority…</option>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
          <Select value="" onChange={(e) => e.target.value && bulkPatch({ assignedToId: e.target.value }, "Assignees updated")} className="!w-40 !py-1.5"><option value="">Assign to…</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select>
          <Btn variant="ghost" onClick={bulkDelete} className="bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"><Trash2 className="size-3.5" /> Delete</Btn>
          <button onClick={() => setSelected([])} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary"><X className="size-3" /> clear</button>
        </div>
      )}
      <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{shownTasks.length} tasks</span>}>
        <table className="w-full">
          <THead>
            <Th><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? (shownTasks ?? []).filter((t) => !t.parentTaskId).map((t) => t.id) : [])} className="size-3.5 accent-primary" /></Th>
            <Th>Title</Th><Th>Type</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th><Th>Assignee</Th><Th>Project</Th>
          </THead>
          <tbody>
            {shownTasks.filter((t) => !t.parentTaskId).map((t, i) => (
              <FragmentRow key={t.id} t={t} i={i} expanded={expanded.has(t.id)} hasChildren={(childMap[t.id] ?? []).length > 0} childrenList={childMap[t.id] ?? []}
                onToggleExpand={() => toggleExpand(t.id)} selected={selected.includes(t.id)} onSelect={() => toggleSelect(t.id)}
                onOpen={() => setSelectedId(t.id)} onChanged={reload}
                renderChild={(c, ci) => (
                  <Tr key={c.id} index={ci} onClick={() => setSelectedId(c.id)} className="cursor-pointer">
                    <Td />
                    <Td>
                      <div className="flex items-center gap-1.5 pl-6">
                        <GitBranch className="size-3 shrink-0 text-muted-foreground/60" />
                        <p className="max-w-52 truncate font-medium">{c.title}</p>
                        {c.isBlocked && <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-400">BLOCKED</span>}
                      </div>
                    </Td>
                    <Td>{c.taskType ? <span className={cn("rounded-full border px-2 py-0.5 text-[9.5px] font-bold capitalize", TYPE_TONES[c.taskType] ?? TYPE_TONES.general)}>{c.taskType}</span> : <span className="text-muted-foreground/50">—</span>}</Td>
                    <Td><StatusBadge status={c.status} /></Td>
                    <Td><span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", PRIORITY_TONES[c.priority] ?? PRIORITY_TONES.MEDIUM)}>{c.priority}</span></Td>
                    <Td className="tabular-nums text-muted-foreground">{formatDay(c.dueDate)}</Td>
                    <Td className="text-muted-foreground">{c.assignedTo?.name ?? "Unassigned"}</Td>
                    <Td className="text-muted-foreground">{c.project?.name ?? "—"}</Td>
                  </Tr>
                )} />
            ))}
          </tbody>
        </table>
      </TableShell>
    </FadeIn>
  );

const [wlOpen, setWlOpen] = useState<Set<string>>(new Set());

  const renderCalendar = () => (
    <FadeIn>
      <CardShell>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Btn variant="outline" onClick={() => setCal({ y: cal.m === 0 ? cal.y - 1 : cal.y, m: cal.m === 0 ? 11 : cal.m - 1 })}><ChevronLeft className="size-3.5" /></Btn>
            <Btn variant="outline" onClick={() => setCal({ y: cal.m === 11 ? cal.y + 1 : cal.y, m: cal.m === 11 ? 0 : cal.m + 1 })}><ChevronRight className="size-3.5" /></Btn>
            <h3 className="font-heading text-[15px] font-semibold">{monthLabel}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Segmented value={calMode} onChange={setCalMode} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]} />
            <Btn variant="ghost" onClick={() => { const d = new Date(); setCal({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</Btn>
          </div>
        </div>
        {calMode === "month" ? (
          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{d}</div>)}
            {calCells.map((c) => {
              const items = c.inMonth ? (byDay[c.dateKey] ?? []) : [];
              const isToday = c.inMonth && c.dateKey === todayKey();
              return (
                <div key={c.key} className={cn("min-h-24 rounded-xl border p-1.5", c.inMonth ? "border-border/60 bg-card" : "border-transparent bg-muted/30")}>
                  <div className="mb-1 flex justify-end">
                    <span className={cn("flex size-5 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums", isToday ? "bg-brand-gradient text-white" : c.inMonth ? "text-muted-foreground" : "text-muted-foreground/40")}>{c.day}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 3).map((t) => (
                      <button key={t.id} onClick={() => setSelectedId(t.id)} className={cn("w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold transition-transform hover:scale-[1.02]", STATUS_CHIP[t.status] ?? "bg-muted text-muted-foreground")}>{t.title}</button>
                    ))}
                    {items.length > 3 && <span className="px-1 text-[9.5px] font-semibold text-muted-foreground">+{items.length - 3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{d}</div>)}
            {weekCells.map((c) => {
              const items = byDay[c.dateKey] ?? [];
              const isToday = c.dateKey === todayKey();
              return (
                <div key={c.key} className={cn("min-h-56 rounded-xl border p-1.5", isToday ? "border-primary/40 bg-primary/5" : c.inMonth ? "border-border/60 bg-card" : "border-border/40 bg-muted/30")}>
                  <div className="mb-1 flex justify-end">
                    <span className={cn("flex size-5 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums", isToday ? "bg-brand-gradient text-white" : "text-muted-foreground")}>{c.day}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => setSelectedId(t.id)} className={cn("w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold transition-transform hover:scale-[1.02]", STATUS_CHIP[t.status] ?? "bg-muted text-muted-foreground")}>{t.title}</button>
                    ))}
                    {items.length > 6 && <span className="px-1 text-[9.5px] font-semibold text-muted-foreground">+{items.length - 6} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardShell>
    </FadeIn>
  );

  const renderGantt = () => {
    const { CELL, totalDays, months, spans, start0, todayOffset, lanes } = gantt;
    return (
      <FadeIn>
        <CardShell>
          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="min-w-max">
              <div className="flex" style={{ width: 220 + totalDays * CELL }}>
                <div className="w-[220px] shrink-0 border-b border-border/60 py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Task</div>
                <div className="relative shrink-0 border-b border-border/60 py-2">
                  <div className="flex">
                    {months.map((m, i) => (
                      <div key={i} className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: m.days * CELL }}>{m.label}</div>
                    ))}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex">
                    {months.map((m, i) => (
                      <div key={i} className="h-2 border-l border-border/40" style={{ width: m.days * CELL }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col" style={{ width: 220 + totalDays * CELL }}>
                {lanes.map((lane) => (
                  <div key={lane.label}>
                    <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 py-1.5 pl-3">
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{lane.label}</span>
                      <span className="text-[9.5px] font-semibold text-muted-foreground">{lane.tasks.length}</span>
                    </div>
                    {lane.tasks.map((t) => {
                      const span = spans.get(t.id);
                      if (!span) return null;
                      const left = Math.max(0, Math.round((span.start.getTime() - start0.getTime()) / 86400000)) * CELL;
const width = Math.max(CELL, Math.round((span.end.getTime() - span.start.getTime()) / 86400000) * CELL + CELL);

  return (
                        <div key={t.id} className="flex items-center border-b border-border/40 hover:bg-muted/40" style={{ width: 220 + totalDays * CELL }}>
                          <button onClick={() => setSelectedId(t.id)} className="flex h-9 w-[220px] shrink-0 items-center gap-2 pr-3 pl-3 text-left">
                            <span className={cn("size-2 shrink-0 rounded-full", t.status === "DONE" ? "bg-emerald-500" : t.status === "IN_PROGRESS" ? "bg-primary" : t.status === "IN_REVIEW" ? "bg-amber-400" : t.status === "BLOCKED" ? "bg-rose-400" : t.status === "TODO" ? "bg-sky-400" : "bg-muted")} />
                            <span className="truncate text-[11.5px] font-medium">{t.title}</span>
                          </button>
                          <div className="relative shrink-0" style={{ width: totalDays * CELL }}>
                            <div className="absolute top-1/2 h-4 -translate-y-1/2 cursor-pointer rounded-md border transition-all hover:opacity-80"
                              style={{
                                left, width,
                                backgroundColor: t.status === "DONE" ? "rgba(16,185,129,0.35)" : t.status === "IN_PROGRESS" ? "rgba(139,92,246,0.4)" : t.status === "IN_REVIEW" ? "rgba(251,191,36,0.35)" : t.status === "BLOCKED" ? "rgba(244,63,94,0.4)" : "rgba(100,116,139,0.4)",
                                borderColor: t.status === "DONE" ? "rgb(16,185,129)" : t.status === "IN_PROGRESS" ? "rgb(139,92,246)" : t.status === "IN_REVIEW" ? "rgb(251,191,36)" : t.status === "BLOCKED" ? "rgb(244,63,94)" : "rgb(100,116,139)",
                              }}
                              onClick={() => setSelectedId(t.id)} title={t.title} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="relative" style={{ width: 220 + totalDays * CELL, height: 0 }}>
                <div className="absolute top-0 bottom-0 w-px bg-rose-400/60" style={{ left: 220 + todayOffset * CELL }} />
              </div>
            </div>
          </div>
        </CardShell>
      </FadeIn>
    );
  };

  const renderView = () => {
    if (!tasks && !tasksErr) {
      return <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>;
    }
    if (tasksErr) {
      return (
        <div className="flex flex-col items-center gap-3">
          <EmptyState title={tasksErr} hint="Could not load tasks" />
          <Btn variant="outline" onClick={reload}><RefreshCw className="size-3.5" /> Retry</Btn>
        </div>
      );
    }
    if (view === "board") return renderBoard();
    if (view === "calendar") return renderCalendar();
    if (view === "gantt") return renderGantt();
    return renderList();
  };

  return (
    <div>
      {flash && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl">
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Tasks"
        subtitle="Where daily work happens — task execution, time logging, smart prioritization."
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }, { value: "calendar", label: "Calendar" }, { value: "gantt", label: "Gantt" }]} />
            <Btn variant="primary" onClick={() => { setEditTask(null); setFormOpen(true); }}><Plus className="size-3.5" /> New Task</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open" value={stats?.open ?? "—"} sub={`${stats?.total ?? 0} total`} icon={<ListTodo className="size-5" />} />
        <StatCard label="Done" value={stats?.done ?? "—"} sub="completed" icon={<CheckCircle2 className="size-5" />} />
        <StatCard label="In Progress" value={stats?.inProgress ?? "—"} sub={`${stats?.review ?? 0} in review`} icon={<Timer className="size-5" />} />
        <StatCard label="Due Today" value={stats?.dueToday ?? "—"} sub="must finish today" icon={<AlarmClock className="size-5" />} />
        <StatCard label="Overdue" value={stats?.overdue ?? "—"} sub="past due date" icon={<ShieldAlert className="size-5" />} />
        <StatCard label="High Priority" value={stats?.highPriority ?? "—"} sub="urgent + high" icon={<Flame className="size-5" />} />
      </div>

      {(view === "board" || view === "list") && (
        <div className="mt-4 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
          </div>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="!w-36"><option value="">All statuses</option>{STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select>
          <Select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className="!w-32"><option value="">All priorities</option>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
          <Select value={fType} onChange={(e) => setFType(e.target.value)} className="!w-36"><option value="">All types</option>{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select>
          <Select value={fProject} onChange={(e) => setFProject(e.target.value)} className="!w-40"><option value="">All projects</option>{(projects ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select>
          {view === "list" && (
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-32">
              <option value="due">Sort: due date</option>
              <option value="priority">Sort: priority</option>
              <option value="title">Sort: title</option>
              <option value="created">Sort: newest</option>
              <option value="status">Sort: status</option>
            </Select>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-3.5 accent-primary" /> Mine
          </label>
          <Btn variant="outline" onClick={() => setMyDayOnly((v) => !v)}><Zap className="size-3.5" />{myDayOnly ? "My Day on" : "My Day"} ({myDay?.length ?? 0})</Btn>
          {myDayOnly && <button onClick={() => setMyDayOnly(false)} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary"><X className="size-3" /> clear</button>}
        </div>
      )}

      <div className="mt-4">{renderView()}</div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell>
          <SectionTitle title="Templates" subtitle="Reusable task checklists" action={<Btn variant="primary" onClick={() => setTplOpen(true)}><Plus className="size-3.5" /> New</Btn>} />
          {tplErr ? (
            <div className="flex flex-col items-center gap-3"><EmptyState title={tplErr} /><Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn></div>
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
                      <button onClick={() => useTemplate(t)} title="Use template" className="flex size-7 items-center justify-center rounded-lg text-emerald-400 transition-colors hover:bg-emerald-500/10"><Play className="size-3.5" /></button>
                      <button onClick={() => deleteTemplate(t)} title="Delete template" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
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
        </CardShell>

        <CardShell>
          <SectionTitle title="Automation" subtitle="Rules that fire on status, priority or assignee changes" action={<Btn variant="primary" onClick={() => setAutoOpen(true)}><Plus className="size-3.5" /> Add rule</Btn>} />
          {rulesErr ? (
            <div className="flex flex-col items-center gap-3"><EmptyState title={rulesErr} /><Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn></div>
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
                    <button onClick={() => toggleRule(r)} className={cn("relative h-5 w-9 rounded-full transition-colors", r.enabled ? "bg-primary" : "bg-muted")} title={r.enabled ? "Disable" : "Enable"}>
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", r.enabled ? "left-[18px]" : "left-0.5")} />
                    </button>
                    <button onClick={() => deleteRule(r)} title="Delete rule" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardShell>
      </div>

      <div className="mt-6">
        <SectionTitle title="Team Workload" subtitle="Capacity vs assigned hours this week" />
        {wlErr ? (
          <div className="flex flex-col items-center gap-3"><EmptyState title={wlErr} /><Btn variant="outline" onClick={() => setAux((a) => a + 1)}><RefreshCw className="size-3.5" /> Retry</Btn></div>
        ) : !workload ? (
          <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-bold text-primary">Team utilization {(workload as any)?.teamUtilization ?? 0}%</span>
              <span className={cn("rounded-full px-2.5 py-1 text-[10.5px] font-bold", ((workload as any)?.overbookedCount ?? 0) > 0 ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400")}>{(workload as any)?.overbookedCount ?? 0} overbooked</span>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground">{(workload as any)?.totalAllocated ?? 0}h allocated</span>
            </div>
            <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{(workload?.rows ?? []).length} people</span>}>
              <table className="w-full">
                <THead><Th>Employee</Th><Th>Open Tasks</Th><Th>Hours / Capacity</Th><Th>Utilization</Th><Th>Status</Th><Th>Urgent</Th><Th>Overdue</Th></THead>
                <tbody>
                  {(workload?.rows ?? []).map((w: WorkloadRow, i: number) => {
                    const pct = Math.round((w.utilization ?? 0) * 100);
                    const bar = Math.min(100, (w.allocated ?? 0) / 40 * 100);
                    const open = wlOpen.has(w.id);
                    return (
                      <Fragment key={w.id}>
                        <Tr index={i} onClick={() => setWlOpen((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })} className="cursor-pointer">
                          <Td>
                            <div className="flex items-center gap-2.5">
                              <button onClick={() => setWlOpen((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })} className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted"><ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} /></button>
                              <Avatar name={w.name} size="size-7" /><span className="font-medium">{w.name}</span>
                            </div>
                          </Td>
                          <Td className="tabular-nums">{w.taskCount ?? 0}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                <div className={cn("h-full rounded-full transition-all", w.overbooked ? "bg-rose-500" : pct >= 90 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${bar}%` }} />
                              </div>
                              <span className="text-[11px] tabular-nums text-muted-foreground">{w.allocated ?? 0}h / 40h</span>
                            </div>
                          </Td>
                          <Td className="font-bold tabular-nums">{pct}%</Td>
                          <Td>
                            {w.overbooked ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-400">Overbooked</span>
                              : pct >= 90 ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">Near capacity</span>
                                : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">OK</span>}
                          </Td>
                          <Td className="tabular-nums text-muted-foreground">{w.urgent ?? 0}</Td>
                          <Td className={cn("tabular-nums", (w.overdue ?? 0) > 0 ? "font-bold text-rose-400" : "text-muted-foreground")}>{w.overdue ?? 0}</Td>
                        </Tr>
{open && (
                          <Tr index={i + 0.5}>
<Td className="!whitespace-normal">
                              <div className="py-2 pl-12">
                                {(w.tasks ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No open tasks.</p>}
                                <div className="flex flex-wrap gap-1.5">
                                  {(w.tasks ?? []).map((task, ti) => (
                                    <span key={ti} className={cn("flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold", PRIORITY_TONES[task.priority] ?? "border-border bg-muted/60 text-muted-foreground")}>
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
      </div>

      <TaskFormModal open={formOpen} onClose={() => setFormOpen(false)} initial={editTask} tasks={tasks ?? []} users={users} projects={projects ?? []} onSaved={() => { notify(editTask ? "Task updated" : "Task created"); reload(); }} />
      <TemplateModal open={tplOpen} onClose={() => setTplOpen(false)} onSaved={() => { notify("Template created"); setAux((a) => a + 1); }} />
      <AutomationModal open={autoOpen} onClose={() => setAutoOpen(false)} users={users} onSaved={() => { notify("Rule added"); setAux((a) => a + 1); }} />

      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={
          detailLoading ? <p className="text-[17px] font-semibold">Loading…</p>
            : detail ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5"><FolderKanban className="size-3" />{detail.project?.name ?? "No project"}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize", TYPE_TONES[detail.taskType ?? "general"])}>{detail.taskType ?? "general"}</span>
                  <StatusBadge status={detail.status} />
                </div>
                <p className="mt-2 font-heading text-[20px] font-bold leading-tight tracking-tight">{detail.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Created {timeAgo(detail.createdAt)} {detail.reporter?.name ? `· by ${detail.reporter.name}` : ""} {detail.dueDate ? `· Due ${formatDate(detail.dueDate)}` : ""}</p>
              </div>
            ) : null
        }
      >
        {detailLoading ? (
          <div className="flex flex-col gap-3">{[...Array(8)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : detailError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-center">
            <p className="text-[13px] font-bold text-rose-600">{detailError}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Only assignee, creator, PM/Admin can view this task.</p>
            <Btn variant="outline" onClick={() => setSelectedId(null)} className="mt-3">Close</Btn>
          </div>
        ) : !detail ? null : (
          (() => { const canFull = (detail as any)._permissions?.canEditFull ?? false; const canProgress = (detail as any)._permissions?.canEditProgress ?? false; return (
          <div className="flex flex-col gap-5">
            {!canFull && (
              <div className={cn("rounded-xl border px-3 py-2.5 text-[11px] font-semibold", canProgress ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-rose-500/30 bg-rose-500/10 text-rose-600")}>
                {canProgress ? "You can only update progress, time logs and comments. Full edit restricted to creator / PM / Admin." : "View only — you don't have edit permission."}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={cn(!canProgress && "pointer-events-none opacity-50")}><Segmented value={detail.status} onChange={canProgress ? changeStatus : (()=>{})} options={STATUS_OPTS} /></div>
              <div className="flex items-center gap-1.5">
                <Select value={detail.priority} onChange={(e) => canFull && patchDetail({ priority: e.target.value }, "Priority updated")} disabled={!canFull} className="!w-28 !py-1.5">{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
                <button onClick={() => copyLink(detail.id)} title="Copy link" className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Link2 className="size-3.5" /></button>
                <button onClick={canFull ? cloneTask : undefined} disabled={!canFull} title={canFull ? "Clone task" : "Only creator/PM can clone"} className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", !canFull && "opacity-40 cursor-not-allowed")}><Copy className="size-3.5" /></button>
                <button onClick={canFull ? archiveTask : undefined} disabled={!canFull} title={canFull ? "Archive task" : "Only creator/PM can archive"} className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", !canFull && "opacity-40 cursor-not-allowed")}><Archive className="size-3.5" /></button>
                <button onClick={canFull ? () => deleteTask(detail.id) : undefined} disabled={!canFull} title={canFull ? "Delete task" : "Only creator/PM can delete"} className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "opacity-40 cursor-not-allowed")}><Trash2 className="size-3.5" /></button>
              </div>
            </div>

            {detail.description
              ? <p className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">{detail.description}</p>
              : <p className="text-[11.5px] italic text-muted-foreground/70">No description.</p>}

            {detail.isBlocked && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] font-semibold text-rose-400"><ShieldAlert className="size-3.5" /> Blocked — unblock before continuing</div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select value={detail.taskType ?? "general"} onChange={(e) => canFull && patchDetail({ taskType: e.target.value }, "Type updated")} disabled={!canFull} className="!w-36 !py-1.5">{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select>
              <div className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span className="tabular-nums">{Number(detail.actualHours ?? 0).toFixed(1)}h actual</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", Number(detail.actualHours ?? 0) > Number(detail.estimatedHours ?? 0) ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, (Number(detail.actualHours ?? 0) / Math.max(1, Number(detail.estimatedHours ?? 1))) * 100)}%` }} />
                </div>
                <span className="tabular-nums">{detail.estimatedHours != null ? `${detail.estimatedHours}h est` : "no estimate"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Project"><Select value={detail.projectId ?? ""} onChange={(e) => canFull && patchDetail({ projectId: e.target.value || null }, "Project updated")} disabled={!canFull} className="!py-1.5"><option value="">None</option>{(projects ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></Field>
              <Field label="Assignee"><Select value={detail.assignedToId ?? ""} onChange={(e) => canFull && patchDetail({ assignedToId: e.target.value || null }, "Assignee updated")} disabled={!canFull} className="!py-1.5"><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
              <Field label="Reporter"><Select value={detail.reporterId ?? ""} onChange={(e) => canFull && patchDetail({ reporterId: e.target.value || null }, "Reporter updated")} disabled={!canFull} className="!py-1.5"><option value="">None</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
              <Field label="Start date"><Input type="date" value={detail.startDate?.slice(0, 10) ?? ""} onChange={(e) => canFull && patchDetail({ startDate: e.target.value || null }, "Start date updated")} disabled={!canFull} /></Field>
              <Field label="Due date"><Input type="date" value={detail.dueDate?.slice(0, 10) ?? ""} onChange={(e) => canFull && patchDetail({ dueDate: e.target.value || null }, "Due date updated")} disabled={!canFull} /></Field>
              <Field label="Estimated hours"><Input type="number" min={0} step={0.5} value={detail.estimatedHours ?? ""} onChange={(e) => canFull && patchDetail({ estimatedHours: e.target.value ? Number(e.target.value) : null }, "Hours updated")} disabled={!canFull} /></Field>
            </div>

            <div>
              <span className="text-[11.5px] font-semibold text-muted-foreground">Additional assignees { !canFull && <span className="ml-1 text-[10px] text-amber-600">(creator/PM only)</span>}</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {users.filter((u) => u.id !== detail.assignedToId).map((u) => {
                  const has = ((detail.assignees ?? []) as any[]).some((a: any) => a.id === u.id);
                  return (
                    <button key={u.id} disabled={!canFull} onClick={() => canFull && patchDetail({ assignees: has ? ((detail.assignees ?? []) as any[]).filter((a: any) => a.id !== u.id) : [...((detail.assignees ?? []) as any[]), { id: u.id, name: u.name }] }, has ? "Assignee removed" : "Assignee added")}
                      className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors", has ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground", !canFull && "opacity-40 cursor-not-allowed")}>{u.name}</button>
                  );
                })}
              </div>
            </div>

            <Field label="Tags" hint={canFull ? "Comma separated" : "View only — creator/PM can edit"}><Input disabled={!canFull} defaultValue={(detail.tags ?? []).join(", ")} onBlur={(e) => canFull && patchDetail({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }, "Tags updated")} placeholder="design, urgent" /></Field>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
              <label className={cn("flex items-center gap-2 text-[12px] font-semibold", canFull ? "cursor-pointer text-muted-foreground" : "cursor-not-allowed opacity-50 text-muted-foreground")}>
                <input type="checkbox" disabled={!canFull} checked={!!detail.isRecurring} onChange={(e) => canFull && patchDetail({ isRecurring: e.target.checked }, e.target.checked ? "Recurring on — next occurrence is created when this is completed" : "Recurring off")} className="size-3.5 accent-primary" /> Recurring
              </label>
              {detail.isRecurring && (
                <Select value={detail.recurrenceSchedule ?? "weekly"} onChange={(e) => canFull && patchDetail({ recurrenceSchedule: e.target.value }, "Schedule updated")} disabled={!canFull} className="!w-32 !py-1">
                  {["daily", "weekly", "monthly", "quarterly", "yearly"].map((s) => (<option key={s} value={s}>{s}</option>))}
                </Select>
              )}
              {detail.isRecurring && detail.status !== "DONE" && <span className="text-[10.5px] text-muted-foreground">next occurrence auto-created on completion</span>}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {([{ key: "overview", label: `Activity (${detail.activityLog?.length ?? 0})` }, { key: "subtasks", label: `Subtasks (${detail.subtasks?.length ?? 0})` }, { key: "comments", label: `Comments (${detail.comments?.length ?? 0})` }, { key: "time", label: `Time Log (${detail.timeLogs?.length ?? 0})` }, { key: "deps", label: `Dependencies (${detail.dependencies?.length ?? 0})` }, { key: "files", label: `Files & Links (${(detail.attachments?.length ?? 0) + (detail.referenceLinks?.length ?? 0)})` }] as const).map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={cn("rounded-xl px-3 py-1.5 text-[11.5px] font-bold transition-all", tab === t.key ? "bg-brand-gradient text-white" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>{t.label}</button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="flex flex-col gap-1.5">
                {(detail.activityLog ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No activity yet.</p>}
                {(detail.activityLog ?? []).map((a: any, i: number) => (
                  <div key={a.id ?? i} className="flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-relaxed">{a.message ?? a.action ?? "Activity"} {a.field && a.to != null ? `· ${label(a.field)} → ${label(String(a.to))}` : ""}</p>
                      <p className="text-[10px] text-muted-foreground/70">{timeAgo(a.createdAt ?? a.at ?? a.loggedAt)} {a.by ? `· ${a.by}` : a.actorName ? `· ${a.actorName}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "subtasks" && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubtask()} placeholder="Add a subtask…" className="flex-1" disabled={!canFull} />
                  <Select value={subAssignee} onChange={(e) => setSubAssignee(e.target.value)} className="!w-36" disabled={!canFull}><option value="">Assignee</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select>
                  <Input type="date" value={subDue} onChange={(e) => setSubDue(e.target.value)} className="!w-36" disabled={!canFull} />
                  <Btn variant="primary" onClick={addSubtask} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                </div>
                {(detail.subtasks ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No subtasks — break this task down.</p>}
                {(detail.subtasks ?? []).map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <button onClick={() => toggleSubtask(s)} title={s.status === "DONE" ? "Reopen" : "Mark done"} className={cn("flex size-4 shrink-0 items-center justify-center rounded-md border transition-colors", s.status === "DONE" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:border-primary/40")}>
                        {s.status === "DONE" && <CheckCircle2 className="size-3" />}
                      </button>
                      <div className="min-w-0">
                        <p className={cn("truncate text-[12.5px] font-medium", s.status === "DONE" && "text-muted-foreground line-through")}>{s.title}</p>
                        <p className="text-[10.5px] text-muted-foreground">{s.assignedTo ? s.assignedTo.name : "Unassigned"}{s.dueDate ? ` · ${formatDay(s.dueDate)}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => moveSubtask(i, -1)} disabled={i === 0} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                      <button onClick={() => moveSubtask(i, 1)} disabled={i >= (detail.subtasks?.length ?? 0) - 1} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                      <button onClick={() => deleteTask(s.id)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "comments" && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder={canProgress || canFull ? "Write a comment…" : "View only — cannot comment"} className="min-h-16" disabled={!canProgress && !canFull} />
                  <Btn variant="primary" onClick={() => postComment()} disabled={!canProgress && !canFull}>Post</Btn>
                </div>
                {(detail.comments ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No comments yet.</p>}
                {(detail.comments ?? []).map((c) => (
                  <CommentItem key={c.id} c={c} replyTo={replyTo} replyText={replyText} setReplyTo={setReplyTo} setReplyText={setReplyText}
                    onPostReply={() => postComment(c.id)} onToggleReaction={(emoji) => toggleReaction(c.id, emoji)} onDelete={() => deleteComment(c.id)} />
                ))}
              </div>
            )}

            {tab === "time" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Timer className="size-4 shrink-0 text-primary" />
                    <span className="font-mono text-[16px] font-bold tabular-nums">{fmtElapsed(elapsed)}</span>
                  </div>
                  {timerOn ? <Btn variant="primary" onClick={stopTimer} disabled={!canProgress && !canFull}>Stop & log</Btn> : <Btn variant="outline" onClick={startTimer} disabled={!canProgress && !canFull}><Play className="size-3.5" /> Start timer</Btn>}
                  <span className="ml-auto text-[10.5px] font-semibold text-muted-foreground">{Number(detail.actualHours ?? 0).toFixed(1)}h total logged</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Date"><Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} disabled={!canProgress && !canFull} /></Field>
                  <Field label="Hours"><Input type="number" min={0} step={0.25} value={logHours} onChange={(e) => setLogHours(e.target.value)} placeholder="1.5" disabled={!canProgress && !canFull} /></Field>
                  <Field label="Note"><Input value={logDesc} onChange={(e) => setLogDesc(e.target.value)} placeholder="Optional" disabled={!canProgress && !canFull} /></Field>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className={cn("flex items-center gap-2 text-[12px] font-semibold", canProgress || canFull ? "cursor-pointer text-muted-foreground" : "cursor-not-allowed opacity-50 text-muted-foreground")}>
                    <input type="checkbox" checked={logBillable} onChange={(e) => (canProgress || canFull) && setLogBillable(e.target.checked)} disabled={!canProgress && !canFull} className="size-3.5 accent-primary" /> Billable
                  </label>
                  <Btn variant="primary" onClick={addTimeLog} disabled={!canProgress && !canFull}><Plus className="size-3.5" /> Add log</Btn>
                </div>
                {(detail.timeLogs ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No time logged yet.</p>}
                {(detail.timeLogs ?? []).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold tabular-nums">{formatDate(l.date)} · {l.hours}h</p>
                      {l.description && <p className="truncate text-[11px] text-muted-foreground">{l.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {l.isBillable !== false && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">billable</span>}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{l.loggedVia ?? "MANUAL"}</span>
                      <button onClick={() => deleteLog(l.id)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "deps" && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Select value={depType} onChange={(e) => setDepType(e.target.value)} className="!w-32" disabled={!canFull}>
                    <option value="blocked-by">blocked by</option>
                    <option value="blocks">blocks</option>
                    <option value="related">related to</option>
                  </Select>
                  <Select value={depId} onChange={(e) => setDepId(e.target.value)} disabled={!canFull}><option value="">Pick a task…</option>{(tasks ?? []).filter((t) => t.id !== detail.id).map((t) => (<option key={t.id} value={t.id}>{t.title}</option>))}</Select>
                  <Btn variant="primary" onClick={addDependency} disabled={!canFull}><Link2 className="size-3.5" /> Add</Btn>
                </div>
                {(detail.dependencies ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No dependencies — this task can start anytime.</p>}
                {(detail.dependencies ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <p className="flex min-w-0 items-center gap-2 truncate text-[12px] font-medium">
                      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold", d.type === "blocks" ? "bg-amber-500/15 text-amber-400" : d.type === "related" ? "bg-sky-500/15 text-sky-400" : "bg-rose-500/15 text-rose-400")}>{d.type ?? "blocked-by"}</span>
                      <span className="truncate">{d.dependsOnTask.title}</span>
                    </p>
                    <button onClick={() => removeDependency(d)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
                {(detail.dependents ?? []).length > 0 && (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Blocks these tasks</span>
                    {(detail.dependents ?? []).map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/40 px-3 py-2">
                        <p className="flex min-w-0 items-center gap-2 truncate text-[12px] font-medium">
                          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{d.task.title}</span>
                          <StatusBadge status={d.task.status} />
                        </p>
                        <button onClick={() => removeDependency(d)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "files" && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11.5px] font-semibold text-muted-foreground">Attachments ({(detail.attachments ?? []).length}) { !canFull && <span className="ml-1 text-[10px] text-amber-600">(view only)</span>}</span>
                    <button disabled={!canFull} onClick={() => canFull && fileRef.current?.click()} className={cn("flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-[11.5px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground", !canFull && "opacity-40 cursor-not-allowed") }><Upload className="size-3.5" /> Upload</button>
                    <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
                  </div>
                  {(detail.attachments ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No attachments.</p>}
                  <div className="flex flex-col gap-1.5">
                    {((detail.attachments ?? []) as any[]).map((att) => (
                      <div key={att.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        {fileIcon(att.type)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium">{att.name}</p>
                          <p className="text-[10.5px] text-muted-foreground">{att.size}{att.uploadedByName ? ` · ${att.uploadedByName}` : ""}</p>
                        </div>
                        <a href={att.url} target="_blank" rel="noreferrer" title="Open" className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"><ExternalLink className="size-3.5" /></a>
                        <button disabled={!canFull} onClick={() => canFull && removeAttachment(att.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "opacity-40 cursor-not-allowed")}><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-2 block text-[11.5px] font-semibold text-muted-foreground">Reference links ({(detail.referenceLinks ?? []).length})</span>
                  <div className="flex gap-2">
                    <Input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="Title (optional)" disabled={!canFull} />
                    <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} placeholder="https://…" disabled={!canFull} />
                    <Btn variant="primary" onClick={addLink} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                  </div>
                  {(detail.referenceLinks ?? []).length === 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">No links — add design docs, PRs, requirements…</p>}
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {((detail.referenceLinks ?? []) as any[]).map((l) => (
                      <div key={l.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <p className="min-w-0 flex-1 truncate text-[12px] font-medium">{l.title}</p>
                        <a href={l.url} target="_blank" rel="noreferrer" className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"><ExternalLink className="size-3.5" /></a>
                        <button disabled={!canFull} onClick={() => canFull && removeLink(l.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "opacity-40 cursor-not-allowed")}><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-2 block text-[11.5px] font-semibold text-muted-foreground">Custom fields ({(detail.customFields ?? []).length})</span>
                  <div className="flex gap-2">
                    <Input value={cfKey} onChange={(e) => setCfKey(e.target.value)} placeholder="Key, e.g. severity" disabled={!canFull} />
                    <Input value={cfValue} onChange={(e) => setCfValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addField()} placeholder="Value" disabled={!canFull} />
                    <Btn variant="primary" onClick={addField} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                  </div>
                  {(detail.customFields ?? []).length === 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">No custom fields.</p>}
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {((detail.customFields ?? []) as any[]).map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                        <p className="min-w-0 truncate text-[12px] font-medium"><span className="font-bold text-primary">{f.key}</span><span className="mx-1.5 text-muted-foreground/50">·</span>{f.value || "—"}</p>
                        <button disabled={!canFull} onClick={() => canFull && removeField(f.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "opacity-40 cursor-not-allowed")}><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )})())}
      </Modal>
    </div>
  );
}