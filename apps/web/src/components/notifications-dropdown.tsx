"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  Check,
  FileText,
  HandCoins,
  Settings2,
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

const TYPE_META: Record<string, { icon: typeof Zap; tone: string; label: string }> = {
  NEW_LEAD: { icon: Zap, tone: "bg-primary/10 text-primary", label: "Lead" },
  LEAD_ASSIGNED: { icon: UserCheck, tone: "bg-primary/10 text-primary", label: "Lead" },
  MEETING_SCHEDULED: { icon: CalendarClock, tone: "bg-sky-500/10 text-sky-400", label: "Meeting" },
  FOLLOWUP_SCHEDULED: { icon: CalendarClock, tone: "bg-amber-500/10 text-amber-400", label: "Follow-up" },
  TASK_ASSIGNED: { icon: Check, tone: "bg-emerald-500/10 text-emerald-400", label: "Task" },
  TASK_REMINDER: { icon: Check, tone: "bg-amber-500/10 text-amber-400", label: "Task" },
  INVOICE_CREATED: { icon: FileText, tone: "bg-sky-500/10 text-sky-400", label: "Invoice" },
  INVOICE_PAID: { icon: HandCoins, tone: "bg-emerald-500/10 text-emerald-400", label: "Payment" },
  OVERDUE_PAYMENT: { icon: Wallet, tone: "bg-rose-500/10 text-rose-400", label: "Overdue" },
  CLIENT_MESSAGE: { icon: Users, tone: "bg-violet-500/10 text-violet-400", label: "Client" },
  PROJECT_UPDATE: { icon: Workflow, tone: "bg-primary/10 text-primary", label: "Project" },
  PROJECT_ASSIGNED: { icon: UserCheck, tone: "bg-primary/10 text-primary", label: "Project" },
  LEAVE_REQUEST: { icon: CalendarClock, tone: "bg-amber-500/10 text-amber-400", label: "Leave" },
  LEAVE_STATUS: { icon: Check, tone: "bg-emerald-500/10 text-emerald-400", label: "Leave" },
  REPORT_READY: { icon: FileText, tone: "bg-sky-500/10 text-sky-400", label: "Report" },
  WEEKLY_REPORT: { icon: FileText, tone: "bg-muted text-muted-foreground", label: "Report" },
};

export function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, tone: "bg-muted text-muted-foreground", label: "Update" };
}

export function NotificationsDropdown() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 45000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!open || !token) return;
    const sse = new EventSource(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"}/notifications/sse?token=${encodeURIComponent(token)}`);
    sse.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "count") setUnread(data.count);
        else if (data.type === "notification") refresh();
      } catch {}
    };
    return () => sse.close();
  }, [open ]);

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

  const refresh = async () => {
    try {
      const [list, count] = await Promise.all([
        apiFetch<Notification[]>("/notifications?limit=15"),
        apiFetch<{ count: number }>("/notifications/count"),
      ]);
      setItems(list);
      setUnread(count.count ?? 0);
    } catch {}
  };

  const loadPrefs = async () => {
    try {
      const rows = await apiFetch<Pref[]>("/notifications/preferences");
      setPrefs(rows.filter((r) => r.channel === "PUSH"));
    } catch {}
  };

  const togglePref = async (type: string, enabled: boolean) => {
    setPrefs((p) => p.map((r) => (r.type === type ? { ...r, enabled } : r)));
    try {
      await apiFetch("/notifications/preferences", {
        method: "POST",
        body: JSON.stringify({ type, channel: "PUSH", enabled }),
      });
    } catch {
      refresh();
    }
  };

  const markAllRead = async () => {
    await apiFetch("/notifications/read-all", { method: "PATCH" });
    setItems((p) => p.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
  };

  const clearAll = async () => {
    await apiFetch("/notifications", { method: "DELETE" });
    setItems([]);
    setUnread(0);
  };

  const openItem = async (n: Notification) => {
    if (!n.isRead) {
      try {
        await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
      } catch {}
      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
    else router.push("/notifications");
  };

  const shown = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.isRead) : items),
    [items, filter]
  );

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
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 flex max-h-[32rem] w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-[13px] font-semibold">
              Notifications
              {unread > 0 && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{unread} new</span>}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setShowPrefs((s) => !s);
                  if (!showPrefs && !prefs.length) loadPrefs();
                }}
                title="Notification settings"
                className={cn("rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", showPrefs && "bg-muted text-foreground")}
              >
                <Settings2 className="size-3.5" />
              </button>
              <button onClick={markAllRead} title="Mark all read" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Check className="size-3.5" />
              </button>
              <button onClick={clearAll} title="Clear all" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>

          {showPrefs ? (
            <div className="max-h-80 overflow-y-auto p-2">
              <p className="px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                Mute by type
              </p>
              {prefs.map((p) => (
                <label key={p.type} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50">
                  <span className="flex items-center gap-2 text-[12px] font-medium">
                    {(() => {
                      const m = typeMeta(p.type);
                      const Icon = m.icon;
                      return (
                        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", m.tone)}>
                          <Icon className="size-3" />
                        </span>
                      );
                    })()}
                    {typeMeta(p.type).label}
                    <span className="font-mono text-[9.5px] text-muted-foreground">{p.type}</span>
                  </span>
                  <button
                    role="switch"
                    aria-checked={p.enabled}
                    onClick={(e) => {
                      e.preventDefault();
                      togglePref(p.type, !p.enabled);
                    }}
                    className={cn(
                      "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                      p.enabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", p.enabled ? "left-[18px]" : "left-0.5")} />
                  </button>
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="flex gap-1 border-b border-border/60 px-3 py-2">
                {(["all", "unread"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors",
                      filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f}
                    {f === "unread" && unread > 0 && <span className="ml-1 tabular-nums">({unread})</span>}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push("/notifications");
                  }}
                  className="ml-auto rounded-lg px-2.5 py-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  View all
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {shown.length === 0 && (
                  <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                    {filter === "unread" ? "All caught up ✓" : "No notifications yet"}
                  </p>
                )}
                {shown.map((n) => {
                  const m = typeMeta(n.type);
                  const Icon = m.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className={cn(
                        "block w-full border-b border-border/50 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/40",
                        !n.isRead && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", m.tone)}>
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-snug">
                            {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                            <span className="truncate">{n.title}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{n.message}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground/70">{timeAgo(n.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
