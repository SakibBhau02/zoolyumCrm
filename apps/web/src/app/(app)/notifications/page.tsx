"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Inbox,
  Mail,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, PageHeader, SkeletonBlock, cn } from "@/components/shared";
import { categoryForType, typeMeta } from "@/components/notifications-dropdown";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

interface Summary {
  total: number;
  unread: number;
  today: number;
  thisWeek: number;
  categories: Record<string, { total: number; unread: number }>;
}

interface Pref {
  type: string;
  channel: string;
  enabled: boolean;
}

const CATEGORIES = [
  { id: "all", label: "All notifications" },
  { id: "tasks", label: "Tasks" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "People" },
  { id: "business", label: "Business" },
  { id: "system", label: "System" },
] as const;

function bucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) return "Today";
  if (d.getTime() >= startToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

function Stat({ label, value, tone, icon }: { label: string; value: number | string; tone?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className={cn("mt-1 text-stat font-heading font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"inbox" | "preferences">("inbox");
  const [items, setItems] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [prefsLoading, setPrefsLoading] = useState(false);

  const PAGE = 30;

  const queryFor = useCallback(
    (skip: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), skip: String(skip) });
      if (unreadOnly) p.set("unread", "true");
      if (category !== "all") p.set("category", category);
      return p.toString();
    },
    [unreadOnly, category]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, sum] = await Promise.all([
        apiFetch<Notification[]>(`/notifications?${queryFor(0)}`),
        apiFetch<Summary>("/notifications/summary"),
      ]);
      setItems(rows);
      setSummary(sum);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [queryFor]);

  useEffect(() => {
    if (tab === "inbox") load();
  }, [tab, load]);

  const loadPrefs = async () => {
    setPrefsLoading(true);
    try {
      setPrefs(await apiFetch<Pref[]>("/notifications/preferences"));
    } catch {
      setPrefs([]);
    } finally {
      setPrefsLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "preferences" && prefs.length === 0) loadPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await apiFetch<Notification[]>(`/notifications?${queryFor(items.length)}`);
      setItems((prev) => [...prev, ...rows]);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  };

  const markAllRead = async () => {
    await apiFetch("/notifications/read-all", { method: "PATCH" });
    await load();
  };
  const clearAll = async () => {
    await apiFetch("/notifications", { method: "DELETE" });
    setItems([]);
    setSummary((s) => (s ? { ...s, total: 0, unread: 0, today: 0, thisWeek: 0, categories: {} } : s));
  };
  const openItem = async (n: Notification) => {
    if (!n.isRead) {
      try {
        await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
      } catch {}
      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setSummary((s) =>
        s
          ? {
              ...s,
              unread: Math.max(0, s.unread - 1),
              categories: Object.fromEntries(
                Object.entries(s.categories).map(([k, v]) => [
                  k,
                  { ...v, unread: Math.max(0, v.unread - (k === categoryForType(n.type) || k === "all" ? 1 : 0)) },
                ])
              ),
            }
          : s
      );
    }
    // Always land on this notification's own detail page; the "Open related
    // page" action is what jumps to the linked module.
    router.push(`/notifications/${n.id}`);
  };
  const removeItem = async (n: Notification) => {
    try {
      await apiFetch(`/notifications/${n.id}`, { method: "DELETE" });
      setItems((p) => p.filter((x) => x.id !== n.id));
      setSummary((s) =>
        s ? { ...s, total: Math.max(0, s.total - 1), unread: n.isRead ? s.unread : Math.max(0, s.unread - 1) } : s
      );
    } catch {}
  };

  const searchFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (n) => n.title.toLowerCase().includes(needle) || n.message.toLowerCase().includes(needle)
    );
  }, [items, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of searchFiltered) {
      const key = bucket(n.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return ["Today", "Yesterday", "Earlier"].filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  }, [searchFiltered]);

  const togglePref = async (type: string, channel: string, enabled: boolean) => {
    setPrefs((p) => p.map((r) => (r.type === type && r.channel === channel ? { ...r, enabled } : r)));
    try {
      await apiFetch("/notifications/preferences", {
        method: "POST",
        body: JSON.stringify({ type, channel, enabled }),
      });
    } catch {
      loadPrefs();
    }
  };

  const prefTypes = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const p of prefs) {
      const cat = categoryForType(p.type);
      const arr = groups.get(cat) ?? [];
      if (!arr.includes(p.type)) arr.push(p.type);
      groups.set(cat, arr);
    }
    return groups;
  }, [prefs]);

  return (
    <div>
      <PageHeader
        title="Notification center"
        subtitle={summary ? `${summary.unread} unread · ${summary.today} today · ${summary.thisWeek} this week` : "Everything that needs your attention"}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
              {(["inbox", "preferences"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-meta font-semibold capitalize transition-colors",
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "inbox" ? <Inbox className="size-3.5" /> : <Settings2 className="size-3.5" />}
                  {t}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {tab === "inbox" ? (
        <FadeIn>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Unread" value={summary?.unread ?? 0} tone={summary?.unread ? "text-primary" : undefined} icon={<Bell className="size-4" />} />
            <Stat label="Today" value={summary?.today ?? 0} icon={<Clock className="size-4" />} />
            <Stat label="This week" value={summary?.thisWeek ?? 0} icon={<CheckCheck className="size-4" />} />
            <Stat label="Total" value={summary?.total ?? 0} icon={<Inbox className="size-4" />} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
            <CardShell className="h-fit !p-2">
              <p className="px-2 pb-1.5 pt-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Filters</p>
              {CATEGORIES.map((c) => {
                const count = summary?.categories?.[c.id]?.unread ?? 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-body font-medium transition-colors",
                      category === c.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span>{c.label}</span>
                    {count > 0 && (
                      <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold", category === c.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="my-2 h-px bg-border/60" />
              <button
                onClick={() => setUnreadOnly((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-body font-medium transition-colors",
                  unreadOnly ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-1.5"><SlidersHorizontal className="size-3.5" /> Unread only</span>
                <span className={cn("relative h-4 w-7 rounded-full transition-colors", unreadOnly ? "bg-primary" : "bg-muted")}>
                  <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", unreadOnly ? "left-3.5" : "left-0.5")} />
                </span>
              </button>
            </CardShell>

            <CardShell className="!p-0">
              <div className="flex flex-col gap-2 border-b border-border/60 p-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative w-full sm:min-w-0 sm:flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search notifications…"
                    className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-body outline-none focus:border-primary/40"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    onClick={markAllRead}
                    disabled={!summary?.unread}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-meta font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    <CheckCheck className="size-3.5" /> Mark all read
                  </button>
                  <button
                    onClick={clearAll}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-meta font-semibold text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" /> Clear
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex flex-col gap-2 p-3">
                  {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-16" />)}
                </div>
              ) : searchFiltered.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    title={unreadOnly ? "All caught up ✓" : "Nothing here yet"}
                    hint={unreadOnly ? "No unread notifications match these filters." : "Assignments, payments, approvals and client messages will appear here."}
                  />
                </div>
              ) : (
                <>
                  <div className="scroll-slim max-h-[62vh] overflow-y-auto">
                    {grouped.map(([group, rows]) => (
                      <div key={group}>
                        <p className="sticky top-0 z-10 border-b border-border/40 bg-card/95 px-4 py-1.5 text-micro font-bold uppercase tracking-widest text-muted-foreground backdrop-blur">
                          {group}
                        </p>
                        {rows.map((n) => {
                          const m = typeMeta(n.type);
                          const Icon = m.icon;
                          return (
                            <div
                              key={n.id}
                              className={cn(
                                "group relative flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-0 hover:bg-muted/30",
                                !n.isRead && "bg-primary/[0.035]"
                              )}
                            >
                              {!n.isRead && <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" />}
                              <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", m.tone)}>
                                <Icon className="size-4" />
                              </span>
                              <button onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                                <p className="flex items-center gap-2 text-body-lg leading-snug">
                                  <span className={cn("truncate", n.isRead ? "font-medium" : "font-semibold")}>{n.title}</span>
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold uppercase text-muted-foreground">
                                    {m.label}
                                  </span>
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-body leading-snug text-muted-foreground">{n.message}</p>
                                <p className="mt-1 text-micro text-muted-foreground/70">
                                  {timeAgo(n.createdAt)} · {formatDate(n.createdAt)}
                                  <span className="ml-2 font-semibold text-primary">View →</span>
                                </p>
                              </button>
                              <div className="flex shrink-0 flex-col items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                                {n.link && (
                                  <button
                                    onClick={() => router.push(n.link!)}
                                    title="Open related page"
                                    aria-label="Open related page"
                                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    <ExternalLink className="size-3.5" />
                                  </button>
                                )}
                                {!n.isRead && (
                                  <button
                                    onClick={async () => {
                                      await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
                                      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
                                      setSummary((s) => (s ? { ...s, unread: Math.max(0, s.unread - 1) } : s));
                                    }}
                                    title="Mark read"
                                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    <Check className="size-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => removeItem(n)}
                                  title="Delete"
                                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {items.length >= PAGE && !q && (
                    <div className="border-t border-border/60 p-3 text-center">
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        {loadingMore ? "Loading…" : "Load more"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </CardShell>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          <CardShell>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-heading text-section font-semibold">Delivery preferences</h3>
                <p className="mt-0.5 text-body text-muted-foreground">
                  Choose how each notification reaches you. In-app notifications still appear in this inbox when other channels are off.
                </p>
              </div>
              <span className="flex items-center gap-3 text-micro font-bold uppercase tracking-wider text-muted-foreground">
                <span className="flex items-center gap-1"><Bell className="size-3.5" /> In-app</span>
                <span className="flex items-center gap-1"><Mail className="size-3.5" /> Email</span>
                <span className="flex items-center gap-1"><Send className="size-3.5" /> Telegram</span>
              </span>
            </div>
            {prefsLoading && prefs.length === 0 ? (
              <SkeletonBlock className="h-64" />
            ) : (
              <div className="flex flex-col gap-4">
                {[...prefTypes.entries()].map(([cat, types]) => (
                  <div key={cat}>
                    <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">{cat}</p>
                    <div className="overflow-hidden rounded-xl border border-border/60">
                      {types.map((type, i) => {
                        const m = typeMeta(type);
                        const Icon = m.icon;
                        const pref = (channel: string) =>
                          prefs.find((p) => p.type === type && p.channel === channel)?.enabled ?? true;
                        return (
                          <div
                            key={type}
                            className={cn(
                              "flex flex-wrap items-center justify-between gap-3 px-3 py-2.5",
                              i % 2 === 1 && "bg-muted/30"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2 text-body font-medium">
                              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", m.tone)}>
                                <Icon className="size-3.5" />
                              </span>
                              <span className="truncate">{m.label}</span>
                              <span className="hidden truncate font-mono text-micro text-muted-foreground sm:inline">{type}</span>
                            </span>
                            <span className="flex items-center gap-4">
                              {[
                                { channel: "PUSH", color: "bg-primary" },
                                { channel: "EMAIL", color: "bg-sky-500" },
                                { channel: "TELEGRAM", color: "bg-cyan-500" },
                              ].map(({ channel, color }) => {
                                const on = pref(channel);
                                return (
                                  <button
                                    key={channel}
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={`${type} ${channel}`}
                                    onClick={() => togglePref(type, channel, !on)}
                                    className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? color : "bg-muted")}
                                  >
                                    <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
                                  </button>
                                );
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </FadeIn>
      )}
    </div>
  );
}
