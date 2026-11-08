"use client";
import { useCallback, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { Avatar, EmptyState, cn } from "@/components/shared";
import { Td, Tr } from "@/components/table";
import { DataTable, useList } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";

/**
 * Skills matrix.
 *
 * The API returns one row per skill with the people who hold it:
 * `{ skill, count, employees: string[], departments: string[], avgExperience }`.
 * The page previously rendered `category` / `level` / `people` — none of which
 * the endpoint produces — so three of four columns were permanently "—".
 */
export default function SkillsPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: matrix, loading, error } = useList<any[]>("/people/skills-matrix", refresh);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = matrix ?? [];
    if (!needle) return all;
    return all.filter((s: any) => `${s.skill} ${(s.departments ?? []).join(" ")}`.toLowerCase().includes(needle));
  }, [matrix, q]);

  const totalSkills = (matrix ?? []).length;
  const covered = new Set<string>((matrix ?? []).flatMap((s: any) => s.employees ?? [])).size;
  const thin = (matrix ?? []).filter((s: any) => (s.count ?? 0) === 1).length;
  const deepest = [...(matrix ?? [])].sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))[0];

  return (
    <div>
      <PeopleHero
        icon={<Sparkles className="size-4" />}
        title="Skills matrix"
        subtitle="Who can do what — coverage by skill, department and tenure"
        stats={[
          { label: "Skills", value: totalSkills, sub: "distinct" },
          { label: "Covered", value: covered, sub: "people", tone: "emerald" },
          { label: "Single-person", value: thin, sub: "bus factor 1", tone: thin ? "rose" : "default" },
          { label: "Deepest", value: deepest?.skill ?? "—", sub: deepest ? `${deepest.count} people` : "no data", tone: "sky" },
        ]}
      />

      <div className="mt-3 mb-3 max-w-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a skill or department…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No skills tagged yet" hint="Add skill tags on an employee profile (Directory → person → Edit profile) and the matrix builds itself." />
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={6}
          footer={<span className="text-[11.5px] text-muted-foreground">{rows.length} of {totalSkills} skills</span>}
          cols={["Skill", "Coverage", "Departments", "Avg time with the team", "People"]}
          rows={rows.map((s: any, i: number) => (
            <Tr key={s.skill} index={i}>
              <Td><p className="font-semibold">{s.skill}</p></Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", (s.count ?? 0) >= 3 ? "bg-emerald-500" : (s.count ?? 0) === 2 ? "bg-amber-400" : "bg-rose-500")} style={{ width: `${Math.min((s.count ?? 0) / Math.max(1, deepest?.count ?? 1), 1) * 100}%` }} />
                  </div>
                  <span className="text-[11.5px] font-bold tabular-nums">{s.count ?? 0}</span>
                </div>
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {(s.departments ?? []).length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                  {(s.departments ?? []).map((d: string) => (
                    <span key={d} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{d}</span>
                  ))}
                </span>
              </Td>
              <Td className="tabular-nums text-muted-foreground">{s.avgExperience != null ? `${s.avgExperience} yr` : "—"}</Td>
              <Td>
                <span className="flex flex-wrap gap-1.5">
                  {(s.employees ?? []).length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                  {(s.employees ?? []).slice(0, 5).map((name: string) => (
                    <span key={name} className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                      <Avatar name={name} size="size-4" />{name}
                    </span>
                  ))}
                  {(s.employees ?? []).length > 5 && <span className="text-[10.5px] text-muted-foreground">+{(s.employees ?? []).length - 5}</span>}
                </span>
              </Td>
            </Tr>
          ))}
        />
      )}
    </div>
  );
}
