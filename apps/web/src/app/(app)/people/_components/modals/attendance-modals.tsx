"use client";
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ATT_STATUSES, label, todayLocal } from "../constants";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";

/** Dhaka wall-clock HH:MM for an ISO instant (the API stores true UTC). */
const hhmm = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 6 * 3600_000).toISOString().slice(11, 16);
};

/**
 * Record or correct one attendance day.
 *
 * Correcting used to be status-only, so "he forgot to punch out" or "the
 * machine logged 09:14 instead of 09:01" could not be fixed from the UI. Each
 * changed field is sent as its own correction so the audit trail records what
 * actually changed and why.
 */
export function AttendanceModal({ open, onClose, employees, edit, onSaved }: { open: boolean; onClose: () => void; employees: any[]; edit: any; onSaved: () => void }) {
  const blank = { employeeId: "", date: todayLocal(), status: "PRESENT", checkIn: "", checkOut: "", reason: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const current = useMemo(
    () => ({ checkIn: hhmm(edit?.checkIn ?? edit?.checkInTime), checkOut: hhmm(edit?.checkOut ?? edit?.checkOutTime), status: edit?.status ?? "" }),
    [edit]
  );

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      edit
        ? {
            employeeId: edit.employee?.id ?? "",
            date: String(edit.date).slice(0, 10),
            status: edit.status ?? "PRESENT",
            checkIn: current.checkIn,
            checkOut: current.checkOut,
            reason: "",
          }
        : { ...blank, employeeId: employees[0]?.id ?? "", date: todayLocal() }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit, employees]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.employeeId || !f.date) { setErr("Employee and date are required"); return; }
    if (f.checkIn && f.checkOut && f.checkOut <= f.checkIn) { setErr("Check-out must be after check-in (use the next day for night shifts)"); return; }
    setBusy(true); setErr(null);
    try {
      if (edit) {
        const changes: { field: "status" | "checkInTime" | "checkOutTime"; value: string }[] = [];
        if (f.status !== current.status) changes.push({ field: "status", value: f.status });
        if (f.checkIn !== current.checkIn) changes.push({ field: "checkInTime", value: f.checkIn });
        if (f.checkOut !== current.checkOut) changes.push({ field: "checkOutTime", value: f.checkOut });
        if (!changes.length) { setErr("Nothing changed yet"); setBusy(false); return; }
        // One PATCH per changed field so each lands in the correction log.
        for (const c of changes) {
          await apiFetch(`/people/attendance/${edit.id}/correct`, {
            method: "PATCH",
            body: JSON.stringify({ field: c.field, value: c.value, reason: f.reason.trim() || undefined }),
          });
        }
      } else {
        // "HH:MM" is Dhaka wall time on that date; the API wants an instant.
        const iso = (t: string) => (t ? new Date(`${f.date}T${t}:00+06:00`).toISOString() : undefined);
        await apiFetch("/people/attendance", {
          method: "POST",
          body: JSON.stringify({
            employeeId: f.employeeId,
            date: f.date,
            status: f.status,
            checkInTime: iso(f.checkIn),
            checkOutTime: iso(f.checkOut),
          }),
        });
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check-in" hint="Dhaka time · leave blank if there was no punch">
            <Input type="time" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} />
          </Field>
          <Field label="Check-out" hint="Blank means still inside / forgot to punch out">
            <Input type="time" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />
          </Field>
        </div>
        {edit && (
          <Field label="Correction reason" hint="Saved against every field you change">
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. late punch missed - employee informed" />
          </Field>
        )}
        {edit && current.checkIn && (
          <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-meta text-muted-foreground">
            Current: in <span className="font-semibold tabular-nums text-foreground">{current.checkIn}</span> · out{" "}
            <span className="font-semibold tabular-nums text-foreground">{current.checkOut || "not punched"}</span>
            {edit.punchCount != null && <span> · {edit.punchCount} device punch{edit.punchCount === 1 ? "" : "es"}</span>}
          </p>
        )}
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
