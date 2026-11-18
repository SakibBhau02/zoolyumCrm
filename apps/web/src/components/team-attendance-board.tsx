"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Clock, LogIn, LogOut, Users } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Avatar, CardShell, SectionTitle, cn } from "@/components/shared";

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDur = (mins?: number | null) => {
  if (mins == null || mins < 0) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

const RANK: Record<string, number> = { inside: 0, left: 1, not_in: 2 };

/**
 * "Who is in today" — one row per active employee with the exact check-in and
 * check-out times, so the dashboard answers the question without opening HR.
 * Reuses /people/attendance/live, which already applies the same punch pairing
 * as the attendance engine (one punch = checked in, not in *and* out).
 */
export function TeamAttendanceBoard() {
  // Stable query key + explicit invalidation: the old `?ts=` counter forced a
  // cold network round trip every minute and made the query cache useless.
  const { data, mutate } = useApi<any>(`/people/attendance/live`);

  useEffect(() => {
    const t = setInterval(mutate, 60_000);
    return () => clearInterval(t);
  }, [mutate]);

  const rows = useMemo(() => {
    const list: any[] = data?.rows ?? [];
    return [...list].sort(
      (a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || String(a.name).localeCompare(String(b.name))
    );
  }, [data]);

  if (!rows.length) return null;

  return (
    <CardShell>
      <SectionTitle
        title="Who's in today"
        subtitle={`${data?.inside ?? 0} inside · ${data?.left ?? 0} checked out · ${data?.notIn ?? 0} not in yet`}
        action={
          <Link href="/people/attendance" className="inline-flex items-center gap-1 text-meta font-semibold text-primary hover:underline">
            Attendance <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Link
            key={r.employeeId}
            href={`/people/team?id=${r.employeeId}`}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-muted/40",
              r.state === "inside" ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-border/60"
            )}
          >
            <Avatar name={r.name} size="size-7" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-body font-semibold">{r.name}</span>
                {r.state === "inside" ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-micro font-bold text-emerald-600 dark:text-emerald-400">in</span>
                ) : r.state === "left" ? (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-micro font-bold text-muted-foreground">out</span>
                ) : (
                  <span className="shrink-0 rounded-full border border-dashed border-border px-1.5 py-px text-micro font-semibold text-muted-foreground/70">not in</span>
                )}
              </span>
              {r.state === "not_in" ? (
                <span className="mt-0.5 block text-micro text-muted-foreground/80">No punch today yet</span>
              ) : (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-1" title="Checked in">
                    <LogIn className="size-3" /> {fmt(r.checkIn)}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Checked out">
                    <LogOut className="size-3" /> {r.state === "inside" ? "still in" : fmt(r.checkOut)}
                  </span>
                  {r.state === "inside" && r.hoursSoFarMinutes != null && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <Clock className="size-3" /> {fmtDur(r.hoursSoFarMinutes)}
                    </span>
                  )}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-micro text-muted-foreground">
        <Users className="size-3.5" /> Times are live · refreshes every minute · dates use the Dhaka calendar
      </p>
    </CardShell>
  );
}
