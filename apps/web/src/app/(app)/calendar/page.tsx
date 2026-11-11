"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Pencil,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDay } from "@/lib/format";
import {
  CardShell,
  EmptyState,
  FadeIn,
  PageHeader,
  SectionTitle,
  SkeletonBlock,
  StatCard,
  cn,
} from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";

const PLATFORMS = ["facebook", "instagram", "twitter", "linkedin", "tiktok"];
const POST_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"];
const EVENT_TYPES = ["CAMPAIGN", "CONTENT", "MEETING", "DEADLINE", "MILESTONE"];
const UNITS = ["leads", "calls", "revenue", "tasks", "posts"];
const CATEGORIES = ["sales", "marketing", "content", "support"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthPeriod = (d: Date) => iso(d).slice(0, 7);
const todayISO = () => iso(new Date());
const progressPct = (current: number, target: number) => (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0);
const barTone = (pct: number) => (pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : "bg-rose-500");

const POST_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  SCHEDULED: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
  PUBLISHED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  FAILED: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
};
const STATUS_DOT: Record<string, string> = {
  DRAFT: "bg-amber-400",
  SCHEDULED: "bg-primary",
  PUBLISHED: "bg-emerald-500",
  FAILED: "bg-rose-500",
};
const TYPE_STYLES: Record<string, string> = {
  CAMPAIGN: "border-primary/30 bg-primary/15 text-primary",
  CONTENT: "border-sky-500/30 bg-sky-500/15 text-sky-400",
  MEETING: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  DEADLINE: "border-rose-500/30 bg-rose-500/15 text-rose-400",
  MILESTONE: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
};
const PLATFORM_SHORT: Record<string, string> = { facebook: "fb", instagram: "ig", twitter: "tw", linkedin: "in", tiktok: "tt" };
const PLATFORM_STYLES: Record<string, string> = {
  facebook: "bg-blue-500/15 text-blue-400",
  instagram: "bg-fuchsia-500/15 text-fuchsia-400",
  twitter: "bg-sky-500/15 text-sky-400",
  linkedin: "bg-blue-400/15 text-blue-300",
  tiktok: "bg-muted text-muted-foreground",
};
const CATEGORY_STYLES: Record<string, string> = {
  sales: "bg-primary/15 text-primary",
  marketing: "bg-sky-500/15 text-sky-400",
  content: "bg-amber-500/15 text-amber-400",
  support: "bg-emerald-500/15 text-emerald-400",
};

function buildCells(anchor: Date): (Date | null)[] {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) cells.push(new Date(y, m, d));
  return cells;
}

function ErrorBlock({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <EmptyState title={msg} hint="Could not load calendar data" />
      <Btn variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" /> Retry
      </Btn>
    </div>
  );
}

function MonthNav({ anchor, setAnchor, label: lbl }: { anchor: Date; setAnchor: (d: Date) => void; label: string }) {
  const move = (dir: number) => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-1">
        <Btn variant="ghost" onClick={() => move(-1)}>
          <ChevronLeft className="size-3.5" />
        </Btn>
        <h3 className="w-44 text-center text-body-lg font-heading font-semibold">{lbl}</h3>
        <Btn variant="ghost" onClick={() => move(1)}>
          <ChevronRight className="size-3.5" />
        </Btn>
      </div>
      <Btn variant="outline" onClick={() => setAnchor(new Date())}>Today</Btn>
    </div>
  );
}

function WeekRow() {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map((w) => (
        <div key={w} className="pb-1 text-center text-micro font-bold uppercase tracking-wider text-muted-foreground">
          {w}
        </div>
      ))}
    </div>
  );
}

