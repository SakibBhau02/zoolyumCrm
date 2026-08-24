"use client";
import { useCallback, useState } from "react";
import { Avatar, CardShell, EmptyState, FadeIn, SectionTitle } from "@/components/shared";
import { LoadOrError, useList } from "../_components/hooks";

function OrgNode({ node, depth = 0 }: { node: any; depth?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-primary/30" style={{ marginLeft: depth * 28 }}>
        <Avatar name={node.name} size="size-6" />
        <p className="text-[12.5px] font-semibold">{node.name}</p>
        <p className="text-[11px] text-muted-foreground">{node.roleTitle}</p>
        {depth === 0 && <span className="rounded-full bg-brand-gradient px-2 py-0.5 text-[9px] font-bold text-white shadow-md shadow-primary/25">Lead</span>}
      </div>
      {(node.directReports ?? []).map((c: any) => <OrgNode key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}

export default function OrgChartPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: tree, loading, error } = useList<any[]>("/people/org-chart", refresh);
  return (
    <div>
      <SectionTitle title="Org chart" subtitle="Reporting structure, top-down" />
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={8} />
      {!loading && !error && (
        <FadeIn>
          {(tree ?? []).length === 0 ? (
            <EmptyState title="No org chart yet" hint="Assign reporting managers to employees" />
          ) : (
            <CardShell>
              <div className="flex flex-col gap-1.5">
                {(tree ?? []).map((n: any) => <OrgNode key={n.id} node={n} />)}
              </div>
            </CardShell>
          )}
        </FadeIn>
      )}
    </div>
  );
}
