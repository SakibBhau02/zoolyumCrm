"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  Download,
  Fingerprint,
  Mail,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { formatBDT } from "@/lib/format";
import { Avatar, EmptyState, FadeIn, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Select } from "@/components/ui";
import { downloadCsv, utilBarCls } from "../_components/constants";
import { LoadOrError, Toast, useList, useToast } from "../_components/hooks";
import { usePeopleAccess } from "../_components/permissions";
import { Pager, RowCheck } from "../_components/table-kit";
import { PeopleHero } from "../_components/hero";
import { EmployeeModal } from "../_components/modals/employee-form";

type Employee = {
  id: string;
  name: string;
  roleTitle: string;
  department: string | null;
  workLocation: string | null;
  employmentType: string | null;
  employmentStatus: string;
  email: string | null;
  deviceId?: string | null;
  salary?: number | string | null;
  utilizationRate?: number | null;
  todayStatus?: string | null;
  photoUrl?: string | null;
  photoJxlUrl?: string | null;
  reportingManager?: { name: string } | null;
};

type SortKey = "name" | "roleTitle" | "department" | "manager" | "employmentStatus" | "deviceId" | "salary" | "utilizationRate";

const QUICK_FILTERS = [
  { id: "late", label: "Late today", test: (e: Employee) => e.todayStatus === "LATE" },
  { id: "not-logged", label: "Not logged", test: (e: Employee) => !e.todayStatus || e.todayStatus === "NOT_LOGGED" },
  { id: "on-leave", label: "On leave", test: (e: Employee) => e.employmentStatus === "ON_LEAVE" },
  { id: "no-device", label: "No device", test: (e: Employee) => !e.deviceId },
  { id: "no-email", label: "Missing email", test: (e: Employee) => !e.email },
] as const;

const PAGE_SIZE = 8;

