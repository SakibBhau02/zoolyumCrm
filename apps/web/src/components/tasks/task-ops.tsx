"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Plus, Timer, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { useTaskTimer } from "./timer-context";

export interface ChecklistItem {
  id: string;
  content: string;
  done: boolean;
  sortOrder: number;
  doneAt?: string | null;
  doneBy?: { id: string; name: string } | null;
}

/**
 * Checklist tab — lightweight sub-items with no hour estimate.
 * Kept separate from subtasks (full Task rows) by design: a checklist item
 * is a "did you do this?" tick, not plannable work.
 */
export function ChecklistTab({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<ChecklistItem[]>(`/tasks/${taskId}/checklist`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [taskId]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const add = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const created = await apiFetch<ChecklistItem>(`/tasks/${taskId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setItems((prev) => [...(prev ?? []), created]);
      setDraft("");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ChecklistItem) => {
    // optimistic — checkbox must feel instant
    setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      const updated = await apiFetch<ChecklistItem>(`/tasks/${taskId}/checklist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
      setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? updated : i)));
      onChanged?.();
    } catch {
      load(); // revert on failure
    }
  };

  const remove = async (item: ChecklistItem) => {
    setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    await apiFetch(`/tasks/${taskId}/checklist/${item.id}`, { method: "DELETE" }).catch(() => load());
    onChanged?.();
  };

  const done = (items ?? []).filter((i) => i.done).length;
  const total = items?.length ?? 0;

  return (
    <div className="flex flex-col gap-2.5">
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-gradient transition-all"
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
            {done}/{total}
          </span>
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 py-2 text-[11.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading checklist…
        </div>
      ) : total === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">No checklist items yet — add quick steps below.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((item) => (
            <div key={item.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2 transition-colors hover:border-primary/30">
              <button
                onClick={() => toggle(item)}
                aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-all",
                  item.done ? "border-primary bg-primary text-white" : "border-border hover:border-primary/60"
                )}
              >
                {item.done && <Check className="size-3" strokeWidth={3} />}
              </button>
              <span className={cn("min-w-0 flex-1 text-[12px] leading-snug", item.done && "text-muted-foreground line-through")}>
                {item.content}
              </span>
              {item.done && item.doneBy && (
                <span className="shrink-0 text-[9.5px] font-semibold text-muted-foreground/70">{item.doneBy.name}</span>
              )}
              <button
                onClick={() => remove(item)}
                aria-label={`Delete checklist item: ${item.content}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a checklist item…"
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
        />
        <Btn variant="outline" onClick={add} disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        </Btn>
      </div>
    </div>
  );
}

interface RunningTimer {
  id: string;
  taskId: string;
  startedAt: string;
  task?: { id: string; title: string };
}

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Timer pill — shows the running timer for the current user anywhere on the
 * tasks page. Start/stop lives here so a user can never lose a running clock
 * by navigating between views.
 */
export function TimerPill({ onStopped }: { onStopped?: () => void }) {
  const { running, setRunning } = useTaskTimer();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!running) return null;

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/tasks/${running.taskId}/timer/stop`, { method: "POST" });
      setRunning(null);
      onStopped?.();
    } finally {
      setBusy(false);
    }
  };

  const elapsed = Date.now() - new Date(running.startedAt).getTime();
  void tick; // referenced so the interval re-renders

  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5">
      <Timer className="size-3.5 shrink-0 text-primary" />
      <span className="max-w-32 truncate text-[11.5px] font-semibold">{running.task?.title ?? "Task"}</span>
      <span className="font-mono text-[11.5px] font-bold tabular-nums text-primary">{fmtElapsed(elapsed)}</span>
      <button
        onClick={stop}
        disabled={busy}
        aria-label="Stop timer"
        className="flex size-6 items-center justify-center rounded-lg bg-primary text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Pause className="size-3" />}
      </button>
    </div>
  );
}

/** Play/stop control on a task card or in the detail header. */
export function TaskTimerButton({ taskId, onChanged, compact }: { taskId: string; onChanged?: () => void; compact?: boolean }) {
  const { running, refresh, setRunning } = useTaskTimer();
  const [busy, setBusy] = useState(false);
  const isMine = running?.taskId === taskId;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isMine) {
        await apiFetch(`/tasks/${taskId}/timer/stop`, { method: "POST" });
        setRunning(null);
      } else {
        await apiFetch(`/tasks/${taskId}/timer/start`, { method: "POST", body: JSON.stringify({}) });
        // Re-read so the pill gets the server timestamp/title rather than a guess.
        await refresh();
      }
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const label = isMine ? "Stop timer" : "Start timer";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={isMine}
      className={cn(
        "flex items-center justify-center rounded-lg transition-colors disabled:opacity-50",
        compact ? "size-6" : "size-7",
        isMine ? "bg-primary text-white" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : isMine ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </button>
  );
}
