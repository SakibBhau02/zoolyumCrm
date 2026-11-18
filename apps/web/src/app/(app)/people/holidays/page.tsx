"use client";
import { useCallback, useState } from "react";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { EmptyState, FadeIn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { LoadOrError, Toast, useList, useToast } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";
import { usePeopleAccess } from "../_components/permissions";
import { HolidayModal } from "../_components/modals/holiday-modal";

export default function HolidaysPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: holidays, loading, error } = useList<any[]>("/people/holidays", refresh);
  const [open, setOpen] = useState(false);
  const { flash, notify } = useToast();
  const { canEdit } = usePeopleAccess();
  const removeHoliday = async (h: any) => {
    // A misclick here used to shift every payroll deduction for that month.
    if (!window.confirm(`Remove ${h.name} (${String(h.date).slice(0, 10)})? Attendance and payroll for that day will treat it as a normal working day.`)) return;
    try {
      await apiFetch(`/people/holidays/${h.id}`, { method: "DELETE" });
      notify("Holiday removed");
      reload();
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        icon={<CalendarOff className="size-4" />}
        title="Holidays"
        subtitle="Company-wide days off — government, festival and tentative"
        stats={[
          { label: "Holidays", value: (holidays ?? []).length },
          { label: "Govt", value: (holidays ?? []).filter((h: any) => h.isGovernment).length, tone: "emerald" },
          { label: "Tentative", value: (holidays ?? []).filter((h: any) => h.tentative).length, tone: "amber" },
        ]}
        actions={canEdit ? <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add</Btn> : undefined}
      />
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={4} />
      {!loading && !error && (
        <FadeIn>
          {(holidays ?? []).length === 0 ? (
            <EmptyState title="No holidays defined" hint="Add the company holiday calendar" />
          ) : (
            <TableShell footer={<span className="text-meta text-muted-foreground">{(holidays ?? []).length} holidays</span>}>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Name</Th><Th>Type</Th><Th>Description</Th><Th>Actions</Th></THead>
                <tbody>
                  {(holidays ?? []).map((h: any, i: number) => (
                    <Tr key={h.id} index={i}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-gradient-soft text-primary dark:text-primary"><CalendarOff className="size-4" /></span>
                          <span className="font-semibold tabular-nums">{formatDate(h.date)}</span>
                        </div>
                      </Td>
                      <Td className="font-medium">{h.name}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {h.isGovernment && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-semibold text-emerald-600 dark:text-emerald-300">Govt</span>}
                          {h.tentative && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-micro font-semibold text-amber-600 dark:text-amber-300">Tentative</span>}
                          {!h.isGovernment && !h.tentative && <span className="text-meta text-muted-foreground">—</span>}
                        </div>
                      </Td>
                      <Td className="text-muted-foreground">{h.description ?? "—"}</Td>
                      <Td><button onClick={() => removeHoliday(h)} aria-label={`Delete holiday ${h.name}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete holiday"><Trash2 className="size-3.5" /></button></Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </FadeIn>
      )}
      <HolidayModal open={open} onClose={() => setOpen(false)} onSaved={() => { notify("Holiday added"); reload(); }} />
    </div>
  );
}
