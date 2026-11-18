"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Fingerprint,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Timer,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth";
import { Avatar, CardShell, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import {
  biometricErrorMessage,
  deleteFingerprint,
  listFingerprints,
  registerFingerprint,
  verifyFingerprintForClock,
  webAuthnSupported,
  type FingerprintRow,
} from "@/lib/webauthn";

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDur = (mins: number | null | undefined) => {
  if (mins == null || mins < 0) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

const sourceLabel = (source: string | null | undefined) => {
  const s = String(source ?? "").toUpperCase();
  if (s === "DEVICE") return "Fingerprint machine";
  if (s === "KIOSK") return "Kiosk";
  if (s === "SELF") return "Web";
  return source || "Manual";
};

/**
 * Dashboard time clock.
 *
 * Shows today's check-in/out, the live punch timeline (including punches that
 * arrived automatically from the ZKTeco fingerprint machine), the browser
 * login time, and three actions:
 *   - Clock in / Clock out (web punch)
 *   - Fingerprint clock in / out (WebAuthn + punch)
 *   - Enable fingerprint (one-time Windows Hello / Touch ID registration)
 *
 * Renders nothing when the signed-in account is not linked to an employee.
 */
export function MyDayWidget({ userName }: { userName?: string | null }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<"in" | "out" | "bio" | "reg" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [manage, setManage] = useState(false);
  const [fingerprints, setFingerprints] = useState<FingerprintRow[]>([]);

  // Stable key; `mutate()` is what refreshes it. Appending `?ts=` used to force
  // a new cache entry (and a network hit) on every render.
  const { data, mutate } = useApi<any>(`/people/attendance/today`);
  const mine = data?.mine;

  const loadFingerprints = async () => {
    try {
      setFingerprints(await listFingerprints());
    } catch {
      setFingerprints([]);
    }
  };
  useEffect(() => {
    loadFingerprints();
  }, []);

  // Live "worked" timer while checked in.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const action: "in" | "out" = useMemo(
    () => (mine?.nextAction === "out" || mine?.nextAction === "in" ? mine.nextAction : !mine?.checkIn || mine?.checkOut ? "in" : "out"),
    [mine?.nextAction, mine?.checkIn, mine?.checkOut]
  );

  const workedMinutes = useMemo(() => {
    if (mine?.workedMinutes != null) return mine.workedMinutes;
    if (!mine?.checkIn) return null;
    const start = new Date(mine.checkIn).getTime();
    const end = mine.checkOut ? new Date(mine.checkOut).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 60_000));
  }, [mine?.workedMinutes, mine?.checkIn, mine?.checkOut]);

  if (!mine) return null;

  const hasFingerprint = fingerprints.length > 0;
  const supported = webAuthnSupported();

  const refresh = () => {
    mutate();
  };

  const punch = async (kind: "in" | "out") => {
    setBusy(kind);
    setNotice(null);
    try {
      const r = await apiFetch<any>("/people/attendance/kiosk", {
        method: "POST",
        body: JSON.stringify({ action: kind, mode: "self" }),
      });
      setNotice({ tone: "ok", text: `${kind === "in" ? "Checked in" : "Checked out"} at ${fmtTime(r?.punch?.punchTime)}` });
      refresh();
    } catch (e: any) {
      setNotice({ tone: "err", text: e.message ?? "Punch failed" });
    } finally {
      setBusy(null);
    }
  };

  const fingerprintPunch = async () => {
    setBusy("bio");
    setNotice(null);
    try {
      await verifyFingerprintForClock();
      const r = await apiFetch<any>("/people/attendance/kiosk", {
        method: "POST",
        body: JSON.stringify({ action, mode: "self" }),
      });
      setNotice({
        tone: "ok",
        text: `Fingerprint verified — ${action === "in" ? "checked in" : "checked out"} at ${fmtTime(r?.punch?.punchTime)}`,
      });
      refresh();
    } catch (e: any) {
      setNotice({ tone: "err", text: biometricErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const enableFingerprint = async () => {
    if (!supported) {
      setNotice({ tone: "err", text: "This browser/device does not support fingerprint sign-in." });
      return;
    }
    setBusy("reg");
    setNotice(null);
    try {
      const ua = navigator.userAgent;
      const label = /Windows/i.test(ua)
        ? "Windows Hello"
        : /Mac/i.test(ua)
          ? "Touch ID"
          : /Android/i.test(ua)
            ? "Android biometrics"
            : "This device";
      await registerFingerprint(label);
      await loadFingerprints();
      setNotice({ tone: "ok", text: "Fingerprint enabled for this device." });
    } catch (e: any) {
      setNotice({ tone: "err", text: biometricErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const removeFingerprint = async (id: string) => {
    try {
      await deleteFingerprint(id);
      await loadFingerprints();
      setNotice({ tone: "ok", text: "Fingerprint removed." });
    } catch (e: any) {
      setNotice({ tone: "err", text: e.message ?? "Could not remove fingerprint" });
    }
  };

  const loginAt = user?.lastLoginAt ? new Date(user.lastLoginAt) : null;
  const loginToday = loginAt && new Date().toDateString() === loginAt.toDateString();

  return (
    <CardShell className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        {/* status */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-heading text-body-lg font-semibold">
                Time clock
                <StatusBadge status={mine.status} />
                {mine.hasDeviceId && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-3.5" /> Machine linked
                  </span>
                )}
                {hasFingerprint && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-primary">
                    <Fingerprint className="size-3.5" /> Fingerprint on
                  </span>
                )}
              </p>
              <p className="text-meta text-muted-foreground">
                {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {" · "}
                {mine.checkIn && !mine.checkOut
                  ? `checked in at ${fmtTime(mine.checkIn)}`
                  : mine.checkOut
                    ? `checked out at ${fmtTime(mine.checkOut)}`
                    : "not checked in yet"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Avatar name={userName ?? user?.name ?? "?"} size="size-8" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Check in</p>
              <p className="mt-0.5 text-section font-heading font-bold tabular-nums">{fmtTime(mine.checkIn)}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Check out</p>
              <p className={cn("mt-0.5 text-section font-heading font-bold tabular-nums", !mine.checkOut && "text-muted-foreground")}>
                {fmtTime(mine.checkOut)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Worked</p>
              <p className="mt-0.5 text-section font-heading font-bold tabular-nums">{fmtDur(workedMinutes)}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-3 py-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Late</p>
              <p
                className={cn(
                  "mt-0.5 text-section font-heading font-bold tabular-nums",
                  (mine.minutesLate ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                )}
              >
                {(mine.minutesLate ?? 0) > 0 ? `${mine.minutesLate}m` : "—"}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
              <Timer className="size-3.5" /> Today&apos;s punches
            </p>
            {(!mine.punches || mine.punches.length === 0) ? (
              <p className="text-meta text-muted-foreground">No punches yet. Use a button on the right or the fingerprint machine.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {mine.punches.map((p: any, i: number) => (
                  <span
                    key={`${p.at}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-0.5 text-micro font-medium"
                  >
                    <span className="tabular-nums">{fmtTime(p.at)}</span>
                    <span className="text-muted-foreground">{sourceLabel(p.source)}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <LogIn className="size-3.5" />
                Signed in at {loginAt ? `${loginToday ? "" : `${loginAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} `}${fmtTime(loginAt.toISOString())}` : "—"}
              </span>
              {mine.punches?.length ? (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="size-3.5" />
                  Last punch {fmtTime(mine.lastPunchAt)}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* actions */}
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[248px]">
          {mine.checkOut ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center">
              <p className="flex items-center justify-center gap-1.5 text-micro font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> Day closed
              </p>
              <p className="mt-0.5 text-meta text-emerald-700/80 dark:text-emerald-300/80">
                {fmtTime(mine.checkIn)} → {fmtTime(mine.checkOut)} · {fmtDur(workedMinutes)}
              </p>
            </div>
          ) : (
            <Btn
              variant="primary"
              className="w-full justify-center !py-3"
              onClick={() => punch(action)}
              disabled={!!busy}
            >
              {action === "in" ? <LogIn className="size-4" /> : <LogOut className="size-3.5" />}
              {busy === "in" || busy === "out" ? "Saving…" : action === "in" ? "Clock in" : "Clock out"}
            </Btn>
          )}

          {mine.checkOut && (
            <Btn
              variant="ghost"
              className="w-full justify-center !text-meta"
              onClick={() => punch("in")}
              disabled={!!busy}
            >
              <LogIn className="size-3.5" /> {busy === "in" ? "Saving…" : "Clock in again"}
            </Btn>
          )}

          <Btn
            variant="outline"
            className="w-full justify-center !py-2.5"
            onClick={fingerprintPunch}
            disabled={!!busy || !hasFingerprint || !supported}
            title={!hasFingerprint ? "Enable fingerprint first" : "Verify with fingerprint then punch"}
          >
            <Fingerprint className="size-3.5" />
            {busy === "bio"
              ? "Verifying…"
              : mine.checkOut
                ? "Fingerprint clock in"
                : action === "in"
                  ? "Fingerprint clock in"
                  : "Fingerprint clock out"}
          </Btn>

          {!hasFingerprint ? (
            <Btn
              variant="ghost"
              className="w-full justify-center !text-meta"
              onClick={enableFingerprint}
              disabled={!!busy || !supported}
            >
              <Fingerprint className="size-3.5" />
              {busy === "reg" ? "Waiting for sensor…" : "Enable fingerprint"}
            </Btn>
          ) : (
            <button
              onClick={() => setManage((v) => !v)}
              className="text-center text-micro font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {manage ? "Hide devices" : `${fingerprints.length} fingerprint device(s)`}
            </button>
          )}

          {manage && hasFingerprint && (
            <div className="flex flex-col gap-1 rounded-xl border border-border/60 p-1.5">
              {fingerprints.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-meta">
                  <Smartphone className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.deviceLabel ?? "This device"}</span>
                  <button
                    onClick={() => removeFingerprint(f.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                    title="Remove fingerprint"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Link
            href="/people/me"
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-border/60 py-2 text-meta font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            My attendance <CheckCircle2 className="size-3.5" />
          </Link>

          {notice && (
            <p
              className={cn(
                "flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-micro font-medium leading-snug",
                notice.tone === "ok"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              )}
            >
              {notice.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              {notice.text}
            </p>
          )}

          {!supported && (
            <p className="text-micro leading-snug text-muted-foreground">
              Fingerprint needs a device with Windows Hello / Touch ID and a secure (https or localhost) connection.
            </p>
          )}
        </div>
      </div>
    </CardShell>
  );
}
