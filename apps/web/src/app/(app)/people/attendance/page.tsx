"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Cpu, Download, Fingerprint, Plus, RotateCcw, Trash2, TrendingUp, Upload } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import { Avatar, CardShell, SectionTitle, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Field, Input, Select } from "@/components/ui";
import { downloadCsv, fmtTime, monthNow } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { usePeopleAccess } from "../_components/permissions";
import { Pager, TableToolbar, useTable } from "../_components/table-kit";
import { PeopleHero, PeopleTabs } from "../_components/hero";
import { AttendanceModal, ImportPunchModal } from "../_components/modals/attendance-modals";

/** minutes → "7h 20m" / "45m" / "—" */
export const fmtDur = (mins?: number | null) => {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

const ONLINE_WINDOW_MS = 5 * 60_000;

function DevicesCard({
  employees,
  notify,
  refreshKey,
  onChanged,
  active = true,
}: {
  employees: any[];
  notify: (m: string) => void;
  refreshKey: number;
  onChanged?: () => void;
  active?: boolean;
}) {
  // Self-polling: a freshly connected terminal shows up on its first heartbeat,
  // so an empty list must not require a manual page reload.
  const [tick, setTick] = useState(0);
  const { data: devices, error: devicesError } = useList<any[]>("/people/attendance/devices", refreshKey + tick);
  const [drafts, setDrafts] = useState<Record<string, { name: string; location: string; isActive: boolean }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const [pinDrafts, setPinDrafts] = useState<Record<string, string>>({});
  const [pinSaving, setPinSaving] = useState<string | null>(null);

  // The address printed for the terminal has to be one the *device* can reach.
  // API_URL is baked in at build time (usually localhost), so when the admin is
  // browsing from a LAN IP or a domain we reuse that host with the API port.
  const [serverBase, setServerBase] = useState(() => API_URL.replace(/\/api\/?$/, ""));
  useEffect(() => {
    try {
      const api = new URL(API_URL);
      const host = window.location.hostname;
      if (host && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
        setServerBase(`${api.protocol}//${host}${api.port ? `:${api.port}` : ""}`);
      }
    } catch {}
  }, []);
  const loopbackBase = /\/\/(localhost|127\.0\.0\.1)/.test(serverBase);
  const isOnline = (d: any) => !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    const d: Record<string, { name: string; location: string; isActive: boolean }> = {};
    for (const dev of devices ?? []) d[dev.id] = { name: dev.name ?? "", location: dev.location ?? "", isActive: dev.isActive !== false };
    setDrafts(d);
  }, [devices]);

  const save = async (id: string) => {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    try {
      await apiFetch(`/people/attendance/devices/${id}`, { method: "PATCH", body: JSON.stringify(d) });
      notify("Device updated");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (dev: any) => {
    if (!window.confirm(`Remove ${dev.name || dev.serialNumber}? Its punches stay in the log, but the device re-registers if it is still pushing.`)) return;
    setDeletingId(dev.id);
    try {
      await apiFetch(`/people/attendance/devices/${dev.id}`, { method: "DELETE" });
      notify("Device removed");
      setTick((n) => n + 1);
    } catch (e: any) {
      notify(e.message ?? "Remove failed");
    } finally {
      setDeletingId(null);
    }
  };

  const savePin = async (emp: any) => {
    const raw = pinDrafts[emp.id] ?? emp.deviceId ?? "";
    setPinSaving(emp.id);
    try {
      await apiFetch(`/people/employees/${emp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ deviceId: raw.trim() || null }),
      });
      notify(`${emp.name}: fingerprint PIN ${raw.trim() || "cleared"}`);
      // Drop the draft so the row reads from the refreshed employee record.
      setPinDrafts((d) => {
        const next = { ...d };
        delete next[emp.id];
        return next;
      });
      onChanged?.();
    } catch (e: any) {
      notify(e.message ?? "PIN save failed");
    } finally {
      setPinSaving(null);
    }
  };

  const copyServer = async () => {
    try {
      await navigator.clipboard.writeText(serverBase);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Copy blocked by the browser — select the URL manually");
    }
  };

  const unmapped = (employees ?? []).filter((e: any) => !e.deviceId);
  const list = devices ?? [];
  const onlineCount = list.filter((d: any) => isOnline(d)).length;
  const pins = (employees ?? [])
    .filter((e: any) => e.employmentStatus !== "EXITED")
    .filter((e: any) => !pinQuery || `${e.name} ${e.deviceId ?? ""} ${e.roleTitle ?? ""}`.toLowerCase().includes(pinQuery.toLowerCase()));

  return (
    <CardShell className="mb-4">
      <SectionTitle
        title="Fingerprint devices"
        subtitle={
          list.length
            ? `ZKTeco push (ADMS) terminals · ${onlineCount} online of ${list.length}`
            : "ZKTeco push (ADMS) terminals — auto-registered on first heartbeat"
        }
        action={<Btn variant="ghost" onClick={() => setShowGuide((v) => !v)}>{showGuide ? "Hide setup" : "Setup guide"}</Btn>}
      />

      {showGuide && (
        <div className="mb-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-body leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">On the device: Menu → COMM → Cloud Server / ADMS</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5">
            <li>
              Server address:{" "}
              <button
                onClick={copyServer}
                title="Copy server URL"
                className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-mono text-meta font-semibold text-foreground ring-1 ring-inset ring-border transition-colors hover:ring-primary/40"
              >
                {serverBase} <Copy className="size-3" /> {copied ? "copied" : "copy"}
              </button>{" "}
              — the terminal must reach it over LAN/VPN (port 80 by default).
              {loopbackBase && (
                <span className="mt-1 block text-micro">
                  That is this server's own address. Swap <span className="font-mono">localhost</span> for the machine's
                  LAN IP (run <span className="font-mono">ipconfig</span> — e.g.{" "}
                  <span className="font-mono">http://192.168.0.20:4000</span>) so the terminal, which sits on the same
                  network, can reach it.
                </span>
              )}
            </li>
            <li>Enable ADMS / push mode. The terminal then polls <span className="font-mono text-meta">/iclock/getrequest</span> and pushes punches to <span className="font-mono text-meta">/iclock/cdata</span>.</li>
            <li>Enroll staff with numeric PINs on the device, then set the same PIN as <span className="font-semibold text-foreground">Device ID</span> below. Punches then match automatically.</li>
            <li>Unknown PINs still arrive — they show as unmatched punches until mapped.</li>
          </ol>
        </div>
      )}

      {devicesError ? (
        <p className="text-body text-rose-500">Could not load devices: {devicesError.includes("role") ? "Owner / HR/Admin only" : devicesError}</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-4">
          <p className="flex items-center gap-1.5 text-body font-semibold">
            <Cpu className="size-4 text-primary" /> No device connected yet
          </p>
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            Point the terminal at{" "}
            <button
              onClick={copyServer}
              title="Copy server URL"
              className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-mono text-meta font-semibold text-foreground ring-1 ring-inset ring-border transition-colors hover:ring-primary/40"
            >
              {serverBase} <Copy className="size-3" /> {copied ? "copied" : "copy"}
            </button>{" "}
            and it will appear here by itself within a minute of its first heartbeat — no IP or serial to type in.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-micro text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Watching for a device… checking every 20 seconds
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {list.map((dev: any) => {
          const online = isOnline(dev);
          return (
            <div key={dev.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2.5">
              <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-lg", online ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>
                <Cpu className="size-4" />
                {online && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" />}
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <Input
                  value={drafts[dev.id]?.name ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), name: e.target.value } })}
                  placeholder="Device name — e.g. Main Entrance"
                  className="!py-1.5 text-body font-semibold"
                />
                <p className="mt-0.5 font-mono text-micro text-muted-foreground">
                  SN {dev.serialNumber} · {dev.punchCount ?? 0} punches{(dev.unmatchedCount ?? 0) > 0 && ` · ${dev.unmatchedCount} unmatched`} ·{" "}
                  <span className={online ? "font-semibold text-emerald-500" : undefined}>
                    {online ? "online now" : dev.lastSeenAt ? `seen ${timeAgo(dev.lastSeenAt)}` : "never seen"}
                  </span>
                </p>
              </div>
              <Input
                value={drafts[dev.id]?.location ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), location: e.target.value } })}
                placeholder="Location"
                className="!w-36 !py-1.5 text-body"
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-meta font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={drafts[dev.id]?.isActive ?? true}
                  onChange={(e) => setDrafts({ ...drafts, [dev.id]: { ...(drafts[dev.id] ?? { name: "", location: "", isActive: true }), isActive: e.target.checked } })}
                  className="size-3.5 accent-emerald-500"
                />
                Active
              </label>
              <Btn variant="outline" onClick={() => void save(dev.id)} disabled={savingId === dev.id} className="!px-3 !py-1.5 text-meta">
                {savingId === dev.id ? "Saving…" : "Save"}
              </Btn>
              <Btn variant="ghost" onClick={() => void remove(dev)} disabled={deletingId === dev.id} className="!px-2 !py-1.5 text-meta text-rose-500">
                {deletingId === dev.id ? "…" : <Trash2 className="size-3.5" />}
              </Btn>
            </div>
          );
        })}
      </div>

      {!devicesError && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
            <p className="text-meta text-muted-foreground">
              {unmapped.length > 0 ? (
                <>
                  <span className="font-bold text-amber-500">{unmapped.length} employee{unmapped.length === 1 ? "" : "s"}</span> need a fingerprint PIN
                </>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">Every active employee has a fingerprint PIN</span>
              )}
            </p>
            <Btn variant="ghost" onClick={() => setShowPins((v) => !v)} className="!px-2 !py-1 text-meta">
              {showPins ? "Hide PINs" : "Map PINs"}
            </Btn>
          </div>
          {showPins && (
            <div className="mt-2 rounded-xl border border-border/60">
              <div className="border-b border-border/50 p-2">
                <Input value={pinQuery} onChange={(e) => setPinQuery(e.target.value)} placeholder="Search employee or PIN…" className="!py-1.5 text-body" />
              </div>
              <div className="scroll-slim max-h-72 overflow-y-auto">
                {pins.map((e: any) => {
                  const value = pinDrafts[e.id] ?? e.deviceId ?? "";
                  const changed = value !== (e.deviceId ?? "");
                  return (
                    <div key={e.id} className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1.5 last:border-0">
                      <Avatar name={e.name} size="size-6" src={e.photoUrl} jxlSrc={e.photoJxlUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-meta font-semibold">{e.name}</p>
                        <p className="truncate text-micro text-muted-foreground">{e.roleTitle}</p>
                      </div>
                      <Input
                        value={value}
                        onChange={(ev) => setPinDrafts({ ...pinDrafts, [e.id]: ev.target.value })}
                        placeholder="PIN"
                        inputMode="numeric"
                        className="!w-24 !py-1 text-center font-mono text-meta"
                      />
                      <Btn
                        variant={changed ? "primary" : "ghost"}
                        onClick={() => void savePin(e)}
                        disabled={!changed || pinSaving === e.id}
                        className="!px-2.5 !py-1 text-meta"
                      >
                        {pinSaving === e.id ? "…" : "Save"}
                      </Btn>
                    </div>
                  );
                })}
                {!pins.length && <p className="p-3 text-meta text-muted-foreground">No employee matches “{pinQuery}”.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

export default function AttendancePage() {
  const [month, setMonth] = useState(monthNow());
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  // Range mode: calendar month (payroll view) or trailing 7/15/30 days.
  // Every metric section keys off `qs` so all tables stay in sync.
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const qs = rangeDays ? `days=${rangeDays}` : `month=${month}`;
  const rangeLabel = rangeDays ? `Last ${rangeDays} days` : month;
  const { data: report, loading: rpl, error: rpe } = useList<any[]>(`/people/attendance/report?${qs}`, refresh);
  const { data: lateList, loading: ll, error: le } = useList<any[]>(`/people/attendance/late-list?${qs}`, refresh);
  const { data: records, loading: rl, error: re } = useList<any[]>(`/people/attendance?${qs}`, refresh);
  const { data: live, loading: lvLoading } = useList<any>(`/people/attendance/live`, refresh);
  const { data: trends, error: te } = useList<any>(`/people/attendance/trends?${qs}`, refresh);
  const { data: punches, loading: pl, error: pe } = useList<any[]>(`/people/punches?${qs}`, refresh);
  const { data: employees, error: empErr } = useList<any[]>("/people/employees", refresh);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [kioskBusy, setKioskBusy] = useState(false);
  const [recompBusy, setRecompBusy] = useState(false);
  const [view, setView] = useState<"live" | "report" | "late" | "trends" | "daily" | "punches" | "devices">("report");
  const { flash, notify } = useToast();
  const { canEdit, isHr } = usePeopleAccess();
  const kiosk = async (action: "in" | "out") => {
    setKioskBusy(true);
    try { await apiFetch("/people/attendance/kiosk", { method: "POST", body: JSON.stringify({ action }) }); notify(action === "in" ? "Checked in - welcome!" : "Checked out - good work!"); reload(); } catch (e: any) { notify(e.message ?? "Kiosk failed"); } finally { setKioskBusy(false); }
  };
  const recompute = async () => {
    setRecompBusy(true);
    try { const r = await apiFetch<any>("/people/attendance/recompute", { method: "POST", body: JSON.stringify({ month }) }); notify(`Recomputed ${r.processed} attendance days`); reload(); } catch (e: any) { notify(e.message ?? "Recompute failed"); } finally { setRecompBusy(false); }
  };
  const mapPunch = async (p: any, employeeId: string) => {
    if (!employeeId) return;
    try { await apiFetch(`/people/punches/${p.id}/map`, { method: "PATCH", body: JSON.stringify({ employeeId }) }); notify("Punch mapped to employee"); reload(); } catch (e: any) { notify(e.message ?? "Mapping failed"); }
  };
  const totalDeduction = (s: any) => (s.lateDeduction ?? 0) + (s.halfDayDeduction ?? 0) + (s.absentDeduction ?? 0);
  // Month tables easily reach a few hundred rows — paginate instead of mounting everything.
  // Page sizes are capped so a tab fits the viewport without scrolling.
  const reportRows = useTable<any>(report, { keys: (r) => [r.name, r.roleTitle], pageSize: 8 });
  const lateRows = useTable<any>(lateList, { keys: (r) => [r.employee?.name, r.date], pageSize: 7 });
  const daily = useTable<any>(records, { keys: (r) => [r.employee?.name, r.status, r.date], pageSize: 7 });
  const punchRows = useTable<any>(punches, { keys: (p) => [p.deviceId, p.employee?.name, p.source], pageSize: 5 });

  // Overall roll-up across the visible range — the "overall report" header.
  const overall = useMemo(() => {
    const rows = report ?? [];
    const working = rows.reduce((s: number, r: any) => s + (r.workingDays ?? 0), 0);
    const unrecorded = rows.reduce((s: number, r: any) => s + (r.unrecordedDays ?? 0), 0);
    const attended = rows.reduce((s: number, r: any) => s + (r.present ?? 0) + (r.late ?? 0) + (r.halfDay ?? 0), 0);
    const worked = rows.reduce((s: number, r: any) => s + (r.workedMinutes ?? 0), 0);
    const overtime = rows.reduce((s: number, r: any) => s + (r.overtimeMinutes ?? 0), 0);
    const late = rows.reduce((s: number, r: any) => s + (r.late ?? 0), 0);
    const absent = rows.reduce((s: number, r: any) => s + (r.absent ?? 0), 0);
    // Measured days only — days nobody processed must not drag the rate down.
    const measured = Math.max(0, working - unrecorded);
    return {
      rate: measured ? Math.round((attended / measured) * 100) : 0,
      worked, overtime, late, absent, unrecorded,
      heads: rows.length,
    };
  }, [report]);
  return (
    <div>
      <Toast flash={flash} />

      <PeopleHero
        title="Attendance"
        subtitle={`${rangeLabel} · live floor, hours, late, deductions`}
        stats={[
          { label: "Rate", value: rpl ? "—" : `${overall.rate}%`, sub: `${overall.heads} people`, tone: "emerald" },
          { label: "Worked", value: rpl ? "—" : fmtDur(overall.worked), tone: "default" },
          { label: "Overtime", value: rpl ? "—" : fmtDur(overall.overtime), tone: "violet" },
          { label: "Late", value: rpl ? "—" : overall.late, sub: rangeLabel, tone: overall.late ? "amber" : "default" },
          { label: "Absent", value: rpl ? "—" : overall.absent, sub: overall.unrecorded > 0 ? `${overall.unrecorded} no record` : rangeLabel, tone: overall.absent ? "rose" : "default" },
          { label: "Inside", value: lvLoading ? "—" : `${live?.inside ?? 0}/${live?.total ?? 0}`, sub: "now", tone: "sky" },
        ]}
        actions={canEdit ? <Btn variant="primary" onClick={() => { setEdit(null); setOpen(true); }}><Plus className="size-3.5" /> Record</Btn> : undefined}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setRangeDays(null); }} className="w-full sm:!w-40 sm:!py-1 sm:text-meta" />
          {([7, 15, 30] as const).map((n) => (
            <button
              key={n}
              onClick={() => setRangeDays((d) => (d === n ? null : n))}
              className={cn(
                "rounded-lg px-3 py-2 text-body font-bold transition-colors sm:px-2 sm:py-1 sm:text-micro",
                rangeDays === n ? "bg-brand-gradient text-white" : "border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {n}D
            </button>
          ))}
          <Btn variant="outline" onClick={() => kiosk("in")} disabled={kioskBusy} className={cn("text-body sm:text-micro", kioskBusy && "opacity-60")}><Fingerprint className="size-3.5" /> Kiosk in</Btn>
          <Btn variant="outline" onClick={() => kiosk("out")} disabled={kioskBusy} className={cn("text-body sm:text-micro", kioskBusy && "opacity-60")}><Fingerprint className="size-3.5" /> Out</Btn>
          {canEdit && (
            <>
              <Btn variant="outline" onClick={() => setImportOpen(true)} className="text-body sm:text-micro"><Upload className="size-3.5" /> Import</Btn>
              <Btn variant="outline" onClick={recompute} disabled={recompBusy} className={cn("text-body sm:text-micro", recompBusy && "opacity-60")}><RotateCcw className="size-3.5" /> Recompute</Btn>
            </>
          )}
        </div>
      </PeopleHero>

      <PeopleTabs
        className="mt-2"
        value={view}
        onChange={setView}
        tabs={[
          { id: "report", label: "Report", count: overall.heads },
          { id: "live", label: "Live now", count: live?.inside ?? 0 },
          { id: "late", label: "Late", count: lateRows.total },
          { id: "trends", label: "Trends" },
          { id: "daily", label: "Daily", count: daily.total },
          { id: "punches", label: "Punches", count: punchRows.total },
          { id: "devices", label: "Devices" },
        ]}
      />

      {/* Live board — who is in the office right now */}
      <CardShell className={view === "live" ? "mt-2" : "hidden"}>
        <SectionTitle title="Live now" subtitle={`Who is in · ${live?.date ?? "today"}`} />
        {lvLoading ? (
          <p className="text-meta text-muted-foreground">Loading live board…</p>
        ) : (live?.rows ?? []).length === 0 ? (
          <p className="text-meta text-muted-foreground">No active employees.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(live?.rows ?? []).map((r: any) => (
              <Link
                key={r.employeeId}
                href={`/people/team?id=${r.employeeId}`}
                title={`${r.name} · in ${r.checkIn ? fmtTime(r.checkIn) : "—"}${r.checkOut ? ` · out ${fmtTime(r.checkOut)}` : ""}${r.hoursSoFarMinutes != null ? ` · ${fmtDur(r.hoursSoFarMinutes)} so far` : ""}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors hover:border-primary/40",
                  r.state === "inside" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : r.state === "left" ? "border-border bg-card text-muted-foreground"
                      : "border-dashed border-border text-muted-foreground/60"
                )}
              >
                <span className={cn("size-1.5 rounded-full", r.state === "inside" ? "bg-emerald-500" : r.state === "left" ? "bg-muted-foreground/50" : "bg-transparent ring-1 ring-muted-foreground/40")} />
                {r.name}
                {r.state === "inside" && r.hoursSoFarMinutes != null && <span className="tabular-nums opacity-80">{fmtDur(r.hoursSoFarMinutes)}</span>}
              </Link>
            ))}
          </div>
        )}
      </CardShell>
      <div className={view === "devices" ? "mt-2" : "hidden"}>
        <DevicesCard employees={employees ?? []} notify={notify} refreshKey={refresh} onChanged={reload} active={view === "devices"} />
      </div>
      <div className={view === "report" ? "mt-2" : "hidden"}>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Attendance + hours" subtitle={`Per-employee check-in/out totals and payroll deductions · ${rangeLabel}`} />
          <Btn variant="ghost" onClick={() => downloadCsv(`attendance-report-${rangeDays ? `${rangeDays}d` : month}.csv`, ["Employee", "Working", "Present", "Late", "Half day", "Absent", "No record", "Worked", "Avg per day", "Overtime", "Daily rate", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)"], (report ?? []).map((s: any) => [s.name, s.workingDays, s.present, s.late, s.halfDay, s.absent, s.unrecordedDays ?? 0, fmtDur(s.workedMinutes), fmtDur(s.avgWorkedMinutes), fmtDur(s.overtimeMinutes), s.dailyRate, s.lateDeduction, s.halfDayDeduction, s.absentDeduction]))}><Download className="size-3.5" /> CSV</Btn>
        </div>
        <DataTable
          loading={rpl}
          error={rpe}
          onRetry={reload}
          skeleton={6}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-meta text-muted-foreground">{reportRows.total} employees · {fmtDur(overall.worked)} worked · {fmtDur(overall.overtime)} overtime · daily rate = salary ÷ {report?.[0]?.divisor ?? "divisor"}</span>
              <Pager page={reportRows.page} pages={reportRows.pages} onPage={reportRows.setPage} total={reportRows.total} pageSize={8} label="people" />
            </div>
          }
          cols={["Employee", "Working", "Present", "Late", "Half", "Absent", "No record", "Worked", "Avg/day", "Overtime", "Daily (BDT)", "Late (BDT)", "Half-day (BDT)", "Absent (BDT)", "Total (BDT)"]}
          rows={reportRows.paged.map((s: any, i: number) => (
            <Tr key={s.employeeId ?? s.name} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={s.name} /><div><p className="font-medium"><Link href={`/people/team?id=${s.employeeId}`} className="hover:text-primary hover:underline">{s.name}</Link></p><p className="text-meta text-muted-foreground">{s.roleTitle}</p></div></div></Td>
              <Td className="font-semibold tabular-nums">{s.workingDays}</Td>
              <Td className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s.present}</Td>
              <Td className="tabular-nums text-amber-500">{s.late}</Td>
              <Td className="tabular-nums text-orange-500">{s.halfDay}</Td>
              <Td className="tabular-nums text-rose-500">{s.absent}</Td>
              <Td className="tabular-nums text-muted-foreground">
                <span title="Working days with no attendance row and no punch — never processed, not deducted">
                  {(s.unrecordedDays ?? 0) > 0 ? s.unrecordedDays : "—"}
                </span>
              </Td>
              <Td className="font-semibold tabular-nums">{fmtDur(s.workedMinutes)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtDur(s.avgWorkedMinutes)}</Td>
              <Td className={cn("tabular-nums", (s.overtimeMinutes ?? 0) > 0 ? "font-bold text-amber-500" : "text-muted-foreground")}>{(s.overtimeMinutes ?? 0) > 0 ? fmtDur(s.overtimeMinutes) : "—"}</Td>
              <Td className="tabular-nums text-muted-foreground">{formatBDT(s.dailyRate)}</Td>
              <Td className="tabular-nums text-amber-600">{s.lateDeduction ? formatBDT(s.lateDeduction) : "—"}</Td>
              <Td className="tabular-nums text-orange-600">{s.halfDayDeduction ? formatBDT(s.halfDayDeduction) : "—"}</Td>
              <Td className="tabular-nums text-rose-600">{s.absentDeduction ? formatBDT(s.absentDeduction) : "—"}</Td>
              <Td className="font-bold tabular-nums">{totalDeduction(s) ? formatBDT(totalDeduction(s)) : "—"}</Td>
            </Tr>
          ))}
        />
      </div>
      <div className={view === "late" ? "mt-2" : "hidden"}>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Late arrivals" subtitle={`Punches after shift start + grace · ${rangeLabel}`} />
          <Btn variant="ghost" onClick={() => downloadCsv(`late-list-${rangeDays ? `${rangeDays}d` : month}.csv`, ["Employee", "Date", "Check-in", "Minutes late", "Shift start", "Grace"], (lateList ?? []).map((r: any) => [r.employee?.name, String(r.date).slice(0, 10), fmtTime(r.checkInTime), r.minutesLate, r.shiftStart, r.graceMinutes]))}><Download className="size-3.5" /> CSV</Btn>
        </div>
        <DataTable
          loading={ll}
          error={le}
          onRetry={reload}
          skeleton={4}
          footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-meta text-muted-foreground">{lateRows.total} late entries</span><Pager page={lateRows.page} pages={lateRows.pages} onPage={lateRows.setPage} total={lateRows.total} pageSize={7} label="entries" /></div>}
          cols={["Employee", "Date", "Check-in", "Minutes late", "Shift start", "Grace"]}
          rows={lateRows.paged.map((r: any, i: number) => (
            <Tr key={r.id} index={i}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} size="size-7" /><p className="font-medium">{r.employee?.name}</p></div></Td>
              <Td className="text-muted-foreground">{formatDate(r.date)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtTime(r.checkInTime)}</Td>
              <Td className="font-semibold tabular-nums text-amber-500">{r.minutesLate} min</Td>
              <Td className="tabular-nums text-muted-foreground">{r.shiftStart}</Td>
              <Td className="tabular-nums text-muted-foreground">{r.graceMinutes} min</Td>
            </Tr>
          ))}
        />
      </div>
      <div className={view === "trends" ? "mt-2" : "hidden"}>
        <SectionTitle title="Trends & anomalies" subtitle={`Late / absence patterns · ${rangeLabel}`} />
        {te ? (
          <p className="text-meta text-rose-500">Could not load trends: {te}</p>
        ) : !(trends?.rows ?? []).length ? (
          <p className="text-meta text-muted-foreground">No trend data for this range.</p>
        ) : (trends.rows.every((r: any) => r.flags.length === 0) ? (
          <p className="flex items-center gap-1.5 text-body font-semibold text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="size-3.5" /> Clean sheet — no habitual lates, streaks or frequent absents in this range.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(trends.rows ?? []).filter((r: any) => r.flags.length > 0).map((r: any) => (
              <Link
                key={r.employeeId}
                href={`/people/team?id=${r.employeeId}`}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 transition-colors hover:border-amber-500/50"
              >
                <Avatar name={r.name} size="size-7" />
                <span className="min-w-0 flex-1 text-body font-bold">{r.name}</span>
                <span className="text-meta tabular-nums text-muted-foreground">{r.late} late · {r.absent} absent · avg {fmtDur(r.avgWorkedMinutes)}/day</span>
                {r.flags.map((f: string) => (
                  <span key={f} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="size-3.5" />{f}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className={view === "daily" ? "mt-2" : "hidden"}>
        <SectionTitle title="Daily records" subtitle={`${isHr ? "Click a row to fix the check-in / check-out time, status or reason · " : ""}${rangeLabel}`} />
        <TableToolbar
          q={daily.q}
          onQ={daily.setQ}
          placeholder="Search employee, status or date…"
          count={`${daily.total} record${daily.total === 1 ? "" : "s"}`}
        />
        <DataTable
          loading={rl}
          error={re}
          onRetry={reload}
          skeleton={8}
          footer={<Pager page={daily.page} pages={daily.pages} onPage={daily.setPage} total={daily.total} pageSize={7} label="records" />}
          cols={["Employee", "Date", "Status", "Check-in", "Check-out", "Worked"]}
          rows={daily.paged.map((r: any, i: number) => {
            // `checkIn`/`checkOut` are derived from punches (API-side) — the raw
            // columns can still hold the legacy in === out value.
            const cin = r.checkIn ?? r.checkInTime;
            const cout = r.checkOut ?? r.checkOutTime;
            const todayKey = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
            const isToday = String(r.date).slice(0, 10) === todayKey;
            // An unclosed past day is a missing punch, not "still working" —
            // showing now − check-in there would grow every time the page opens.
            const worked = !cin
              ? null
              : cout
                ? Math.max(0, Math.round((new Date(cout).getTime() - new Date(cin).getTime()) / 60000))
                : isToday
                  ? Math.max(0, Math.round((Date.now() - new Date(cin).getTime()) / 60000))
                  : null;
            return (
              <Tr
                key={r.id}
                index={i}
                onClick={isHr ? () => { setEdit(r); setOpen(true); } : undefined}
                className={isHr ? "cursor-pointer" : undefined}
              >
                <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} size="size-7" /><p className="font-medium">{r.employee?.name}</p>{r.isManuallyCorrected && <span title="Corrected by HR" className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-micro font-bold uppercase text-violet-500">edited</span>}</div></Td>
                <Td className="text-muted-foreground">{formatDate(r.date)}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="tabular-nums text-muted-foreground">{fmtTime(cin)}</Td>
                <Td className="tabular-nums text-muted-foreground">
                  {cout
                    ? fmtTime(cout)
                    : cin
                      ? isToday
                        ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-bold text-emerald-500">inside</span>
                        : <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-micro font-bold text-rose-500">no punch-out</span>
                      : "—"}
                </Td>
                <Td className="font-semibold tabular-nums">{fmtDur(worked)}</Td>
              </Tr>
            );
          })}
        />
      </div>
      <div className={view === "punches" ? "mt-2" : "hidden"}>
        <SectionTitle title="Raw device punches" subtitle="Fingerprint / CSV / kiosk log — map unmatched rows to employees" />
        {empErr && <p className="mb-1.5 text-meta text-rose-500">Employee list unavailable — unmatched punches cannot be mapped right now ({empErr}).</p>}
        <TableToolbar
          q={punchRows.q}
          onQ={punchRows.setQ}
          placeholder="Search device, employee or source…"
          count={`${punchRows.total} punches · ${(punches ?? []).filter((p: any) => p.unmatched).length} unmatched`}
        />
        <DataTable
          loading={pl}
          error={pe}
          onRetry={reload}
          skeleton={6}
          footer={<Pager page={punchRows.page} pages={punchRows.pages} onPage={punchRows.setPage} total={punchRows.total} pageSize={5} label="punches" />}
          cols={["Device", "Time", "Employee", "Source", "Status"]}
          rows={punchRows.paged.map((p: any, i: number) => (
            <Tr key={p.id} index={i}>
              <Td><span className="font-mono text-meta font-semibold">{p.deviceId}</span></Td>
              <Td className="tabular-nums text-muted-foreground">{new Date(p.punchTime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
              <Td>{p.employee ? <div className="flex items-center gap-2"><Avatar name={p.employee.name} size="size-6" /><span className="text-body font-medium">{p.employee.name}</span></div> : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-micro font-semibold text-amber-600 dark:text-amber-300">Unmatched</span>}</Td>
              <Td><span className={cn("rounded-full px-2 py-0.5 text-micro font-semibold", p.source === "DEVICE" ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : p.source === "KIOSK" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : p.source === "SELF" ? "bg-teal-500/10 text-teal-600 dark:text-teal-300" : "bg-primary/10 text-primary dark:text-primary")}>{p.source}</span></Td>
              <Td>{p.unmatched ? <Select className="!w-40" value="" onChange={(e) => mapPunch(p, e.target.value)}><option value="">Map to…</option>{(employees ?? []).map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}</Select> : <span className="text-meta text-muted-foreground">Mapped</span>}</Td>
            </Tr>
          ))}
        />
      </div>
      <AttendanceModal open={open} onClose={() => { setOpen(false); setEdit(null); }} employees={employees ?? []} edit={edit} onSaved={() => { notify(edit ? "Correction saved" : "Attendance recorded"); setEdit(null); reload(); }} />
      <ImportPunchModal open={importOpen} onClose={() => setImportOpen(false)} onSaved={(r) => { notify(`Imported ${r.imported} punches${r.unmatched ? ` · ${r.unmatched} unmatched` : ""}`); reload(); }} />
    </div>
  );
}
