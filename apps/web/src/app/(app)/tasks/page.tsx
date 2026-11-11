"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlarmClock, Archive, ArrowRight, ArrowUp, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Copy, ExternalLink, FileText, Flame, FolderKanban, GitBranch, Link2, ListTodo, MessageSquare, MoreHorizontal, Paperclip, Play,
  Plus, Pencil, RefreshCw, Search, Save, Settings2, ShieldAlert, SlidersHorizontal, Smile, Timer, Trash2, Upload, UserRound, X, Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { formatDay, formatDate, timeAgo } from "@/lib/format";
import { Avatar, CardShell, EmptyState, FadeIn, PageHeader, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Drawer, Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { ChecklistTab, TaskTimerButton, TimerPill } from "@/components/tasks/task-ops";
import { TaskTimerProvider } from "@/components/tasks/timer-context";
import { TaskContextSidebar } from "@/components/tasks/task-context-sidebar";
import { SprintBurndownCard, SprintPicker, type Sprint } from "@/components/tasks/sprint";
import { SavedViewBar, type SavedView } from "@/components/tasks/saved-views";
import {
  BOARD_COLUMNS,
  GANTT_BAR,
  PRIORITIES,
  PRIORITY_META,
  TASK_STATUSES,
  TASK_STATUS_META,
  TASK_STATUS_OPTS,
  TASK_TYPES,
  TASK_TYPE_META,
  label,
  normalizeStatus,
  statusLabel,
} from "@/components/tasks/domain";

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
  sprintId?: string | null;
  sprint?: { id: string; name: string; status: string } | null;
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
  project?: { id: string; name: string; client?: { id: string; companyName: string } | null } | null;
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
  assignedBy?: { id: string; name: string; roleTitle?: string } | null;
  assignedAt?: string | null;
  deliverable?: { id: string; title: string; status: string } | null;
  sprint?: { id: string; name: string; status: string; startDate: string; endDate: string } | null;
  checklist?: { id: string; content: string; done: boolean }[];
  _permissions?: { canView: boolean; canEditFull: boolean; canEditProgress: boolean };
};
type Stats = { total?: number; open?: number; done?: number; inProgress?: number; overdue?: number; dueToday?: number; highPriority?: number; review?: number; blocked?: number; hoursThisWeek?: number };
type UserLite = { id: string; name: string; roleTitle?: string };
type ProjectLite = { id: string; name: string };
const SWIMLANES = [
  { value: "none", label: "No lanes" },
  { value: "project", label: "By project" },
  { value: "assignee", label: "By assignee" },
  { value: "priority", label: "By priority" },
];
const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👏", "🚀"];
/** Base tone per priority / type — the canonical maps live in ./domain. */
const PRIORITY_TONES: Record<string, string> = Object.fromEntries(
  PRIORITIES.map((p) => [p, PRIORITY_META[p].tone])
);
const TYPE_TONES: Record<string, string> = Object.fromEntries(
  TASK_TYPES.map((t) => [t, TASK_TYPE_META[t].tone])
);
/** Status pill colour by real status — legacy values are normalised first. */
const STATUS_CHIP: Record<string, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s, TASK_STATUS_META[s].chip])
);
const chipFor = (status?: string | null) => STATUS_CHIP[normalizeStatus(status)];
const pad = (n: number) => String(n).padStart(2, "0");
const localKey = (d: string | Date) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const todayKey = () => localKey(new Date());
const fmtElapsed = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fileIcon = (type?: string) => {
  const t = (type ?? "").toLowerCase();
  if (t.includes("image")) return <span className="shrink-0 rounded-lg bg-sky-500/15 p-1.5 text-sky-400"><CalendarDays className="size-3.5" /></span>;
  if (t.includes("pdf")) return <span className="shrink-0 rounded-lg bg-rose-500/15 p-1.5 text-rose-400"><FileText className="size-3.5" /></span>;
  if (t.includes("video")) return <span className="shrink-0 rounded-lg bg-primary/15 p-1.5 text-primary"><Play className="size-3.5" /></span>;
  if (t.includes("sheet") || t.includes("csv")) return <span className="shrink-0 rounded-lg bg-emerald-500/15 p-1.5 text-emerald-400"><FileText className="size-3.5" /></span>;
  return <span className="shrink-0 rounded-lg bg-muted p-1.5 text-muted-foreground"><Paperclip className="size-3.5" /></span>;
};

/** Compact "label 12" pair used in the slim summary strip under the header. */
function SummaryStat({
  label: text,
  value,
  tone,
  strong,
}: {
  label: string;
  value?: number | null;
  tone?: string;
  strong?: boolean;
}) {
  const n = value ?? 0;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("text-body-lg font-bold tabular-nums", strong && n > 0 ? "text-rose-500" : tone ?? "text-foreground")}>
        {value ?? "—"}
      </span>
      <span className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{text}</span>
    </span>
  );
}

/** Small icon + number tile used in the task detail summary strip. */
function MiniStat({
  icon,
  label: text,
  value,
  tone = "bg-muted text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{text}</p>
        <p className="truncate text-body font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

/** Small toggle used in the filter bar (My Day). */
function PillButton({ active, onClick, label: text }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-meta font-bold transition-colors",
        active ? "bg-brand-gradient text-white" : "border border-border text-muted-foreground hover:text-foreground"
      )}
    >
      <Zap className="size-3.5" /> {text}
    </button>
  );
}

