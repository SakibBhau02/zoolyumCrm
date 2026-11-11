"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { Avatar, EmptyState, SectionTitle, cn } from "@/components/shared";
import { LoadOrError, useList } from "../_components/hooks";
import { PeopleHero } from "../_components/hero";

/**
 * Reporting tree.
 *
 * The API returns roots with nested `directReports` (built from
 * `reportingManagerId`), so depth is real now — previously every employee was
 * rendered at depth 0 with a "Lead" badge because the endpoint returned a flat
 * list. Anyone caught in a reporting cycle is promoted to a root server-side,
 * so nobody can disappear from the chart.
 */
function OrgNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const reports = node.directReports ?? [];
  return (
    <div className={cn("flex flex-col", depth > 0 && "ml-4 border-l border-border/60 pl-4")}>
      <Link
        href={`/people/directory/${node.id}`}
        className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-primary/40"
      >
        <Avatar name={node.name} size={depth === 0 ? "size-9" : "size-7"} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-body font-semibold">
            {node.name}
            {depth === 0 && (
              <span className="rounded-full bg-brand-gradient px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-white">root</span>
            )}
          </p>
          <p className="truncate text-micro text-muted-foreground">
            {node.roleTitle}
            {node.department ? ` · ${node.department}` : ""}
          </p>
        </div>
        {reports.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-micro font-semibold text-muted-foreground">
            <Users className="size-3.5" />{reports.length}
          </span>
        )}
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </Link>
      {reports.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {reports.map((c: any) => <OrgNode key={c.id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: tree, loading, error } = useList<any[]>("/people/org-chart", refresh);
  const roots = tree ?? [];
  const total = roots.reduce(function count(acc: number, n: any): number {
    return acc + 1 + (n.directReports ?? []).reduce(count, 0);
  }, 0);
  return (
    <div>
      <PeopleHero
        icon={<Users className="size-4" />}
        title="Org chart"
        subtitle={`Reporting structure, top-down · ${total} people`}
        stats={[
          { label: "People", value: total, tone: "sky" },
          { label: "Roots", value: roots.length },
        ]}
      />
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={8} />
      {!loading && !error && (
        roots.length === 0 ? (
          <EmptyState title="No org chart yet" hint="Set a reporting manager on each employee profile and the tree builds itself." />
        ) : (
          <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
            {roots.map((n: any) => <OrgNode key={n.id} node={n} />)}
          </div>
        )
      )}
    </div>
  );
}
