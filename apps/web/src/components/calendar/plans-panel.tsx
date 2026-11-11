"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Copy,
  Download,
  FileText,
  Lock,
  Plus,
  Send,
  Unlock,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn, CardShell, SectionTitle, SkeletonBlock } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { CalendarClient, label } from "./types";
import { addDays, dayLabel, dhakaDay, todayISO, weekDates } from "@/lib/calendar-date";
import { buildCalendarPlanPdf, buildVariancePdf, downloadPdf } from "@/lib/calendar-plan-pdf";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  IN_REVIEW: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  LOCKED: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  PUBLISHED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function PlansPanel({ clients }: { clients: CalendarClient[] }) {
  const [plans, setPlans] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [scope, setScope] = useState<"MONTH" | "WEEK">("MONTH");
  const [clientId, setClientId] = useState("");
  const [anchor, setAnchor] = useState(todayISO());
  const [language, setLanguage] = useState<"EN" | "BN">("EN");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [variance, setVariance] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [showUnlock, setShowUnlock] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(() => {
    setErr(null);
    apiFetch<any[]>("/calendar/plans")
      .then(setPlans)
      .catch((e) => setErr(e.message ?? "Could not load plans"));
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const createPlan = async () => {
    setCreating(true);
    setErr(null);
    try {
      const body: any = { scope, clientId: clientId || null, language };
      if (scope === "MONTH") body.month = anchor.slice(0, 7);
      else body.date = anchor;
      const plan = await apiFetch<any>("/calendar/plans", { method: "POST", body: JSON.stringify(body) });
      setRefresh((r) => r + 1);
      setDetail(plan);
      notify("Plan draft created");
    } catch (e: any) {
      setErr(e.message ?? "Could not create the plan");
    } finally {
      setCreating(false);
    }
  };

  const openPlan = async (id: string) => {
    setVariance(null);
    setShareUrl(null);
    setShowUnlock(false);
    setUnlockReason("");
    try {
      const plan = await apiFetch<any>(`/calendar/plans/${id}`);
      setDetail(plan);
      setNotes(plan.notes ?? "");
      setLanguage(plan.language === "BN" ? "BN" : "EN");
    } catch (e: any) {
      notify(e.message ?? "Could not open the plan");
    }
  };

  const act = async (path: string, body?: any) => {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await apiFetch<any>(`/calendar/plans/${detail.id}${path}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setDetail((d: any) => ({ ...d, ...updated, payload: updated.payload ?? d.payload }));
      setRefresh((r) => r + 1);
      notify(path.includes("lock") ? "Plan locked (soft)" : path.includes("publish") ? "Published to the client portal" : "Done");
      if (path === "/share") setShareUrl(updated.url);
    } catch (e: any) {
      notify(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await apiFetch<any>(`/calendar/plans/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes, language }),
      });
      setDetail((d: any) => ({ ...d, ...updated, payload: d.payload }));
      notify("Saved");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const loadVariance = async () => {
    if (!detail) return;
    try {
      setVariance(await apiFetch<any>(`/calendar/plans/${detail.id}/variance`));
    } catch (e: any) {
      notify(e.message ?? "Could not compare");
    }
  };

  const exportPdf = async () => {
    if (!detail) return;
    try {
      const doc = await buildCalendarPlanPdf(detail, {
        language: (detail.language as "EN" | "BN") ?? "EN",
        clientName: detail.client?.companyName,
      });
      downloadPdf(doc, `${(detail.title ?? "calendar-plan").replace(/[^\w\-]+/g, "-")}.pdf`);
    } catch (e: any) {
      notify(e.message ?? "PDF failed");
    }
  };

  const exportVariancePdf = () => {
    if (!variance || !detail) return;
    const doc = buildVariancePdf(variance, detail, {
      language: (detail.language as "EN" | "BN") ?? "EN",
      clientName: detail.client?.companyName,
    });
    downloadPdf(doc, `${(detail.title ?? "plan").replace(/[^\w\-]+/g, "-")}-variance.pdf`);
  };

  const exportCsv = () => {
    if (!detail) return;
    const items = detail.payload?.items ?? [];
    const header = ["Date", "Time", "Source", "Title", "Platforms", "Owner", "Status", "Approval"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = items.map((i: any) =>
      [i.date, i.time ?? "", i.source, i.title, (i.platforms ?? []).join("|"), i.owner ?? "", i.status, i.approval ?? ""]
        .map(esc)
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + [header.join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(detail.title ?? "plan").replace(/[^\w\-]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removePlan = async (id: string) => {
    if (!confirm("Delete this plan? The calendar items stay untouched.")) return;
    await apiFetch(`/calendar/plans/${id}`, { method: "DELETE" }).catch(() => null);
    setDetail(null);
    setRefresh((r) => r + 1);
  };

  const coverage = useMemo(() => {
    if (!detail) return null;
    const items: any[] = detail.payload?.items ?? [];
    const posts = items.filter((i) => i.source === "CONTENT_POST");
    const days = new Set(posts.map((i) => i.date));
    const from = detail.payload?.meta?.from;
    const to = detail.payload?.meta?.to;
    let gapDays: string[] = [];
    if (from && to) {
      const total: string[] = [];
      let cur = from;
      for (let i = 0; i < 400 && cur <= to; i++) {
        total.push(cur);
        cur = addDays(cur, 1);
      }
      gapDays = total.filter((d) => !days.has(d));
    }
    return {
      posts: posts.length,
      daysCovered: days.size,
      gapDays,
      pending: items.filter((i) => i.approval === "INTERNAL_REVIEW").length,
      tasks: items.filter((i) => i.source === "TASK").length,
      meetings: items.filter((i) => i.source === "EVENT").length,
      ads: items.filter((i) => i.source === "AD_FLIGHT").length,
    };
  }, [detail]);

  const grouped = useMemo(() => {
    const items: any[] = detail?.payload?.items ?? [];
    const map: Record<string, any[]> = {};
    for (const i of items) (map[i.date] ??= []).push(i);
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [detail]);

  return (
    <div className="flex flex-col gap-4">
      {toast && (
        <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12px] font-medium text-white shadow-xl">
          {toast}
        </div>
      )}

      <CardShell>
        <SectionTitle title="Plans & reports" subtitle="Build the week or month, lock it, send it to the client, then compare plan vs actual." />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="MONTH">Monthly</option>
              <option value="WEEK">Weekly</option>
            </Select>
          </Field>
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">All clients (agency)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </Select>
          </Field>
          <Field label={scope === "MONTH" ? "Month" : "Week of"}>
            <Input type={scope === "MONTH" ? "month" : "date"} value={scope === "MONTH" ? anchor.slice(0, 7) : anchor} onChange={(e) => setAnchor(scope === "MONTH" ? `${e.target.value}-01` : e.target.value)} />
          </Field>
          <Field label="Report language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as any)}>
              <option value="EN">English</option>
              <option value="BN">বাংলা</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Btn variant="primary" onClick={createPlan} disabled={creating} className="!w-full">
              <Plus className="size-3.5" /> {creating ? "Building…" : "Generate draft"}
            </Btn>
          </div>
        </div>
        <p className="mt-2 text-[10.5px] text-muted-foreground">
          A draft snapshots every post, meeting, task, deliverable and ad flight in the period — nothing is retyped.
        </p>
      </CardShell>

      {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}

      {plans === null ? (
        <SkeletonBlock className="h-60" />
      ) : plans.length === 0 ? (
        <CardShell>
          <p className="py-8 text-center text-[12px] text-muted-foreground">No plans yet. Generate the first one above.</p>
        </CardShell>
      ) : (
        <TableShell footer={<span className="text-[11px] text-muted-foreground">{plans.length} plan{plans.length === 1 ? "" : "s"}</span>}>
          <table className="w-full">
            <THead>
              <Th>Plan</Th>
              <Th>Client</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>v</Th>
              <Th>Actions</Th>
            </THead>
            <tbody>
              {plans.map((p, i) => (
                <Tr key={p.id} index={i} onClick={() => openPlan(p.id)}>
                  <Td className="max-w-64">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="text-[10px] text-muted-foreground">{p.scope.toLowerCase()} plan</p>
                  </Td>
                  <Td className="text-muted-foreground">{p.client?.companyName ?? "Agency"}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {dhakaDay(p.periodStart)} → {dhakaDay(p.periodEnd)}
                  </Td>
                  <Td>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_TONE[p.status] ?? STATUS_TONE.DRAFT)}>
                      {label(p.status)}
                    </span>
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">{p.version}</Td>
                  <Td>
                    <button onClick={(e) => { e.stopPropagation(); openPlan(p.id); }} className="text-[11px] font-semibold text-primary hover:underline">
                      Open
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? "Plan"} subtitle={detail ? `${detail.client?.companyName ?? "Agency"} · v${detail.version} · ${label(detail.status)}` : ""} size="2xl">
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Posts" value={coverage?.posts ?? 0} sub={`${coverage?.daysCovered ?? 0} days covered`} />
              <Kpi label="In review" value={coverage?.pending ?? 0} sub="needs approval" />
              <Kpi label="Tasks" value={coverage?.tasks ?? 0} sub="due in period" />
              <Kpi label="Ad flights" value={coverage?.ads ?? 0} sub={`${coverage?.meetings ?? 0} meetings`} />
            </div>

            {coverage && coverage.gapDays.length > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
                {coverage.gapDays.length} day{coverage.gapDays.length > 1 ? "s" : ""} with no content:{" "}
                {coverage.gapDays.slice(0, 8).map((d) => d.slice(5)).join(", ")}
                {coverage.gapDays.length > 8 ? "…" : ""}
              </div>
            )}

            {Array.isArray(detail.payload?.mix) && detail.payload.mix.length > 0 && (
              <div className="rounded-xl border border-border/60 px-3 py-2">
                <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Content mix vs target</p>
                <div className="flex flex-col gap-1.5">
                  {detail.payload.mix.map((m: any) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-[10.5px] font-medium">{m.name}</span>
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, m.pct)}%`, background: m.color }} />
                        <span className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${Math.min(100, m.targetPct)}%` }} title={`Target ${m.targetPct}%`} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-[9.5px] tabular-nums text-muted-foreground">
                        {m.pct}% / {m.targetPct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <Btn variant="outline" onClick={exportPdf}><FileText className="size-3.5" /> PDF</Btn>
              <Btn variant="outline" onClick={exportCsv}><Download className="size-3.5" /> CSV</Btn>
              <Btn variant="outline" onClick={() => act("/share")} disabled={busy}><Copy className="size-3.5" /> Share link</Btn>
              {detail.status === "DRAFT" ? (
                <Btn variant="primary" onClick={() => act("/lock")} disabled={busy}><Lock className="size-3.5" /> Lock plan</Btn>
              ) : (
                <Btn variant="outline" onClick={() => setShowUnlock(true)} disabled={busy}><Unlock className="size-3.5" /> Unlock</Btn>
              )}
              {detail.status !== "PUBLISHED" && (
                <Btn variant="primary" onClick={() => act("/publish")} disabled={busy}><Send className="size-3.5" /> Publish to client</Btn>
              )}
              <Btn variant="ghost" onClick={() => removePlan(detail.id)} className="!text-rose-500"><Trash2 className="size-3.5" /> Delete</Btn>
            </div>

            {detail.status === "LOCKED" && (
              <p className="rounded-lg bg-sky-500/5 px-2.5 py-1.5 text-[11px] text-sky-600 dark:text-sky-300">
                Soft lock: the plan snapshot is frozen for reporting, but the calendar stays editable. Unlock records a reason.
              </p>
            )}

            {shareUrl && (
              <div className="flex items-center gap-2 rounded-xl border border-border/60 px-2.5 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px]">{`${window.location.origin}${shareUrl}`}</code>
                <Btn variant="outline" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${shareUrl}`)}>Copy</Btn>
              </div>
            )}

            {showUnlock && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Why are you unlocking?</p>
                <Textarea value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} className="min-h-12 text-[12px]" />
                <div className="flex gap-1.5">
                  <Btn variant="primary" disabled={busy || !unlockReason.trim()} onClick={() => { act("/unlock", { reason: unlockReason }); setShowUnlock(false); }}>
                    Unlock
                  </Btn>
                  <Btn variant="ghost" onClick={() => setShowUnlock(false)}>Cancel</Btn>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
              <Field label="Notes for the client">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14 text-[12px]" />
              </Field>
              <div className="flex flex-col gap-1.5">
                <Field label="Language">
                  <Select value={language} onChange={(e) => setLanguage(e.target.value as any)}>
                    <option value="EN">English</option>
                    <option value="BN">বাংলা</option>
                  </Select>
                </Field>
                <Btn variant="outline" onClick={saveNotes} disabled={busy}>Save</Btn>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Plan preview</p>
                <button onClick={loadVariance} className="text-[11px] font-semibold text-primary hover:underline">Compare with actual →</button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60">
                {grouped.length === 0 && <p className="p-4 text-center text-[11.5px] text-muted-foreground">Nothing in this period.</p>}
                {grouped.map(([date, rows]) => (
                  <div key={date} className="border-b border-border/40 last:border-0">
                    <p className="bg-muted/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{dayLabel(date)}</p>
                    {rows.map((r: any) => (
                      <div key={r.key} className="flex items-center gap-2 px-2.5 py-1 text-[11px]">
                        <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{r.time ?? "All day"}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                        <span className="shrink-0 text-[9.5px] text-muted-foreground">{r.platforms?.join(" · ") || label(r.source)}</span>
                        <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-semibold">{label(r.status)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {variance && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Plan vs actual</p>
                  <Btn variant="outline" onClick={exportVariancePdf}><FileText className="size-3.5" /> Variance PDF</Btn>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi label="Published" value={variance.actual.published} sub={`of ${variance.planned.posts} planned`} />
                  <Kpi label="Missed" value={variance.actual.missed} sub="not delivered" />
                  <Kpi label="Rescheduled" value={variance.actual.moved} sub="date changed" />
                  <Kpi label="On time" value={`${variance.actual.onTimePct}%`} sub="publish rate" />
                </div>
                {variance.slipped.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-border/60">
                    {variance.slipped.slice(0, 40).map((s: any) => (
                      <div key={s.key} className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1 text-[10.5px] last:border-0">
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="shrink-0 text-muted-foreground">{s.date?.slice(5)}</span>
                        <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-600 dark:text-amber-300">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ label: lbl, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{lbl}</p>
      <p className="text-[16px] font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[9.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
