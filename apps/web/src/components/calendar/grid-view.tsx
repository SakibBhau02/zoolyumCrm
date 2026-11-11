"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, PlaySquare, Plus } from "lucide-react";
import { cn, CardShell, EmptyState, SectionTitle } from "@/components/shared";
import { Btn } from "@/components/table";
import { CalItem, PLATFORMS, PLATFORM_LABEL } from "./types";
import { dayLabel } from "@/lib/calendar-date";
import { ApprovalBadge, StatusBadge } from "./parts";

/**
 * Feed preview: the same posts the client will see, in the order they ship.
 * Deliberately visual — this is the view a social media manager sanity-checks
 * before a month is locked.
 */
export function GridView({
  items,
  onOpen,
  onAdd,
  clientName,
}: {
  items: CalItem[];
  onOpen: (item: CalItem) => void;
  onAdd: () => void;
  clientName?: string;
}) {
  const [platform, setPlatform] = useState<string>("ALL");
  const posts = useMemo(
    () =>
      items.filter(
        (i) => i.source === "CONTENT_POST" && (platform === "ALL" || i.platforms.includes(platform))
      ),
    [items, platform]
  );

  const used = PLATFORMS.filter((p) => items.some((i) => i.platforms.includes(p)));

  return (
    <div className="flex flex-col gap-4">
      <CardShell>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle
            title="Feed preview"
            subtitle={`${clientName ?? "All clients"} · ${posts.length} posts in this period`}
          />
          <Btn variant="primary" onClick={onAdd}>
            <Plus className="size-3.5" /> New post
          </Btn>
        </div>

        <div className="mb-4 flex flex-wrap gap-1">
          {["ALL", ...used].map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
                platform === p ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {p === "ALL" ? "All platforms" : PLATFORM_LABEL[p] ?? p}
            </button>
          ))}
        </div>

        {posts.length === 0 ? (
          <EmptyState title="No posts in this period" hint="Create a post or widen the filters — a gap here is a gap in the plan." />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {posts.map((p) => {
              const approved = p.approval === "APPROVED";
              const rejected = p.approval === "REJECTED";
              const review = p.approval === "INTERNAL_REVIEW";
              return (
                <button
                  key={p.key}
                  onClick={() => onOpen(p)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-shadow hover:shadow-md"
                >
                  <div
                    className="relative flex aspect-square items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${p.clientColor ?? "#7C3AED"}22, ${p.clientColor ?? "#7C3AED"}05)` }}
                  >
                    {p.meta?.hasVideo ? (
                      <PlaySquare className="size-6 text-foreground/40" />
                    ) : (
                      <ImageIcon className="size-6 text-foreground/30" />
                    )}
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide",
                        approved
                          ? "bg-emerald-500 text-white"
                          : rejected
                            ? "bg-rose-500 text-white"
                            : review
                              ? "bg-amber-400 text-black"
                              : "bg-slate-700/80 text-white"
                      )}
                    >
                      {approved ? "Approved" : rejected ? "Rejected" : review ? "In review" : p.status}
                    </span>
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/45 px-1 py-0.5 text-[8.5px] font-semibold text-white">
                      {p.date.slice(5)}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5 p-2">
                    <p className="truncate text-[11px] font-semibold">{p.title}</p>
                    <p className="truncate text-[9.5px] text-muted-foreground">
                      {p.platforms.map((x) => PLATFORM_LABEL[x] ?? x).join(" · ")}
                      {p.startTime ? ` · ${p.startTime}` : ""}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1">
                      {p.approval === "INTERNAL_REVIEW" || p.approval === "REJECTED" ? (
                        <ApprovalBadge approval={p.approval} />
                      ) : (
                        <StatusBadge status={p.status} tone={p.statusTone} />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardShell>
    </div>
  );
}
