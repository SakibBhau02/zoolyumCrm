"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Save, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, EmptyState, SectionTitle, SkeletonBlock, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Select } from "@/components/ui";
import { DAYS, dayShort } from "../_components/constants";
import { Toast, useList, useToast } from "../_components/hooks";

export default function SettingsPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: policy, loading, error } = useList<any>("/people/attendance-policy", refresh);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const { flash, notify } = useToast();
  useEffect(() => {
    if (policy && !f) setF({ ...policy, lateLadder: (policy.lateLadder ?? []).map((e: any) => ({ lates: e.lates, days: e.days })) });
  }, [policy, f]);
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!f) return;
    setBusy(true);
    try {
      await apiFetch("/people/attendance-policy", { method: "PATCH", body: JSON.stringify({ ...f, lateLadder: f.lateLadder.filter((r: any) => Number(r.lates) > 0).map((r: any) => ({ lates: Number(r.lates), days: Number(r.days) })) }) });
      setF(null);
      reload();
      notify("Attendance policy saved");
    } catch (e2: any) { notify(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  const toggleDay = (d: string) => setF({ ...f, weeklyOffDays: f.weeklyOffDays.includes(d) ? f.weeklyOffDays.filter((x: string) => x !== d) : [...f.weeklyOffDays, d] });
  const setLadder = (i: number, key: "lates" | "days", v: string) => {
    const ladder = f.lateLadder.map((r: any, ri: number) => (ri === i ? { ...r, [key]: v } : r));
    setF({ ...f, lateLadder: ladder });
  };
  if (loading) return <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>;
  if (error) return <EmptyState title={error.includes("role") ? "Owner / HR/Admin only" : error} hint="Attendance policy is managed by the Owner or HR/Admin" />;
  if (!f) return null;
  const ladderSummary = f.lateLadder.filter((r: any) => Number(r.lates) > 0).sort((a: any, b: any) => a.lates - b.lates).map((r: any) => `${r.lates} lates → ${r.days} day(s)`).join(", ");
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Attendance policy" subtitle="Company-wide rules for shifts, weekly off and late deductions" />
          <Btn variant="primary" onClick={save} className={busy ? "opacity-60" : ""}><Save className="size-3.5" /> Save policy</Btn>
        </div>
        <CardShell>
          <form onSubmit={save} className="flex flex-col gap-5 p-5">
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Weekly off days</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDay(d)} className={cn("rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors", f.weeklyOffDays.includes(d) ? "bg-brand-gradient text-white" : "bg-muted text-muted-foreground hover:bg-muted/70")}>{dayShort[d]}</button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Days without punches are not treated as absent. Employees can override in Directory.</p>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Shift start (HH:MM)"><Input value={f.shiftStart} onChange={(e) => setF({ ...f, shiftStart: e.target.value })} placeholder="10:00" /></Field>
              <Field label="Shift end (HH:MM)"><Input value={f.shiftEnd} onChange={(e) => setF({ ...f, shiftEnd: e.target.value })} placeholder="18:00" /></Field>
              <Field label="Late grace (minutes)"><Input type="number" min={0} value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: e.target.value })} placeholder="15" /></Field>
              <Field label="Half-day cutoff (HH:MM)"><Input value={f.halfDayCutoff} onChange={(e) => setF({ ...f, halfDayCutoff: e.target.value })} placeholder="12:00" /></Field>
              <Field label="Overtime threshold (minutes)" hint="Extra time below this is ignored"><Input type="number" min={0} value={f.overtimeThresholdMinutes ?? 30} onChange={(e) => setF({ ...f, overtimeThresholdMinutes: Number(e.target.value) })} placeholder="30" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Daily rate divisor">
                <Select value={String(f.dailyRateDivisor)} onChange={(e) => setF({ ...f, dailyRateDivisor: Number(e.target.value) })}>
                  <option value="26">26 working days / month</option>
                  <option value="30">30 calendar days / month</option>
                  <option value="0">Auto — actual working days</option>
                </Select>
              </Field>
              <Field label="Half-day = half LOP">
                <Select value={f.proRataEnabled ? "true" : "false"} onChange={(e) => setF({ ...f, proRataEnabled: e.target.value === "true" })}>
                  <option value="true">Half-day LOP (0.5 day)</option>
                  <option value="false">Full-day LOP (1 day)</option>
                </Select>
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Late ladder — N lates in a month = 1 day deduction</p>
              <div className="flex flex-col gap-2">
                {f.lateLadder.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="number" min={1} value={r.lates} onChange={(e) => setLadder(i, "lates", e.target.value)} className="!w-24" placeholder="Lates" />
                    <span className="text-[11.5px] text-muted-foreground">lates =</span>
                    <Input type="number" min={1} value={r.days} onChange={(e) => setLadder(i, "days", e.target.value)} className="!w-24" placeholder="Days" />
                    <span className="text-[11.5px] text-muted-foreground">day(s) off salary</span>
                    <button type="button" onClick={() => setF({ ...f, lateLadder: f.lateLadder.filter((_: any, ri: number) => ri !== i) })} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><Trash2 className="size-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setF({ ...f, lateLadder: [...f.lateLadder, { lates: "", days: "" }] })} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><Plus className="size-3.5" /> Add ladder step</button>
              </div>
              {ladderSummary && <p className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">Current rule: every <span className="font-semibold text-foreground">{ladderSummary}</span> deducted from monthly pay.</p>}
            </div>
          </form>
        </CardShell>
      </div>
      <CardShell>
        <div className="flex flex-col gap-4 p-5">
          <SectionTitle title="How payroll deductions work" subtitle="Calculated per working day in the pay period" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-[12.5px] font-bold">Late arrival</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">Punch after shift start + grace counts as late. Lates accumulate against the ladder above and convert into full-day deductions.</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-[12.5px] font-bold">Half day</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">First punch after the half-day cutoff counts as a half day — 0.5 day LOP per the setting above.</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-[12.5px] font-bold">Absent & unpaid leave</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">No punch on a working day = absent, 1 day LOP. Approved casual / sick / earned leave never deducts; only unpaid leave does.</p>
            </div>
          </div>
          <p className="text-[11.5px] text-muted-foreground">Daily rate = monthly salary ÷ {f.dailyRateDivisor === 0 ? "actual working days" : `${f.dailyRateDivisor} (divisor)`}. Working on a weekly off day counts as present — no extra pay.</p>
        </div>
      </CardShell>
      <div className="mt-4">
        <WorkCalendarCard notify={notify} />
      </div>
      <div className="mt-4">
        <LeaveQuotasCard notify={notify} />
      </div>
    </div>
  );
}

