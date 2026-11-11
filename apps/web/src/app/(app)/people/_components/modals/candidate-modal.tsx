"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Field, FormActions, Input, Modal } from "@/components/ui";

export function CandidateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", position: "", department: "", source: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setErr(null); setF({ firstName: "", lastName: "", email: "", phone: "", position: "", department: "", source: "" }); }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() || !f.lastName.trim() || !f.email.trim() || !f.position.trim()) { setErr("Name, email and position are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/candidates", { method: "POST", body: JSON.stringify({ firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, position: f.position.trim(), department: f.department.trim() || undefined, source: f.source.trim() || undefined }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Add candidate" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name *"><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="Sadia" autoFocus /></Field>
          <Field label="Last name *"><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="Rahman" /></Field>
          <Field label="Email *"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="sadia@example.com" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+8801…" /></Field>
          <Field label="Position *"><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="UI Designer" /></Field>
          <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Design" /></Field>
          <Field label="Source"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="LinkedIn" /></Field>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add candidate" />
      </form>
    </Modal>
  );
}