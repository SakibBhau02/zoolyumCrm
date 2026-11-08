"use client";
import Link from "next/link";
import { CalendarDays, Gauge, Users } from "lucide-react";
import { useApi } from "@/lib/use-api";
import type { Employee } from "@/lib/types";
import { Avatar, FadeIn, SkeletonBlock, StatusBadge } from "@/components/shared";
import { Td, THead, Th, Tr } from "@/components/table";
import { UtilizationHeatmap } from "@/components/charts";
import { DenseCard, PeopleHero } from "./_components/hero";
import { Pager, useTable } from "./_components/table-kit";
import { ActionCenter } from "./_components/action-center";

export default function OverviewPage() {
  const { data: overview } = useApi<any>("/people/overview");
  const { data: employees, loading } = useApi<Employee[]>("/people/employees");
  const { data: leaves } = useApi<any[]>("/people/leave-requests");
  const { data: utilization } = useApi<any>("/people/utilization");
  const rows = useTable<Employee>(employees, { keys: (e) => [e.name, e.roleTitle, e.department], pageSize: 8 });

  return (
    <div className="flex flex-col gap-3">
      <ActionCenter />
      <PeopleHero
        icon={<Users className="size-4" />}
        title="Overview"
        subtitle="Headcount, attendance, leave and utilization at a glance"
        stats={[
          { label: "Employees", value: overview?.totalEmployees ?? "—", sub: `${overview?.activeEmployees ?? 0} active` },
          { label: "Present", value: overview?.presentToday ?? "—", sub: `${overview?.absentToday ?? 0} absent`, tone: "emerald" },
          { label: "On leave", value: overview?.onLeaveToday ?? "—", sub: "today", tone: "sky" },
          { label: "Utilization", value: `${overview?.avgUtilization ?? "—"}%`, sub: `${overview?.overloaded ?? 0} over 105%`, tone: "violet" },
          { label: "Open leave", value: (leaves ?? []).filter((l) => l.status === "PENDING").length, sub: "pending", tone: "amber" },
        ]}
        actions={<Link href="/people/team" className="text-[10.5px] font-bold text-primary hover:underline">Team 360 →</Link>}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <DenseCard title="People" hint={`${rows.total} employees · click a name for the profile`} icon={<Users className="size-3.5" />}>
          {loading ? (
            <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-9" />)}</div>
          ) : (
            <FadeIn>
              <div className="overflow-hidden rounded-xl border border-border/50">
                <table className="w-full">
                  <THead>
                    <Th>Employee</Th><Th>Role</Th><Th>Today</Th><Th>Utilization</Th><Th>Status</Th>
                  </THead>
                  <tbody>
                    {rows.paged.map((e, i) => (
                      <Tr key={e.id} index={i}>
                        <Td><div className="flex items-center gap-2"><Avatar name={e.name} size="size-6" /><Link href={`/people/directory/${e.id}`} className="text-[12px] font-medium hover:text-primary hover:underline">{e.name}</Link></div></Td>
                        <Td className="text-[11.5px] text-muted-foreground">{e.roleTitle}</Td>
                        <Td><StatusBadge status={e.todayStatus ?? "NOT_LOGGED"} /></Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                              <div className={`h-full rounded-full ${(e.utilizationRate ?? 0) >= 1.05 ? "bg-rose-500" : (e.utilizationRate ?? 0) >= 0.95 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min((e.utilizationRate ?? 0) * 100, 100)}%` }} />
                            </div>
                            <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{e.utilizationRate != null ? `${Math.round(e.utilizationRate * 100)}%` : "—"}</span>
                          </div>
                        </Td>
                        <Td><StatusBadge status={e.employmentStatus} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={rows.page} pages={rows.pages} onPage={rows.setPage} total={rows.total} pageSize={8} label="people" />
            </FadeIn>
          )}
        </DenseCard>

        <div className="flex min-w-0 flex-col gap-3">
          <DenseCard
            title="Leave requests"
            hint="latest"
            icon={<CalendarDays className="size-3.5" />}
            action={<Link href="/people/leave" className="text-[10px] font-bold text-primary hover:underline">All</Link>}
          >
            <div className="flex flex-col gap-1">
              {(leaves ?? []).slice(0, 4).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Avatar name={l.employee.name} size="size-5" />
                    <span className="min-w-0 truncate text-[11px] font-medium">{l.employee.name}</span>
                    <span className="shrink-0 text-[9.5px] text-muted-foreground">
                      {new Date(l.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {" → "}
                      {new Date(l.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
              ))}
              {!leaves?.length && <p className="text-[11px] text-muted-foreground">No leave requests</p>}
            </div>
          </DenseCard>

          <DenseCard title="Utilization trend" hint="weekly, per team" icon={<Gauge className="size-3.5" />}>
            {utilization ? <UtilizationHeatmap rows={utilization.rows ?? []} weeks={utilization.weeks ?? []} /> : <SkeletonBlock className="h-24" />}
          </DenseCard>
        </div>
      </div>
    </div>
  );
}