const WD_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/**
 * Monthly work calendar — per-date open/closed exceptions to the weekly rhythm.
 * Click a day to flip it: a weekly-off Saturday becomes a working day (or back
 * to default); a weekday becomes a closed day (or back). Past months are locked
 * server-side because payroll already ran on them.
 */
function WorkCalendarCard({ notify }: { notify: (m: string) => void }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data, loading } = useList<any>(`/people/work-calendar?month=${month}`, refresh);
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const overrides = useMemo<Map<string, { id: string; date: string; isOpen: boolean; note?: string | null }>>(
    () => new Map((data?.overrides ?? []).map((o: any) => [o.date, o])),
    [data]
  );
  const holidays = useMemo<Map<string, string>>(
    () => new Map((data?.holidays ?? []).map((h: any) => [h.date, h.name])),
    [data]
  );
  const offSet = useMemo(() => new Set(data?.weeklyOffDays ?? []), [data]);

  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const out: (null | { date: string; day: number; dow: string })[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ date, day: d, dow: WD_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] });
    }
    return out;
  }, [month]);

  const stateOf = (c: { date: string; dow: string }) => {
    const ov = overrides.get(c.date);
    if (ov) return ov.isOpen ? "open-ex" : "closed-ex";
    if (holidays.has(c.date)) return "holiday";
    if (offSet.has(c.dow)) return "off";
    return "working";
  };

  const save = async (isOpen: boolean | null) => {
    if (!sel) return;
    setBusy(true);
    try {
      const existing = overrides.get(sel);
      if (isOpen == null) {
        if (existing) await apiFetch(`/people/work-calendar/${existing.id}`, { method: "DELETE" });
      } else {
        await apiFetch(`/people/work-calendar`, {
          method: "POST",
          body: JSON.stringify({ date: sel, isOpen, note: note.trim() || undefined }),
        });
      }
      setSel(null);
      setNote("");
      reload();
      notify(isOpen == null ? "Back to weekly default" : isOpen ? "Saturday opened for work" : "Day closed");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const selCell = sel ? cells.find((c) => c?.date === sel) ?? null : null;
  const selDefaultOpen = selCell ? !offSet.has(selCell.dow) && !holidays.has(selCell.date) : true;

  return (
    <CardShell>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="Monthly work calendar" subtitle="Open a Saturday, or close a weekday — exceptions to the weekly off pattern" />
          <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setSel(null); }} className="!w-44" />
        </div>
        {loading ? (
          <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <p key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{d}</p>
              ))}
              {cells.map((c, i) =>
                !c ? <span key={`x${i}`} /> : (
                  <button
                    key={c.date}
                    type="button"
                    onClick={() => { setSel(c.date); setNote(overrides.get(c.date)?.note ?? ""); }}
                    title={`${c.date} — ${c.dow.charAt(0)}${c.dow.slice(1).toLowerCase()} · ${overrides.has(c.date) ? "click to edit/remove override" : !offSet.has(c.dow) && !holidays.has(c.date) ? "working by default — click to close" : "off by default — click to open"}`}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-[11px] font-semibold transition-all",
                      sel === c.date ? "border-primary ring-2 ring-primary/30" : "border-border/60 hover:border-primary/40",
                      stateOf(c) === "working" && "bg-card text-foreground",
                      stateOf(c) === "off" && "bg-muted/50 text-muted-foreground",
                      stateOf(c) === "holiday" && "bg-violet-500/10 text-violet-600 dark:text-violet-300",
                      stateOf(c) === "open-ex" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                      stateOf(c) === "closed-ex" && "border-rose-500/50 bg-rose-500/10 text-rose-500"
                    )}
                  >
                    <span className="tabular-nums">{c.day}</span>
                    <span className="text-[8.5px] font-bold uppercase leading-none">
                      {stateOf(c) === "open-ex" ? "open" : stateOf(c) === "closed-ex" ? "closed" : stateOf(c) === "holiday" ? "holiday" : stateOf(c) === "off" ? "off" : ""}
                    </span>
                  </button>
                )
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10.5px] font-semibold text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-foreground" /> working</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted-foreground/50" /> weekly off</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-violet-500" /> holiday</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" /> opened</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-rose-500" /> closed</span>
            </div>
            {sel && selCell && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                <CalendarDays className="size-4 shrink-0 text-primary" />
                <span className="text-[12px] font-bold">{sel} ({selCell.dow}, default {selDefaultOpen ? "open" : "closed"})</span>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note — e.g. Release crunch Saturday"
                  className="min-w-40 flex-1 !py-1.5 text-[12px]"
                />
                <Btn variant="primary" onClick={() => save(true)} disabled={busy} className="!py-1.5">Open</Btn>
                <Btn variant="outline" onClick={() => save(false)} disabled={busy} className="!py-1.5">Close</Btn>
                {overrides.has(sel) && <Btn variant="ghost" onClick={() => save(null)} disabled={busy} className="!py-1.5">Back to default</Btn>}
              </div>
            )}
          </>
        )}
      </div>
    </CardShell>
  );
}

