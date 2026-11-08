"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";

export interface RunningTimer {
  taskId: string;
  startedAt: string;
  task?: { title?: string } | null;
}

interface TimerContextValue {
  running: RunningTimer | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setRunning: (timer: RunningTimer | null) => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

/**
 * One source of truth for "which timer is running".
 *
 * The play/stop button is rendered on every task row. Each copy used to fetch
 * `/tasks/timers/running` on mount, so a 27-task board fired ~56 identical
 * requests. Now the provider fetches once and every button reads the shared
 * value; starting or stopping a timer updates it for the whole page.
 */
export function TaskTimerProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState<RunningTimer | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await apiFetch<RunningTimer | null>("/tasks/timers/running");
      setRunning(t ?? null);
    } catch {
      setRunning(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ running, loading, refresh, setRunning }),
    [running, loading, refresh]
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTaskTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error("useTaskTimer must be used inside <TaskTimerProvider>");
  }
  return ctx;
}
