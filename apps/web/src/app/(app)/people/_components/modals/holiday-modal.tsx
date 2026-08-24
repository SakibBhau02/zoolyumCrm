"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Field, FormActions, Input, Modal } from "@/components/ui";

export function HolidayModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: "", name: "", description: "", tentative: false, isGovernment: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setErr(null); setF({ date: "", name: "", description: "", tentative: false, isGovernment: true }); }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.date || !f.name.trim()) { setErr("Date and name are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/holidays", { method: "POST", body: JSON.stringify({ date: f.date, name: f.name.trim(), description: f.description.trim() || undefined, tentative: f.tentative, isGovernment: f.isGovernment }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add holiday">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Eid-ul-Fitr" autoFocus /></Field>
        </div>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Public holiday" /></Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium"><input type="checkbox" checked={f.isGovernment} onChange={(e) => setF({ ...f, isGovernment: e.target.checked })} className="size-3.5 rounded border-border accent-primary" /> Government holiday</label>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium"><input type="checkbox" checked={f.tentative} onChange={(e) => setF({ ...f, tentative: e.target.checked })} className="size-3.5 rounded border-border accent-amber-500" /> Tentative date (e.g. Eid, subject to moon sighting)</label>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add holiday" />
      </form>
    </Modal>
  );
}