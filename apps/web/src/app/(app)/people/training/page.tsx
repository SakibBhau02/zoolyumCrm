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
import { CourseModal, EnrollModal } from "../_components/modals/training-modals";

export default function TrainingPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: courses, loading: cl, error: ce } = useList<any[]>("/people/courses", refresh);
  const { data: enrollments, loading: el, error: ee } = useList<any[]>("/people/enrollments", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const [courseOpen, setCourseOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const { flash, notify } = useToast();
  const removeCourse = async (c: any) => {
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
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Courses" subtitle="Learning catalog" />
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => setEnrollOpen(true)}><Users className="size-3.5" /> Enroll</Btn>
            <Btn variant="primary" onClick={() => setCourseOpen(true)}><Plus className="size-3.5" /> Add Course</Btn>
          </div>
        </div>
        <DataTable
          loading={cl}
          error={ce}
          onRetry={reload}
          skeleton={5}
          footer={<span className="text-[11.5px] text-muted-foreground">{(courses ?? []).length} courses</span>}
          cols={["Course", "Type", "Category", "Duration", "Provider", "Actions"]}
          rows={(courses ?? []).map((c: any, i: number) => (
            <Tr key={c.id} index={i}>
              <Td>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-gradient-soft text-primary dark:text-primary"><GraduationCap className="size-4" /></span>
                  <div><p className="font-medium">{c.title}</p>{c.description && <p className="max-w-xs truncate text-[11px] text-muted-foreground">{c.description}</p>}</div>
                </div>
              </Td>
              <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", c.type === "mandatory" ? "bg-primary/10 text-primary dark:text-primary" : "bg-muted text-muted-foreground")}>{label(c.type)}</span></Td>
              <Td className="text-muted-foreground">{c.category ?? "—"}</Td>
              <Td className="text-muted-foreground">{c.duration ?? "—"}</Td>
              <Td className="text-muted-foreground">{c.provider ?? "—"}</Td>
              <Td><button onClick={() => removeCourse(c)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete course"><Trash2 className="size-4" /></button></Td>
            </Tr>
          ))}
        />
      </div>
      <SectionTitle title="Enrollments" subtitle="Employee progress across the catalog" />
      <DataTable
        loading={el}
        error={ee}
        onRetry={reload}
        skeleton={5}
        footer={<span className="text-[11.5px] text-muted-foreground">{(enrollments ?? []).length} enrollments</span>}
        cols={["Course", "Employee", "Status", "Progress", "Completed"]}
        rows={(enrollments ?? []).map((en: any, i: number) => (
          <Tr key={en.id} index={i}>
            <Td><p className="font-medium">{en.course?.title}</p></Td>
            <Td><div className="flex items-center gap-2.5"><Avatar name={en.employee?.name} size="size-7" /><p className="text-muted-foreground">{en.employee?.name}</p></div></Td>
            <Td><StatusBadge status={en.status} /></Td>
            <Td>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", (en.progress ?? 0) >= 100 ? "bg-emerald-500" : "bg-brand-gradient")} style={{ width: `${Math.min(en.progress ?? 0, 100)}%` }} />
                </div>
                <Select value={String(en.progress ?? 0)} onChange={(e) => setProgress(en, Number(e.target.value))} className="!w-24 !py-1 !text-[11px]">
                  {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
                </Select>
              </div>
            </Td>
            <Td className="text-muted-foreground">{en.completedAt ? formatDate(en.completedAt) : "—"}</Td>
          </Tr>
        ))}
      />
      <CourseModal open={courseOpen} onClose={() => setCourseOpen(false)} onSaved={() => { notify("Course added"); reload(); }} />
      <EnrollModal open={enrollOpen} onClose={() => setEnrollOpen(false)} courses={courses ?? []} employees={employees ?? []} onSaved={() => { notify("Employee enrolled"); reload(); }} />
    </div>
  );
}
