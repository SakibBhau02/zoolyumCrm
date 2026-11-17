"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info, Undo2, X } from "lucide-react";
import { cn } from "@/components/shared";

/* ────────────────────────────────────────────────────────────────────────────
   Toasts with Undo.

   Every dashboard mutation (approve, remind, snooze) must report back and offer
   a way back. A promise-based helper keeps call sites short:
     toast.undo("Reminder sent", () => undoReminder())
   ──────────────────────────────────────────────────────────────────────────── */

type Tone = "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: Tone;
  /** Seconds before auto-dismiss. 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  push: (input: ToastInput) => number;
  dismiss: (id: number) => void;
  /** Shorthand for a success toast carrying an Undo action. */
  undo: (title: string, onUndo: () => void | Promise<void>, description?: string) => number;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<Tone, { icon: typeof Check; tile: string }> = {
  success: { icon: Check, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  error: { icon: AlertTriangle, tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  info: { icon: Info, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { ...input, id }]);
      const duration = input.duration ?? (input.action ? 8 : 5);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration * 1000)
        );
      }
      return id;
    },
    [dismiss]
  );

  const undo = useCallback(
    (title: string, onUndo: () => void | Promise<void>, description?: string) =>
      push({
        title,
        description,
        tone: "success",
        action: { label: "Undo", onClick: onUndo },
      }),
    [push]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss, undo }), [push, dismiss, undo]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const tone = TONE[item.tone ?? "info"];
            const Icon = tone.icon;
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg"
                role="status"
              >
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", tone.tile)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold leading-snug">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 text-meta text-muted-foreground">{item.description}</p>
                  )}
                  {item.action && (
                    <button
                      type="button"
                      onClick={async () => {
                        await item.action?.onClick();
                        dismiss(item.id);
                      }}
                      className="mt-1.5 inline-flex items-center gap-1 text-meta font-bold text-primary hover:underline"
                    >
                      <Undo2 className="size-3.5" /> {item.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss notification"
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
