"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBDT } from "@/lib/format";
import { Avatar, EmptyState, FadeIn, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Select } from "@/components/ui";
import { label, utilBarCls } from "../_components/constants";
import { LoadOrError, Toast, useList, useToast } from "../_components/hooks";
import { Pager, useTable } from "../_components/table-kit";
import { PeopleHero } from "../_components/hero";
import { EmployeeModal } from "../_components/modals/employee-form";

export default function DirectoryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canSeePay = /owner|hr|admin/i.test(`${user?.role ?? ""} ${user?.roleName ?? ""}`);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: employees, loading, error } = useList<any[]>("/people/employees", refresh);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { flash, notify } = useToast();
  const depts = useMemo(() => [...new Set((employees ?? []).map((e: any) => e.department).filter(Boolean))], [employees]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (employees ?? []).filter((e: any) => (!term || e.name.toLowerCase().includes(term) || e.roleTitle.toLowerCase().includes(term) || (e.email ?? "").toLowerCase().includes(term)) && (!dept || e.department === dept));
  }, [employees, q, dept]);
  const table = useTable(rows, { pageSize: 8 });
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        title="Directory"
        subtitle="Everyone on the team — profile, department, device ID and utilization"
        stats={[
          { label: "People", value: (employees ?? []).length },
          { label: "Shown", value: rows.length, tone: "sky" },
          { label: "Active", value: (employees ?? []).filter((e: any) => e.employmentStatus === "ACTIVE").length, tone: "emerald" },
          { label: "On leave", value: (employees ?? []).filter((e: any) => e.employmentStatus === "ON_LEAVE").length, tone: "amber" },
          { label: "Departments", value: depts.length, tone: "violet" },
        ]}
        actions={<Btn variant="primary" onClick={() => setAddOpen(true)} className="!px-2.5 !py-1.5 text-[11px]"><Plus className="size-3.5" /> Add</Btn>}
      />
      <div className="mt-3 mb-2 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="!w-40 !py-1.5 text-[11.5px]">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
      </div>
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No employees match" hint="Try a different search or department" />
      ) : (
        <FadeIn>
          <TableShell footer={<Pager page={table.page} pages={table.pages} onPage={table.setPage} total={table.total} pageSize={8} label="employees" />}>
            <table className="w-full">
              <THead>
                <Th>Employee</Th><Th>Role</Th><Th>Department</Th><Th>Location</Th><Th>Type</Th><Th>Status</Th><Th>Device ID</Th><Th>Salary</Th><Th>Utilization</Th>
              </THead>
              <tbody>
                {table.paged.map((e: any, i: number) => (
                  <Tr key={e.id} index={i} onClick={() => router.push(`/people/directory/${e.id}`)} className="cursor-pointer">
                    <Td><div className="flex items-center gap-2.5"><Avatar name={e.name} /><div><p className="font-medium">{e.name}</p><p className="text-[11px] text-muted-foreground">{e.email ?? "—"}</p></div></div></Td>
                    <Td className="text-muted-foreground">{e.roleTitle}</Td>
                    <Td className="text-muted-foreground">{e.department ?? "—"}</Td>
                    <Td className="text-muted-foreground">{e.workLocation ?? "—"}</Td>
                    <Td className="text-muted-foreground capitalize">{label(e.employmentType ?? "full-time")}</Td>
                    <Td><StatusBadge status={e.employmentStatus} /></Td>
                    <Td><span className={cn("font-mono text-[11.5px] font-semibold", e.deviceId ? "text-foreground" : "text-muted-foreground")}>{e.deviceId ?? "—"}</span></Td>
                    <Td className="font-semibold tabular-nums">{canSeePay ? formatBDT(e.salary != null ? Number(e.salary) : null) : "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", utilBarCls(e.utilizationRate))} style={{ width: `${Math.min((e.utilizationRate ?? 0) * 100, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{e.utilizationRate != null ? `${Math.round(e.utilizationRate * 100)}%` : "—"}</span>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={6} />
      <EmployeeModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { notify("Employee added"); reload(); }} />
    </div>
  );
}
