"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarDays, Download } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, EmptyState, SectionTitle, SkeletonBlock, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { dayLabel } from "@/lib/calendar-date";
import { buildCalendarPlanPdf, downloadPdf } from "@/lib/calendar-plan-pdf";
import { label } from "@/components/calendar/types";

export default function SharedCalendarPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"EN" | "BN">("EN");

  useEffect(() => {
    if (!token) return;
    apiFetch<any>(`/public/calendar/${token}`)
      .then(setData)
      .catch((e) => setError(e.message ?? "This link is not available"));
  }, [token]);

  const grouped = useMemo(() => {
    const items: any[] = data?.type === "plan" ? data.plan?.payload?.items ?? [] : data?.items ?? [];
    const map: Record<string, any[]> = {};
    for (const i of items) if (i.date) (map[i.date] ??= []).push(i);
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <CardShell className="max-w-md text-center">
          <p className="text-[13px] font-semibold">Link unavailable</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{error}</p>
        </CardShell>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <SkeletonBlock className="h-40" />
      </div>
    );
  }

  const plan = data.type === "plan" ? data.plan : null;
  const clientName = plan?.client?.companyName ?? data.client?.companyName ?? data?.plan?.payload?.meta?.clientName ?? "";
  const title = plan?.title ?? `${clientName || "Calendar"}`;
  const totals = plan?.payload?.totals ?? plan?.totals ?? data?.totals ?? {};

  const exportPdf = async () => {
    if (!plan) return;
    const doc = await buildCalendarPlanPdf(plan, { language: lang, clientName });
    downloadPdf(doc, `${(plan.title ?? "plan").replace(/[^\w\-]+/g, "-")}.pdf`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="size-4" />
            </span>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Shared calendar</p>
              <h1 className="font-heading text-[17px] font-semibold leading-tight">{title}</h1>
              <p className="text-[11px] text-muted-foreground">
                {clientName}
                {plan?.payload?.meta?.from ? ` · ${plan.payload.meta.from} → ${plan.payload.meta.to}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {plan && (
              <>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as "EN" | "BN")}
                  className="rounded-xl border border-border bg-card px-2 py-1.5 text-[11px] font-semibold"
                >
                  <option value="EN">English</option>
                  <option value="BN">বাংলা</option>
                </select>
                <Btn variant="primary" onClick={exportPdf}>
                  <Download className="size-3.5" /> PDF
                </Btn>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Posts", totals.posts ?? 0],
            ["Tasks", totals.tasks ?? 0],
            ["Meetings", totals.meetings ?? 0],
            ["Ad flights", totals.ads ?? 0],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl border border-border/60 bg-card px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{l}</p>
              <p className="text-[18px] font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        <CardShell>
          <SectionTitle title="Schedule" subtitle="Day by day" />
          {grouped.length === 0 ? (
            <EmptyState title="Nothing scheduled" hint="The plan for this period is still being built." />
          ) : (
            <div className="flex flex-col gap-3">
              {grouped.map(([date, rows]) => (
                <div key={date}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{dayLabel(date)}</p>
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    {rows.map((r: any) => (
                      <div key={r.key ?? `${date}-${r.title}`} className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-0">
                        <span className="w-14 shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{r.time ?? "All day"}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{r.title}</span>
                        <span className="hidden shrink-0 text-[9.5px] text-muted-foreground sm:inline">
                          {(r.platforms ?? []).join(" · ") || label(r.source)}
                        </span>
                        <span className={cn("shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold", r.status === "PUBLISHED" && "bg-emerald-500/10 text-emerald-600")}>
                          {label(r.status)}
                        </span>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary hover:underline">
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardShell>

        {plan?.notes && (
          <CardShell>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{plan.notes}</p>
          </CardShell>
        )}

        <p className="text-center text-[10px] text-muted-foreground">
          Shared read-only link · only approved and client-visible work appears here.
        </p>
      </main>
    </div>
  );
}
