"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import { cn } from "./shared";
import { formatDate, timeAgo } from "@/lib/format";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
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
      } catch {}
    };
    return () => sse.close();
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const refresh = async () => {
    try {
      const [list, count] = await Promise.all([
        apiFetch<Notification[]>("/notifications?limit=12"),
        apiFetch<{ count: number }>("/notifications/count"),
      ]);
      setItems(list);
      setUnread(count.count ?? 0);
    } catch {}
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

  const markRead = async (id: string) => {
    await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
    setItems((p) => p.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-[13px] font-semibold">
              Notifications
              {unread > 0 && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{unread} new</span>}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={markAllRead} title="Mark all read" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Check className="size-3.5" />
              </button>
              <button onClick={clearAll} title="Clear all" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">No notifications yet</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={cn(
                  "block w-full border-b border-border/50 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/40",
                  !n.isRead && "bg-primary/5"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.isRead ? "bg-border" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold leading-snug">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{n.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">{timeAgo(n.createdAt)} · {formatDate(n.createdAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}