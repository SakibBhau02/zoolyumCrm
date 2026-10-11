"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
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
    </div>
  );
}
