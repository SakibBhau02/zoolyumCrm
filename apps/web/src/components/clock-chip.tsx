"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, LogIn, LogOut } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { useToast } from "@/components/toast";

/* ────────────────────────────────────────────────────────────────────────────
   Compact time clock.

   The big clock card used to be the loudest thing on the owner dashboard even
   though it matters to exactly one person for ten seconds a day. It now lives
   in the header as a chip: state + one action, with the full timeline one click
   away in People → My space.
   ──────────────────────────────────────────────────────────────────────────── */

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "—";

export function ClockChip() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setState(await apiFetch<any>("/people/attendance/today"));
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 120_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const mine = state?.mine;
  if (!mine) return null;

  const checkedIn = !!mine.checkIn && !mine.checkOut;
  const next: "in" | "out" = mine.nextAction === "in" || mine.nextAction === "out"
    ? mine.nextAction
    : checkedIn
      ? "out"
      : "in";

  const punch = async () => {
    setBusy(true);
    try {
      await apiFetch("/people/attendance/kiosk", {
        method: "POST",
        body: JSON.stringify({ action: next, mode: "self" }),
      });
      await load();
      toast.push({
        title: next === "in" ? "Checked in" : "Checked out",
        description: `Recorded at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
        tone: "success",
      });
    } catch (e: any) {
      toast.push({ title: "Clock action failed", description: e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/60 py-1 pl-2.5 pr-1 md:flex">
      <Clock className={cn("size-3.5", checkedIn ? "text-emerald-500" : "text-muted-foreground")} />
      <Link
        href="/people/me"
        className="hidden whitespace-nowrap text-meta font-medium text-muted-foreground transition-colors hover:text-foreground xl:inline"
        title="Open my attendance"
      >
        {checkedIn ? `In ${fmt(mine.checkIn)}` : mine.checkOut ? `Out ${fmt(mine.checkOut)}` : "Not checked in"}
      </Link>
      <button
        type="button"
        onClick={punch}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-micro font-bold transition-colors disabled:opacity-60",
          checkedIn
            ? "bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 dark:text-rose-400"
            : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"
        )}
      >
        {checkedIn ? <LogOut className="size-3" /> : <LogIn className="size-3" />}
        {next === "in" ? "In" : "Out"}
      </button>
    </div>
  );
}
