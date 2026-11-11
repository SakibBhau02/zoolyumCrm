"use client";
import { useCallback, useState } from "react";
import { GraduationCap, Plus, Trash2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, SectionTitle, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, Tr } from "@/components/table";
import { Select } from "@/components/ui";
import { label } from "../_components/constants";
import { DataTable, Toast, useList, useToast } from "../_components/hooks";
import { Pager, useTable } from "../_components/table-kit";
import { PeopleHero, PeopleTabs } from "../_components/hero";
import { usePeopleAccess } from "../_components/permissions";
import { CourseModal, EnrollModal } from "../_components/modals/training-modals";

export default function TrainingPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: courses, loading: cl, error: ce } = useList<any[]>("/people/courses", refresh);
  const { data: enrollments, loading: el, error: ee } = useList<any[]>("/people/enrollments", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [courseOpen, setCourseOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [view, setView] = useState<"courses" | "enrollments">("courses");
  const courseRows = useTable<any>(courses, { keys: (c) => [c.title, c.category, c.provider], pageSize: 7 });
  const enrollRows = useTable<any>(enrollments, { keys: (en) => [en.course?.title, en.employee?.name, en.status], pageSize: 7 });
  const { flash, notify } = useToast();
  const { canEdit } = usePeopleAccess();
  const removeCourse = async (c: any) => {
    if (!window.confirm(`Delete the course "${c.title}" and its enrollments?`)) return;
    try {
      await apiFetch(`/people/courses/${c.id}`, { method: "DELETE" });
      notify("Course deleted");
      reload();
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };
  const setProgress = async (en: any, progress: number) => {
    try {
      await apiFetch(`/people/enrollments/${en.id}`, { method: "PATCH", body: JSON.stringify({ progress }) });
      notify(`Progress set to ${progress}%`);
      reload();
    } catch (e: any) { notify(e.message ?? "Update failed"); }
  };
  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        title="Training"
        subtitle="Learning catalog and employee progress"
        stats={[
          { label: "Courses", value: (courses ?? []).length },
          { label: "Enrollments", value: (enrollments ?? []).length, tone: "sky" },
          { label: "Completed", value: (enrollments ?? []).filter((e: any) => (e.progress ?? 0) >= 100).length, tone: "emerald" },
        ]}
        actions={
          canEdit ? (
            <div className="flex gap-1.5">
              <Btn variant="outline" onClick={() => setEnrollOpen(true)} className="!px-2 !py-1 text-micro"><Users className="size-3.5" /> Enroll</Btn>
              <Btn variant="primary" onClick={() => setCourseOpen(true)} className="!px-2 !py-1 text-micro"><Plus className="size-3.5" /> Course</Btn>
            </div>
          ) : undefined
        }
      />
      <PeopleTabs
        className="mt-2"
        value={view}
        onChange={setView}
        tabs={[
          { id: "courses", label: "Courses", count: courseRows.total },
          { id: "enrollments", label: "Enrollments", count: enrollRows.total },
        ]}
      />
      <div className={view === "courses" ? "mt-2" : "hidden"}>
        <DataTable
          loading={cl}
          error={ce}
          onRetry={reload}
          skeleton={5}
          footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-meta text-muted-foreground">{courseRows.total} courses</span><Pager page={courseRows.page} pages={courseRows.pages} onPage={courseRows.setPage} total={courseRows.total} pageSize={7} label="courses" /></div>}
          cols={["Course", "Type", "Category", "Duration", "Provider", "Actions"]}
          rows={courseRows.paged.map((c: any, i: number) => (
            <Tr key={c.id} index={i}>
              <Td>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-gradient-soft text-primary dark:text-primary"><GraduationCap className="size-4" /></span>
                  <div><p className="font-medium">{c.title}</p>{c.description && <p className="max-w-xs truncate text-meta text-muted-foreground">{c.description}</p>}</div>
                </div>
              </Td>
              <Td><span className={cn("rounded-full px-2 py-0.5 text-micro font-semibold", c.type === "mandatory" ? "bg-primary/10 text-primary dark:text-primary" : "bg-muted text-muted-foreground")}>{label(c.type)}</span></Td>
              <Td className="text-muted-foreground">{c.category ?? "—"}</Td>
              <Td className="text-muted-foreground">{c.duration ?? "—"}</Td>
              <Td className="text-muted-foreground">{c.provider ?? "—"}</Td>
              <Td><button onClick={() => removeCourse(c)} aria-label={`Delete course ${c.title}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete course"><Trash2 className="size-3.5" /></button></Td>
            </Tr>
          ))}
        />
      </div>
      <div className={view === "enrollments" ? "mt-2" : "hidden"}>
      <SectionTitle title="Enrollments" subtitle="Employee progress across the catalog" />
      <DataTable
        loading={el}
        error={ee}
        onRetry={reload}
        skeleton={5}
        footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-meta text-muted-foreground">{enrollRows.total} enrollments</span><Pager page={enrollRows.page} pages={enrollRows.pages} onPage={enrollRows.setPage} total={enrollRows.total} pageSize={7} label="enrollments" /></div>}
        cols={["Course", "Employee", "Status", "Progress", "Completed"]}
        rows={enrollRows.paged.map((en: any, i: number) => (
          <Tr key={en.id} index={i}>
            <Td><p className="font-medium">{en.course?.title}</p></Td>
            <Td><div className="flex items-center gap-2.5"><Avatar name={en.employee?.name} size="size-7" /><p className="text-muted-foreground">{en.employee?.name}</p></div></Td>
            <Td><StatusBadge status={en.status} /></Td>
            <Td>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", (en.progress ?? 0) >= 100 ? "bg-emerald-500" : "bg-brand-gradient")} style={{ width: `${Math.min(en.progress ?? 0, 100)}%` }} />
                </div>
                <Select value={String(en.progress ?? 0)} onChange={(e) => setProgress(en, Number(e.target.value))} className="!w-24 !py-1 !text-meta">
                  {/* Include the stored value even when it is not one of the
                      presets (40%, 60% …) — otherwise the select renders blank. */}
                  {Array.from(new Set([0, 25, 50, 75, 100, Number(en.progress ?? 0)])).sort((a, b) => a - b).map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </Select>
              </div>
            </Td>
            <Td className="text-muted-foreground">{en.completedAt ? formatDate(en.completedAt) : "—"}</Td>
          </Tr>
        ))}
      />
      </div>
      <CourseModal open={courseOpen} onClose={() => setCourseOpen(false)} onSaved={() => { notify("Course added"); reload(); }} />
      <EnrollModal open={enrollOpen} onClose={() => setEnrollOpen(false)} courses={courses ?? []} employees={employees ?? []} onSaved={() => { notify("Employee enrolled"); reload(); }} />
    </div>
  );
}
