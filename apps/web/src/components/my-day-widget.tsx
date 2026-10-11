"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Fingerprint, LogIn, LogOut } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Avatar, CardShell, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";

const fmtT = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "—";

/**
 * "My Day" — self-service attendance for the logged-in employee.
 * Renders nothing when the account isn't linked to an employee record.
 */
export function MyDayWidget({ userName }: { userName?: string | null }) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, mutate } = useApi<any>(`/people/attendance/today?ts=${tick}`);
  const mine = data?.mine;

  if (!mine) return null;

  const punch = async (action: "in" | "out") => {
    setBusy(action);
    setErr(null);
    try {
      await apiFetch("/people/attendance/kiosk", {
        method: "POST",
        body: JSON.stringify({ action, mode: "self" }),
      });
      setTick((t) => t + 1);
      mutate();
    } catch (e: any) {
      setErr(e.message ?? "Punch failed");
    } finally {
      setBusy(null);
    }
  };

  const checkedIn = !!mine.checkIn;
  const checkedOut = !!mine.checkOut;
  const primary: "in" | "out" = !checkedIn || checkedOut ? "in" : "out";

  return (
    <CardShell className="mb-4 mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={userName ?? "?"} size="size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] font-heading font-semibold">My Day — today</p>
            <StatusBadge status={mine.status} />
            {mine.status === "LATE" && mine.minutesLate > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-bold text-amber-600 dark:text-amber-300">
                <AlarmClock className="size-3" /> {mine.minutesLate} min late
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
            In {fmtT(mine.checkIn)} · Out {fmtT(mine.checkOut)}
            {mine.punchCount > 0 && ` · ${mine.punchCount} punch${mine.punchCount === 1 ? "" : "es"}`}
            {mine.lastSource && mine.lastSource !== "DEVICE" && ` · via ${mine.lastSource.toLowerCase()}`}
          </p>
          {!mine.hasDeviceId && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Fingerprint className="size-3" /> No fingerprint ID mapped — manual punch only. Ask HR to add it in Directory.
            </p>
          )}
          {err && <p className="mt-0.5 text-[11.5px] font-medium text-rose-500">{err}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Btn
            variant={primary === "in" ? "primary" : "outline"}
            onClick={() => void punch("in")}
            disabled={busy !== null}
            className={cn(busy && "opacity-60")}
          >
            <LogIn className="size-3.5" /> {busy === "in" ? "Punching…" : checkedIn && !checkedOut ? "Punch in again" : "Clock In"}
          </Btn>
          <Btn
            variant={primary === "out" ? "primary" : "outline"}
            onClick={() => void punch("out")}
            disabled={busy !== null || !checkedIn}
            className={cn(busy && "opacity-60")}
          >
            <LogOut className="size-3.5" /> {busy === "out" ? "Punching…" : "Clock Out"}
          </Btn>
          <Link href="/people/attendance" className="text-[11.5px] font-semibold text-primary hover:underline">
            My log
          </Link>
        </div>
      </div>
    </CardShell>
  );
}
