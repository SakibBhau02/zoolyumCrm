"use client";
import { CalendarDays, Gauge, Users } from "lucide-react";
import { useApi } from "@/lib/use-api";
import type { Employee } from "@/lib/types";
import { Avatar, CardShell, FadeIn, SkeletonBlock, StatCard, StatusBadge } from "@/components/shared";
import { TableShell, Td, THead, Th, Tr } from "@/components/table";
import { UtilizationHeatmap } from "@/components/charts";

export default function OverviewPage() {
  const { data: overview } = useApi<any>("/people/overview");
  const { data: employees, loading } = useApi<Employee[]>("/people/employees");
  const { data: leaves } = useApi<any[]>("/people/leave-requests");
  const { data: utilization } = useApi<any>("/people/utilization");
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Employees" value={overview?.totalEmployees ?? "—"} sub={`${overview?.activeEmployees ?? 0} active`} delta="+1" icon={<Users className="size-5" />} />
        <StatCard label="Present Today" value={overview?.presentToday ?? "—"} sub={`${overview?.absentToday ?? 0} absent`} delta="+2" icon={<Users className="size-5" />} />
        <StatCard label="On Leave" value={overview?.onLeaveToday ?? "—"} sub="approved leave today" delta="0" icon={<CalendarDays className="size-5" />} />
        <StatCard label="Avg Utilization" value={`${overview?.avgUtilization ?? "—"}%`} sub={`${overview?.overloaded ?? 0} overloaded (105%+)`} delta="+3.2%" icon={<Gauge className="size-5" />} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {loading ? (
            <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
          ) : (
            <FadeIn>
              <TableShell>
                <table className="w-full">
                  <THead>
                    <Th>Employee</Th><Th>Role</Th><Th>Today</Th><Th>Utilization</Th><Th>Skills</Th><Th>Status</Th>
                  </THead>
                  <tbody>
                    {(employees ?? []).map((e, i) => (
                      <Tr key={e.id} index={i}>
                        <Td><div className="flex items-center gap-2.5"><Avatar name={e.name} /><p className="font-medium">{e.name}</p></div></Td>
                        <Td className="text-muted-foreground">{e.roleTitle}</Td>
                        <Td><StatusBadge status={e.todayStatus ?? "NOT_LOGGED"} /></Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div className={`h-full rounded-full ${(e.utilizationRate ?? 0) >= 1.05 ? "bg-rose-500" : (e.utilizationRate ?? 0) >= 0.95 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min((e.utilizationRate ?? 0) * 100, 100)}%` }} />
                            </div>
                            <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">{e.utilizationRate != null ? `${Math.round(e.utilizationRate * 100)}%` : "—"}</span>
                          </div>
                        </Td>
                        <Td>
                          <span className="flex flex-wrap gap-1">
                            {(e.skillTags ?? []).slice(0, 2).map((s) => (
                              <span key={s} className="rounded-full bg-brand-gradient-soft px-2 py-0.5 text-[10px] font-medium text-primary dark:text-primary">{s}</span>
                            ))}
                          </span>
                        </Td>
                        <Td><StatusBadge status={e.employmentStatus} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          )}
        </div>
        <FadeIn delay={0.1}>
          <div className="card-lift rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-[15px] font-heading font-semibold">Leave Requests</h3>
            <div className="flex flex-col gap-3">
              {(leaves ?? []).slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={l.employee.name} size="size-7" />
                    <div>
                      <p className="text-[12px] font-medium">{l.employee.name}</p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {l.leaveType} · {new Date(l.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        {" → "}
                        {new Date(l.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
              ))}
              {!leaves?.length && <p className="text-[12px] text-muted-foreground">No leave requests</p>}
            </div>
          </div>
        </FadeIn>
      </div>
      <FadeIn delay={0.15}>
        <CardShell className="mt-4">
          <h3 className="mb-4 text-[15px] font-heading font-semibold">Utilization Trend</h3>
          {utilization ? <UtilizationHeatmap rows={utilization.rows ?? []} weeks={utilization.weeks ?? []} /> : <SkeletonBlock className="h-40" />}
        </CardShell>
      </FadeIn>
    </div>
  );
}