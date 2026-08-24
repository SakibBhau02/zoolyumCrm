"use client";
import { useCallback, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Avatar, SectionTitle, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Select } from "@/components/ui";
import { CANDIDATE_STAGES, label } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { CandidateModal } from "../_components/modals/candidate-modal";

export default function CandidatesPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: candidates, loading, error } = useList<any[]>("/people/candidates", refresh);
  const [open, setOpen] = useState(false);
  const { flash, notify } = useToast();
  const setStage = async (c: any, stage: string) => {
    try {
      await apiFetch(`/people/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      notify(`Moved to ${label(stage)}`);
      reload();
    } catch (e: any) { notify(e.message ?? "Update failed"); }
  };
  const removeCandidate = async (c: any) => {
    try {
      await apiFetch(`/people/candidates/${c.id}`, { method: "DELETE" });
      notify("Candidate removed");
      reload();
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle title="Candidates" subtitle="Track applicants from applied to hired" />
        <Btn variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add Candidate</Btn>
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={6}
        footer={<span className="text-[11.5px] text-muted-foreground">{(candidates ?? []).length} candidates</span>}
        cols={["Candidate", "Position", "Department", "Source", "Rating", "Skills", "Stage", "Actions"]}
        rows={(candidates ?? []).map((c: any, i: number) => (
          <Tr key={c.id} index={i}>
            <Td><div className="flex items-center gap-2.5"><Avatar name={`${c.firstName} ${c.lastName}`} /><div><p className="font-medium">{c.firstName} {c.lastName}</p><p className="text-[11px] text-muted-foreground">{c.email}</p></div></div></Td>
            <Td className="text-muted-foreground">{c.position}</Td>
            <Td className="text-muted-foreground">{c.department ?? "—"}</Td>
            <Td className="text-muted-foreground">{c.source ?? "—"}</Td>
            <Td>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => <Star key={s} className={cn("size-3", s <= (c.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted")} />)}
                {!c.rating && <span className="text-[11px] text-muted-foreground">—</span>}
              </div>
            </Td>
            <Td>
              <span className="flex flex-wrap gap-1">
                {(c.skills ?? []).length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                {(c.skills ?? []).slice(0, 3).map((s: string) => <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{s}</span>)}
                {(c.skills ?? []).length > 3 && <span className="text-[10px] text-muted-foreground">+{(c.skills ?? []).length - 3}</span>}
              </span>
            </Td>
            <Td>
              <Select value={c.stage} onChange={(e) => setStage(c, e.target.value)} className="!w-32 !py-1.5 !text-[11px]">
                {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Td>
            <Td><button onClick={() => removeCandidate(c)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Remove candidate"><Trash2 className="size-4" /></button></Td>
          </Tr>
        ))}
      />
      <CandidateModal open={open} onClose={() => setOpen(false)} onSaved={() => { notify("Candidate added"); reload(); }} />
    </div>
  );
}
