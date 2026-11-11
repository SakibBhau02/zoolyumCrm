"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { cn, CardShell, SectionTitle } from "@/components/shared";
import { Btn } from "@/components/table";
import { CalendarClient, PLATFORM_LABEL, PLATFORM_STYLE, label } from "./types";
import { dayLabel, endOfMonth, parseISO, startOfMonth, todayISO } from "@/lib/calendar-date";

type CampaignRow = {
  id: string;
  clientId: string;
  clientName?: string;
  name: string;
  status: string;
  start: string;
  end: string;
  color: string;
  platforms: string[];
  posts: number;
};
type FlightRow = {
  id: string;
  clientId: string;
  clientName?: string;
  campaignName?: string;
  name: string;
  platform: string;
  status: string;
  start: string;
  end: string;
  plannedSpend: number;
  actualSpend: number;
};

export function TimelineView({
  anchor,
  campaigns,
  flights,
  clients,
  onOpenFlight,
  onNewCampaign,
  onOpenClient,
}: {
  anchor: string;
  campaigns: CampaignRow[];
  flights: FlightRow[];
  clients: CalendarClient[];
  onOpenFlight: (flight: FlightRow) => void;
  onNewCampaign: () => void;
  onOpenClient: (id: string) => void;
}) {
  const from = startOfMonth(anchor);
  const to = endOfMonth(anchor);
  const monthStart = parseISO(from);
  const monthEnd = parseISO(to);
  const totalDays = parseISO(to).getDate();
  const today = todayISO();
  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, "0")}`), [from, totalDays]);

  const rows = useMemo(() => {
    const map = new Map<string, { client: CalendarClient | undefined; id: string; name: string; campaigns: CampaignRow[]; flights: FlightRow[] }>();
    const ensure = (id: string, name?: string) => {
      if (!map.has(id)) {
        map.set(id, { id, name: name ?? clients.find((c) => c.id === id)?.companyName ?? "Client", client: clients.find((c) => c.id === id), campaigns: [], flights: [] });
      }
      return map.get(id)!;
    };
    for (const c of campaigns) ensure(c.clientId, c.clientName).campaigns.push(c);
    for (const f of flights) ensure(f.clientId, f.clientName).flights.push(f);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [campaigns, flights, clients]);

  const bar = (start: string, end: string) => {
    const s = parseISO(start);
    const e = parseISO(end);
    // A campaign or flight can start before / end after the visible month:
    // clamp to the month edge instead of using the raw day-of-month (which
    // produced one-day slivers for cross-month spans).
    const startDay = s < monthStart ? 1 : s > monthEnd ? totalDays : s.getDate();
    const endDay = e > monthEnd ? totalDays : e < monthStart ? 1 : e.getDate();
    const span = Math.max(1, endDay - startDay + 1);
    return { left: `${((startDay - 1) / totalDays) * 100}%`, width: `${(span / totalDays) * 100}%` };
  };

  return (
    <div className="flex flex-col gap-4">
      <CardShell>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Campaign timeline" subtitle="Campaigns, ad flights and posting volume by client" />
          <Btn variant="primary" onClick={onNewCampaign}>
            <Plus className="size-3.5" /> New campaign
          </Btn>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="mb-1 flex">
              <div className="w-44 shrink-0" />
              <div className="relative flex-1 border-b border-border/60">
                <div className="flex">
                  {days.map((d) => (
                    <div
                      key={d}
                      className={cn(
                        "flex-1 border-r border-border/30 py-1 text-center text-[8.5px] font-semibold tabular-nums",
                        d === today ? "bg-primary/10 text-primary" : "text-muted-foreground"
                      )}
                    >
                      {Number(d.slice(8))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {rows.length === 0 && (
              <p className="py-10 text-center text-[12px] text-muted-foreground">No campaigns or ad flights this month.</p>
            )}

            {rows.map((row) => (
              <div key={row.id} className="flex border-b border-border/40 py-2 last:border-0">
                <button onClick={() => onOpenClient(row.id)} className="w-44 shrink-0 pr-2 text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: row.client?.calendarColor ?? "#7C3AED" }} />
                    <span className="truncate text-[11.5px] font-semibold">{row.name}</span>
                  </span>
                  <span className="block text-[9.5px] text-muted-foreground">
                    {row.campaigns.length} campaign{row.campaigns.length === 1 ? "" : "s"} · {row.flights.length} flight{row.flights.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="relative flex-1">
                  <div className="flex h-full">
                    {days.map((d) => (
                      <div key={d} className={cn("flex-1 border-r border-border/20", d === today && "bg-primary/[0.04]")} />
                    ))}
                  </div>
                  <div className="absolute inset-0 flex flex-col gap-1 py-0.5">
                    {row.campaigns.map((c) => (
                      <div key={c.id} className="relative h-4">
                        <div
                          className="absolute top-0 flex h-4 items-center gap-1 overflow-hidden rounded-full px-1.5 text-[9px] font-bold text-white"
                          style={{ ...bar(c.start, c.end), background: c.color }}
                          title={`${c.name} · ${c.start} → ${c.end} · ${c.posts} posts`}
                        >
                          <span className="truncate">{c.name}</span>
                        </div>
                      </div>
                    ))}
                    {row.flights.map((f) => (
                      <button key={f.id} onClick={() => onOpenFlight(f)} className="relative h-4 text-left">
                        <div
                          className="absolute top-0 flex h-4 items-center gap-1 overflow-hidden rounded-full border border-dashed border-primary/50 bg-primary/10 px-1.5 text-[9px] font-semibold text-primary"
                          style={bar(f.start, f.end)}
                          title={`${f.name} · ${f.platform} · ${f.status} · planned ৳${Math.round(f.plannedSpend).toLocaleString("en-US")}`}
                        >
                          <span className={cn("rounded px-0.5 text-[8px]", PLATFORM_STYLE[f.platform] ?? "bg-muted")}>{f.platform.slice(0, 2)}</span>
                          <span className="truncate">{f.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => (
          <CardShell key={row.id} className="!p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: row.client?.calendarColor ?? "#7C3AED" }} />
              <p className="flex-1 truncate text-[12px] font-semibold">{row.name}</p>
              <span className="text-[10px] text-muted-foreground">{label(row.client?.healthLevel ?? "")}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {row.flights.map((f) => {
                const pct = f.plannedSpend ? Math.min(100, Math.round((f.actualSpend / f.plannedSpend) * 100)) : 0;
                return (
                  <div key={f.id} className="w-full rounded-lg border border-border/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10.5px] font-medium">{f.name}</span>
                      <span className={cn("shrink-0 rounded px-1 text-[8.5px] font-bold", PLATFORM_STYLE[f.platform] ?? "bg-muted")}>{PLATFORM_LABEL[f.platform] ?? f.platform}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums text-muted-foreground">{pct}%</span>
                    </div>
                  </div>
                );
              })}
              {row.flights.length === 0 && <p className="text-[10px] text-muted-foreground">No ad flights.</p>}
            </div>
          </CardShell>
        ))}
      </div>
    </div>
  );
}