const LEAVE_TYPES = ["CASUAL", "SICK", "EARNED", "UNPAID"] as const;

/**
 * Yearly leave quotas — one number per type, effective for every employee.
 * Balances are (re)created per employee from these rows; UNPAID is always
 * unlimited and never touches a balance.
 */
function LeaveQuotasCard({ notify }: { notify: (m: string) => void }) {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: policies, loading } = useList<any[]>(`/people/leave-policies`, refresh);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(() => `${new Date().getFullYear()}`);
  const [reset, setReset] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);

  useEffect(() => {
    if (policies && Object.keys(draft).length === 0) {
      const d: Record<string, string> = {};
      for (const t of LEAVE_TYPES) {
        const p = (policies ?? []).find((x: any) => x.leaveType === t);
        d[t] = p?.annualDays != null ? String(p.annualDays) : "";
      }
      setDraft(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies]);

  const save = async () => {
    setBusy(true);
    try {
      await apiFetch(`/people/leave-policies`, {
        method: "PATCH",
        body: JSON.stringify({
          policies: LEAVE_TYPES.filter((t) => t !== "UNPAID").map((t) => ({
            leaveType: t,
            annualDays: draft[t] === "" ? null : Number(draft[t]),
          })),
        }),
      });
      notify("Leave quotas saved — applies to every employee");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    if (reset && !window.confirm(`Delete ALL ${period} balances and re-seed from quotas? Last year's leftovers will be gone.`)) return;
    setSeedBusy(true);
    try {
      const r = await apiFetch<any>(`/people/leave-balances/ensure`, {
        method: "POST",
        body: JSON.stringify({ period, reset }),
      });
      notify(`Balances ready for ${r.period}: ${r.created} created across ${r.employees} employees`);
    } catch (e: any) {
      notify(e.message ?? "Seed failed");
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <CardShell>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="Yearly leave quotas" subtitle="Days per year per type — same for every employee, balances derive from here" />
          <Btn variant="primary" onClick={save} disabled={busy} className={busy ? "opacity-60" : ""}><Save className="size-3.5" /> Save quotas</Btn>
        </div>
        {loading ? (
          <div className="flex flex-col gap-2">{[...Array(2)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(["CASUAL", "SICK", "EARNED"] as const).map((t) => (
              <Field key={t} label={`${t.charAt(0)}${t.slice(1).toLowerCase()} (days/year)`}>
                <Input
                  type="number" min={0} step={0.5}
                  value={draft[t] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [t]: e.target.value })}
                  placeholder="e.g. 10"
                />
              </Field>
            ))}
            <Field label="Unpaid">
              <Input value="Unlimited" disabled className="opacity-60" />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <span className="text-[12px] font-bold">Balances for year</span>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026" className="!w-24 !py-1.5" />
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} className="size-3.5 accent-rose-500" />
            Reset first (January reset — deletes existing rows)
          </label>
          <Btn variant="outline" onClick={seed} disabled={seedBusy} className="!py-1.5">{seedBusy ? "Working…" : "Seed balances"}</Btn>
          <span className="text-[11px] text-muted-foreground">Missing rows are created; existing balances are never overwritten unless reset.</span>
        </div>
      </div>
    </CardShell>
  );
}
