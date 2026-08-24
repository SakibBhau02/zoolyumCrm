"use client";
import { useCallback, useState } from "react";
import { Avatar, SectionTitle, cn } from "@/components/shared";
import { Td, Tr } from "@/components/table";
import { levelTone } from "../_components/constants";
import { DataTable, useList } from "../_components/hooks";

export default function SkillsPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: matrix, loading, error } = useList<any[]>("/people/skills-matrix", refresh);
  return (
    <div>
      <SectionTitle title="Skills matrix" subtitle="Capability coverage by skill and level" />
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={6}
        footer={<span className="text-[11.5px] text-muted-foreground">{(matrix ?? []).length} skills</span>}
        cols={["Skill", "Category", "Level", "People"]}
        rows={(matrix ?? []).map((s: any, i: number) => (
          <Tr key={i} index={i}>
            <Td><p className="font-medium">{s.skill}</p></Td>
            <Td className="text-muted-foreground">{s.category ?? "—"}</Td>
            <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", levelTone[s.level] ?? "bg-muted text-muted-foreground")}>{s.level}</span></Td>
            <Td>
              <span className="flex flex-wrap gap-1.5">
                {(s.people ?? []).length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                {(s.people ?? []).slice(0, 5).map((p: any, pi: number) => (
                  <span key={pi} className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"><Avatar name={p.name} size="size-4" />{p.name}</span>
                ))}
                {(s.people ?? []).length > 5 && <span className="text-[10.5px] text-muted-foreground">+{(s.people ?? []).length - 5}</span>}
              </span>
            </Td>
          </Tr>
        ))}
      />
    </div>
  );
}
