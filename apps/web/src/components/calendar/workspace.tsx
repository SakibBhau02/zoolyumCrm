"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid3x3,
  LayoutDashboard,
  List,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, CardShell, PageHeader, SkeletonBlock } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Modal, Select } from "@/components/ui";
import {
  CalItem,
  CalendarClient,
  CalendarFilters,
  CalendarPerson,
  CalendarSummary,
  CalendarView,
  FeedResponse,
  label,
} from "./types";
import {
  addDays,
  dayLabel,
  monthLabel,
  rangeForView,
  shiftMonth,
  shiftWeek,
  todayISO,
} from "@/lib/calendar-date";
import { FilterBar } from "./filter-bar";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { Overview } from "./overview";
import { TimelineView } from "./timeline-view";
import { GridView } from "./grid-view";
import { PlansPanel } from "./plans-panel";
import { SettingsPanel } from "./settings-panel";
import { ItemDrawer } from "./item-drawer";
import { CampaignForm, EventForm, FlightForm, PostForm } from "./forms";

const VIEWS: { value: CalendarView; label: string; icon: any }[] = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "month", label: "Month", icon: CalendarDays },
  { value: "week", label: "Week", icon: Columns3 },
  { value: "day", label: "Day", icon: Sun },
  { value: "timeline", label: "Timeline", icon: CalendarRange },
  { value: "grid", label: "Grid", icon: Grid3x3 },
  { value: "plans", label: "Plans & reports", icon: List },
  { value: "settings", label: "Settings", icon: Settings2 },
];

const DEFAULT_FILTERS: CalendarFilters = {
  clientId: "",
  projectId: "",
  sources: "TASK,CONTENT_POST,EVENT,AD_FLIGHT,MILESTONE,DELIVERABLE",
  platforms: "",
  approval: "",
  mine: false,
  q: "",
};

type ModalState =
  | { kind: "none" }
  | { kind: "quick" }
  | { kind: "post"; id?: string; date?: string; time?: string }
  | { kind: "event"; id?: string; date?: string; time?: string }
  | { kind: "flight" }
  | { kind: "campaign" };

