"use client";

import { Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Input, Select } from "@/components/ui";
import { CalendarClient, CalendarFilters, PLATFORMS, PLATFORM_LABEL, SOURCE_LABEL } from "./types";

const SOURCE_TOGGLES = ["TASK", "CONTENT_POST", "EVENT", "AD_FLIGHT", "MILESTONE", "DELIVERABLE", "INVOICE"];

export function FilterBar({
  filters,
  onChange,
  clients,
  onSaveView,
  onExport,
}: {
  filters: CalendarFilters;
  onChange: (f: CalendarFilters) => void;
  clients: CalendarClient[];
  onSaveView: () => void;
  onExport: (kind: "csv" | "ics") => void;
}) {
  const sources = filters.sources.split(",").filter(Boolean);
  const toggleSource = (s: string) => {
    const next = sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s];
    onChange({ ...filters, sources: next.join(",") });
  };
  const active =
    (filters.clientId ? 1 : 0) +
    (filters.approval ? 1 : 0) +
    (filters.platforms ? 1 : 0) +
    (filters.mine ? 1 : 0) +
    (filters.q ? 1 : 0);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={filters.clientId}
          onChange={(e) => onChange({ ...filters, clientId: e.target.value })}
          aria-label="Filter by client"
          className="!w-52 !py-1.5 text-[12px]"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </Select>

        <button
          onClick={() => onChange({ ...filters, mine: !filters.mine })}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
            filters.mine ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <UserRound className="size-3.5" /> My work
        </button>

        <div className="hidden items-center gap-1 md:flex">
          {SOURCE_TOGGLES.map((s) => (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                sources.includes(s) ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground/70 hover:text-foreground"
              )}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>

        <Select
          value={filters.approval}
          onChange={(e) => onChange({ ...filters, approval: e.target.value })}
          aria-label="Filter by approval status"
          className="!w-40 !py-1.5 text-[11px]"
        >
          <option value="">Any approval</option>
          <option value="INTERNAL_REVIEW">In review</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="NONE">Not submitted</option>
        </Select>

        <Select
          value={filters.platforms}
          onChange={(e) => onChange({ ...filters, platforms: e.target.value })}
          aria-label="Filter by platform"
          className="!w-36 !py-1.5 text-[11px]"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
          ))}
        </Select>

        <div className="relative min-w-[140px] max-w-[230px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            placeholder="Search title, client, project…"
            className="!py-1.5 pl-8 text-[12px]"
          />
        </div>

        {active > 0 && (
          <button
            onClick={() => onChange({ ...filters, approval: "", platforms: "", mine: false, q: "", clientId: "" })}
            className="inline-flex items-center gap-1 rounded-xl border border-border px-2 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" /> Clear ({active})
          </button>
        )}

        <Btn variant="ghost" onClick={onSaveView} title="Save this filter set" className="!px-2">
          <SlidersHorizontal className="size-3.5" />
        </Btn>
        <div className="flex items-center gap-1">
          <Btn variant="ghost" onClick={() => onExport("csv")} className="!px-2 text-[10.5px]">CSV</Btn>
          <Btn variant="ghost" onClick={() => onExport("ics")} className="!px-2 text-[10.5px]">iCal</Btn>
        </div>
      </div>
    </div>
  );
}
