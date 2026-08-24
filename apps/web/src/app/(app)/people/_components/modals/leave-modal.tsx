"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { label, LEAVE_TYPES } from "../constants";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";

export function LeaveModal({ open, onClose, employees, onSaved }: { open: boolean; onClose: () => void; employees: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: "", leaveType: "CASUAL", startDate: "", endDate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ employeeId: employees[0]?.id ?? "", leaveType: "CASUAL", startDate: "", endDate: "" });
  }, [open, employees]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.employeeId || !f.startDate || !f.endDate) { setErr("Employee and dates are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/leave-requests", { method: "POST", body: JSON.stringify({ employeeId: f.employeeId, leaveType: f.leaveType, startDate: f.startDate, endDate: f.endDate }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Request leave">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Employee *">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </Select>
        </Field>
        <Field label="Leave type">
          <Select value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date *"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End date *"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Submit request" />
      </form>
    </Modal>
  );
}