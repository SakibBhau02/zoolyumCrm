"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ATT_STATUSES, label, todayLocal } from "../constants";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";

export function AttendanceModal({ open, onClose, employees, edit, onSaved }: { open: boolean; onClose: () => void; employees: any[]; edit: any; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: "", date: todayLocal(), status: "PRESENT", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF(edit ? { employeeId: edit.employee?.id ?? "", date: String(edit.date).slice(0, 10), status: edit.status, reason: "" } : { employeeId: employees[0]?.id ?? "", date: todayLocal(), status: "PRESENT", reason: "" });
  }, [open, edit, employees]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.employeeId || !f.date) { setErr("Employee and date are required"); return; }
    setBusy(true); setErr(null);
    try {
      if (edit) {
        await apiFetch(`/people/attendance/${edit.id}/correct`, { method: "PATCH", body: JSON.stringify({ field: "status", value: f.status, reason: f.reason.trim() || undefined }) });
      } else {
        await apiFetch("/people/attendance", { method: "POST", body: JSON.stringify({ employeeId: f.employeeId, date: f.date, status: f.status }) });
      }
      onSaved(); onClose();
    } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title={edit ? "Correct attendance" : "Record attendance"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Employee *">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} disabled={!!edit}>
            {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={edit ? "Date" : "Date *"} hint={edit ? "The date cannot be changed — correct the right day, or delete and re-record" : undefined}>
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} disabled={!!edit} />
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {ATT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
        </div>
        {edit && <Field label="Correction reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. late punch missed - employee informed" /></Field>}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={edit ? "Save correction" : "Record attendance"} />
      </form>
    </Modal>
  );
}

export function ImportPunchModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (r: { imported: number; unmatched: number }) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setErr(null); setText(""); } }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rows: any[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const p = t.split(/[\t,]/);
      if (p.length < 2) { setErr("Each line needs deviceId + datetime, e.g. 101  2026-08-20 09:05:12"); return; }
      rows.push({ deviceId: p[0].trim(), time: p[1].trim().replace("T", " "), verifyMethod: p[2]?.trim() || undefined, workCode: p[3]?.trim() || undefined });
    }
    if (!rows.length) { setErr("Paste at least one punch row"); return; }
    setBusy(true); setErr(null);
    try { const r = await apiFetch<any>("/people/punches/import", { method: "POST", body: JSON.stringify({ rows }) }); onSaved(r); onClose(); } catch (e2: any) { setErr(e2.message ?? "Import failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Import punches" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-body leading-relaxed text-muted-foreground">Paste rows exported from the fingerprint device. One punch per line: <span className="font-mono text-meta text-foreground">deviceId, datetime, verify, workcode</span>. Punches with unknown device IDs are left unmatched for you to map.</p>
        <Field label="Punch rows *">
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"101\t2026-08-20 09:05:12\t2\t1\n102\t2026-08-20 10:35:12\t2\t1"} className="font-mono text-body" />
        </Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Import punches" />
      </form>
    </Modal>
  );
}