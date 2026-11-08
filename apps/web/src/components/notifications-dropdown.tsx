"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  FileText,
  HandCoins,
  Inbox,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import { cn } from "./shared";
import { timeAgo } from "@/lib/format";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

interface Pref {
  type: string;
  channel: string;
  enabled: boolean;
}

interface Summary {
  total: number;
  unread: number;
  today: number;
  thisWeek: number;
  categories: Record<string, { total: number; unread: number }>;
}

const TYPE_META: Record<string, { icon: typeof Zap; tone: string; label: string }> = {
  NEW_LEAD: { icon: Zap, tone: "bg-primary/10 text-primary", label: "Lead" },
  LEAD_ASSIGNED: { icon: UserCheck, tone: "bg-primary/10 text-primary", label: "Lead" },
  MEETING_SCHEDULED: { icon: CalendarClock, tone: "bg-sky-500/10 text-sky-500", label: "Meeting" },
  MEETING_INVITE: { icon: CalendarClock, tone: "bg-sky-500/10 text-sky-500", label: "Meeting" },
  FOLLOWUP_SCHEDULED: { icon: CalendarClock, tone: "bg-amber-500/10 text-amber-500", label: "Follow-up" },
  TASK_ASSIGNED: { icon: Check, tone: "bg-emerald-500/10 text-emerald-500", label: "Task" },
  TASK_REMINDER: { icon: Check, tone: "bg-amber-500/10 text-amber-500", label: "Task" },
  TASK_COMMENT: { icon: Check, tone: "bg-sky-500/10 text-sky-500", label: "Task" },
  TASK_MENTION: { icon: Check, tone: "bg-primary/10 text-primary", label: "Mention" },
  TASK_OVERDUE: { icon: Clock, tone: "bg-rose-500/10 text-rose-500", label: "Overdue" },
  TASK_DUE_SOON: { icon: Clock, tone: "bg-amber-500/10 text-amber-500", label: "Due soon" },
  INVOICE_CREATED: { icon: FileText, tone: "bg-sky-500/10 text-sky-500", label: "Invoice" },
  INVOICE_PAID: { icon: HandCoins, tone: "bg-emerald-500/10 text-emerald-500", label: "Payment" },
  INSTALLMENT_DUE: { icon: Wallet, tone: "bg-amber-500/10 text-amber-500", label: "Installment" },
  OVERDUE_PAYMENT: { icon: Wallet, tone: "bg-rose-500/10 text-rose-500", label: "Overdue" },
  CLIENT_MESSAGE: { icon: Users, tone: "bg-violet-500/10 text-violet-500", label: "Client" },
  PROJECT_UPDATE: { icon: Workflow, tone: "bg-primary/10 text-primary", label: "Project" },
  PROJECT_ASSIGNED: { icon: UserCheck, tone: "bg-primary/10 text-primary", label: "Project" },
  LEAVE_REQUEST: { icon: CalendarClock, tone: "bg-amber-500/10 text-amber-500", label: "Leave" },
  LEAVE_STATUS: { icon: Check, tone: "bg-emerald-500/10 text-emerald-500", label: "Leave" },
  REPORT_READY: { icon: FileText, tone: "bg-sky-500/10 text-sky-500", label: "Report" },
  REPORT_ALERT: { icon: Bell, tone: "bg-rose-500/10 text-rose-500", label: "Alert" },
  REPORT_DELIVERED: { icon: FileText, tone: "bg-sky-500/10 text-sky-500", label: "Report" },
  WEEKLY_REPORT: { icon: FileText, tone: "bg-muted text-muted-foreground", label: "Report" },
  FOLLOWUP_DIGEST: { icon: CalendarClock, tone: "bg-amber-500/10 text-amber-500", label: "Digest" },
  ATTENDANCE_NUDGE: { icon: Clock, tone: "bg-rose-500/10 text-rose-500", label: "Attendance" },
  PAYROLL_REMINDER: { icon: Wallet, tone: "bg-violet-500/10 text-violet-500", label: "Payroll" },
  PEOPLE_DIGEST: { icon: Users, tone: "bg-sky-500/10 text-sky-500", label: "People" },
  DOCUMENT_EXPIRY: { icon: FileText, tone: "bg-amber-500/10 text-amber-500", label: "Documents" },
  ONBOARDING_STALE: { icon: UserCheck, tone: "bg-amber-500/10 text-amber-500", label: "Onboarding" },
};

