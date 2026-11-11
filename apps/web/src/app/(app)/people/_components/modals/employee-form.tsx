"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EMPLOYMENT_TYPES, label } from "../constants";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";

export function EmployeeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", roleTitle: "", department: "", workLocation: "", employmentType: "full-time", salary: "", joinedDate: "", deviceId: "", education: "", emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setErr(null); setF({ name: "", email: "", phone: "", roleTitle: "", department: "", workLocation: "", employmentType: "full-time", salary: "", joinedDate: "", deviceId: "", education: "", emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "" }); }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.roleTitle.trim()) { setErr("Name and role are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/employees", { method: "POST", body: JSON.stringify({ name: f.name.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, roleTitle: f.roleTitle.trim(), department: f.department.trim() || undefined, workLocation: f.workLocation.trim() || undefined, employmentType: f.employmentType, salary: f.salary ? Number(f.salary) : undefined, joinedDate: f.joinedDate || undefined, joinDate: f.joinedDate || undefined, deviceId: f.deviceId.trim() || undefined, education: f.education.trim() || undefined, emergencyContactName: f.emergencyContactName.trim() || undefined, emergencyContactPhone: f.emergencyContactPhone.trim() || undefined, emergencyContactRelation: f.emergencyContactRelation.trim() || undefined }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Add employee" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rahim Ahmed" autoFocus /></Field>
          <Field label="Role *"><Input value={f.roleTitle} onChange={(e) => setF({ ...f, roleTitle: e.target.value })} placeholder="Software Engineer" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="rahim@zoolyum.com" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+8801…" /></Field>
          <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Engineering" /></Field>
          <Field label="Work location"><Input value={f.workLocation} onChange={(e) => setF({ ...f, workLocation: e.target.value })} placeholder="Remote" /></Field>
          <Field label="Employment type"><Select value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
          <Field label="Monthly salary (BDT)"><Input type="number" min={0} value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} placeholder="95000" /></Field>
          <Field label="Device ID (fingerprint)"><Input value={f.deviceId} onChange={(e) => setF({ ...f, deviceId: e.target.value })} placeholder="e.g. 101" /></Field>
          <Field label="Joined date"><Input type="date" value={f.joinedDate} onChange={(e) => setF({ ...f, joinedDate: e.target.value })} /></Field>
          <Field label="Education"><Input value={f.education} onChange={(e) => setF({ ...f, education: e.target.value })} placeholder="BBA, NSU (2019)" /></Field>
          <Field label="Emergency contact"><Input value={f.emergencyContactName} onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Emergency phone"><Input value={f.emergencyContactPhone} onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })} placeholder="+8801…" /></Field>
          <Field label="Emergency relation"><Input value={f.emergencyContactRelation} onChange={(e) => setF({ ...f, emergencyContactRelation: e.target.value })} placeholder="Spouse / Parent" /></Field>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add employee" />
      </form>
    </Modal>
  );
}