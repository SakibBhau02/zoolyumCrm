"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/components/shared";

/**
 * Client-side table plumbing: search → page slice → pager.
 *
 * The People tables rendered every row they received. Attendance for a month
 * is ~200 rows for ten people and over a thousand for fifty, all mounted at
 * once — slow to paint and impossible to scan. These hooks keep the API calls
 * unchanged and add the missing layer.
 */
export function useTable<T>(
  rows: T[] | null | undefined,
  opts: { keys?: (row: T) => (string | number | null | undefined)[]; pageSize?: number } = {}
) {
  const { keys, pageSize = 12 } = opts;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const all = rows ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle || !keys) return all;
    return all.filter((row) => keys(row).some((v) => String(v ?? "").toLowerCase().includes(needle)));
  }, [rows, q, keys]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const paged = useMemo(() => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize), [filtered, safePage, pageSize]);

  return {
    q,
    setQ: (v: string) => { setQ(v); setPage(0); },
    page: safePage,
    setPage,
    pages,
    paged,
    total: filtered.length,
    allCount: (rows ?? []).length,
  };
}

export function TableToolbar({
  q,
  onQ,
  placeholder = "Search…",
  right,
  count,
}: {
  q?: string;
  onQ?: (v: string) => void;
  placeholder?: string;
  right?: React.ReactNode;
  count?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {onQ && (
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-border bg-card py-1.5 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}
      {count && <span className="text-meta text-muted-foreground">{count}</span>}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Pager({
  page,
  pages,
  onPage,
  total,
  pageSize,
  label = "rows",
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  total: number;
  pageSize: number;
  label?: string;
}) {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
      <p className="text-meta text-muted-foreground">
        {from}–{to} of {total} {label}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(Math.max(0, page - 1))}
            disabled={page === 0}
            aria-label="Previous page"
            className={cn(
              "flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors",
              page === 0 ? "opacity-40" : "hover:border-primary/40 hover:text-foreground"
            )}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          {Array.from({ length: pages }).slice(0, 7).map((_, i) => {
            // Show a moving window around the current page for long tables.
            const start = Math.max(0, Math.min(page - 2, pages - 5));
            const n = Math.min(pages - 1, start + i);
            if (i > 4) return null;
            return (
              <button
                key={n}
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={cn(
                  "min-w-7 rounded-lg px-1.5 py-1 text-meta font-bold tabular-nums transition-colors",
                  n === page ? "bg-brand-gradient text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {n + 1}
              </button>
            );
          })}
          {pages > 5 && <span className="px-1 text-meta text-muted-foreground">…</span>}
          <button
            onClick={() => onPage(Math.min(pages - 1, page + 1))}
            disabled={page >= pages - 1}
            aria-label="Next page"
            className={cn(
              "flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors",
              page >= pages - 1 ? "opacity-40" : "hover:border-primary/40 hover:text-foreground"
            )}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Small checkbox used by bulk-select tables. */
export function RowCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="size-3.5 cursor-pointer accent-primary"
    />
  );
}