export function typeMeta(type: string) {
  // Legacy senders used snake_case ("task_assigned"); the canonical map is
  // upper-case, so normalise before looking up or every such row falls back to
  // the generic "Update" label.
  const key = (type ?? "").toUpperCase();
  return TYPE_META[key] ?? { icon: Bell, tone: "bg-muted text-muted-foreground", label: "Update" };
}

export function categoryForType(type: string): "tasks" | "finance" | "people" | "business" | "system" {
  const t = (type ?? "").toUpperCase();
  if (t.startsWith("TASK_")) return "tasks";
  if (
    ["INVOICE_", "OVERDUE_PAYMENT", "PAYMENT_", "REPORT_READY", "WEEKLY_REPORT", "INSTALLMENT_DUE"].some((p) =>
      p.endsWith("_") ? t.startsWith(p) : t === p
    )
  )
    return "finance";
  if (
    ["LEAVE_", "PAYROLL_", "ATTENDANCE_", "PEOPLE_", "DOCUMENT_", "ONBOARDING_"].some((p) => t.startsWith(p))
  )
    return "people";
  if (
    ["NEW_LEAD", "LEAD_", "MEETING_", "FOLLOWUP_", "CLIENT_", "PROJECT_"].some((p) =>
      p.endsWith("_") ? t.startsWith(p) : t === p
    )
  )
    return "business";
  return "system";
}

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Tasks" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "People" },
  { id: "business", label: "Business" },
  { id: "system", label: "System" },
] as const;

function dateBucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startYesterday) return "Yesterday";
  return "Earlier";
}