/** Removable chip showing one active filter. */
function FilterChip({ label: text, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-micro font-bold capitalize text-primary">
      {text}
      <button onClick={onClear} title="Remove filter" className="rounded-full p-0.5 transition-colors hover:bg-primary/20">
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function CommentItem({ c, replyTo, replyText, setReplyTo, setReplyText, onPostReply, onToggleReaction, onDelete, currentUserId }: {
  c: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[];
       replies?: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[] }[] };
  replyTo: string | null; replyText: string;
  setReplyTo: (v: string | null) => void; setReplyText: (v: string) => void;
  onPostReply: () => void; onToggleReaction: (emoji: string) => void; onDelete: () => void;
  currentUserId: string;
}) {
  const [picker, setPicker] = useState(false);
  const body = (cc: { id: string; content: string; createdAt?: string; author?: { id: string; name: string } | null; reactions?: { emoji: string; userIds: string[] }[] }, isReply: boolean) => (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2.5", isReply && "border-border/40 bg-muted/20")}>
      <Avatar name={cc.author?.name ?? "?"} size="size-7" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-meta font-semibold">{cc.author?.name ?? "System"}<span className="text-micro font-normal text-muted-foreground/70">{timeAgo(cc.createdAt)}</span></p>
        <p className="mt-0.5 whitespace-pre-wrap text-body leading-relaxed">{cc.content}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(cc.reactions ?? []).map((r) => {
            const mine = (r.userIds ?? []).includes(currentUserId);
            return (
              <button key={r.emoji} onClick={() => onToggleReaction(r.emoji)} className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold transition-colors", mine ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/30")}>
                <span>{r.emoji}</span><span className="tabular-nums">{(r.userIds ?? []).length}</span>
              </button>
            );
          })}
          <button onClick={() => setPicker((v) => !v)} className={cn("flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground", picker && "border-primary/50 text-primary")} title="React"><Smile className="size-3.5" /></button>
          {!isReply && (
            <button onClick={() => setReplyTo(replyTo === cc.id ? null : cc.id)} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-micro font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"><MessageSquare className="size-3.5" /> Reply</button>
          )}
          <button onClick={onDelete} className="flex size-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete"><Trash2 className="size-3.5" /></button>
        </div>
        {picker && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {REACTION_EMOJIS.map((emo) => (
              <button key={emo} onClick={() => { onToggleReaction(emo); setPicker(false); }} className="flex size-7 items-center justify-center rounded-lg border border-border text-body-lg transition-all hover:scale-110 hover:border-primary/40">{emo}</button>
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
            <span className="flex size-6 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" aria-label="Select task" checked={selected} onChange={(e) => { e.stopPropagation(); onSelect(); }} className="size-4 accent-primary" />
            </span>
            {hasChildren && (
              <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted">
                <ChevronDown className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} />
              </button>
            )}
          </div>
        </Td>
        <Td className="max-w-[190px] whitespace-normal">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="max-w-44 truncate font-semibold leading-none">{t.title}</p>
              {t.isBlocked && <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-micro font-bold text-rose-400">BLOCKED</span>}
              {t.parentTaskId && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro font-semibold text-muted-foreground">subtask</span>}
              {t.isClientVisible && <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-micro font-bold text-sky-400">client</span>}
              <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                <TaskTimerButton taskId={t.id} compact onChanged={onChanged} />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.project?.name ? <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-micro font-semibold text-muted-foreground lg:hidden"><FolderKanban className="size-3.5" />{t.project.name}</span> : <span className="text-micro text-muted-foreground/50 lg:hidden">No project</span>}
              {t.dueDate && <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold lg:hidden", overdue ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}><CalendarDays className="size-3.5" />{dueLabel}</span>}
              {(t.estimatedHours != null || t.actualHours != null) && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold tabular-nums text-primary"><Timer className="size-3.5" />{Number(t.actualHours ?? 0).toFixed(1)}/{t.estimatedHours ?? "—"}h</span>}
              <span className="hidden items-center gap-1 text-micro tabular-nums text-muted-foreground group-hover:inline-flex"><MessageSquare className="size-3.5" />{t._count?.comments ?? 0} · <Timer className="size-3.5" />{t._count?.timeLogs ?? 0}{t.subtaskCount ? <> · <ListTodo className="size-3.5" />{t.subtaskCount}</> : null}</span>
            </div>
          </div>
        </Td>
        <Td className="hidden md:table-cell">{t.taskType ? <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold capitalize", TYPE_TONES[t.taskType] ?? TYPE_TONES.general)}><span className="size-1.5 rounded-full bg-current opacity-60" />{t.taskType}</span> : <span className="text-muted-foreground/50">—</span>}</Td>
        <Td><StatusBadge status={t.status} /></Td>
        <Td className="hidden sm:table-cell">
          <Select aria-label={`Priority for ${t.title}`} value={t.priority} onChange={(e) => { e.stopPropagation(); apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ priority: e.target.value }) }).then(() => onChanged()).catch(() => {}); }} className="!w-28 !py-1" onClick={(e) => e.stopPropagation()}>
            {PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
          </Select>
        </Td>
        <Td className={cn("hidden font-medium tabular-nums text-body sm:table-cell", overdue ? "text-rose-500" : "text-muted-foreground")}>{dueLabel}</Td>
        <Td className="hidden sm:table-cell">
          <div className="flex items-center gap-2">
            {t.assignedTo?.name ? <><Avatar name={t.assignedTo.name} size="size-6" /><span className="max-w-20 truncate text-body font-medium">{t.assignedTo.name}</span></> : <span className="flex items-center gap-1.5 text-muted-foreground"><span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border"><UserRound className="size-3.5" /></span>Unassigned</span>}
          </div>
        </Td>
        <Td className="hidden lg:table-cell">
          {t.project?.name ? <span className="inline-flex max-w-20 items-center gap-1.5 truncate rounded-full border border-border/60 bg-card px-2.5 py-1 text-meta font-semibold"><FolderKanban className="size-4 shrink-0 text-muted-foreground" />{t.project.name}</span> : <span className="text-muted-foreground">—</span>}
        </Td>
      </Tr>
      {expanded && hasChildren && childrenList.map((c, ci) => renderChild(c, ci))}
    </>
  );
}

export default function TasksPage() {
  return (
    <TaskTimerProvider>
      <TasksPageInner />
    </TaskTimerProvider>
  );
}

function TasksPageInner() {
  const [refresh, setRefresh] = useState(0);
  const [aux, setAux] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const [flash, setFlash] = useState<string | null>(null);
  const notify = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 3000); };
  const [view, setView] = useState<"board" | "list" | "calendar" | "gantt">("list");
  const [swimlane, setSwimlane] = useState("none");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fType, setFType] = useState("");
  const [fProject, setFProject] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [sort, setSort] = useState("due");
  const [mine, setMine] = useState(false);
  const [myDayOnly, setMyDayOnly] = useState(false);
  const [fSprint, setFSprint] = useState("");
  const [activeViewId, setActiveViewId] = useState("");
  /** Advanced filters are collapsed by default — see the filter-bar notes below. */
  const [advanced, setAdvanced] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: stats } = useApi<Stats>("/tasks/stats");
  const { data: employees } = useApi<UserLite[]>("/people/employees");
  const users = employees ?? [];
  const { data: projects } = useApi<ProjectLite[]>("/flow/projects");
  const { data: myDay } = useApi<any[]>(`/tasks/my-day?v=${aux}`);
  const { data: sprints } = useApi<Sprint[]>(`/tasks/sprints?v=${aux}`);
  const { data: savedViews } = useApi<SavedView[]>(`/tasks/views?v=${aux}`);
  // The signed-in user already comes from the shell (`/auth/me`); asking again
  // added a round trip to every Tasks visit.
  const { user: me } = useAuth();
  // Mirrors the backend isPM() rule: sprint/template/automation authoring
  // reshapes everyone's plan, so only planners see those controls.
  const canPlan = !!me && ["Owner", "Admin", "HR/Admin", "Project Manager"].includes(me.roleName ?? "");

  // Search is debounced: typing "invoice" used to fire seven full list queries.
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const activeSprint = (sprints ?? []).find((s) => s.id === fSprint) ?? null;
  /** How many advanced filters are on — drives the "Filters (n)" badge and chips. */
  const activeFilterCount = [fStatus, fPriority, fType, fProject, fAssignee].filter(Boolean).length;

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [reloadTasks, setReloadTasks] = useState(0);

  /**
   * Keyboard-first, mouse-optional — the one habit that makes a task tool feel
   * fast. Deliberately tiny: `c` create, `/` search, `Esc` close. Nothing fires
   * while the user is typing in a field.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && !typing) {
        setSelectedId(null);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "c" || e.key === "n") {
        e.preventDefault();
        setEditTask(null);
        setFormOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dq) p.set("q", dq);
    if (fStatus) p.set("status", fStatus);
    if (fPriority) p.set("priority", fPriority);
    if (fType) p.set("taskType", fType);
    if (fProject) p.set("projectId", fProject);
    if (fAssignee) p.set("assignee", fAssignee);
    if (fSprint) p.set("sprintId", fSprint);
    if (mine) p.set("mine", "true");
    p.set("sort", sort);
    return p.toString();
  }, [dq, fStatus, fPriority, fType, fProject, fAssignee, fSprint, mine, sort]);
  useEffect(() => {
    let cancelled = false;
    setTasksErr(null);
    apiFetch<TaskRow[]>(`/tasks${query ? `?${query}` : ""}`)
      .then((d) => !cancelled && setTasks(d))
      .catch((e) => !cancelled && setTasksErr(e.message));
    return () => { cancelled = true; };
  }, [query, refresh, reloadTasks]);

  // ── Deep links from notifications (?task=<id>) ───────────────────────
  // Two effects, declared in this order on purpose: the cleanup runs BEFORE the
  // opener on the first render, so a fresh ?task= link is not stripped before
  // the drawer has had a chance to open it.
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskParam = searchParams.get("task");
  const taskOpened = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId) {
      taskOpened.current = true;
      return;
    }
    if (!taskOpened.current) return;
    // Drawer closed: drop ?task= so the same notification can re-open it.
    taskOpened.current = false;
    const p = new URLSearchParams(window.location.search);
    if (!p.has("task")) return;
    p.delete("task");
    router.replace(`/tasks${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [selectedId, router]);
  useEffect(() => {
    if (taskParam) setSelectedId(taskParam);
  }, [taskParam]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [descEdit, setDescEdit] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  // Opens on Overview — a task should introduce itself, not the project panel.
  const [tab, setTab] = useState<"overview" | "checklist" | "subtasks" | "comments" | "time" | "deps" | "files">("overview");
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(null); setTab("overview"); setDescEdit(false); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDescEdit(false);
    apiFetch<TaskDetail>(`/tasks/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => { if (!cancelled) { setDetailError(e.message ?? "Failed to load"); setDetail(null); } })
      .finally(() => !cancelled && setDetailLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);

  const patchDetail = async (patch: any, msg?: string) => {
    if (!selectedId) return;
    setBusy(true);
    try { await apiFetch(`/tasks/${selectedId}`, { method: "PATCH", body: JSON.stringify(patch) }); if (msg) notify(msg); reload(); }
    catch (e: any) { notify(e.message ?? "Save failed"); } finally { setBusy(false); }
  };
  const changeStatus = (s: string) => {
    if (!selectedId || s === detail?.status) return;
    // Optimistic: paint the new status immediately, roll back only if the
    // server rejects it. Waiting for a full list refetch made every status
    // change feel slow.
    const prev = detail?.status;
    setDetail((d) => (d ? { ...d, status: s } : d));
    apiFetch(`/tasks/${selectedId}/status`, { method: "PATCH", body: JSON.stringify({ status: s }) })
      .then(() => { notify(`Moved to ${label(s)}`); reload(); })
      .catch((e: any) => {
        if (prev) setDetail((d) => (d ? { ...d, status: prev } : d));
        notify(e.message ?? "Move failed");
      });
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
    try { await apiFetch(`/tasks/${selectedId}/comments/${commentId}/reactions`, { method: "PATCH", body: JSON.stringify({ emoji }) }); reload(); }
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


  const myDayIds = useMemo(() => new Set((myDay ?? []).map((t: any) => t.id ?? t.taskId)), [myDay]);
  const shownTasks = useMemo(() => {
    let list = tasks ?? [];
    if (myDayOnly) list = list.filter((t) => myDayIds.has(t.id));
    return list;
  }, [tasks, myDayOnly, myDayIds]);

  // ── Board (lanes + order + DnD) ──────────────────────────────────────
  const laneKeyOf = (t: TaskRow) => swimlane === "project" ? (t.project?.name ?? "No project")
    : swimlane === "assignee" ? (t.assignedTo?.name ?? "Unassigned")
      : swimlane === "priority" ? (t.priority ?? "MEDIUM")
        : swimlane === "status" ? (t.status ?? "TODO")
          : swimlane === "tag" ? (t.tags?.[0] ?? "untagged")
            : "all";
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
    const id = dragId;
    const k = `${status}|${lane}`;
    const prevStatus = (tasks ?? []).find((t) => t.id === id)?.status;
    // Move the card in local state first so the board responds instantly.
    setTasks((prev) => (prev ? prev.map((t) => (t.id === id ? { ...t, status } : t)) : prev));
    apiFetch(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
      .then(() => {
        setLaneOrder((prev) => {
          const next: Record<string, string[]> = {};
          Object.keys(prev).forEach((kk) => {
            if (kk === k) return;
            if (prev[kk].includes(id)) next[kk] = prev[kk].filter((x) => x !== id);
            else next[kk] = prev[kk];
          });
          next[k] = [id, ...(prev[k] ?? []).filter((x) => x !== id)];
          return next;
        });
        notify(`Moved to ${label(status)}`);
        reload();
      })
      .catch((e: any) => {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === id ? { ...t, status: prevStatus ?? t.status } : t)) : prev));
        notify(e.message ?? "Move failed");
      })
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
  /** Bulk due date is staged, not applied on pick — a stray click used to move
   *  every selected task's deadline. */
  const [bulkDue, setBulkDue] = useState("");
  useEffect(() => { if (!selected.length) setBulkDue(""); }, [selected.length]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = selected.length > 0 && (shownTasks ?? []).length > 0 && selected.length === shownTasks.filter((t) => !t.parentTaskId).length;

  /**
   * Bulk operations now hit the single /tasks/bulk endpoint so the server can
   * permission-check each task and report how many were skipped, instead of
   * firing N parallel PATCHes and failing the whole batch on one 403.
   */
  const bulkRun = async (op: string, value: any, msg: string) => {
    if (!selected.length) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ affected: number; skipped: number }>("/tasks/bulk", {
        method: "POST",
        body: JSON.stringify({ ids: selected, op, value }),
      });
      notify(res.skipped ? `${msg} — ${res.affected} done, ${res.skipped} skipped (no permission)` : `${msg} (${res.affected})`);
      setSelected([]);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkDelete = async () => {
    if (!selected.length || !window.confirm(`Delete ${selected.length} task(s)? This cannot be undone.`)) return;
    await bulkRun("delete", null, "Tasks deleted");
  };
  const childMap = useMemo(() => {
    const m: Record<string, TaskRow[]> = {};
    (tasks ?? []).forEach((t) => { if (t.parentTaskId) (m[t.parentTaskId] = m[t.parentTaskId] ?? []).push(t); });
    return m;
  }, [tasks]);

  // ── Calendar ─────────────────────────────────────────────────────────
  const [cal, setCal] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });
  const calCells = useMemo(() => {
    const first = new Date(cal.y, cal.m, 1);
    const startDow = first.getDay();
    const days = new Date(cal.y, cal.m + 1, 0).getDate();
    const prevDays = new Date(cal.y, cal.m, 0).getDate();
    const cells: { key: string; day: number; inMonth: boolean; dateKey: string }[] = [];
    for (let i = startDow - 1; i >= 0; i--) cells.push({ key: `p${i}`, day: prevDays - i, inMonth: false, dateKey: "" });
    for (let d = 1; d <= days; d++) cells.push({ key: `${cal.y}-${cal.m}-${d}`, day: d, inMonth: true, dateKey: `${cal.y}-${pad(cal.m + 1)}-${pad(d)}` });
    let nx = 1;
    while (cells.length % 7 !== 0) cells.push({ key: `n${nx}`, day: nx++, inMonth: false, dateKey: "" });
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
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      cells.push({ key: localKey(d), day: d.getDate(), dateKey: localKey(d), inMonth: d.getMonth() === cal.m });
    }
    return cells;
  }, [weekStart, cal.m]);
  const weekLabel = `${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  const shiftCalendar = (dir: number) => {
    if (calMode === "week") {
      setWeekStart((prev) => {
        const d = new Date(prev);
        d.setDate(d.getDate() + dir * 7);
        return d;
      });
      return;
    }
    setCal((prev) => ({ y: prev.y + (prev.m === 0 && dir < 0 ? -1 : prev.m === 11 && dir > 0 ? 1 : 0), m: (prev.m + dir + 12) % 12 }));
  };
  const goToday = () => {
    const d = new Date();
    setCal({ y: d.getFullYear(), m: d.getMonth() });
    const w = new Date();
    w.setHours(0, 0, 0, 0);
    w.setDate(w.getDate() - w.getDay());
    setWeekStart(w);
  };

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
      <span className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-bold", k === today ? "bg-amber-500/15 text-amber-400" : k < today ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}>
        <CalendarDays className="size-3.5" />{k === today ? "today" : formatDay(t.dueDate)}
      </span>
    );
  };

  const cardMenu = (t: TaskRow) => menuFor === t.id && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
      <div className="absolute right-2 top-9 z-50 w-40 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl shadow-black/20">
        <button onClick={() => { copyLink(t.id); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta font-semibold transition-colors hover:bg-muted"><Link2 className="size-4 text-muted-foreground" /> Copy link</button>
        <button onClick={() => { moveToTop(t); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta font-semibold transition-colors hover:bg-muted"><ArrowUp className="size-3.5 text-muted-foreground" /> Move to top</button>
        <button onClick={() => { apiFetch(`/tasks/${t.id}/clone`, { method: "POST" }).then(() => { notify("Task cloned"); reload(); }).catch((e: any) => notify(e.message ?? "Failed")); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta font-semibold transition-colors hover:bg-muted"><Copy className="size-3.5 text-muted-foreground" /> Clone</button>
        <button onClick={() => { deleteTask(t.id); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta font-semibold text-rose-400 transition-colors hover:bg-rose-500/10"><Trash2 className="size-3.5" /> Delete</button>
      </div>
    </>
  );

  const assigneeStack = (t: TaskRow) => {
    const all = [t.assignedTo ? { name: t.assignedTo.name } : null, ...((t.assignees ?? []) as any[]).map((a: any) => ({ name: a.name }))].filter(Boolean);
    if (!all.length) return <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"><UserRound className="size-3.5" /></span>;
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
        <div className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", t.project?.name ? "border-border/60 bg-muted/40" : "border-dashed border-border bg-transparent")}>
            <FolderKanban className="size-3.5" />{t.project?.name ?? "No project"}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold capitalize" style={{ borderColor: "var(--border)" }}><span className={cn("size-1.5 rounded-full", TYPE_TONES[t.taskType ?? "general"]?.includes("rose") ? "bg-rose-400" : TYPE_TONES[t.taskType ?? "general"]?.includes("primary") ? "bg-primary" : "bg-muted-foreground")} />{t.taskType ?? "general"}</span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 line-clamp-2 flex-1 text-body font-bold leading-snug">{t.title}</p>
          <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
            <TaskTimerButton taskId={t.id} compact onChanged={reload} />
            <button onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted group-hover:text-foreground"><MoreHorizontal className="size-3.5" /></button>
          </div>
        </div>
        {cardMenu(t)}
        {t.description && <p className="mt-1 line-clamp-2 text-meta leading-relaxed text-muted-foreground/80">{t.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {t.priority && <span className={cn("rounded-full border px-2 py-0.5 text-micro font-bold tracking-wide", PRIORITY_TONES[t.priority] ?? PRIORITY_TONES.MEDIUM)}>{t.priority}</span>}
          {dueBadge(t)}
          {t.isBlocked && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-micro font-bold text-rose-400">BLOCKED</span>}
          {t.isClientVisible && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-micro font-bold text-sky-400">client</span>}
          {t.parentTaskId && <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold text-muted-foreground">subtask</span>}
        </div>
        {/* Hours progress — hierarchy */}
        {(t.estimatedHours != null || t.actualHours != null) && progress !== null && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", Number(t.actualHours ?? 0) > Number(t.estimatedHours ?? 0) ? "bg-rose-500" : "bg-primary")} style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 text-micro font-bold tabular-nums text-muted-foreground">{Number(t.actualHours ?? 0).toFixed(1)}/{t.estimatedHours ?? "—"}h</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {(t.tags ?? []).slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-semibold text-primary">#{tag}</span>)}
            {(t.tags ?? []).length > 2 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-semibold text-muted-foreground">+{(t.tags ?? []).length - 2}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground"><MessageSquare className="size-3.5" />{t._count?.comments ?? 0}</span>
            <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground"><Timer className="size-3.5" />{t._count?.timeLogs ?? 0}</span>
            {(t.subtaskCount ?? 0) > 0 && <span className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground"><ListTodo className="size-3.5" />{t.subtaskCount}</span>}
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
        <span className="text-meta font-semibold text-muted-foreground">{shownTasks.length} tasks</span>
      </div>
      {swimlane === "none" ? (
        <div className="-mx-3 snap-x snap-mandatory overflow-x-auto px-3 pb-2 sm:-mx-0 sm:px-0 lg:overflow-visible">
          <div className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-5">
            {BOARD_COLUMNS.map((col) => {
              const items = tasksIn(col.key, "all");
              return (
                <div key={col.key} className="flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col sm:w-[280px] lg:w-auto lg:max-w-none lg:min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={() => dropTask(col.key, "all")}>
                  <div className={cn("mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-2", dragId && "border-dashed")}>
                    <span className="flex items-center gap-2 text-meta font-bold"><span className={cn("size-2 rounded-full", col.dot)} />{col.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold tabular-nums text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.length === 0 && <p className="px-2 py-3 text-center text-meta text-muted-foreground/60">{dragId ? "Drop here" : "No tasks"}</p>}
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
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-meta font-bold text-primary">{lane}</span>
                <span className="text-micro font-semibold text-muted-foreground">{shownTasks.filter((t) => laneKeyOf(t) === lane).length} tasks</span>
              </div>
              <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:overflow-visible lg:px-0">
                <div className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-5">
                  {BOARD_COLUMNS.map((col) => {
                    const items = tasksIn(col.key, lane);
                    return (
                      <div key={col.key} className="flex w-[280px] shrink-0 flex-col lg:w-auto lg:min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={() => dropTask(col.key, lane)}>
                        <div className={cn("mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-2", dragId && "border-dashed")}>
                          <span className="flex items-center gap-2 text-meta font-bold"><span className={cn("size-2 rounded-full", col.dot)} />{col.label}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold tabular-nums text-muted-foreground">{items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {items.length === 0 && <p className="px-2 py-3 text-center text-meta text-muted-foreground/60">{dragId ? "Drop here" : "No tasks"}</p>}
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
          <span className="text-meta font-bold text-primary">{selected.length} selected</span>
          {bulkBusy && <RefreshCw className="size-3.5 animate-spin text-primary" />}
          <Select aria-label="Bulk change status" value="" disabled={bulkBusy} onChange={(e) => e.target.value && bulkRun("status", e.target.value, `Moved ${selected.length} task(s)`)} className="!w-36 !py-1.5"><option value="">Move to…</option>{TASK_STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select>
          <Select aria-label="Bulk change priority" value="" disabled={bulkBusy} onChange={(e) => e.target.value && bulkRun("priority", e.target.value, `Priority updated`)} className="!w-32 !py-1.5"><option value="">Priority…</option>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
          <Select aria-label="Bulk assign" value="" disabled={bulkBusy} onChange={(e) => e.target.value && bulkRun("assign", e.target.value, "Assignees updated")} className="!w-40 !py-1.5"><option value="">Assign to…</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select>
          <label className="flex items-center gap-1.5 text-meta font-semibold text-muted-foreground">
            Due
            <input
              type="date"
              aria-label="Bulk due date"
              value={bulkDue}
              disabled={bulkBusy}
              onChange={(e) => setBulkDue(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-meta outline-none focus:border-primary/40"
            />
          </label>
          <Btn
            variant="outline"
            disabled={bulkBusy || !bulkDue}
            onClick={async () => { await bulkRun("dueDate", bulkDue, "Due dates updated"); setBulkDue(""); }}
            className="!py-1.5"
          >
            Apply
          </Btn>
          <Btn
            variant="outline"
            disabled={bulkBusy}
            onClick={() => { if (window.confirm(`Archive ${selected.length} task(s)? They will leave the board.`)) bulkRun("archive", null, "Archived"); }}
            className="!py-1.5"
          >
            Archive
          </Btn>
          <Btn variant="ghost" disabled={bulkBusy} onClick={bulkDelete} className="bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"><Trash2 className="size-3.5" /> Delete</Btn>
          <button onClick={() => setSelected([])} className="flex items-center gap-1 text-meta font-bold text-primary hover:text-primary"><X className="size-3.5" /> clear</button>
        </div>
      )}
      <TableShell footer={shownTasks.length > 0 ? <span className="text-meta text-muted-foreground">{shownTasks.length} tasks</span> : undefined}>
        <table className="w-full">
          <THead>
            <Th><span className="flex size-6 items-center justify-center"><input type="checkbox" aria-label="Select all tasks" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? (shownTasks ?? []).filter((t) => !t.parentTaskId).map((t) => t.id) : [])} className="size-4 accent-primary" /></span></Th>
            <Th className="max-w-[190px] whitespace-normal">Title</Th><Th className="hidden md:table-cell">Type</Th><Th>Status</Th><Th className="hidden sm:table-cell">Priority</Th><Th className="hidden sm:table-cell">Due</Th><Th className="hidden sm:table-cell">Assignee</Th><Th className="hidden lg:table-cell">Project</Th>
          </THead>
          <tbody>
            {shownTasks.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="text-body-lg font-bold">No tasks match</p>
                  <p className="mt-1 text-meta text-muted-foreground">
                    Loosen a filter, or{" "}
                    <button onClick={() => { setEditTask(null); setFormOpen(true); }} className="font-bold text-primary hover:underline">
                      create a task
                    </button>
                    .
                  </p>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => { setFStatus(""); setFPriority(""); setFType(""); setFProject(""); setFAssignee(""); setQ(""); }}
                      className="mt-2 rounded-xl border border-border px-3 py-1.5 text-meta font-bold text-muted-foreground hover:text-foreground"
                    >
                      Clear all filters
                    </button>
                  )}
                </td>
              </tr>
            )}
            {shownTasks.filter((t) => !t.parentTaskId).map((t, i) => (
              <FragmentRow key={t.id} t={t} i={i} expanded={expanded.has(t.id)} hasChildren={(childMap[t.id] ?? []).length > 0} childrenList={childMap[t.id] ?? []}
                onToggleExpand={() => toggleExpand(t.id)} selected={selected.includes(t.id)} onSelect={() => toggleSelect(t.id)}
                onOpen={() => setSelectedId(t.id)} onChanged={reload}
                renderChild={(c, ci) => (
                  <Tr key={c.id} index={ci} onClick={() => setSelectedId(c.id)} className="cursor-pointer">
                    <Td />
                    <Td className="max-w-[160px] whitespace-normal">
                      <div className="flex items-center gap-1.5 pl-6">
                        <GitBranch className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <p className="max-w-52 truncate font-medium">{c.title}</p>
                        {c.isBlocked && <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-micro font-bold text-rose-400">BLOCKED</span>}
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{c.taskType ? <span className={cn("rounded-full border px-2 py-0.5 text-micro font-bold capitalize", TYPE_TONES[c.taskType] ?? TYPE_TONES.general)}>{c.taskType}</span> : <span className="text-muted-foreground/50">-</span>}</Td>
                    <Td><StatusBadge status={c.status} /></Td>
                    <Td className="hidden sm:table-cell"><span className={cn("rounded-full border px-2 py-0.5 text-micro font-bold", PRIORITY_TONES[c.priority] ?? PRIORITY_TONES.MEDIUM)}>{c.priority}</span></Td>
                    <Td className="hidden tabular-nums text-muted-foreground sm:table-cell">{formatDay(c.dueDate)}</Td>
                    <Td className="hidden text-muted-foreground sm:table-cell">{c.assignedTo?.name ?? "Unassigned"}</Td>
                    <Td className="hidden text-muted-foreground lg:table-cell">{c.project?.name ?? "-"}</Td>
                  </Tr>
                )} />
            ))}
          </tbody>
        </table>
      </TableShell>
    </FadeIn>
  );

  const renderCalendar = () => (
    <FadeIn>
      <CardShell>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Btn variant="outline" aria-label="Previous period" onClick={() => shiftCalendar(-1)}><ChevronLeft className="size-3.5" /></Btn>
            <Btn variant="outline" aria-label="Next period" onClick={() => shiftCalendar(1)}><ChevronRight className="size-3.5" /></Btn>
            <h3 className="font-heading text-section font-semibold">{calMode === "month" ? monthLabel : weekLabel}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Segmented value={calMode} onChange={setCalMode} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]} />
            <Btn variant="ghost" onClick={goToday}>Today</Btn>
          </div>
        </div>
        {calMode === "month" ? (
          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-1 text-center text-micro font-bold uppercase tracking-wider text-muted-foreground">{d}</div>)}
            {calCells.map((c) => {
              const items = c.inMonth ? (byDay[c.dateKey] ?? []) : [];
              const isToday = c.inMonth && c.dateKey === todayKey();
              return (
                <div key={c.key} className={cn("min-h-24 rounded-xl border p-1.5", c.inMonth ? "border-border/60 bg-card" : "border-transparent bg-muted/30")}>
                  <div className="mb-1 flex justify-end">
                    <span className={cn("flex size-5 items-center justify-center rounded-full text-micro font-bold tabular-nums", isToday ? "bg-brand-gradient text-white" : c.inMonth ? "text-muted-foreground" : "text-muted-foreground/40")}>{c.day}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 3).map((t) => (
                      <button key={t.id} onClick={() => setSelectedId(t.id)} className={cn("w-full truncate rounded-md px-1.5 py-0.5 text-left text-micro font-semibold transition-transform hover:scale-[1.02]", chipFor(t.status))}>{t.title}</button>
                    ))}
                    {items.length > 3 && <span className="px-1 text-micro font-semibold text-muted-foreground">+{items.length - 3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-1 text-center text-micro font-bold uppercase tracking-wider text-muted-foreground">{d}</div>)}
            {weekCells.map((c) => {
              const items = byDay[c.dateKey] ?? [];
              const isToday = c.dateKey === todayKey();
              return (
                <div key={c.key} className={cn("min-h-56 rounded-xl border p-1.5", isToday ? "border-primary/40 bg-primary/5" : c.inMonth ? "border-border/60 bg-card" : "border-border/40 bg-muted/30")}>
                  <div className="mb-1 flex justify-end">
                    <span className={cn("flex size-5 items-center justify-center rounded-full text-micro font-bold tabular-nums", isToday ? "bg-brand-gradient text-white" : "text-muted-foreground")}>{c.day}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => setSelectedId(t.id)} className={cn("w-full truncate rounded-md px-1.5 py-0.5 text-left text-micro font-semibold transition-transform hover:scale-[1.02]", chipFor(t.status))}>{t.title}</button>
                    ))}
                    {items.length > 6 && <span className="px-1 text-micro font-semibold text-muted-foreground">+{items.length - 6} more</span>}
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
                <div className="w-[220px] shrink-0 border-b border-border/60 py-2 pr-3 text-micro font-bold uppercase tracking-wider text-muted-foreground">Task</div>
                <div className="relative shrink-0 border-b border-border/60 py-2">
                  <div className="flex">
                    {months.map((m, i) => (
                      <div key={i} className="text-center text-micro font-bold uppercase tracking-wider text-muted-foreground" style={{ width: m.days * CELL }}>{m.label}</div>
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
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-micro font-bold text-primary">{lane.label}</span>
                      <span className="text-micro font-semibold text-muted-foreground">{lane.tasks.length}</span>
                    </div>
                    {lane.tasks.map((t) => {
                      const span = spans.get(t.id);
                      if (!span) return null;
                      const left = Math.max(0, Math.round((span.start.getTime() - start0.getTime()) / 86400000)) * CELL;
const width = Math.max(CELL, Math.round((span.end.getTime() - span.start.getTime()) / 86400000) * CELL + CELL);

  return (
                        <div key={t.id} className="flex items-center border-b border-border/40 hover:bg-muted/40" style={{ width: 220 + totalDays * CELL }}>
                          <button onClick={() => setSelectedId(t.id)} className="flex h-9 w-[220px] shrink-0 items-center gap-2 pr-3 pl-3 text-left">
                            <span className={cn("size-2 shrink-0 rounded-full", TASK_STATUS_META[normalizeStatus(t.status)].dot)} />
                            <span className="truncate text-meta font-medium">{t.title}</span>
                          </button>
                          <div className="relative shrink-0" style={{ width: totalDays * CELL }}>
                            <div className="absolute top-1/2 h-4 -translate-y-1/2 cursor-pointer rounded-md border transition-all hover:opacity-80"
                              style={{
                                left, width,
                                backgroundColor: GANTT_BAR[normalizeStatus(t.status)].fill,
                                borderColor: GANTT_BAR[normalizeStatus(t.status)].line,
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
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-body font-medium text-white shadow-xl">
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Tasks"
        subtitle="Where daily work happens — task execution, time logging, smart prioritization."
          actions={
            <>
              <TimerPill onStopped={reload} />
              <SprintPicker
                value={fSprint}
                onChange={setFSprint}
                sprints={sprints}
                canPlan={canPlan}
                onSprintsChanged={() => setAux((a) => a + 1)}
                projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
              />
              <Segmented value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }, { value: "calendar", label: "Calendar" }, { value: "gantt", label: "Gantt" }]} />
              <Link
                href="/tasks/setup"
                title="Templates, automation, workload, estimation"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-meta font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <Settings2 className="size-3.5" /> Setup
              </Link>
              <Btn variant="primary" onClick={() => { setEditTask(null); setFormOpen(true); }}><Plus className="size-3.5" /> New Task</Btn>
            </>
          }
      />

      {/*
        One slim strip instead of six big cards. The board columns already show
        TODO/in-progress/done counts; what a person actually needs at a glance is
        "what is late, what is due today, what is waiting on me". Detailed
        numbers live on /tasks/setup (workload) and in the board itself.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card px-3.5 py-2">
        <SummaryStat label="Open" value={stats?.open} tone="text-foreground" />
        <span className="text-border">·</span>
        <SummaryStat label="Due today" value={stats?.dueToday} tone="text-sky-500" />
        <span className="text-border">·</span>
        <SummaryStat label="Overdue" value={stats?.overdue} tone="text-rose-500" strong />
        <span className="text-border">·</span>
        <SummaryStat label="In review" value={stats?.review} tone="text-amber-500" />
        <span className="text-border">·</span>
        <SummaryStat label="High priority" value={stats?.highPriority} tone="text-orange-500" />
        <span className="ml-auto text-meta tabular-nums text-muted-foreground">
          {stats?.total ?? 0} total · {stats?.done ?? 0} done
          {stats?.hoursThisWeek != null ? ` · ${stats.hoursThisWeek}h logged this week` : ""}
        </span>
      </div>

      {(view === "board" || view === "list") && (
        <div className="mt-4 mb-3 flex flex-col gap-2">
          <SavedViewBar
            views={savedViews}
            activeId={activeViewId}
            employees={users}
            currentFilters={{ status: fStatus, priority: fPriority, taskType: fType, projectId: fProject, sprintId: fSprint, mine, q }}
            currentView={view}
            currentGroupBy={swimlane}
            onViewsChanged={() => setAux((a) => a + 1)}
            onApply={(v) => {
              if (v.id === "__group__") { setSwimlane(v.groupBy); return; }
              setActiveViewId(v.id);
              const f = v.filters ?? {};
              // Saved views can predate the status fix — fold IN_REVIEW/BACKLOG
              // onto real statuses instead of filtering to nothing.
              setFStatus(f.status ? normalizeStatus(f.status) : "");
              setFPriority(f.priority ?? "");
              setFType(f.taskType ?? "");
              setFProject(f.projectId ?? "");
              setFAssignee(f.assignee ?? f.assigneeId ?? "");
              setFSprint(f.sprintId ?? "");
              setQ(f.q ?? "");
              setMine(!!f.mine);
              if (v.viewMode && ["board", "list", "calendar", "gantt"].includes(v.viewMode)) setView(v.viewMode as any);
              if (v.groupBy) setSwimlane(v.groupBy);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* Scope: everyone vs just mine. One decision, always visible. */}
            <div className="inline-flex rounded-xl border border-border bg-card p-0.5">
              <button
                onClick={() => { setMine(false); }}
                className={cn(
                  "rounded-[10px] px-2.5 py-1.5 text-meta font-bold transition-colors",
                  !mine ? "bg-brand-gradient text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Everyone
              </button>
              <button
                onClick={() => { setMine(true); setFAssignee(""); }}
                className={cn(
                  "rounded-[10px] px-2.5 py-1.5 text-meta font-bold transition-colors",
                  mine ? "bg-brand-gradient text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >
                My work
              </button>
            </div>

            <div className="relative min-w-44 max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…  ( / )" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
            </div>

            {/* People filter — faces beat a dropdown for the most-used slice. */}
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-1.5">
                {users.slice(0, 5).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setFAssignee((v) => (v === u.id ? "" : u.id)); setMine(false); }}
                    title={u.name}
                    aria-label={`Filter by ${u.name} (${u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()})`}
                    aria-pressed={fAssignee === u.id}
                    className={cn(
                      "rounded-full ring-2 transition-transform hover:z-10 hover:scale-110",
                      fAssignee === u.id ? "ring-primary" : "ring-card"
                    )}
                  >
                    <span aria-hidden="true"><Avatar name={u.name} size="size-7" /></span>
                  </button>
                ))}
              </div>
              {users.length > 5 && (
                <Select aria-label="Filter by assignee" value={fAssignee} onChange={(e) => { setFAssignee(e.target.value); setMine(false); }} className="!w-32 !py-1.5 text-meta">
                  <option value="">Anyone</option>
                  {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </Select>
              )}
            </div>

            <Btn variant="outline" onClick={() => setAdvanced((v) => !v)} className="!px-3 !py-1.5 text-meta">
              <SlidersHorizontal className="size-3.5" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Btn>

            {activeFilterCount > 0 && (
              <button
                onClick={() => { setFStatus(""); setFPriority(""); setFType(""); setFProject(""); setFAssignee(""); setQ(""); }}
                className="flex items-center gap-1 text-meta font-bold text-primary hover:underline"
              >
                <X className="size-3.5" /> Clear all
              </button>
            )}

            <PillButton
              active={myDayOnly}
              onClick={() => setMyDayOnly((v) => !v)}
              label={`My Day (${myDay?.length ?? 0})`}
            />

            <span className="ml-auto text-meta font-semibold tabular-nums text-muted-foreground">
              {tasks ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "…"}
              {tasks && tasks.length >= 500 ? " (first 500 — narrow the filters)" : ""}
            </span>
          </div>

          {/* Active filter chips — filters must never be silently applied. */}
          {(activeFilterCount > 0 || myDayOnly) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {fStatus && <FilterChip label={statusLabel(fStatus)} onClear={() => setFStatus("")} />}
              {fPriority && <FilterChip label={label(fPriority)} onClear={() => setFPriority("")} />}
              {fType && <FilterChip label={fType} onClear={() => setFType("")} />}
              {fProject && <FilterChip label={(projects ?? []).find((p) => p.id === fProject)?.name ?? "Project"} onClear={() => setFProject("")} />}
              {fAssignee && <FilterChip label={users.find((u) => u.id === fAssignee)?.name ?? "Assignee"} onClear={() => setFAssignee("")} />}
              {myDayOnly && <FilterChip label="My Day" onClear={() => setMyDayOnly(false)} />}
            </div>
          )}

          {/* Advanced filters — collapsed until asked for. */}
          {advanced && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2">
              <Select aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="!w-36"><option value="">All statuses</option>{TASK_STATUS_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}</Select>
              <Select aria-label="Filter by priority" value={fPriority} onChange={(e) => setFPriority(e.target.value)} className="!w-32"><option value="">All priorities</option>{PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}</Select>
              <Select aria-label="Filter by type" value={fType} onChange={(e) => setFType(e.target.value)} className="!w-36"><option value="">All types</option>{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select>
              <Select aria-label="Filter by project" value={fProject} onChange={(e) => setFProject(e.target.value)} className="!w-40"><option value="">All projects</option>{(projects ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select>
              {view === "board" && (
                <Select aria-label="Group board into swimlanes" value={swimlane} onChange={(e) => setSwimlane(e.target.value)} className="!w-36">
                  {SWIMLANES.map((s) => (<option key={s.value} value={s.value}>{s.value === "none" ? "No lanes" : `Lane: ${s.label.replace("By ", "")}`}</option>))}
                  <option value="status">Lane: status</option>
                  <option value="tag">Lane: tag</option>
                </Select>
              )}
              {view === "list" && (
                <Select aria-label="Sort tasks" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-36">
                  <option value="due">Sort: due date</option>
                  <option value="priority">Sort: priority</option>
                  <option value="title">Sort: title</option>
                  <option value="created">Sort: newest</option>
                  <option value="status">Sort: status</option>
                </Select>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">{renderView()}</div>
      {activeSprint && <SprintBurndownCard sprint={activeSprint} onClose={() => setFSprint("")} />}

      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size="3xl"
        title={
          detailLoading ? (
            <span className="text-section font-semibold">Loading task…</span>
          ) : detail ? (
            <span className="block min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Building2 className="size-3.5 shrink-0" />
                  <span className="truncate">{detail.project?.client?.companyName ?? "Internal"}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 opacity-40" />
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FolderKanban className="size-3.5 shrink-0" />
                  <span className="truncate">{detail.project?.name ?? "No project"}</span>
                </span>
              </span>
              <span className="mt-1.5 block font-heading text-stat font-bold leading-tight tracking-tight text-foreground">
                {detail.title}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={detail.status} />
                <span className={cn("rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide", PRIORITY_TONES[detail.priority] ?? PRIORITY_TONES.MEDIUM)}>
                  {detail.priority}
                </span>
                <span className={cn("rounded-full border px-2 py-0.5 text-micro font-bold capitalize", TYPE_TONES[detail.taskType ?? "general"] ?? TYPE_TONES.general)}>
                  {detail.taskType ?? "general"}
                </span>
                {detail.dueDate && (
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold",
                    detail.status !== "DONE" && localKey(detail.dueDate) < todayKey()
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                      : "border-border bg-muted/50 text-muted-foreground"
                  )}>
                    <CalendarDays className="size-3.5" />
                    {detail.status !== "DONE" && localKey(detail.dueDate) < todayKey() ? "Overdue · " : "Due · "}
                    {formatDay(detail.dueDate)}
                  </span>
                )}
                {detail.isBlocked && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-micro font-bold text-rose-500">BLOCKED</span>}
                {detail.isClientVisible && <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-micro font-bold text-sky-500">CLIENT VISIBLE</span>}
              </span>
              {(detail.assignedTo || detail.assignedBy || detail.reporter) && (
                <span className="mt-2 flex flex-wrap items-center gap-1.5 text-micro text-muted-foreground">
                  {(detail.assignedBy?.name ?? detail.reporter?.name) && (
                    <>
                      <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground/70">{detail.assignedBy ? "Assigned by" : "Reported by"}</span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2 py-0.5 font-bold text-foreground">
                        {detail.assignedBy?.name ?? detail.reporter?.name}
                      </span>
                      <ArrowRight className="size-3.5" />
                    </>
                  )}
                  <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground/70">Assignee</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-bold text-primary">
                    {detail.assignedTo?.name ?? "Unassigned"}
                  </span>
                  {detail.assignedAt && <span>· {timeAgo(detail.assignedAt)}</span>}
                  {!detail._permissions?.canEditFull && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-400">
                      Assignee access — status, checklist & time
                    </span>
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="text-section font-semibold">Task</span>
          )
        }
      >
        {detailLoading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="flex flex-col gap-3">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-20" />)}</div>
            <div className="flex flex-col gap-3">{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-24" />)}</div>
          </div>
        ) : detailError ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-8 text-center">
            <p className="text-body-lg font-bold text-rose-600">{detailError}</p>
            <p className="mt-1 text-meta text-muted-foreground">Only the assignee, creator or PM/Admin can open this task.</p>
            <Btn variant="outline" onClick={() => setSelectedId(null)} className="mt-3">Close</Btn>
          </div>
        ) : !detail ? null : (
          (() => {
            const canFull = (detail as any)._permissions?.canEditFull ?? false;
            const canProgress = (detail as any)._permissions?.canEditProgress ?? false;
            const checklist = detail.checklist ?? [];
            const checklistDone = checklist.filter((c) => c.done).length;
            const subtasks = detail.subtasks ?? [];
            const subtasksDone = subtasks.filter((s) => s.status === "DONE").length;
            const comments = detail.comments ?? [];
            const est = Number(detail.estimatedHours ?? 0);
            const actual = Number(detail.actualHours ?? 0);
            const timePct = est > 0 ? Math.min(100, (actual / est) * 100) : 0;
            const tabs = [
              { key: "overview", label: `Activity (${(detail.activityLog ?? []).length})` },
              { key: "checklist", label: `Checklist (${checklistDone}/${checklist.length})` },
              { key: "subtasks", label: `Subtasks (${subtasksDone}/${subtasks.length})` },
              { key: "comments", label: `Comments (${comments.length})` },
              { key: "time", label: `Time (${(detail.timeLogs ?? []).length})` },
              { key: "deps", label: `Dependencies (${(detail.dependencies ?? []).length})` },
              { key: "files", label: `Files & links (${(detail.attachments ?? []).length + (detail.referenceLinks ?? []).length})` },
            ] as const;
            return (
              <div className="flex flex-col gap-4">
                {!canFull && (
                  <div className={cn("rounded-xl border px-3 py-2.5 text-meta font-semibold", canProgress ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-rose-500/30 bg-rose-500/10 text-rose-600")}>
                    {canProgress
                      ? "You can update status, checklist, time logs and comments. Full edit is reserved for the creator, PM or Admin."
                      : "View only — you don't have edit permission on this task."}
                  </div>
                )}
                {detail.isBlocked && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-meta font-semibold text-rose-500">
                    <ShieldAlert className="size-3.5" /> Blocked — resolve the blocker before continuing.
                  </div>
                )}

                {/* At-a-glance delivery metrics */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat
                    icon={<CheckCircle2 className="size-4" />}
                    label="Checklist"
                    value={checklist.length ? `${checklistDone} / ${checklist.length}` : "—"}
                    tone="bg-emerald-500/10 text-emerald-500"
                  />
                  <MiniStat
                    icon={<ListTodo className="size-4" />}
                    label="Subtasks"
                    value={subtasks.length ? `${subtasksDone} / ${subtasks.length}` : "—"}
                    tone="bg-sky-500/10 text-sky-500"
                  />
                  <MiniStat
                    icon={<Timer className="size-4" />}
                    label="Logged / estimate"
                    value={est > 0 ? `${actual.toFixed(1)} / ${est}h` : `${actual.toFixed(1)}h`}
                    tone={actual > est && est > 0 ? "bg-rose-500/10 text-rose-500" : "bg-primary/10 text-primary"}
                  />
                  <MiniStat
                    icon={<MessageSquare className="size-4" />}
                    label="Comments"
                    value={comments.length}
                    tone="bg-violet-500/10 text-violet-500"
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
                  {/* ── Main column ─────────────────────────────────── */}
                  <div className="flex min-w-0 flex-col gap-4">
                    {/* Status + priority + row actions */}
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2.5">
                      <div className={cn("min-w-0", !canProgress && !canFull && "pointer-events-none opacity-50")}>
                        <Segmented value={detail.status} onChange={canProgress || canFull ? changeStatus : () => {}} options={TASK_STATUS_OPTS} />
                      </div>
                      <Select
                        value={detail.priority}
                        onChange={(e) => canFull && patchDetail({ priority: e.target.value }, "Priority updated")}
                        disabled={!canFull}
                        className="!w-28 !py-1.5"
                        aria-label="Priority"
                      >
                        {PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
                      </Select>
                      <div className="ml-auto flex items-center gap-1.5">
                        {canFull && (
                          <button onClick={() => { setEditTask(detail); setSelectedId(null); setFormOpen(true); }} title="Edit full task" aria-label="Edit task" className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
                        )}
                        <button onClick={() => copyLink(detail.id)} title="Copy task link" aria-label="Copy task link" className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Link2 className="size-3.5" /></button>
                        <button onClick={canFull ? cloneTask : undefined} disabled={!canFull} title={canFull ? "Clone task" : "Only creator/PM can clone"} aria-label="Clone task" className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", !canFull && "cursor-not-allowed opacity-40")}><Copy className="size-3.5" /></button>
                        <button onClick={canFull ? archiveTask : undefined} disabled={!canFull} title={canFull ? "Archive task" : "Only creator/PM can archive"} aria-label="Archive task" className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", !canFull && "cursor-not-allowed opacity-40")}><Archive className="size-3.5" /></button>
                        <button onClick={canFull ? () => deleteTask(detail.id) : undefined} disabled={!canFull} title={canFull ? "Delete task" : "Only creator/PM can delete"} aria-label="Delete task" className={cn("flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400", !canFull && "cursor-not-allowed opacity-40")}><Trash2 className="size-3.5" /></button>
                      </div>
                    </div>

                    {/* Brief */}
                    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                      <header className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-4 py-2.5">
                        <FileText className="size-3.5 text-primary" />
                        <h4 className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Brief &amp; description</h4>
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="flex items-center gap-1 text-micro font-semibold text-muted-foreground">
                            <Zap className="size-3.5" /> {detail.taskType ?? "general"}
                          </span>
                          {canFull && !descEdit && (
                            <button
                              onClick={() => { setDescDraft(detail.description ?? ""); setDescEdit(true); }}
                              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-micro font-bold text-primary transition-colors hover:bg-primary/10"
                            >
                              <Pencil className="size-3.5" /> Edit
                            </button>
                          )}
                        </span>
                      </header>
                      <div className="px-4 py-3.5">
                        {descEdit ? (
                          <div className="flex flex-col gap-2">
                            <Textarea
                              value={descDraft}
                              onChange={(e) => setDescDraft(e.target.value)}
                              autoFocus
                              className="min-h-28 text-body-lg leading-relaxed"
                              placeholder="What is this task about? Include scope, acceptance criteria and links…"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <Btn variant="ghost" onClick={() => setDescEdit(false)}>Cancel</Btn>
                              <Btn
                                variant="primary"
                                onClick={async () => { await patchDetail({ description: descDraft }, "Description updated"); setDescEdit(false); }}
                              >
                                <Save className="size-3.5" /> Save
                              </Btn>
                            </div>
                          </div>
                        ) : detail.description ? (
                          <p className="whitespace-pre-wrap text-body-lg leading-relaxed text-foreground/90">{detail.description}</p>
                        ) : (
                          <p className="text-body italic text-muted-foreground/70">No description yet — add the context, links and acceptance notes so the assignee knows what “done” means.</p>
                        )}
                        {(detail.tags ?? []).length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2.5">
                            {(detail.tags ?? []).map((tag) => (
                              <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-semibold text-primary">#{tag}</span>
                            ))}
                          </div>
                        )}
                        {(detail.customFields ?? []).length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/40 pt-2.5 text-meta">
                            {((detail.customFields ?? []) as any[]).map((f) => (
                              <span key={f.id}><span className="font-bold text-primary">{f.key}:</span> <span className="text-muted-foreground">{f.value || "—"}</span></span>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Working area */}
                    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                      <div className="flex flex-wrap gap-1 border-b border-border/50 bg-muted/20 px-2 py-1.5">
                        {tabs.map((t) => (
                          <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={cn(
                              "rounded-xl px-2.5 py-1.5 text-meta font-bold transition-colors",
                              tab === t.key ? "bg-brand-gradient text-white shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="px-4 py-4">
                        {tab === "overview" && (
                          <div className="flex flex-col gap-1.5">
                            {(detail.activityLog ?? []).length === 0 && <p className="text-meta text-muted-foreground">No activity yet.</p>}
                            {(detail.activityLog ?? []).map((a: any, i: number) => (
                              <div key={a.id ?? i} className="flex items-start gap-2.5 rounded-xl border border-border/50 px-3 py-2">
                                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-body leading-relaxed">{a.message ?? a.action ?? "Activity"} {a.field && a.to != null ? `· ${label(a.field)} → ${label(String(a.to))}` : ""}</p>
                                  <p className="text-micro text-muted-foreground/70">{timeAgo(a.createdAt ?? a.at ?? a.loggedAt)} {a.by ? `· ${a.by}` : a.actorName ? `· ${a.actorName}` : ""}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {tab === "checklist" && (
                          <ChecklistTab taskId={detail.id} onChanged={() => setRefresh((r) => r + 1)} />
                        )}

                        {tab === "subtasks" && (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              <Input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubtask()} placeholder="Break this task into a subtask…" className="min-w-48 flex-1" disabled={!canFull} />
                              <Select value={subAssignee} onChange={(e) => setSubAssignee(e.target.value)} className="!w-36" disabled={!canFull}><option value="">Assignee</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select>
                              <Input type="date" value={subDue} onChange={(e) => setSubDue(e.target.value)} className="!w-36" disabled={!canFull} />
                              <Btn variant="primary" onClick={addSubtask} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                            </div>
                            {subtasks.length === 0 && <p className="text-meta text-muted-foreground">No subtasks — break the work down so progress is visible.</p>}
                            {subtasks.map((s, i) => (
                              <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 px-3 py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <button onClick={() => toggleSubtask(s)} title={s.status === "DONE" ? "Reopen" : "Mark done"} className={cn("flex size-4 shrink-0 items-center justify-center rounded-md border transition-colors", s.status === "DONE" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:border-primary/40")}>
                                    {s.status === "DONE" && <CheckCircle2 className="size-3.5" />}
                                  </button>
                                  <div className="min-w-0">
                                    <p className={cn("truncate text-body font-medium", s.status === "DONE" && "text-muted-foreground line-through")}>{s.title}</p>
                                    <p className="text-micro text-muted-foreground">{s.assignedTo ? s.assignedTo.name : "Unassigned"}{s.dueDate ? ` · ${formatDay(s.dueDate)}` : ""}</p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button onClick={() => moveSubtask(i, -1)} disabled={i === 0} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                                  <button onClick={() => moveSubtask(i, 1)} disabled={i >= subtasks.length - 1} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                                  <button onClick={() => deleteTask(s.id)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {tab === "comments" && (
                          <div className="flex flex-col gap-3">
                            <div className="flex gap-2">
                              <Textarea aria-label="Comment on this task" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder={canProgress || canFull ? "Write a comment…" : "View only — cannot comment"} className="min-h-16" disabled={!canProgress && !canFull} />
                              <Btn variant="primary" onClick={() => postComment()} disabled={!canProgress && !canFull}>Post</Btn>
                            </div>
                            {comments.length === 0 && <p className="text-meta text-muted-foreground">No comments yet — start the conversation.</p>}
                            {comments.map((c) => (
                              <CommentItem key={c.id} c={c} replyTo={replyTo} replyText={replyText} setReplyTo={setReplyTo} setReplyText={setReplyText} currentUserId={me?.id ?? ""}
                                onPostReply={() => postComment(c.id)} onToggleReaction={(emoji) => toggleReaction(c.id, emoji)} onDelete={() => deleteComment(c.id)} />
                            ))}
                          </div>
                        )}

                        {tab === "time" && (
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                              <TaskTimerButton taskId={detail.id} onChanged={reload} />
                              <span className="text-body font-semibold">Timer</span>
                              <span className="text-micro text-muted-foreground">One shared clock — keep it running while you move around.</span>
                              <span className="ml-auto text-micro font-semibold text-muted-foreground">{actual.toFixed(1)}h logged{est > 0 ? ` of ${est}h` : ""}</span>
                            </div>
                            {est > 0 && (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div className={cn("h-full rounded-full", actual > est ? "bg-rose-500" : "bg-primary")} style={{ width: `${Math.max(2, timePct)}%` }} />
                                </div>
                                <span className="text-micro font-bold tabular-nums text-muted-foreground">{Math.round(timePct)}%</span>
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-2">
                              <Field label="Date"><Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} disabled={!canProgress && !canFull} /></Field>
                              <Field label="Hours"><Input type="number" min={0} step={0.25} value={logHours} onChange={(e) => setLogHours(e.target.value)} placeholder="1.5" disabled={!canProgress && !canFull} /></Field>
                              <Field label="Note"><Input value={logDesc} onChange={(e) => setLogDesc(e.target.value)} placeholder="Optional" disabled={!canProgress && !canFull} /></Field>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <label className={cn("flex items-center gap-2 text-body font-semibold", canProgress || canFull ? "cursor-pointer text-muted-foreground" : "cursor-not-allowed text-muted-foreground opacity-50")}>
                                <input type="checkbox" aria-label="Mark this time log as billable" checked={logBillable} onChange={(e) => (canProgress || canFull) && setLogBillable(e.target.checked)} disabled={!canProgress && !canFull} className="size-3.5 accent-primary" /> Billable
                              </label>
                              <Btn variant="primary" onClick={addTimeLog} disabled={!canProgress && !canFull}><Plus className="size-3.5" /> Add log</Btn>
                            </div>
                            {(detail.timeLogs ?? []).length === 0 && <p className="text-meta text-muted-foreground">No time logged yet.</p>}
                            {(detail.timeLogs ?? []).map((l) => (
                              <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-body font-semibold tabular-nums">{formatDate(l.date)} · {l.hours}h</p>
                                  {l.description && <p className="truncate text-meta text-muted-foreground">{l.description}</p>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {l.isBillable !== false && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-micro font-bold text-emerald-400">billable</span>}
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold text-muted-foreground">{l.loggedVia ?? "MANUAL"}</span>
                                  <button onClick={() => deleteLog(l.id)} aria-label="Delete time log" className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
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
                            {(detail.dependencies ?? []).length === 0 && <p className="text-meta text-muted-foreground">No dependencies — this task can start anytime.</p>}
                            {(detail.dependencies ?? []).map((d) => (
                              <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 px-3 py-2">
                                <p className="flex min-w-0 items-center gap-2 truncate text-body font-medium">
                                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-micro font-bold", d.type === "blocks" ? "bg-amber-500/15 text-amber-400" : d.type === "related" ? "bg-sky-500/15 text-sky-400" : "bg-rose-500/15 text-rose-400")}>{d.type ?? "blocked-by"}</span>
                                  <span className="truncate">{d.dependsOnTask.title}</span>
                                </p>
                                <button onClick={() => removeDependency(d)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                              </div>
                            ))}
                            {(detail.dependents ?? []).length > 0 && (
                              <div className="mt-1 flex flex-col gap-1.5">
                                <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Blocks these tasks</span>
                                {(detail.dependents ?? []).map((d) => (
                                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/40 px-3 py-2">
                                    <p className="flex min-w-0 items-center gap-2 truncate text-body font-medium">
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
                                <span className="text-meta font-semibold text-muted-foreground">Attachments ({(detail.attachments ?? []).length}) { !canFull && <span className="ml-1 text-micro text-amber-600">(view only)</span>}</span>
                                <button disabled={!canFull} onClick={() => canFull && fileRef.current?.click()} className={cn("flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-meta font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground", !canFull && "cursor-not-allowed opacity-40") }><Upload className="size-3.5" /> Upload</button>
                                <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
                              </div>
                              {(detail.attachments ?? []).length === 0 && <p className="text-meta text-muted-foreground">No attachments.</p>}
                              <div className="flex flex-col gap-1.5">
                                {((detail.attachments ?? []) as any[]).map((att) => (
                                  <div key={att.id} className="group flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2">
                                    {fileIcon(att.type)}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-body font-medium">{att.name}</p>
                                      <p className="text-micro text-muted-foreground">{att.size}{att.uploadedByName ? ` · ${att.uploadedByName}` : ""}</p>
                                    </div>
                                    <a href={att.url} target="_blank" rel="noreferrer" title="Open" className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"><ExternalLink className="size-3.5" /></a>
                                    <button disabled={!canFull} onClick={() => canFull && removeAttachment(att.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "cursor-not-allowed opacity-40")}><Trash2 className="size-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <span className="mb-2 block text-meta font-semibold text-muted-foreground">Reference links ({(detail.referenceLinks ?? []).length})</span>
                              <div className="flex gap-2">
                                <Input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="Title (optional)" disabled={!canFull} />
                                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} placeholder="https://…" disabled={!canFull} />
                                <Btn variant="primary" onClick={addLink} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                              </div>
                              {(detail.referenceLinks ?? []).length === 0 && <p className="mt-2 text-meta text-muted-foreground">No links — add design docs, PRs or requirements…</p>}
                              <div className="mt-1.5 flex flex-col gap-1.5">
                                {((detail.referenceLinks ?? []) as any[]).map((l) => (
                                  <div key={l.id} className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2">
                                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                                    <p className="min-w-0 flex-1 truncate text-body font-medium">{l.title}</p>
                                    <a href={l.url} target="_blank" rel="noreferrer" className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"><ExternalLink className="size-3.5" /></a>
                                    <button disabled={!canFull} onClick={() => canFull && removeLink(l.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "cursor-not-allowed opacity-40")}><Trash2 className="size-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <span className="mb-2 block text-meta font-semibold text-muted-foreground">Custom fields ({(detail.customFields ?? []).length})</span>
                              <div className="flex gap-2">
                                <Input value={cfKey} onChange={(e) => setCfKey(e.target.value)} placeholder="Key, e.g. severity" disabled={!canFull} />
                                <Input value={cfValue} onChange={(e) => setCfValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addField()} placeholder="Value" disabled={!canFull} />
                                <Btn variant="primary" onClick={addField} disabled={!canFull}><Plus className="size-3.5" /></Btn>
                              </div>
                              {(detail.customFields ?? []).length === 0 && <p className="mt-2 text-meta text-muted-foreground">No custom fields.</p>}
                              <div className="mt-1.5 flex flex-col gap-1.5">
                                {((detail.customFields ?? []) as any[]).map((f) => (
                                  <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 px-3 py-2">
                                    <p className="min-w-0 truncate text-body font-medium"><span className="font-bold text-primary">{f.key}</span><span className="mx-1.5 text-muted-foreground/50">·</span>{f.value || "—"}</p>
                                    <button disabled={!canFull} onClick={() => canFull && removeField(f.id)} className={cn("rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400", !canFull && "cursor-not-allowed opacity-40")}><Trash2 className="size-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Task settings — collapsed by default so the brief reads first */}
                    <details className="group overflow-hidden rounded-2xl border border-border/60 bg-card">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <Settings2 className="size-3.5 text-muted-foreground" />
                        <span className="text-meta font-bold">Task settings</span>
                        <span className="hidden text-micro text-muted-foreground sm:inline">Assignee, project, dates, hours, tags, recurrence</span>
                        <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="flex flex-col gap-3 border-t border-border/50 px-4 py-4">
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Project"><Select value={detail.projectId ?? ""} onChange={(e) => canFull && patchDetail({ projectId: e.target.value || null }, "Project updated")} disabled={!canFull} className="!py-1.5"><option value="">None</option>{(projects ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></Field>
                          <Field label="Sprint" hint={canFull ? undefined : "Creator/PM only"}>
                            <Select
                              value={detail.sprintId ?? ""}
                              disabled={!canFull}
                              className="!py-1.5"
                              onChange={(e) => {
                                if (!canFull) return;
                                apiFetch(`/tasks/${detail.id}/sprint`, { method: "PATCH", body: JSON.stringify({ sprintId: e.target.value || null }) })
                                  .then(() => { notify(e.target.value ? "Added to sprint" : "Removed from sprint"); reload(); })
                                  .catch((er: any) => notify(er.message ?? "Sprint move failed"));
                              }}
                            >
                              <option value="">Backlog (no sprint)</option>
                              {(sprints ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name} · {s.status}</option>))}
                            </Select>
                          </Field>
                          <Field label="Assignee"><Select value={detail.assignedToId ?? ""} onChange={(e) => canFull && patchDetail({ assignedToId: e.target.value || null }, "Assignee updated")} disabled={!canFull} className="!py-1.5"><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
                          <Field label="Reporter"><Select value={detail.reporterId ?? ""} onChange={(e) => canFull && patchDetail({ reporterId: e.target.value || null }, "Reporter updated")} disabled={!canFull} className="!py-1.5"><option value="">None</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</Select></Field>
                          <Field label="Type"><Select value={detail.taskType ?? "general"} onChange={(e) => canFull && patchDetail({ taskType: e.target.value }, "Type updated")} disabled={!canFull} className="!py-1.5">{TASK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}</Select></Field>
                          <Field label="Estimated hours"><Input type="number" min={0} step={0.5} value={detail.estimatedHours ?? ""} onChange={(e) => canFull && patchDetail({ estimatedHours: e.target.value ? Number(e.target.value) : null }, "Hours updated")} disabled={!canFull} /></Field>
                          <Field label="Start date"><Input type="date" value={detail.startDate?.slice(0, 10) ?? ""} onChange={(e) => canFull && patchDetail({ startDate: e.target.value || null }, "Start date updated")} disabled={!canFull} /></Field>
                          <Field label="Due date"><Input type="date" value={detail.dueDate?.slice(0, 10) ?? ""} onChange={(e) => canFull && patchDetail({ dueDate: e.target.value || null }, "Due date updated")} disabled={!canFull} /></Field>
                        </div>
                        <div>
                          <span className="text-meta font-semibold text-muted-foreground">Additional assignees { !canFull && <span className="ml-1 text-micro text-amber-600">(creator/PM only)</span>}</span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {users.filter((u) => u.id !== detail.assignedToId).map((u) => {
                              const has = ((detail.assignees ?? []) as any[]).some((a: any) => a.id === u.id);
                              return (
                                <button key={u.id} disabled={!canFull} onClick={() => canFull && patchDetail({ assignees: has ? ((detail.assignees ?? []) as any[]).filter((a: any) => a.id !== u.id) : [...((detail.assignees ?? []) as any[]), { id: u.id, name: u.name }] }, has ? "Assignee removed" : "Assignee added")}
                                  className={cn("rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors", has ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground", !canFull && "cursor-not-allowed opacity-40")}>{u.name}</button>
                              );
                            })}
                          </div>
                        </div>
                        <Field label="Tags" hint={canFull ? "Comma separated" : "View only — creator/PM can edit"}><Input disabled={!canFull} defaultValue={(detail.tags ?? []).join(", ")} onBlur={(e) => canFull && patchDetail({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }, "Tags updated")} placeholder="design, urgent" /></Field>
                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
                          <label className={cn("flex items-center gap-2 text-body font-semibold", canFull ? "cursor-pointer text-muted-foreground" : "cursor-not-allowed text-muted-foreground opacity-50")}>
                            <input type="checkbox" aria-label="Recurring task" disabled={!canFull} checked={!!detail.isRecurring} onChange={(e) => canFull && patchDetail({ isRecurring: e.target.checked }, e.target.checked ? "Recurring on — next occurrence is created when this is completed" : "Recurring off")} className="size-3.5 accent-primary" /> Recurring
                          </label>
                          {detail.isRecurring && (
                            <Select value={detail.recurrenceSchedule ?? "weekly"} onChange={(e) => canFull && patchDetail({ recurrenceSchedule: e.target.value }, "Schedule updated")} disabled={!canFull} className="!w-32 !py-1">
                              {["daily", "weekly", "monthly", "quarterly", "yearly"].map((s) => (<option key={s} value={s}>{s}</option>))}
                            </Select>
                          )}
                          {detail.isRecurring && detail.status !== "DONE" && <span className="text-micro text-muted-foreground">next occurrence auto-created on completion</span>}
                        </div>
                      </div>
                    </details>
                  </div>

                  {/* ── Context rail ────────────────────────────────── */}
                  <aside className="min-w-0">
                    <TaskContextSidebar
                      taskId={detail.id}
                      detail={detail}
                      onOpenProject={(projectId) => router.push(`/flow/${projectId}`)}
                    />
                  </aside>
                </div>
              </div>
            );
          })()
        )}
      </Modal>

      <TaskFormModal open={formOpen} onClose={() => setFormOpen(false)} initial={editTask} tasks={tasks ?? []} users={users} projects={projects ?? []} onSaved={() => { notify(editTask ? "Task updated" : "Task created"); reload(); }} />
    </div>
  );
}
