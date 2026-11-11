"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/components/shared";

/**
 * Bounded table rendering for Capital.
 *
 * The invoice list mounts every row (with its actions) at once. At 14 invoices
 * that is fine; at 500 it is a slow first paint and a janky filter. This keeps
 * the DOM to one page while the API contract stays unchanged.
 */
export function usePaged<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, pages - 1);
  const paged = useMemo(() => rows.slice(safe * pageSize, safe * pageSize + pageSize), [rows, safe, pageSize]);
  return { page: safe, setPage, pages, paged };
}

export function Pager({
  page,
  pages,
  onPage,
  total,
  pageSize,
  label = "rows",
  right,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  total: number;
  pageSize: number;
  label?: string;
  right?: React.ReactNode;
}) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-meta text-muted-foreground">
        {from}–{to} of {total} {label}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(Math.max(0, page - 1))}
            disabled={page === 0}
            aria-label="Previous page"
            className={cn("flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground", page === 0 ? "opacity-40" : "hover:border-primary/40 hover:text-foreground")}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="px-1 text-meta font-semibold tabular-nums text-muted-foreground">
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => onPage(Math.min(pages - 1, page + 1))}
            disabled={page >= pages - 1}
            aria-label="Next page"
            className={cn("flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground", page >= pages - 1 ? "opacity-40" : "hover:border-primary/40 hover:text-foreground")}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
