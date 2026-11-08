"use client";
import { useCallback, useState } from "react";
import { Plus, Target, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, EmptyState, FadeIn, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { ProgressRing } from "@/components/charts";
import { okrTone } from "../_components/constants";
import { LoadOrError, Toast, useList, useToast } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";
import { OkrModal } from "../_components/modals/performance-modals";

export default function OkrsPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: okrs, loading, error } = useList<any[]>("/people/okrs", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [open, setOpen] = useState(false);
  const { flash, notify } = useToast();
  const krProgress = (kr: any) => (kr.target > 0 ? (kr.current ?? 0) / kr.target : 0);
  const updateKr = (o: any, idx: number, current: number) => {
    const krs = o.keyResults.map((k: any, i: number) => (i === idx ? { ...k, current } : k));
    apiFetch(`/people/okrs/${o.id}`, { method: "PATCH", body: JSON.stringify({ keyResults: krs }) }).then(() => { notify("Key result updated"); reload(); }).catch((e: any) => notify(e.message ?? "Save failed"));
  };
  const removeOkr = async (o: any) => {
    try {
      await apiFetch(`/people/okrs/${o.id}`, { method: "DELETE" });
      notify("OKR deleted");
      reload();
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        icon={<Target className="size-4" />}
        title="Objectives & key results"
        subtitle="Edit the current value inline to update progress"
        stats={[
          { label: "OKRs", value: (okrs ?? []).length },
          { label: "On track", value: (okrs ?? []).filter((o: any) => o.status === "on-track").length, tone: "emerald" },
          { label: "At risk", value: (okrs ?? []).filter((o: any) => o.status === "at-risk").length, tone: "amber" },
          { label: "Avg progress", value: `${(okrs ?? []).length ? Math.round((okrs ?? []).reduce((s: number, o: any) => s + Number(o.progress ?? 0), 0) / (okrs ?? []).length) : 0}%`, tone: "sky" },
        ]}
        actions={<Btn variant="primary" onClick={() => setOpen(true)} className="!px-2.5 !py-1.5 text-[11px]"><Plus className="size-3.5" /> OKR</Btn>}
      />
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={4} />
      {!loading && !error && (
        <FadeIn>
          {(okrs ?? []).length === 0 ? (
            <EmptyState title="No OKRs yet" hint="Add the first objective for the team" />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(okrs ?? []).map((o: any) => (
                <CardShell key={o.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-heading font-semibold">{o.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{o.employee?.name} · {o.quarter}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", okrTone[o.status] ?? okrTone["at-risk"])}>{o.status}</span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {(o.keyResults ?? []).map((kr: any, i: number) => (
                      <div key={i}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11.5px] text-muted-foreground">{kr.title}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <input type="number" min={0} defaultValue={kr.current ?? 0} onBlur={(e) => updateKr(o, i, Number(e.target.value) || 0)} className="w-16 rounded-lg border border-border bg-muted/40 px-1.5 py-0.5 text-right text-[11px] font-bold tabular-nums outline-none transition-colors focus:border-primary/40" />
                            <span className="text-[10.5px] text-muted-foreground">/ {kr.target}</span>
                          </div>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", krProgress(kr) >= 1 ? "bg-emerald-500" : "bg-brand-gradient")} style={{ width: `${Math.min(krProgress(kr) * 100, 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-3">
                    <ProgressRing value={o.overallProgress ?? 0} size={48} />
                    <button onClick={() => removeOkr(o)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete OKR"><Trash2 className="size-4" /></button>
                  </div>
                </CardShell>
              ))}
            </div>
          )}
        </FadeIn>
      )}
      <OkrModal open={open} onClose={() => setOpen(false)} employees={employees ?? []} onSaved={() => { notify("OKR added"); reload(); }} />
    </div>
  );
}
