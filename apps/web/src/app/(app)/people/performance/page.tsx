"use client";
import { useCallback, useState } from "react";
import { Plus, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Avatar, EmptyState, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";
import { ReviewModal } from "../_components/modals/performance-modals";

export default function PerformancePage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: reviews, loading, error } = useList<any[]>("/people/reviews", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [open, setOpen] = useState(false);
  const { flash, notify } = useToast();
  const complete = async (r: any) => {
    try {
      await apiFetch(`/people/reviews/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) });
      notify("Review marked completed");
      reload();
    } catch (e: any) { notify(e.message ?? "Update failed"); }
  };
  const rows = reviews ?? [];
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        icon={<Star className="size-4" />}
        title="Performance reviews"
        subtitle="Ratings out of 5 — stored as the manager score (0–10) and normalised by the API"
        stats={[
          { label: "Reviews", value: rows.length },
          { label: "Avg rating", value: rows.length ? (rows.reduce((s: number, r: any) => s + Number(r.rating ?? 0), 0) / rows.length).toFixed(1) : "—", sub: "/5", tone: "amber" },
          { label: "Completed", value: rows.filter((r: any) => r.status === "COMPLETED").length, tone: "emerald" },
          { label: "Pending", value: rows.filter((r: any) => r.status !== "COMPLETED").length, tone: "sky" },
        ]}
        actions={<Btn variant="primary" onClick={() => setOpen(true)} className="!px-2.5 !py-1.5 text-[11px]"><Plus className="size-3.5" /> Review</Btn>}
      />
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No reviews yet" hint="Add the first review — pick a person, a period (e.g. Q3 2026) and a rating out of 5." />
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={5}
          footer={<span className="text-[11.5px] text-muted-foreground">{rows.length} reviews</span>}
          cols={["Employee", "Period", "Rating", "Reviewer", "Status", "Actions"]}
          rows={rows.map((r: any, i: number) => {
            const rating = r.rating ?? null;
            return (
              <Tr key={r.id} index={i}>
                <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} /><p className="font-medium">{r.employee?.name}</p></div></Td>
                <Td className="text-muted-foreground">{r.reviewPeriod}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5" title={rating != null ? `${rating} / 5` : "No rating recorded"}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={cn("size-3.5", rating != null && s <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted")} />
                      ))}
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{rating != null ? rating.toFixed(1) : "—"}</span>
                  </div>
                </Td>
                <Td className="text-muted-foreground">{r.reviewedBy?.name ?? "—"}</Td>
                <Td><StatusBadge status={r.status ?? "PENDING"} /></Td>
                <Td>{r.status !== "COMPLETED" ? <Btn variant="outline" onClick={() => complete(r)}>Mark completed</Btn> : <span className="text-[11.5px] text-muted-foreground">—</span>}</Td>
              </Tr>
            );
          })}
        />
      )}
      <ReviewModal open={open} onClose={() => setOpen(false)} employees={employees ?? []} onSaved={() => { notify("Review added"); reload(); }} />
    </div>
  );
}