function PostFormModal({
  open,
  onClose,
  post,
  projects,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  post: any | null;
  projects: any[];
  onSaved: () => void;
}) {
  const [f, setF] = useState({ title: "", content: "", platforms: [] as string[], scheduledDate: todayISO(), scheduledTime: "", status: "DRAFT", projectId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!post;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(post ? { title: post.title ?? "", content: post.content ?? "", platforms: post.platforms ?? [], scheduledDate: post.scheduledDate ?? todayISO(), scheduledTime: post.scheduledTime ?? "", status: post.status ?? "DRAFT", projectId: post.project?.id ?? "" }
      : { title: "", content: "", platforms: [] as string[], scheduledDate: todayISO(), scheduledTime: "", status: "DRAFT", projectId: "" });
  }, [open, post]);
  const togglePlatform = (p: string) => setF({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim() || !f.scheduledDate) return setErr("Title and date are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(editing ? `/calendar/posts/${post.id}` : "/calendar/posts", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ title: f.title.trim(), content: f.content.trim() || undefined, platforms: f.platforms, scheduledDate: f.scheduledDate, scheduledTime: f.scheduledTime || undefined, status: f.status, projectId: f.projectId || undefined }),
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
    <Modal open={open} onClose={onClose} title={editing ? "Edit post" : "New post"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Launch teaser — 12 Feb" autoFocus />
        </Field>
        <Field label="Content">
          <Textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Caption / copy…" />
        </Field>
        <Field label="Platforms">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => {
              const on = f.platforms.includes(p);
              return (
                <button key={p} type="button" onClick={() => togglePlatform(p)} className={cn("rounded-full border px-3 py-1.5 text-meta font-semibold capitalize transition-colors", on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {p}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *">
            <Input type="date" value={f.scheduledDate} onChange={(e) => setF({ ...f, scheduledDate: e.target.value })} />
          </Field>
          <Field label="Time">
            <Input type="time" value={f.scheduledTime} onChange={(e) => setF({ ...f, scheduledTime: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">No project</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create post"} />
      </form>
    </Modal>
  );
}

function EventModal({ open, onClose, clients, onSaved }: { open: boolean; onClose: () => void; clients: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", type: "MEETING", date: todayISO(), clientId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setErr(null);
      setF({ title: "", type: "MEETING", date: todayISO(), clientId: "" });
    }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim() || !f.date) return setErr("Title and date are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/calendar/events", {
        method: "POST",
        body: JSON.stringify({ title: f.title.trim(), type: f.type, date: f.date, clientId: f.clientId || undefined }),
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
    <Modal open={open} onClose={onClose} title="Add event">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Campaign kickoff" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date *">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
        </div>
        <Field label="Client">
          <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
            <option value="">No client</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </Select>
        </Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add event" />
      </form>
    </Modal>
  );
}

function TargetModal({ open, onClose, period, onSaved }: { open: boolean; onClose: () => void; period: string; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", target: "", unit: "leads", category: "marketing" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setErr(null);
      setF({ title: "", target: "", unit: "leads", category: "marketing" });
    }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetNum = Number(f.target);
    if (!f.title.trim() || !f.target || Number.isNaN(targetNum) || targetNum <= 0) return setErr("Title and a positive target are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/calendar/targets", {
        method: "POST",
        body: JSON.stringify({ title: f.title.trim(), target: targetNum, unit: f.unit, category: f.category, period }),
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
    <Modal open={open} onClose={onClose} title="Add target">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="New leads / month" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target *">
            <Input type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="40" />
          </Field>
          <Field label="Unit">
            <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Input value={period} disabled />
          </Field>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add target" />
      </form>
    </Modal>
  );
}

function CurrentCell({ t, onSaved }: { t: any; onSaved: () => void }) {
  const [v, setV] = useState(String(t.current ?? ""));
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(String(t.current ?? "")), [t.current]);
  const save = async () => {
    const n = Number(v);
    if (Number.isNaN(n) || n === Number(t.current)) return;
    setBusy(true);
    try {
      await apiFetch(`/calendar/targets/${t.id}`, { method: "PATCH", body: JSON.stringify({ current: n }) });
      onSaved();
    } catch {
      setV(String(t.current ?? ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <input
      value={v}
      disabled={busy}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-body tabular-nums outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
    />
  );
}

export default function CalendarPage() {
  const [tab, setTab] = useState<"content" | "planner" | "targets">("content");
  const [refresh, setRefresh] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [posts, setPosts] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any | null>(null);
  const [events, setEvents] = useState<any[] | null>(null);
  const [targets, setTargets] = useState<any[] | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [postMonth, setPostMonth] = useState(() => new Date());
  const [eventMonth, setEventMonth] = useState(() => new Date());
  const [period, setPeriod] = useState(() => monthPeriod(new Date()));
  const [createOpen, setCreateOpen] = useState(false);
  const [editPost, setEditPost] = useState<any | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(() => {
    setErr(null);
    setTargets(null);
    setRefresh((r) => r + 1);
  }, []);
  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    Promise.all([
      apiFetch<any[]>("/calendar/posts"),
      apiFetch<any>("/calendar/stats"),
      apiFetch<any[]>("/calendar/events"),
      apiFetch<any[]>("/accounts/client-lookup").catch(() => []),
      apiFetch<any[]>("/projects").catch(() => []),
    ])
      .then(([p, s, ev, cl, pr]) => {
        if (cancelled) return;
        setPosts(p);
        setStats(s);
        setEvents(ev);
        setClients(cl);
        setProjects(pr);
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setTargets(null);
    apiFetch<any[]>(`/calendar/targets?period=${period}`)
      .then((d) => !cancelled && setTargets(d))
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [period, refresh]);

  const loading = err === null && (posts === null || stats === null || events === null);
  const postsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const p of posts ?? []) (map[p.scheduledDate ?? ""] ??= []).push(p);
    return map;
  }, [posts]);
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of events ?? []) (map[e.date ?? ""] ??= []).push(e);
    return map;
  }, [events]);
  const upcoming = useMemo(
    () => (events ?? []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 10),
    [events]
  );
  const avgProgress = useMemo(() => {
    if (!targets || targets.length === 0) return 0;
    return Math.round(targets.reduce((s, t) => s + progressPct(Number(t.current ?? 0), Number(t.target ?? 0)), 0) / targets.length);
  }, [targets]);

  const del = async (path: string, name: string, msg: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await apiFetch(path, { method: "DELETE" });
      notify(msg);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const statRow = (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard label="Scheduled" value={stats?.scheduled ?? 0} sub="posts queued" icon={<CalendarClock className="size-4" />} />
      <StatCard label="Published" value={stats?.published ?? 0} sub={`${stats?.total ?? 0} total`} icon={<CheckCircle2 className="size-4" />} />
      <StatCard label="Drafts" value={stats?.drafts ?? 0} sub="in progress" icon={<PenLine className="size-4" />} />
      <StatCard label="Failed" value={stats?.failed ?? 0} sub="needs attention" icon={<AlertTriangle className="size-4" />} />
    </div>
  );

  return (
    <div>
      {flash && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-body font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}
      <PageHeader
        title="Calendar"
        subtitle="Content calendar, monthly planner and daily targets."
        actions={
          <Btn variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New Post
          </Btn>
        }
      />
      <div className="mb-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "content", label: "Content Calendar" },
            { value: "planner", label: "Monthly Planner" },
            { value: "targets", label: "Daily Targets" },
          ]}
        />
      </div>

      {tab === "content" && (
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <SkeletonBlock key={i} className="h-28" />
              ))}
            </div>
          ) : err ? (
            <ErrorBlock msg={err} onRetry={reload} />
          ) : (
            <FadeIn>{statRow}</FadeIn>
          )}
          {loading || err ? (
            loading ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <SkeletonBlock className="h-96 xl:col-span-2" />
                <SkeletonBlock className="h-96" />
              </div>
            ) : null
          ) : (
            <FadeIn delay={0.1}>
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
                <CardShell className="xl:col-span-2">
                  <MonthNav anchor={postMonth} setAnchor={setPostMonth} label={postMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })} />
                  <WeekRow />
                  <div className="grid grid-cols-7 gap-1.5">
                    {buildCells(postMonth).map((d, i) => {
                      if (!d) return <div key={`e${i}`} />;
                      const key = iso(d);
                      const dayPosts = postsByDate[key] ?? [];
                      const today = key === todayISO();
                      return (
                        <div key={key} className={cn("min-h-24 rounded-xl border p-1.5", today ? "border-primary/40 bg-primary/5" : "border-border/60")}>
                          <span className={cn("text-micro font-semibold tabular-nums", today ? "text-primary" : "text-muted-foreground")}>{d.getDate()}</span>
                          <div className="mt-1 flex flex-col gap-1">
                            {dayPosts.slice(0, 3).map((p) => (
                              <button
                                key={p.id}
                                onClick={() => setEditPost(p)}
                                title={`${p.title} · ${label(p.status)}`}
                                className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-left transition-colors hover:bg-muted"
                              >
                                <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                                <span className="truncate text-micro font-medium">{p.title}</span>
                              </button>
                            ))}
                            {dayPosts.length > 3 && <span className="px-1 text-micro text-muted-foreground">+{dayPosts.length - 3} more</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardShell>
                <div className="min-w-0">
                  <SectionTitle title="All posts" subtitle={`${posts?.length ?? 0} total`} />
                  <TableShell footer={<span className="text-meta text-muted-foreground">{(posts ?? []).length} posts</span>}>
                    <div className="max-h-[560px] overflow-y-auto">
                      <table className="w-full">
                        <THead>
                          <Th>Post</Th>
                          <Th>Platforms</Th>
                          <Th>Date</Th>
                          <Th>Time</Th>
                          <Th>Status</Th>
                          <Th>Actions</Th>
                        </THead>
                        <tbody>
                          {(posts ?? []).map((p, i) => (
                            <Tr key={p.id} index={i}>
                              <Td className="max-w-48">
                                <p className="truncate font-medium">{p.title}</p>
                                {p.project && <p className="text-micro text-muted-foreground">{p.project.name}</p>}
                              </Td>
                              <Td>
                                <div className="flex gap-1">
                                  {(p.platforms ?? []).map((pl: string) => (
                                    <span key={pl} className={cn("rounded-md px-1 py-0.5 text-micro font-bold uppercase", PLATFORM_STYLES[pl] ?? "bg-muted text-muted-foreground")}>
                                      {PLATFORM_SHORT[pl] ?? pl.slice(0, 2)}
                                    </span>
                                  ))}
                                </div>
                              </Td>
                              <Td className="text-muted-foreground">{formatDay(p.scheduledDate)}</Td>
                              <Td className="text-muted-foreground">{p.scheduledTime ?? "—"}</Td>
                              <Td>
                                <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-meta font-medium capitalize", POST_STATUS_STYLES[p.status] ?? "bg-muted text-muted-foreground ring-1 ring-border")}>
                                  {label(p.status)}
                                </span>
                              </Td>
                              <Td>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setEditPost(p)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button onClick={() => del(`/calendar/posts/${p.id}`, p.title, "Post deleted")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              </Td>
                            </Tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TableShell>
                </div>
              </div>
            </FadeIn>
          )}
        </div>
      )}

      {tab === "planner" && (
        <div className="flex flex-col gap-4">
          {loading || err ? (
            loading ? (
              <div className="flex flex-col gap-4">
                <SkeletonBlock className="h-96" />
                <SkeletonBlock className="h-64" />
              </div>
            ) : (
            <ErrorBlock msg={err ?? "Something went wrong"} onRetry={reload} />
            )
          ) : (
            <FadeIn>
              <CardShell>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="size-4 text-primary" />
                    <h3 className="text-section font-heading font-semibold">Monthly Planner</h3>
                  </div>
                  <Btn variant="primary" onClick={() => setEventOpen(true)}>
                    <Plus className="size-3.5" /> Add Event
                  </Btn>
                </div>
                <MonthNav anchor={eventMonth} setAnchor={setEventMonth} label={eventMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })} />
                <WeekRow />
                <div className="grid grid-cols-7 gap-1.5">
                  {buildCells(eventMonth).map((d, i) => {
                    if (!d) return <div key={`e${i}`} />;
                    const key = iso(d);
                    const dayEvents = eventsByDate[key] ?? [];
                    const today = key === todayISO();
                    return (
                      <div key={key} className={cn("min-h-20 rounded-xl border p-1.5", today ? "border-primary/40 bg-primary/5" : "border-border/60")}>
                        <span className={cn("text-micro font-semibold tabular-nums", today ? "text-primary" : "text-muted-foreground")}>{d.getDate()}</span>
                        <div className="mt-1 flex flex-col gap-1">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <button key={ev.id} title={ev.title} className={cn("group flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-micro font-medium", TYPE_STYLES[ev.type] ?? "border-border bg-muted text-muted-foreground")}>
                              <span className="truncate">{ev.title}</span>
                              {ev.client && <span className="hidden truncate text-micro opacity-70 lg:inline">· {ev.client.companyName}</span>}
                              <X
                                onClick={(e) => {
                                  e.stopPropagation();
                                  del(`/calendar/events/${ev.id}`, ev.title, "Event deleted");
                                }}
                                className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              />
                            </button>
                          ))}
                          {dayEvents.length > 3 && <span className="px-1 text-micro text-muted-foreground">+{dayEvents.length - 3} more</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardShell>
              <CardShell>
                <SectionTitle title="Upcoming events" subtitle="Next 10 by date" />
                <div className="flex flex-col gap-1.5">
                  {upcoming.length === 0 && <EmptyState title="No events yet" hint="Add a campaign, meeting or milestone" />}
                  {upcoming.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/40">
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide", TYPE_STYLES[ev.type] ?? "border-border bg-muted text-muted-foreground")}>
                        {label(ev.type)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold">{ev.title}</p>
                        {ev.client && <p className="truncate text-micro text-muted-foreground">{ev.client.companyName}</p>}
                      </div>
                      <span className="shrink-0 text-meta font-medium tabular-nums text-muted-foreground">{formatDay(ev.date)}</span>
                      <button onClick={() => del(`/calendar/events/${ev.id}`, ev.title, "Event deleted")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardShell>
            </FadeIn>
          )}
        </div>
      )}

      {tab === "targets" && (
        <div className="flex flex-col gap-4">
          <FadeIn>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Target className="size-3.5 text-primary" />
                <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-40" />
              </div>
              <Btn variant="primary" onClick={() => setTargetOpen(true)}>
                <Plus className="size-3.5" /> Add Target
              </Btn>
            </div>
          </FadeIn>
          {targets === null ? (
            <div className="grid grid-cols-2 gap-4">
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
            </div>
          ) : (
            <FadeIn delay={0.05}>
              <div className="grid grid-cols-2 gap-4">
                <StatCard label="Total Targets" value={targets.length} sub={period} icon={<Target className="size-4" />} />
                <StatCard label="Avg Progress" value={`${avgProgress}%`} sub="across all targets" icon={<TrendingUp className="size-4" />} />
              </div>
            </FadeIn>
          )}
          {targets === null ? (
            <SkeletonBlock className="h-72" />
          ) : (
            <FadeIn delay={0.1}>
              <TableShell footer={<span className="text-meta text-muted-foreground">{targets.length} targets · {period}</span>}>
                <table className="w-full">
                  <THead>
                    <Th>Title</Th>
                    <Th>Category</Th>
                    <Th>Target</Th>
                    <Th>Current</Th>
                    <Th>Unit</Th>
                    <Th>Progress</Th>
                    <Th>Actions</Th>
                  </THead>
                  <tbody>
                    {targets.length === 0 && (
                      <Tr index={0}>
                        <Td className="py-10 text-center text-body text-muted-foreground">
                          No targets for this period — add one to get started
                        </Td>
                      </Tr>
                    )}
                    {targets.map((t, i) => {
                      const pct = progressPct(Number(t.current ?? 0), Number(t.target ?? 0));
                      return (
                        <Tr key={t.id} index={i}>
                          <Td>
                            <p className="font-medium">{t.title}</p>
                            {t.period && <p className="text-micro text-muted-foreground">{t.period}</p>}
                          </Td>
                          <Td>
                            <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold capitalize", CATEGORY_STYLES[t.category] ?? "bg-muted text-muted-foreground")}>
                              {label(t.category ?? "—")}
                            </span>
                          </Td>
                          <Td className="font-semibold tabular-nums">{t.target}</Td>
                          <Td>
                            <CurrentCell t={t} onSaved={reload} />
                          </Td>
                          <Td className="text-muted-foreground">{label(t.unit ?? "—")}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                <div className={cn("h-full rounded-full transition-all", barTone(pct))} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-micro font-bold tabular-nums text-muted-foreground">{pct}%</span>
                            </div>
                          </Td>
                          <Td>
                            <button onClick={() => del(`/calendar/targets/${t.id}`, t.title, "Target deleted")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                              <Trash2 className="size-3.5" />
                            </button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          )}
        </div>
      )}

      <PostFormModal
        open={createOpen || !!editPost}
        onClose={() => {
          setCreateOpen(false);
          setEditPost(null);
        }}
        post={editPost}
        projects={projects}
        onSaved={() => {
          notify(editPost ? "Post updated" : "Post created");
          reload();
        }}
      />
      <EventModal
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        clients={clients}
        onSaved={() => {
          notify("Event added");
          reload();
        }}
      />
      <TargetModal
        open={targetOpen}
        onClose={() => setTargetOpen(false)}
        period={period}
        onSaved={() => {
          notify("Target added");
          reload();
        }}
      />
    </div>
  );
}
