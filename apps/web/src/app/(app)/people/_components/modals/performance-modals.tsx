"use client";
import React, { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";

/** Current quarter label, e.g. "2026-Q4". */
const currentQuarter = () => `${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`;

export function ReviewModal({ open, onClose, employees, onSaved }: { open: boolean; onClose: () => void; employees: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: "", reviewPeriod: "", overallRating: "4" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ employeeId: employees[0]?.id ?? "", reviewPeriod: "", overallRating: "4" });
  }, [open, employees]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.employeeId || !f.reviewPeriod.trim()) { setErr("Employee and review period are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/reviews", { method: "POST", body: JSON.stringify({ employeeId: f.employeeId, reviewPeriod: f.reviewPeriod.trim(), overallRating: Number(f.overallRating) }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Add performance review">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Employee *">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </Select>
        </Field>
        <Field label="Review period *"><Input value={f.reviewPeriod} onChange={(e) => setF({ ...f, reviewPeriod: e.target.value })} placeholder={currentQuarter()} /></Field>
        <Field label="Overall rating (1–5)">
          <Select value={f.overallRating} onChange={(e) => setF({ ...f, overallRating: e.target.value })}>
            {[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v} — {v >= 5 ? "outstanding" : v >= 4 ? "exceeds" : v >= 3 ? "meets" : v >= 2 ? "below" : "critical"}</option>)}
          </Select>
        </Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add review" />
      </form>
    </Modal>
  );
}

export function OkrModal({ open, onClose, employees, onSaved }: { open: boolean; onClose: () => void; employees: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: "", title: "", quarter: "" });
  const [krs, setKrs] = useState([{ title: "", target: "", current: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setF({ employeeId: employees[0]?.id ?? "", title: "", quarter: "" }); setKrs([{ title: "", target: "", current: "" }]); }
  }, [open, employees]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rows = krs.filter((k) => k.title.trim());
    if (!f.employeeId || !f.title.trim() || !f.quarter.trim() || rows.length === 0) { setErr("Employee, title, quarter and at least one key result are required"); return; }
    setBusy(true); setErr(null);
    try { await apiFetch("/people/okrs", { method: "POST", body: JSON.stringify({ employeeId: f.employeeId, title: f.title.trim(), quarter: f.quarter.trim(), keyResults: rows.map((k) => ({ title: k.title.trim(), target: Number(k.target) || 0, current: Number(k.current) || 0 })) }) }); onSaved(); onClose(); } catch (e2: any) { setErr(e2.message ?? "Save failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title="Add OKR" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee *">
            <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
              {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </Select>
          </Field>
          <Field label="Quarter *"><Input value={f.quarter} onChange={(e) => setF({ ...f, quarter: e.target.value })} placeholder="Q3 2026" /></Field>
        </div>
        <Field label="Objective *"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ship the billing revamp" /></Field>
        <Field label="Key results">
          <div className="flex flex-col gap-2">
            {krs.map((k, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={k.title} onChange={(e) => setKrs(krs.map((r, ri) => (ri === i ? { ...r, title: e.target.value } : r)))} placeholder="Key result title" className="flex-1" />
                <Input type="number" min={0} value={k.target} onChange={(e) => setKrs(krs.map((r, ri) => (ri === i ? { ...r, target: e.target.value } : r)))} placeholder="Target" className="!w-20" />
                <Input type="number" min={0} value={k.current} onChange={(e) => setKrs(krs.map((r, ri) => (ri === i ? { ...r, current: e.target.value } : r)))} placeholder="Cur" className="!w-16" />
                {krs.length > 1 && (
                  <button type="button" onClick={() => setKrs(krs.filter((_, ri) => ri !== i))} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setKrs([...krs, { title: "", target: "", current: "" }])} className="flex items-center gap-1 self-start rounded-lg text-meta font-bold text-primary transition-colors hover:text-primary dark:text-primary"><Plus className="size-3.5" /> Add key result</button>
          </div>
        </Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add OKR" />
      </form>
    </Modal>
  );
}