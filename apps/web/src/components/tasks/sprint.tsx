"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, Loader2, Plus, Target, Trash2, TrendingDown } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Select } from "@/components/ui";

export interface Sprint {
  id: string;
  name: string;
  goal?: string | null;
  projectId?: string | null;
  startDate: string;
  endDate: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED";
  capacityHours?: number | string | null;
  project?: { id: string; name: string } | null;
  _count?: { tasks: number };
}

interface Burndown {
  sprint: Sprint;
  summary: {
    total: number;
    done: number;
    open: number;
    estimatedHours: number;
    actualHours: number;
    capacityHours: number | null;
    completionPct: number;
    snapshotDays?: number;
  };
  days: { date: string; remaining: number; ideal: number; completed: number; source?: "snapshot" | "estimated" }[];
}

const STATUS_TONES: Record<string, string> = {
  PLANNED: "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20",
  ACTIVE: "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20",
  COMPLETED: "bg-muted text-muted-foreground ring-1 ring-border",
};

/**
 * Sprint selector for the tasks page header.
 * Selecting a sprint drives the `sprintId` filter on the task list; the
 * burndown panel below the board is scoped to whichever sprint is active here.
 */
export function SprintPicker({
  value,
  onChange,
  sprints,
  onSprintsChanged,
  projects,
}: {
  value: string;
  onChange: (id: string) => void;
  sprints: Sprint[] | undefined | null;
  onSprintsChanged: () => void;
  projects: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", goal: "", projectId: "", startDate: "", endDate: "", capacityHours: "" });

  const current = (sprints ?? []).find((s) => s.id === value) ?? null;

  const create = async () => {
    if (!draft.name.trim() || !draft.startDate || !draft.endDate) return;
    setBusy(true);
    try {
      const created = await apiFetch<Sprint>("/tasks/sprints", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          goal: draft.goal.trim() || undefined,
          projectId: draft.projectId || null,
          startDate: draft.startDate,
          endDate: draft.endDate,
          capacityHours: draft.capacityHours ? Number(draft.capacityHours) : undefined,
          status: "ACTIVE",
        }),
      });
      setDraft({ name: "", goal: "", projectId: "", startDate: "", endDate: "", capacityHours: "" });
      setCreating(false);
      setOpen(false);
      onSprintsChanged();
      onChange(created.id);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this sprint? Tasks stay, they just leave the sprint.")) return;
    await apiFetch(`/tasks/sprints/${id}`, { method: "DELETE" }).catch(() => {});
    if (value === id) onChange("");
    onSprintsChanged();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors",
          current ? "border-primary/30 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
        )}
      >
        <Target className="size-3.5" />
        <span className="max-w-40 truncate">{current?.name ?? "All tasks"}</span>
        {current && (
          <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", STATUS_TONES[current.status])}>{current.status}</span>
        )}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-border bg-card p-3 shadow-2xl">
            <button
              onClick={() => { onChange(""); setOpen(false); }}
              className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition-colors hover:bg-muted/60", !value && "bg-muted/60")}
            >
              All tasks (no sprint filter)
            </button>

            {(sprints ?? []).length > 0 && <div className="my-1.5 h-px bg-border" />}

            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {(sprints ?? []).map((s) => (
                <div key={s.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => { onChange(s.id); setOpen(false); }}
                    className={cn(
                      "min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60",
                      value === s.id && "bg-primary/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{s.name}</span>
                      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold", STATUS_TONES[s.status])}>{s.status}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(s.startDate).toLocaleDateString()} → {new Date(s.endDate).toLocaleDateString()}
                      {s._count ? ` · ${s._count.tasks} tasks` : ""}
                      {s.project ? ` · ${s.project.name}` : ""}
                    </p>
                  </button>
                  <button
                    onClick={() => remove(s.id)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                    aria-label="Delete sprint"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="my-1.5 h-px bg-border" />

            {creating ? (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Sprint name (e.g. Sprint 12)"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/40"
                />
                <input
                  value={draft.goal}
                  onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                  placeholder="Sprint goal (optional)"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/40"
                />
                <Select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })} className="!w-full">
                  <option value="">All projects</option>
                  {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
                <div className="flex gap-2">
                  <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-2 py-2 text-[11px] outline-none focus:border-primary/40" />
                  <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-2 py-2 text-[11px] outline-none focus:border-primary/40" />
                </div>
                <input
                  type="number"
                  value={draft.capacityHours}
                  onChange={(e) => setDraft({ ...draft, capacityHours: e.target.value })}
                  placeholder="Capacity hours (optional)"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/40"
                />
                <div className="flex items-center gap-2">
                  <Btn variant="primary" onClick={create} disabled={busy || !draft.name.trim() || !draft.startDate || !draft.endDate}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Create sprint
                  </Btn>
                  <Btn variant="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-bold text-primary transition-colors hover:bg-primary/10">
                <Plus className="size-3.5" /> New sprint
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Burndown chart for a sprint — pure SVG, no chart lib dependency. */
export function SprintBurndown({ sprintId }: { sprintId: string }) {
  const [data, setData] = useState<Burndown | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Burndown>(`/tasks/sprints/${sprintId}/burndown`).then(setData).catch((e) => setErr(e.message));
  }, [sprintId]);

  useEffect(() => {
    setData(null);
    setErr(null);
    load();
  }, [load]);

  const geo = useMemo(() => {
    if (!data?.days.length) return null;
    const W = 640;
    const H = 140;
    const pad = 8;
    const maxY = Math.max(1, ...data.days.map((d) => d.remaining));
    const stepX = (W - pad * 2) / Math.max(1, data.days.length - 1);
    const toXY = (i: number, v: number): [number, number] => [pad + i * stepX, H - pad - (v / maxY) * (H - pad * 2)];
    const actual = data.days.map((d, i) => toXY(i, d.remaining));
    const ideal = data.days.map((d, i) => toXY(i, d.ideal));
    // split the line so estimated (reconstructed) segments read as uncertain
    const snapPts: [number, number][] = [];
    const estPts: [number, number][] = [];
    data.days.forEach((d, i) => {
      (d.source === "estimated" ? estPts : snapPts).push(actual[i]);
    });
    const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return {
      W, H,
      actualPath: path(actual),
      snapPath: snapPts.length > 1 ? path(snapPts) : path(actual),
      estPath: estPts.length > 1 ? path(estPts) : "",
      idealPath: path(ideal),
      last: actual[actual.length - 1],
      first: actual[0],
      hasEstimated: estPts.length > 1,
    };
  }, [data]);

  if (err) return <p className="text-[11.5px] text-muted-foreground">Burndown unavailable: {err}</p>;
  if (!data) return <div className="flex items-center gap-2 py-6 text-[11.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading burndown…</div>;

  const { summary } = data;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Completion</p>
          <p className="mt-0.5 font-heading text-[17px] font-bold">{summary.completionPct}%</p>
          <p className="text-[10px] text-muted-foreground">{summary.done}/{summary.total} tasks</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Open</p>
          <p className="mt-0.5 font-heading text-[17px] font-bold">{summary.open}</p>
          <p className="text-[10px] text-muted-foreground">remaining</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hours</p>
          <p className="mt-0.5 font-heading text-[17px] font-bold">{summary.actualHours}<span className="text-[12px] text-muted-foreground">/{summary.estimatedHours}</span></p>
          <p className="text-[10px] text-muted-foreground">{summary.capacityHours ? `of ${summary.capacityHours}h capacity` : "actual / estimated"}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Window</p>
          <p className="mt-0.5 font-heading text-[13px] font-bold">{new Date(data.sprint.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(data.sprint.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
          <p className="text-[10px] text-muted-foreground">{data.sprint.status}</p>
        </div>
      </div>

      {geo && (
        <div className="relative">
          <svg viewBox={`0 0 ${geo.W} ${geo.H}`} className="h-36 w-full" preserveAspectRatio="none">
            <path d={geo.idealPath} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" className="text-muted-foreground/40" />
            <path d={geo.actualPath} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-primary" />
            {geo.hasEstimated && (
              <path d={geo.estPath} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 3" className="text-primary/50" />
            )}
            <circle cx={geo.last[0]} cy={geo.last[1]} r="3.5" className="fill-primary" />
          </svg>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{data.days[0]?.date}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-primary" /> actual remaining</span>
              {geo.hasEstimated && (
                <span className="flex items-center gap-1" title="Reconstructed from task history (no snapshot for these days)">
                  <span className="inline-block h-0.5 w-4 rounded" style={{ borderTop: "2px dashed" }} /> estimated
                </span>
              )}
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-muted-foreground/60" /> ideal</span>
              {summary.snapshotDays != null && <span className="text-muted-foreground/60">{summary.snapshotDays} snapshot days</span>}
            </span>
            <span>{data.days[data.days.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible burndown card used under the board when a sprint is selected. */
export function SprintBurndownCard({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <CalendarRange className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">{sprint.name}</p>
          {sprint.goal && <p className="truncate text-[11px] text-muted-foreground">{sprint.goal}</p>}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground">
          <TrendingDown className="size-3.5" /> {open ? "Hide" : "Burndown"}
        </button>
        <button onClick={onClose} className="text-[11px] font-bold text-muted-foreground hover:text-foreground">Clear</button>
      </div>
      {open && <div className="mt-3"><SprintBurndown sprintId={sprint.id} /></div>}
    </div>
  );
}