export default function DirectoryPage() {
  const router = useRouter();
  const { canSeePay, canEdit } = usePeopleAccess();
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: employees, loading, error } = useList<Employee[]>("/people/employees", refresh);

  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const [chip, setChip] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const { flash, notify } = useToast();

  // Any filter change returns to page 1 (except sorting, which is a view of the same set).
  useEffect(() => {
    setPage(0);
  }, [q, dept, status, chip]);

  const depts = useMemo(() => [...new Set((employees ?? []).map((e) => e.department).filter(Boolean))] as string[], [employees]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const activeChip = QUICK_FILTERS.find((c) => c.id === chip);
    const list = (employees ?? []).filter((e) => {
      if (dept && e.department !== dept) return false;
      if (status && e.employmentStatus !== status) return false;
      if (activeChip && !activeChip.test(e)) return false;
      if (!term) return true;
      return [e.name, e.roleTitle, e.department, e.email].some((v) => String(v ?? "").toLowerCase().includes(term));
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sort.key === "manager" ? a.reportingManager?.name : a[sort.key as keyof Employee];
      const bv = sort.key === "manager" ? b.reportingManager?.name : b[sort.key as keyof Employee];
      if (sort.key === "salary" || sort.key === "utilizationRate") return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [employees, q, dept, status, chip, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const paged = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const allOnPage = paged.length > 0 && paged.every((e) => selected.has(e.id));

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  const exportCsv = () => {
    const source = selected.size ? rows.filter((e) => selected.has(e.id)) : rows;
    downloadCsv(
      `directory-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Role", "Department", "Location", "Type", "Status", "Email", "Device", "Salary", "Utilization"],
      source.map((e) => [
        e.name,
        e.roleTitle,
        e.department ?? "",
        e.workLocation ?? "",
        e.employmentType ?? "",
        e.employmentStatus,
        e.email ?? "",
        e.deviceId ?? "",
        canSeePay && e.salary != null ? Number(e.salary) : "",
        e.utilizationRate != null ? Math.round(e.utilizationRate * 100) : "",
      ]),
    );
    notify(`Exported ${source.length} employee${source.length === 1 ? "" : "s"}`);
  };

  const activeFilters = [dept, status, chip].filter(Boolean).length;

  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        title="Directory"
        subtitle="Everyone on the team — profile, department, device ID and utilization"
        stats={[
          { label: "People", value: (employees ?? []).length },
          { label: "Shown", value: rows.length, tone: "sky" },
          { label: "Active", value: (employees ?? []).filter((e) => e.employmentStatus === "ACTIVE").length, tone: "emerald" },
          { label: "On leave", value: (employees ?? []).filter((e) => e.employmentStatus === "ON_LEAVE").length, tone: "amber" },
          { label: "Departments", value: depts.length, tone: "violet" },
        ]}
        actions={canEdit ? <Btn variant="primary" onClick={() => setAddOpen(true)} className="!px-2.5 !py-1.5 text-meta"><Plus className="size-3.5" /> Add</Btn> : undefined}
      />

      {/* Filter bar */}
      <div className="mt-3 mb-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, role, email…"
              aria-label="Search employees"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department" className="!w-40 !py-1.5 text-meta">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="!w-36 !py-1.5 text-meta">
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="EXITED">Exited</option>
          </Select>
          <span className="inline-flex items-center gap-1 text-micro text-muted-foreground">
            <SlidersHorizontal className="size-3" /> {activeFilters ? `${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : "No filters"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {selected.size > 0 && (
              <span className="text-micro font-semibold text-muted-foreground">{selected.size} selected</span>
            )}
            <Btn onClick={exportCsv} className="!px-2 !py-1.5 text-meta"><Download className="size-3.5" /> CSV</Btn>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_FILTERS.map((c) => {
            const on = chip === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChip(on ? "" : c.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-micro font-semibold transition-colors",
                  on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
          {(activeFilters > 0 || selected.size > 0) && (
            <button
              type="button"
              onClick={() => { setQ(""); setDept(""); setStatus(""); setChip(""); setSelected(new Set()); }}
              className="ml-1 text-micro font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {loading || error ? (
        <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={activeFilters || q ? "No employees match" : "No employees yet"}
          hint={activeFilters || q ? "Try clearing the filters or searching a different term" : "Add your first employee to get started"}
        />
      ) : (
        <FadeIn>
          <TableShell
            footer={
              <Pager page={safePage} pages={pages} onPage={setPage} total={rows.length} pageSize={PAGE_SIZE} label="employees" />
            }
          >
            <table className="w-full">
              <THead>
                <Th className="w-8"><RowCheck checked={allOnPage} onChange={(on) => setSelected((s) => { const n = new Set(s); for (const e of paged) on ? n.add(e.id) : n.delete(e.id); return n; })} label="Select all on this page" /></Th>
                <SortableTh label="Employee" active={sort.key === "name"} dir={sort.dir} onClick={() => sortBy("name")} />
                <SortableTh label="Role" active={sort.key === "roleTitle"} dir={sort.dir} onClick={() => sortBy("roleTitle")} />
                <SortableTh label="Department" active={sort.key === "department"} dir={sort.dir} onClick={() => sortBy("department")} />
                <SortableTh label="Manager" active={sort.key === "manager"} dir={sort.dir} onClick={() => sortBy("manager")} className="hidden md:table-cell" />
                <SortableTh label="Status" active={sort.key === "employmentStatus"} dir={sort.dir} onClick={() => sortBy("employmentStatus")} />
                <SortableTh label="Device" active={sort.key === "deviceId"} dir={sort.dir} onClick={() => sortBy("deviceId")} className="hidden sm:table-cell" />
                {canSeePay && <SortableTh label="Salary" active={sort.key === "salary"} dir={sort.dir} onClick={() => sortBy("salary")} className="hidden lg:table-cell" />}
                <SortableTh label="Utilization" active={sort.key === "utilizationRate"} dir={sort.dir} onClick={() => sortBy("utilizationRate")} className="hidden sm:table-cell" />
                <Th className="w-16"><span className="sr-only">Actions</span></Th>
              </THead>
              <tbody>
                {paged.map((e, i) => {
                  const checked = selected.has(e.id);
                  return (
                    <Tr
                      key={e.id}
                      index={i}
                      onClick={() => router.push(`/people/directory/${e.id}`)}
                      className={cn("cursor-pointer", checked && "bg-primary/5")}
                    >
                      <Td onClick={(ev: React.MouseEvent) => ev.stopPropagation()}>
                        <RowCheck
                          checked={checked}
                          onChange={(on) => setSelected((s) => { const n = new Set(s); on ? n.add(e.id) : n.delete(e.id); return n; })}
                          label={`Select ${e.name}`}
                        />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={e.name} src={e.photoUrl} jxlSrc={e.photoJxlUrl} />
                          <div className="min-w-0">
                            <p className="font-medium">{e.name}</p>
                            <p className={cn("truncate text-meta", e.email ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
                              {e.email ?? "no email"}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-muted-foreground">{e.roleTitle}</Td>
                      <Td className="text-muted-foreground">{e.department ?? "—"}</Td>
                      <Td className="hidden text-muted-foreground md:table-cell">{e.reportingManager?.name ?? "—"}</Td>
                      <Td>
                        {e.employmentStatus === "ACTIVE" ? (
                          <span className="text-meta text-muted-foreground">Active</span>
                        ) : (
                          <StatusBadge status={e.employmentStatus} />
                        )}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <span className={cn("font-mono text-meta font-semibold", e.deviceId ? "text-foreground" : "text-amber-600 dark:text-amber-400")}>
                          {e.deviceId ?? "—"}
                        </span>
                      </Td>
                      {canSeePay && (
                        <Td className="hidden font-semibold tabular-nums lg:table-cell">
                          {formatBDT(e.salary != null ? Number(e.salary) : null)}
                        </Td>
                      )}
                      <Td className="hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", utilBarCls(e.utilizationRate))} style={{ width: `${Math.min((e.utilizationRate ?? 0) * 100, 100)}%` }} />
                          </div>
                          <span className="text-meta font-bold tabular-nums text-muted-foreground">
                            {e.utilizationRate != null ? `${Math.round(e.utilizationRate * 100)}%` : "—"}
                          </span>
                        </div>
                      </Td>
                      <Td onClick={(ev: React.MouseEvent) => ev.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <Link
                            href={`/people/attendance/${e.id}`}
                            title={`Attendance for ${e.name}`}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Clock className="size-3.5" />
                          </Link>
                          <Link
                            href={`/people/directory/${e.id}`}
                            title={`Open ${e.name}`}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <ChevronRight className="size-3.5" />
                          </Link>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-micro text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Mail className="size-3" /> Amber = profile gap (email/device missing)</span>
        <span className="inline-flex items-center gap-1"><Fingerprint className="size-3" /> Device column is the fingerprint enrolment ID</span>
      </div>

      <EmployeeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(employee) => {
          notify(employee?.name ? `Employee added — ${employee.name}` : "Employee added");
          setQ("");
          setDept("");
          setStatus("");
          setChip("");
          setPage(0);
          reload();
        }}
      />
    </div>
  );
}

function SortableTh({
  label: l,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <Th className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn("inline-flex items-center gap-1 transition-colors hover:text-foreground", active && "text-foreground")}
      >
        {l}
        {active ? (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
      </button>
    </Th>
  );
}