export function CalendarWorkspace({ fixedClientId }: { fixedClientId?: string }) {
  const { user } = useAuth();
  const calPerm = user?.permissions?.CALENDAR;
  const canEdit = user?.role === "Owner" || calPerm?.edit === true || calPerm?.approve === true;
  const canApprove = user?.role === "Owner" || calPerm?.approve === true;
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(todayISO());

  // Phones open on the agenda (day) view: the 7-column month grid is only
  // usable with horizontal panning, which hides half the week.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 639px)").matches) {
      setView((v) => (v === "month" ? "day" : v));
    }
  }, []);
  const [filters, setFilters] = useState<CalendarFilters>({
    ...DEFAULT_FILTERS,
    ...(fixedClientId ? { clientId: fixedClientId } : {}),
  });
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [summary, setSummary] = useState<CalendarSummary | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [clients, setClients] = useState<CalendarClient[]>([]);
  const [people, setPeople] = useState<CalendarPerson[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [pillars, setPillars] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<{ campaigns: any[]; flights: any[] }>({ campaigns: [], flights: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [drawer, setDrawer] = useState<CalItem | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [toast, setToast] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickTab, setQuickTab] = useState<"menu" | "task" | "note" | "deliverable">("menu");
  const [quickProject, setQuickProject] = useState("");
  const [deepLink, setDeepLink] = useState<{ post?: string; event?: string } | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };

  // ── URL state (shareable view) ─────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view") as CalendarView | null;
    if (v && VIEWS.some((x) => x.value === v)) setView(v);
    const d = sp.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setAnchor(d);
    const c = sp.get("client");
    if (c && !fixedClientId) setFilters((f) => ({ ...f, clientId: c }));
    const post = sp.get("post") ?? undefined;
    const event = sp.get("event") ?? undefined;
    if (post || event) setDeepLink({ post, event });
    // Read once. Writing back from an effect raced the router: Next re-synced
    // the old query and remounted the page with the default view.
  }, [fixedClientId]);

  /** History writes happen only inside user handlers, never from an effect. */
  const syncUrl = useCallback(
    (next: { view?: CalendarView; date?: string; client?: string }) => {
      const sp = new URLSearchParams();
      sp.set("view", next.view ?? view);
      sp.set("date", next.date ?? anchor);
      const client = next.client !== undefined ? next.client : filters.clientId;
      if (client) sp.set("client", client);
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    },
    [view, anchor, filters.clientId]
  );

  const changeView = (v: CalendarView) => {
    setView(v);
    syncUrl({ view: v });
  };

  const goToDate = (d: string, nextView?: CalendarView) => {
    setAnchor(d);
    if (nextView) setView(nextView);
    syncUrl({ date: d, view: nextView });
  };

  const changeClient = (id: string) => {
    setFilters((f) => ({ ...f, clientId: id }));
    syncUrl({ client: id });
  };

  const openClient = (id: string, nextView: CalendarView = "month") => {
    setFilters((f) => ({ ...f, clientId: id }));
    setView(nextView);
    syncUrl({ client: id, view: nextView });
  };

  // ── lookups (once + on refresh) ────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch<CalendarClient[]>("/calendar/clients").catch(() => []),
      apiFetch<CalendarPerson[]>("/calendar/people").catch(() => []),
      apiFetch<any[]>("/flow/projects?lite=1").catch(() => []),
      apiFetch<any[]>("/calendar/campaigns").catch(() => []),
      apiFetch<any[]>("/calendar/settings/pillars").catch(() => []),
    ]).then(([c, p, pr, cp, pl]) => {
      setClients(c);
      setPeople(p);
      setProjects(pr);
      setCampaigns(cp);
      setPillars(pl);
    });
  }, [refresh]);

  // ── feed ───────────────────────────────────────────────────────────
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);

  useEffect(() => {
    if (view === "plans" || view === "settings") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    const qs = new URLSearchParams({
      from: range.from,
      to: range.to,
      sources: filters.sources,
    });
    if (filters.clientId) qs.set("clientId", filters.clientId);
    if (filters.projectId) qs.set("projectId", filters.projectId);
    if (filters.platforms) qs.set("platforms", filters.platforms);
    if (filters.approval) qs.set("approval", filters.approval);
    if (filters.q) qs.set("q", filters.q);
    if (filters.mine) qs.set("mine", "true");

    Promise.all([
      apiFetch<FeedResponse>(`/calendar/feed?${qs.toString()}`),
      apiFetch<CalendarSummary>(`/calendar/summary?${qs.toString()}`),
      view === "day"
        ? apiFetch<any>(`/calendar/day/${anchor}?${qs.toString()}`)
        : Promise.resolve(null),
      view === "timeline"
        ? apiFetch<any>(`/calendar/timeline?from=${range.from}&to=${range.to}${filters.clientId ? `&clientId=${filters.clientId}` : ""}`)
        : Promise.resolve(null),
    ])
      .then(([f, s, d, t]) => {
        if (cancelled) return;
        setFeed(f);
        setSummary(s);
        if (d) setLogs(d.logs ?? []);
        if (t) setTimeline({ campaigns: t.campaigns ?? [], flights: t.flights ?? [] });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.status === 403) setForbidden(true);
        setError(e.message ?? "Could not load the calendar");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, anchor, range.from, range.to, filters, refresh]);

  // Deep link → open the drawer once the item exists in the feed.
  useEffect(() => {
    if (!deepLink || !feed) return;
    const key = deepLink.post ? `post:${deepLink.post}` : `event:${deepLink.event}`;
    const found = feed.items.find((i) => i.key === key);
    if (found) {
      setDrawer(found);
      setDeepLink(null);
    }
  }, [deepLink, feed]);

  const reload = useCallback(() => setRefresh((r) => r + 1), []);

  // ── actions ────────────────────────────────────────────────────────
  const moveItem = async (drag: { source: string; id: string }, date: string, time?: string) => {
    try {
      await apiFetch("/calendar/move", { method: "PATCH", body: JSON.stringify({ ...drag, date, time }) });
      notify("Rescheduled");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not move that item");
    }
  };

  const saveDayLog = async (body: { date: string; summary: string; misses: string[]; clientId?: string }) => {
    await apiFetch("/calendar/day-logs", { method: "POST", body: JSON.stringify(body) });
    notify("Day note saved");
    reload();
  };

  const exportFeed = async (kind: "csv" | "ics") => {
    const qs = new URLSearchParams({ from: range.from, to: range.to, sources: filters.sources });
    if (filters.clientId) qs.set("clientId", filters.clientId);
    if (filters.platforms) qs.set("platforms", filters.platforms);
    try {
      const file = await apiFetch<{ filename: string; mime: string; content: string }>(`/calendar/export/${kind}?${qs.toString()}`);
      const blob = new Blob([file.content], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
      notify(`Exported ${file.filename}`);
    } catch (e: any) {
      notify(e.message ?? "Export failed");
    }
  };

  const saveView = async () => {
    const name = window.prompt("Name this view (e.g. “My week”, “Client approvals”)");
    if (!name) return;
    try {
      await apiFetch("/calendar/views", {
        method: "POST",
        body: JSON.stringify({ name, view, filters, isShared: true }),
      });
      notify("View saved");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not save the view");
    }
  };

  const quickCreate = async () => {
    try {
      if (quickTab === "task") {
        if (!quickTitle.trim()) return;
        await apiFetch("/calendar/quick-add", {
          method: "POST",
          body: JSON.stringify({ source: "TASK", title: quickTitle.trim(), date: anchor, projectId: filters.projectId || undefined }),
        });
      } else if (quickTab === "deliverable") {
        if (!quickTitle.trim() || !quickProject) return;
        await apiFetch("/calendar/quick-add", {
          method: "POST",
          body: JSON.stringify({ source: "DELIVERABLE", title: quickTitle.trim(), date: anchor, projectId: quickProject }),
        });
      } else {
        if (!quickNote.trim()) return;
        await apiFetch("/calendar/quick-add", {
          method: "POST",
          body: JSON.stringify({ source: "NOTE", date: anchor, summary: quickNote.trim(), clientId: filters.clientId || undefined }),
        });
      }
      setQuickTitle("");
      setQuickNote("");
      setQuickProject("");
      setQuickTab("menu");
      setModal({ kind: "none" });
      notify("Added");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not add");
    }
  };

  // ── navigation ─────────────────────────────────────────────────────
  const step = (dir: number) => {
    if (view === "month" || view === "grid" || view === "timeline") goToDate(shiftMonth(anchor, dir));
    else if (view === "week" || view === "overview") goToDate(shiftWeek(anchor, dir));
    else if (view === "day") goToDate(addDays(anchor, dir));
  };

  const periodLabel =
    view === "day"
      ? dayLabel(anchor)
      : view === "week" || view === "overview"
        ? `${dayLabel(range.from)} – ${dayLabel(range.to)}`
        : monthLabel(anchor);

  const todayItems = useMemo(
    () =>
      (feed?.items ?? [])
        .filter((i) => i.date === todayISO() || (i.endDate && i.date <= todayISO() && i.endDate >= todayISO()))
        .map((i) => (canEdit ? i : { ...i, draggable: false })),
    [feed, canEdit]
  );
  const viewItems = useMemo(
    () => (feed?.items ?? []).map((i) => (canEdit ? i : { ...i, draggable: false })),
    [feed, canEdit]
  );

  const clientName = clients.find((c) => c.id === (fixedClientId ?? filters.clientId))?.companyName;

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Calendar" subtitle="Meetings, tasks, content, ads, deliverables and plans — one timeline." />
        <CardShell>
          <p className="text-[13px] font-semibold">You do not have access to the Calendar</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Ask an administrator to grant <strong>CALENDAR</strong> view permission in Control → Roles. Nothing on this
            screen is loaded from the API until that permission exists.
          </p>
        </CardShell>
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12px] font-medium text-white shadow-xl">
          {toast}
        </div>
      )}

      <PageHeader
        title={clientName ? `${clientName} — Calendar` : "Calendar"}
        subtitle="Meetings, tasks, content, ads, deliverables and plans — one timeline."
        actions={
          <div className="flex items-center gap-1.5">
            <Btn variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
            </Btn>
            {canEdit && (
              <Btn variant="primary" onClick={() => { setQuickTab("menu"); setModal({ kind: "quick" }); }}>
                <Plus className="size-4" /> New
              </Btn>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-0.5 rounded-xl border border-border bg-card p-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => changeView(v.value)}
              aria-label={v.label}
              aria-pressed={view === v.value}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                view === v.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <v.icon className="size-3.5" /> <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        {view !== "plans" && view !== "settings" && (
          <div className="flex items-center gap-1">
            <Btn variant="ghost" onClick={() => step(-1)} aria-label="Previous period" title="Previous period" className="!px-2"><ChevronLeft className="size-4" /></Btn>
            <span className="min-w-[150px] text-center text-[12px] font-semibold">{periodLabel}</span>
            <Btn variant="ghost" onClick={() => step(1)} aria-label="Next period" title="Next period" className="!px-2"><ChevronRight className="size-4" /></Btn>
            <Btn variant="outline" onClick={() => goToDate(todayISO())}>Today</Btn>
          </div>
        )}
      </div>

      {view !== "plans" && view !== "settings" && (
        <FilterBar
          filters={filters}
          onChange={(f) => {
            const clientChanged = f.clientId !== filters.clientId;
            setFilters(f);
            if (clientChanged) syncUrl({ client: f.clientId });
          }}
          clients={clients}
          onSaveView={saveView}
          onExport={exportFeed}
        />
      )}

      {error && (
        <CardShell className="mb-3">
          <p className="text-[12px] font-medium text-rose-500">{error}</p>
          <Btn variant="outline" onClick={reload} className="mt-2"><RefreshCw className="size-3.5" /> Retry</Btn>
        </CardShell>
      )}

      {view === "plans" && <PlansPanel clients={clients} />}
      {view === "settings" && (
        <SettingsPanel
          clients={clients}
          onNewCampaign={() => setModal({ kind: "campaign" })}
          onNewFlight={() => setModal({ kind: "flight" })}
          onRefresh={reload}
        />
      )}

      {view !== "plans" && view !== "settings" && (
        <>
          {loading && !feed ? (
            <SkeletonBlock className="h-[520px]" />
          ) : view === "overview" ? (
            <Overview
              today={todayISO()}
              todayItems={todayItems}
              weekItems={viewItems}
              days={feed?.days ?? {}}
              summary={summary}
              clients={clients}
              onOpen={setDrawer}
              onAdd={() => { setQuickTab("menu"); setModal({ kind: "quick" }); }}
              onOpenDay={(d) => goToDate(d, "day")}
              onOpenClient={(id) => openClient(id)}
              onOpenView={(v) => changeView(v as CalendarView)}
            />
          ) : view === "month" ? (
            <>
              <SummaryStrip summary={summary} />
              <MonthView
                anchor={anchor}
                items={viewItems}
                days={feed?.days ?? {}}
                onOpen={setDrawer}
                onMove={moveItem}
                onAdd={(date) => setModal({ kind: "post", date })}
                onOpenDay={(d) => goToDate(d, "day")}
              />
            </>
          ) : view === "week" ? (
            <>
              <SummaryStrip summary={summary} />
              <WeekView
                anchor={anchor}
                items={viewItems}
                onOpen={setDrawer}
                onMove={moveItem}
                onAdd={(date, time) => setModal({ kind: "post", date, time })}
                onOpenDay={(d) => goToDate(d, "day")}
              />
            </>
          ) : view === "day" ? (
            <DayView
              date={anchor}
              items={viewItems}
              summary={summary}
              logs={logs}
              onOpen={setDrawer}
              onAdd={(date, time) => setModal({ kind: "post", date, time })}
              onSaveLog={saveDayLog}
              onOpenClient={(id) => openClient(id)}
            />
          ) : view === "timeline" ? (
            <TimelineView
              anchor={anchor}
              campaigns={timeline.campaigns}
              flights={timeline.flights}
              clients={clients}
              onOpenFlight={(f) => {
                const item = feed?.items.find((i) => i.source === "AD_FLIGHT" && i.sourceId === f.id);
                if (item) setDrawer(item);
              }}
              onNewCampaign={() => setModal({ kind: "campaign" })}
              onOpenClient={(id) => openClient(id)}
            />
          ) : (
            <GridView
              items={viewItems}
              onOpen={setDrawer}
              onAdd={() => setModal({ kind: "post", date: anchor })}
              clientName={clientName}
            />
          )}
          {feed?.truncated && (
            <p className="mt-2 text-[10.5px] text-amber-600 dark:text-amber-300">
              Showing the first {feed.items.length} items — narrow the date range or filters.
            </p>
          )}
        </>
      )}

      <ItemDrawer
        item={drawer ? feed?.items.find((i) => i.key === drawer.key) ?? drawer : null}
        open={!!drawer}
        onClose={() => setDrawer(null)}
        onRefresh={() => { reload(); }}
        canEdit={canEdit}
        canApprove={canApprove}
        onEditPost={(id) => { setDrawer(null); setModal({ kind: "post", id }); }}
        onEditEvent={(id) => { setDrawer(null); setModal({ kind: "event", id }); }}
        onMoved={() => { setDrawer(null); reload(); }}
      />

      {/* Quick add */}
      <Modal open={modal.kind === "quick"} onClose={() => setModal({ kind: "none" })} title="What are you adding?" subtitle={`Landing on ${dayLabel(anchor)}`}>
        {quickTab === "menu" ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Content post", desc: "Platform, caption, approval", icon: CalendarDays, onClick: () => setModal({ kind: "post", date: anchor }) },
              { label: "Meeting / event", desc: "Time, attendees, client", icon: CalendarRange, onClick: () => setModal({ kind: "event", date: anchor }) },
              { label: "Ad flight", desc: "Platform, dates, budget", icon: Columns3, onClick: () => setModal({ kind: "flight" }) },
              { label: "Campaign", desc: "Groups posts + flights", icon: List, onClick: () => setModal({ kind: "campaign" }) },
            ].map((o) => (
              <button
                key={o.label}
                onClick={o.onClick}
                className="flex flex-col items-start gap-1 rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
              >
                <o.icon className="size-4 text-primary" />
                <span className="text-[12px] font-semibold">{o.label}</span>
                <span className="text-[10px] text-muted-foreground">{o.desc}</span>
              </button>
            ))}
            <button onClick={() => setQuickTab("task")} className="rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/40">
              <span className="text-[12px] font-semibold">Task</span>
              <span className="block text-[10px] text-muted-foreground">Owned by the Tasks module</span>
            </button>
            <button onClick={() => setQuickTab("deliverable")} className="rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/40">
              <span className="text-[12px] font-semibold">Deliverable</span>
              <span className="block text-[10px] text-muted-foreground">What we owe, and when</span>
            </button>
            <button onClick={() => setQuickTab("note")} className="rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/40">
              <span className="text-[12px] font-semibold">Day note</span>
              <span className="block text-[10px] text-muted-foreground">What happened / what did not</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
              {quickTab === "task"
                ? "Quick task — full details live in Tasks."
                : quickTab === "deliverable"
                  ? "A deliverable commitment on the project."
                  : "A short close-out note for this day."}
            </p>
            {quickTab === "note" ? (
              <Field label="Note">
                <Input value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder="Two posts held for client assets." autoFocus />
              </Field>
            ) : (
              <>
                <Field label={quickTab === "task" ? "Task title" : "Deliverable title"}>
                  <Input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} placeholder={quickTab === "task" ? "Ad copy for Winter Glow" : "November content batch"} autoFocus />
                </Field>
                {(quickTab === "deliverable") && (
                  <Field label="Project">
                    <Select value={quickProject} onChange={(e) => setQuickProject(e.target.value)}>
                      <option value="">Select a project</option>
                      {projects
                        .filter((p) => !filters.clientId || p.clientId === filters.clientId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            <div className="flex justify-end gap-1.5">
              <Btn variant="ghost" onClick={() => setQuickTab("menu")}>Back</Btn>
              <Btn variant="primary" onClick={quickCreate}>Add</Btn>
            </div>
          </div>
        )}
      </Modal>

      {modal.kind === "post" && (
        <PostForm
          open
          postId={modal.id}
          defaults={{ date: (modal as any).date ?? anchor, time: (modal as any).time }}
          clients={clients}
          projects={projects}
          people={people}
          campaigns={campaigns}
          pillars={pillars}
          onSaved={reload}
          onClose={() => setModal({ kind: "none" })}
        />
      )}
      {modal.kind === "event" && (
        <EventForm
          open
          eventId={modal.id}
          defaults={{ date: (modal as any).date ?? anchor, time: (modal as any).time }}
          clients={clients}
          projects={projects}
          people={people}
          onSaved={reload}
          onClose={() => setModal({ kind: "none" })}
        />
      )}
      {modal.kind === "flight" && (
        <FlightForm open clients={clients} campaigns={campaigns} onSaved={reload} onClose={() => setModal({ kind: "none" })} />
      )}
      {modal.kind === "campaign" && (
        <CampaignForm open clients={clients} projects={projects} onSaved={reload} onClose={() => setModal({ kind: "none" })} />
      )}
    </div>
  );
}

function SummaryStrip({ summary }: { summary: CalendarSummary | null }) {
  if (!summary) return null;
  const chips = [
    { label: "Meetings", value: `${summary.meetings.done}/${summary.meetings.planned}` },
    { label: "Tasks", value: `${summary.tasks.done}/${summary.tasks.due}` },
    { label: "Posts", value: `${summary.posts.published}/${summary.posts.planned}` },
    { label: "In review", value: summary.posts.pendingApproval },
    { label: "Overdue", value: summary.tasks.overdue + (summary.posts.missed ?? 0) },
    { label: "Gap days", value: summary.posts.gapDays },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c.label} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[10.5px]">
          <span className="font-semibold text-muted-foreground">{c.label}</span>
          <span className="font-bold tabular-nums">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