export function NotificationsDropdown() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [category, setCategory] = useState<string>("all");
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 45_000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!open || !token) return;
    let sse: EventSource | null = null;
    let cancelled = false;
    // Fetch a dedicated short-lived stream token first; the session token never
    // appears in a URL, proxy log or browser history.
    apiFetch<{ token: string }>("/notifications/sse-token")
      .then((res) => {
        if (cancelled) return;
        sse = new EventSource(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"}/notifications/sse?token=${encodeURIComponent(res.token)}`
        );
        sse.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.type === "count") setUnread(data.count);
            else if (data.type === "notification") refresh();
          } catch {}
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sse?.close();
    };
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPrefs(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: "20" });
    if (filter === "unread") p.set("unread", "true");
    if (category !== "all") p.set("category", category);
    return p.toString();
  }, [filter, category]);

  const refresh = async () => {
    try {
      const [list, sum] = await Promise.all([
        apiFetch<Notification[]>(`/notifications?${query}`),
        apiFetch<Summary>("/notifications/summary"),
      ]);
      setItems(list);
      setSummary(sum);
      setUnread(sum.unread ?? 0);
    } catch {}
  };

  // Re-query when the filter changes while the panel is open.
  useEffect(() => {
    if (open) {
      setLoading(true);
      apiFetch<Notification[]>(`/notifications?${query}`)
        .then(setItems)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, query]);

  const loadPrefs = async () => {
    try {
      setPrefs(await apiFetch<Pref[]>("/notifications/preferences"));
    } catch {}
  };

  const prefFor = (type: string, channel: string) =>
    prefs.find((p) => p.type === type && p.channel === channel);

  const togglePref = async (type: string, channel: string, enabled: boolean) => {
    setPrefs((p) => p.map((r) => (r.type === type && r.channel === channel ? { ...r, enabled } : r)));
    try {
      await apiFetch("/notifications/preferences", {
        method: "POST",
        body: JSON.stringify({ type, channel, enabled }),
      });
    } catch {
      refresh();
    }
  };

  const markAllRead = async () => {
    await apiFetch("/notifications/read-all", { method: "PATCH" });
    setItems((p) => p.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    setSummary((s) => (s ? { ...s, unread: 0, categories: Object.fromEntries(Object.entries(s.categories).map(([k, v]) => [k, { ...v, unread: 0 }])) } : s));
  };

  const markRead = async (n: Notification) => {
    if (n.isRead) return;
    try {
      await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
    } catch {}
    setItems((p) => p.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const remove = async (n: Notification) => {
    try {
      await apiFetch(`/notifications/${n.id}`, { method: "DELETE" });
      setItems((p) => p.filter((x) => x.id !== n.id));
      if (!n.isRead) setUnread((u) => Math.max(0, u - 1));
    } catch {}
  };

  const openItem = async (n: Notification) => {
    await markRead(n);
    setOpen(false);
    if (n.link) router.push(n.link);
    else router.push("/notifications");
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of items) {
      const key = dateBucket(n.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return ["Today", "Yesterday", "Earlier"]
      .filter((k) => map.has(k))
      .map((k) => [k, map.get(k)!] as const);
  }, [items]);

  const prefTypes = useMemo(() => [...new Set(prefs.map((p) => p.type))], [prefs]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) refresh();
        }}
        className="relative flex size-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <>
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-ping rounded-full bg-primary/60" />
          </>
        )}
      </button>

      {open && (
        <div className="animate-pop-in fixed inset-x-2 top-16 z-50 flex max-h-[min(38rem,calc(100dvh-5.5rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl shadow-black/15 ring-1 ring-black/[0.03] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[min(30rem,calc(100vw-1rem))]">
          {/* header */}
          <div className="relative shrink-0 overflow-hidden border-b border-border/60">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent" />
            <div className="relative flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  <Inbox className="size-4" />
                  {unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-card" />}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                    Inbox
                    {unread > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9.5px] font-bold tabular-nums text-primary">
                        {unread > 99 ? "99+" : unread} new
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {unread > 0 ? `${summary?.today ?? 0} today · ${summary?.thisWeek ?? 0} this week` : "You're all caught up"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => {
                    setShowPrefs((s) => !s);
                    if (!showPrefs && !prefs.length) loadPrefs();
                  }}
                  title="Notification settings"
                  aria-label="Notification settings"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    showPrefs && "bg-muted text-foreground"
                  )}
                >
                  <Settings2 className="size-3.5" />
                </button>
                <button
                  onClick={markAllRead}
                  disabled={unread === 0}
                  title="Mark all read"
                  aria-label="Mark all read"
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <CheckCheck className="size-3.5" />
                </button>
              </div>
            </div>
          </div>

          {showPrefs ? (
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-2">
              <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between gap-2 bg-card px-4 pb-2 pt-1.5">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Delivery per type</p>
                <p className="flex items-center gap-3 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-1"><Bell className="size-2.5" /> In-app</span>
                  <span className="flex items-center gap-1"><Send className="size-2.5" /> Telegram</span>
                </p>
              </div>
              {prefTypes.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">Loading preferences…</p>
              )}
              {prefTypes.map((type) => {
                const push = prefFor(type, "PUSH")?.enabled ?? true;
                const tg = prefFor(type, "TELEGRAM")?.enabled ?? true;
                const m = typeMeta(type);
                const Icon = m.icon;
                return (
                  <div key={type} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50">
                    <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium">
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", m.tone)}>
                        <Icon className="size-3" />
                      </span>
                      <span className="truncate">{m.label}</span>
                      <span className="hidden truncate font-mono text-[9.5px] text-muted-foreground sm:inline">{type}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        role="switch"
                        aria-label={`${type} in-app`}
                        aria-checked={push}
                        onClick={() => togglePref(type, "PUSH", !push)}
                        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", push ? "bg-primary" : "bg-muted")}
                      >
                        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", push ? "left-[18px]" : "left-0.5")} />
                      </button>
                      <button
                        role="switch"
                        aria-label={`${type} telegram`}
                        aria-checked={tg}
                        onClick={() => togglePref(type, "TELEGRAM", !tg)}
                        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", tg ? "bg-sky-500" : "bg-muted")}
                      >
                        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", tg ? "left-[18px]" : "left-0.5")} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* filters */}
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-0.5 rounded-xl bg-muted/60 p-0.5">
                  {(["all", "unread"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "rounded-[10px] px-2.5 py-1 text-[11px] font-semibold capitalize transition-all",
                        filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {f}
                      {f === "unread" && unread > 0 && <span className="ml-1 tabular-nums">({unread})</span>}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    setShowPrefs(false);
                    router.push("/notifications");
                  }}
                  className="group ml-auto flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  View all <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {CATEGORIES.map((c) => {
                  const count = summary?.categories?.[c.id]?.unread ?? 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
                        category === c.id
                          ? "bg-foreground text-background shadow-sm"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {c.label}
                      {count > 0 && (
                        <span className={cn("rounded-full px-1 text-[9px] font-bold tabular-nums", category === c.id ? "bg-background/20" : "bg-primary/15 text-primary")}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* list */}
              <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {loading && items.length === 0 && (
                    <div className="flex flex-col gap-2 px-3 py-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl px-1 py-2">
                          <span className="size-9 shrink-0 animate-pulse rounded-xl bg-muted" />
                          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <span className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                            <span className="h-2.5 w-full animate-pulse rounded bg-muted/70" />
                            <span className="h-2 w-24 animate-pulse rounded bg-muted/60" />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!loading && items.length === 0 && (
                    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-inset ring-primary/15">
                        <CheckCheck className="size-5 text-primary" />
                      </span>
                      <p className="mt-1 text-[12.5px] font-semibold">{filter === "unread" ? "All caught up" : "No notifications"}</p>
                      <p className="max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">
                        {filter === "unread" ? "Nothing needs your attention right now." : "Assignments, payments and approvals will appear here."}
                      </p>
                    </div>
                  )}
                  {grouped.map(([bucket, rows]) => (
                    <div key={bucket}>
                      <p className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-card px-4 py-1.5 text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span>{bucket}</span>
                        <span className="rounded-full bg-muted px-1.5 text-[9px] font-bold tabular-nums text-muted-foreground/80">{rows.length}</span>
                      </p>
                      {rows.map((n) => {
                        const m = typeMeta(n.type);
                        const Icon = m.icon;
                        return (
                          <div
                            key={n.id}
                            className={cn(
                              "group relative flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-0 hover:bg-muted/40 focus-within:bg-muted/40",
                              !n.isRead && "bg-primary/[0.035]"
                            )}
                          >
                            {!n.isRead && <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-primary" />}
                            <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/[0.03]", m.tone)}>
                              <Icon className="size-4" />
                            </span>
                            <button onClick={() => openItem(n)} className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                              <p className="flex items-center gap-1.5">
                                <span className={cn("truncate text-[12.5px] leading-snug", n.isRead ? "font-medium" : "font-semibold")}>{n.title}</span>
                                {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{n.message}</p>
                              <p className="mt-1.5 flex items-center gap-1.5 text-[9.5px] text-muted-foreground/70">
                                <span>{timeAgo(n.createdAt)}</span>
                                <span className="size-0.5 rounded-full bg-current" />
                                <span className="font-semibold uppercase tracking-wide">{m.label}</span>
                                {n.link && (
                                  <>
                                    <span className="size-0.5 rounded-full bg-current" />
                                    <span className="font-semibold text-primary/80 opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                                  </>
                                )}
                              </p>
                            </button>
                            <div className="flex shrink-0 flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              {!n.isRead && (
                                <button
                                  onClick={() => markRead(n)}
                                  title="Mark read"
                                  aria-label="Mark read"
                                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <Check className="size-3" />
                                </button>
                              )}
                              <button
                                onClick={() => remove(n)}
                                title="Delete"
                                aria-label="Delete notification"
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
                <button
                  onClick={() => { setShowPrefs(true); if (!prefs.length) loadPrefs(); }}
                  className="flex items-center gap-1.5 rounded-lg text-[10.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <SlidersHorizontal className="size-3" /> Preferences
                </button>
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="size-0.5 rounded-full bg-current" />
                  {summary?.thisWeek ?? 0} this week
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
