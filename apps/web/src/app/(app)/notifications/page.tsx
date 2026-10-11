"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { timeAgo, formatDate } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, PageHeader, SkeletonBlock, cn } from "@/components/shared";
import { typeMeta } from "@/components/notifications-dropdown";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { data, loading, mutate } = useApi<Notification[]>("/notifications?limit=100");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const items = data ?? [];

  const shown = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.isRead) : items),
    [items, filter]
  );
  const unread = items.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    await apiFetch("/notifications/read-all", { method: "PATCH" });
    mutate();
  };
  const clearAll = async () => {
    await apiFetch("/notifications", { method: "DELETE" });
    mutate();
  };
  const openItem = async (n: Notification) => {
    if (!n.isRead) {
      try {
        await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
      } catch {}
      mutate();
    }
    if (n.link) router.push(n.link);
  };
  const removeItem = async (id: string) => {
    await apiFetch(`/notifications/${id}`, { method: "DELETE" });
    mutate();
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread — newest first` : "You're all caught up"}
        actions={
          <>
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
              {(["all", "unread"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[11.5px] font-semibold capitalize transition-colors",
                    filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f}
                  {f === "unread" && unread > 0 && <span className="ml-1 tabular-nums">({unread})</span>}
                </button>
              ))}
            </div>
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Check className="size-3.5" /> Mark all read
            </button>
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="size-3.5" /> Clear
            </button>
          </>
        }
      />
      <FadeIn>
        <CardShell className="!p-2">
          {loading ? (
            <div className="flex flex-col gap-2 p-2">
              {[...Array(6)].map((_, i) => (
                <SkeletonBlock key={i} className="h-16" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              title={filter === "unread" ? "All caught up ✓" : "No notifications yet"}
              hint={filter === "unread" ? "Nothing needs your attention right now." : "Assignments, payments, approvals and client messages will appear here."}
            />
          ) : (
            <div className="flex flex-col">
              {shown.map((n) => {
                const m = typeMeta(n.type);
                const Icon = m.icon;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "group flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-0",
                      !n.isRead && "bg-primary/[0.04]"
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", m.tone)}>
                      <Icon className="size-4" />
                    </span>
                    <button onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                      <p className="flex items-center gap-2 text-[13px] font-semibold leading-snug">
                        {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                        <span className="truncate">{n.title}</span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                          {m.label}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{n.message}</p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground/70">
                        {timeAgo(n.createdAt)} · {formatDate(n.createdAt)}
                        {n.link && <span className="ml-2 font-semibold text-primary">Open →</span>}
                      </p>
                    </button>
                    <button
                      onClick={() => removeItem(n.id)}
                      title="Delete"
                      className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardShell>
      </FadeIn>
    </div>
  );
}
