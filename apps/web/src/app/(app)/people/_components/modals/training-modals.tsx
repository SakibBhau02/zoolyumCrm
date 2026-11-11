"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { COURSE_TYPES, label } from "../constants";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";

export function CourseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", description: "", type: "optional", category: "", duration: "", provider: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setErr(null); setF({ title: "", description: "", type: "optional", category: "", duration: "", provider: "" }); }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { setErr("Title is required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/courses", { method: "POST", body: JSON.stringify({ title: f.title.trim(), description: f.description.trim() || undefined, type: f.type, category: f.category.trim() || undefined, duration: f.duration.trim() || undefined, provider: f.provider.trim() || undefined }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Add course">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Advanced TypeScript" autoFocus /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What does the course cover?" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {COURSE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </Select>
          </Field>
          <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Engineering" /></Field>
          <Field label="Duration"><Input value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} placeholder="8 hours" /></Field>
          <Field label="Provider"><Input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="Udemy" /></Field>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add course" />
      </form>
    </Modal>
  );
}

export function EnrollModal({ open, onClose, courses, employees, onSaved }: { open: boolean; onClose: () => void; courses: any[]; employees: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ courseId: "", employeeId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ courseId: courses[0]?.id ?? "", employeeId: employees[0]?.id ?? "" });
  }, [open, courses, employees]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.courseId || !f.employeeId) { setErr("Course and employee are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/enrollments", { method: "POST", body: JSON.stringify({ courseId: f.courseId, employeeId: f.employeeId }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Enroll employee">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Course *">
          <Select value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })}>
            {courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        </Field>
        <Field label="Employee *">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </Select>
        </Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Enroll" />
      </form>
    </Modal>
  );
}