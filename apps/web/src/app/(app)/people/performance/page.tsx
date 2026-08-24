"use client";
import { useCallback, useState } from "react";
import { Plus, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Avatar, SectionTitle, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
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
      await apiFetch(`/people/reviews/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "COMPLETED", overallRating: r.overallRating }) });
      notify("Review marked completed");
      reload();
    } catch (e: any) { notify(e.message ?? "Update failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle title="Performance reviews" subtitle="Ratings out of 5 per review period" />
        <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add Review</Btn>
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={5}
        footer={<span className="text-[11.5px] text-muted-foreground">{(reviews ?? []).length} reviews</span>}
        cols={["Employee", "Period", "Rating", "Status", "Actions"]}
        rows={(reviews ?? []).map((r: any, i: number) => (
          <Tr key={r.id} index={i}>
            <Td><div className="flex items-center gap-2.5"><Avatar name={r.employee?.name} /><p className="font-medium">{r.employee?.name}</p></div></Td>
            <Td className="text-muted-foreground">{r.reviewPeriod}</Td>
            <Td>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => <Star key={s} className={cn("size-3.5", s <= (r.overallRating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted")} />)}
                </div>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{r.overallRating ?? "—"}</span>
              </div>
            </Td>
            <Td><StatusBadge status={r.status ?? "PENDING"} /></Td>
            <Td>{r.status !== "COMPLETED" ? <Btn variant="outline" onClick={() => complete(r)}>Mark completed</Btn> : <span className="text-[11.5px] text-muted-foreground">—</span>}</Td>
          </Tr>
        ))}
      />
      <ReviewModal open={open} onClose={() => setOpen(false)} employees={employees ?? []} onSaved={() => { notify("Review added"); reload(); }} />
    </div>
  );
}
