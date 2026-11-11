"use client";
import { useEffect, useState } from "react";
import { CalendarClock, CalendarDays, GraduationCap, Pencil, Target, Trash2 } from "lucide-react";
import { formatBDT, formatDate, formatDay } from "@/lib/format";
import { Avatar, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Modal, Select } from "@/components/ui";
import { DAYS, dayShort, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, label, skillsOf, fmtTime } from "../constants";

export default function EmployeeProfileModal({
  open,
  onClose,
  detail,
  loading,
  onSave,
  onDelete,
  initialEditing,
}: {
  open: boolean;
  onClose: () => void;
  detail: any;
  loading: boolean;
  onSave: (payload: any) => Promise<void>;
  onDelete: () => Promise<void>;
  initialEditing?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editF, setEditF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setEditing(!!initialEditing); setEditF(null); setErr(null); }
  }, [open, initialEditing]);
  const openEdit = () => {
    if (!detail) return;
    setEditF({ name: detail.name, email: detail.email ?? "", phone: detail.phone ?? "", roleTitle: detail.roleTitle, department: detail.department ?? "", workLocation: detail.workLocation ?? "", employmentType: detail.employmentType, employmentStatus: detail.employmentStatus, salary: detail.salary != null ? String(detail.salary) : "", joinedDate: detail.joinDate ? String(detail.joinDate).slice(0, 10) : "", deviceId: detail.deviceId ?? "", weeklyOffDays: detail.weeklyOffDays ?? [], shiftStart: detail.shiftStart ?? "", shiftEnd: detail.shiftEnd ?? "", graceMinutes: detail.graceMinutes != null ? String(detail.graceMinutes) : "", education: detail.education ?? "", emergencyContactName: detail.emergencyContactName ?? "", emergencyContactPhone: detail.emergencyContactPhone ?? "", emergencyContactRelation: detail.emergencyContactRelation ?? "", careerHistory: Array.isArray(detail.careerHistory) ? detail.careerHistory : [] });
    setEditing(true);
  };
  useEffect(() => {
    if (open && initialEditing && detail && !editF) openEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEditing, detail]);
  const saveEdit = async () => {
    if (!detail || !editF) return;
    setBusy(true);
    setErr(null);
    try {
      if (!editF.name?.trim()) throw new Error("Name is required");
      if (!editF.roleTitle?.trim()) throw new Error("Role is required");
      await onSave({ name: editF.name.trim(), email: editF.email.trim() || undefined, phone: editF.phone.trim() || undefined, roleTitle: editF.roleTitle.trim(), department: editF.department.trim() || undefined, workLocation: editF.workLocation.trim() || undefined, employmentType: editF.employmentType, employmentStatus: editF.employmentStatus, salary: editF.salary ? Number(editF.salary) : undefined, joinedDate: editF.joinedDate || undefined, joinDate: editF.joinedDate || undefined, deviceId: editF.deviceId.trim() || undefined, weeklyOffDays: editF.weeklyOffDays, // empty = follow the company policy
        shiftStart: editF.shiftStart?.trim() ? editF.shiftStart.trim() : null, shiftEnd: editF.shiftEnd?.trim() ? editF.shiftEnd.trim() : null, graceMinutes: editF.graceMinutes === "" ? null : Number(editF.graceMinutes), education: editF.education.trim() || undefined, emergencyContactName: editF.emergencyContactName.trim() || undefined, emergencyContactPhone: editF.emergencyContactPhone.trim() || undefined, emergencyContactRelation: editF.emergencyContactRelation.trim() || undefined, careerHistory: (editF.careerHistory ?? []).filter((c: any) => (c.title ?? "").trim() || (c.company ?? "").trim()) });
      setEditing(false);
      setEditF(null);
    } catch (e: any) {
      // Previously swallowed: a 403/409/500 closed nothing and showed nothing.
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  };
  const deleteEmployee = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete ${detail.name}? This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try { await onDelete(); } catch (e: any) { setErr(e?.message ?? "Delete failed"); } finally { setBusy(false); }
  };
  return (
    <Modal closeOnBackdrop={false}
      open={open}
      onClose={onClose}
      size="xl"
      title={loading ? "Loading…" : detail ? (
        <div className="flex items-center gap-2.5">
          <Avatar name={detail.name} />
          <div><p className="font-heading text-section font-semibold">{detail.name}</p><p className="text-meta text-muted-foreground">{detail.roleTitle}</p></div>
          <StatusBadge status={detail.employmentStatus} />
        </div>
      ) : null}
    >
      {loading ? (
        <div className="flex flex-col gap-3">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : !detail ? null : editing && editF ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><Input value={editF.name} onChange={(e) => setEditF({ ...editF, name: e.target.value })} /></Field>
            <Field label="Role"><Input value={editF.roleTitle} onChange={(e) => setEditF({ ...editF, roleTitle: e.target.value })} /></Field>
            <Field label="Email"><Input value={editF.email} onChange={(e) => setEditF({ ...editF, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={editF.phone} onChange={(e) => setEditF({ ...editF, phone: e.target.value })} /></Field>
            <Field label="Department"><Input value={editF.department} onChange={(e) => setEditF({ ...editF, department: e.target.value })} /></Field>
            <Field label="Work location"><Input value={editF.workLocation} onChange={(e) => setEditF({ ...editF, workLocation: e.target.value })} /></Field>
            <Field label="Employment type">
              <Select value={editF.employmentType} onChange={(e) => setEditF({ ...editF, employmentType: e.target.value })}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={editF.employmentStatus} onChange={(e) => setEditF({ ...editF, employmentStatus: e.target.value })}>
                {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
            <Field label="Monthly salary (BDT)"><Input type="number" min={0} value={editF.salary} onChange={(e) => setEditF({ ...editF, salary: e.target.value })} /></Field>
            <Field label="Device ID (fingerprint)"><Input value={editF.deviceId} onChange={(e) => setEditF({ ...editF, deviceId: e.target.value })} placeholder="e.g. 101" /></Field>
            <Field label="Joined date"><Input type="date" value={editF.joinedDate} onChange={(e) => setEditF({ ...editF, joinedDate: e.target.value })} /></Field>
            <Field label="Education"><Input value={editF.education} onChange={(e) => setEditF({ ...editF, education: e.target.value })} placeholder="BBA, NSU (2019)" /></Field>
          </div>
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">Emergency contact</p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Name"><Input value={editF.emergencyContactName} onChange={(e) => setEditF({ ...editF, emergencyContactName: e.target.value })} placeholder="Full name" /></Field>
              <Field label="Phone"><Input value={editF.emergencyContactPhone} onChange={(e) => setEditF({ ...editF, emergencyContactPhone: e.target.value })} placeholder="+8801…" /></Field>
              <Field label="Relation"><Input value={editF.emergencyContactRelation} onChange={(e) => setEditF({ ...editF, emergencyContactRelation: e.target.value })} placeholder="Spouse / Parent" /></Field>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Career history</p>
              <button type="button" onClick={() => setEditF({ ...editF, careerHistory: [...(editF.careerHistory ?? []), { title: "", company: "", period: "" }] })} className="text-meta font-bold text-primary hover:underline">+ Add entry</button>
            </div>
            <div className="flex flex-col gap-2">
              {(editF.careerHistory ?? []).length === 0 && <p className="text-meta text-muted-foreground">No entries yet.</p>}
              {(editF.careerHistory ?? []).map((c: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <Field label="Title"><Input value={c.title ?? ""} onChange={(e) => setEditF({ ...editF, careerHistory: editF.careerHistory.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder="Senior Designer" /></Field>
                  <Field label="Company"><Input value={c.company ?? ""} onChange={(e) => setEditF({ ...editF, careerHistory: editF.careerHistory.map((x: any, j: number) => (j === i ? { ...x, company: e.target.value } : x)) })} placeholder="Acme Ltd." /></Field>
                  <Field label="Period"><Input value={c.period ?? ""} onChange={(e) => setEditF({ ...editF, careerHistory: editF.careerHistory.map((x: any, j: number) => (j === i ? { ...x, period: e.target.value } : x)) })} placeholder="2021 — 2024" /></Field>
                  <button type="button" onClick={() => setEditF({ ...editF, careerHistory: editF.careerHistory.filter((_: any, j: number) => j !== i) })} className="mb-0.5 rounded-lg p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500" title="Remove entry"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">Schedule (defaults to company policy when blank)</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Weekly off days">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DAYS.map((d) => (
                    <button key={d} type="button" onClick={() => setEditF({ ...editF, weeklyOffDays: editF.weeklyOffDays.includes(d) ? editF.weeklyOffDays.filter((x: string) => x !== d) : [...editF.weeklyOffDays, d] })} className={cn("rounded-lg px-2 py-1 text-meta font-semibold transition-colors", editF.weeklyOffDays.includes(d) ? "bg-brand-gradient text-white" : "bg-muted text-muted-foreground hover:bg-muted/70")}>{dayShort[d]}</button>
                  ))}
                </div>
              </Field>
              <Field label="Late grace (minutes)"><Input type="number" min={0} value={editF.graceMinutes} onChange={(e) => setEditF({ ...editF, graceMinutes: e.target.value })} placeholder="15" /></Field>
              <Field label="Shift start (HH:MM)"><Input value={editF.shiftStart} onChange={(e) => setEditF({ ...editF, shiftStart: e.target.value })} placeholder="10:00" /></Field>
              <Field label="Shift end (HH:MM)"><Input value={editF.shiftEnd} onChange={(e) => setEditF({ ...editF, shiftEnd: e.target.value })} placeholder="18:00" /></Field>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Email</p><p className="mt-0.5 text-body">{detail.email ?? "—"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Phone</p><p className="mt-0.5 text-body">{detail.phone ?? "—"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Department</p><p className="mt-0.5 text-body">{detail.department ?? "—"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Location</p><p className="mt-0.5 text-body">{detail.workLocation ?? "—"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Type</p><p className="mt-0.5 text-body capitalize">{label(detail.employmentType ?? "full-time")}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Joined</p><p className="mt-0.5 text-body">{formatDate(detail.joinDate)}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Salary</p><p className="mt-0.5 text-body font-semibold tabular-nums">{formatBDT(detail.salary != null ? Number(detail.salary) : null)}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Pay frequency</p><p className="mt-0.5 text-body capitalize">{label(detail.payFrequency ?? "monthly")}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Device ID</p><p className="mt-0.5 font-mono text-body font-semibold">{detail.deviceId ?? "—"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Weekly off</p><p className="mt-0.5 text-body">{detail.weeklyOffDays?.length ? detail.weeklyOffDays.map((d: string) => dayShort[d] ?? d).join(", ") : "Per company policy"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Shift</p><p className="mt-0.5 text-body tabular-nums">{detail.shiftStart || detail.shiftEnd ? `${detail.shiftStart ?? "—"} → ${detail.shiftEnd ?? "—"}` : "Per company policy"}</p></div>
            <div><p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Late grace</p><p className="mt-0.5 text-body tabular-nums">{detail.graceMinutes != null ? `${detail.graceMinutes} min` : "Per company policy"}</p></div>
          </div>
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">Skills</p>
            <span className="flex flex-wrap gap-1">
              {skillsOf(detail).length === 0 && <span className="text-body text-muted-foreground">—</span>}
              {skillsOf(detail).map((s: string) => <span key={s} className="rounded-full bg-brand-gradient-soft px-2 py-0.5 text-micro font-medium text-primary dark:text-primary">{s}</span>)}
            </span>
          </div>
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-muted-foreground"><CalendarClock className="size-3.5" /> Attendance — last 7</h4>
            <div className="flex flex-col gap-1.5">
              {detail.attendance?.length === 0 && <p className="text-meta text-muted-foreground">No attendance logged.</p>}
              {detail.attendance?.slice(0, 7).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                  <span className="text-body font-medium">{formatDay(a.date)}</span>
                  <div className="flex items-center gap-2"><span className="text-micro tabular-nums text-muted-foreground">{fmtTime(a.checkInTime)} → {fmtTime(a.checkOutTime)}</span><StatusBadge status={a.status} /></div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-muted-foreground"><CalendarDays className="size-3.5" /> Leave history</h4>
            <div className="flex flex-col gap-1.5">
              {detail.leaveRequests?.length === 0 && <p className="text-meta text-muted-foreground">No leave taken.</p>}
              {detail.leaveRequests?.slice(0, 5).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                  <div><p className="text-body font-medium">{l.leaveType}</p><p className="text-micro text-muted-foreground">{formatDay(l.startDate)} → {formatDay(l.endDate)}</p></div>
                  <StatusBadge status={l.status} />
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-muted-foreground"><GraduationCap className="size-3.5" /> Enrollments</h4>
            <div className="flex flex-col gap-1.5">
              {detail.enrollments?.length === 0 && <p className="text-meta text-muted-foreground">No courses enrolled.</p>}
              {detail.enrollments?.map((en: any) => (
                <div key={en.id} className="rounded-xl bg-muted/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2"><p className="text-body font-medium">{en.course?.title}</p><StatusBadge status={en.status} /></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.min(en.progress ?? 0, 100)}%` }} /></div>
                  <p className="mt-1 text-micro tabular-nums text-muted-foreground">{en.progress ?? 0}% complete</p>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-muted-foreground"><Target className="size-3.5" /> OKRs</h4>
            <div className="flex flex-col gap-1.5">
              {detail.okrs?.length === 0 && <p className="text-meta text-muted-foreground">No OKRs assigned.</p>}
              {detail.okrs?.map((o: any) => (
                <div key={o.id} className="rounded-xl bg-muted/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2"><p className="text-body font-medium">{o.title}</p><span className="text-micro font-semibold text-muted-foreground">{o.quarter}</span></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", (o.overallProgress ?? 0) >= 70 ? "bg-emerald-500" : (o.overallProgress ?? 0) >= 40 ? "bg-amber-400" : "bg-rose-500")} style={{ width: `${Math.min(o.overallProgress ?? 0, 100)}%` }} /></div>
                  <p className="mt-1 text-micro tabular-nums text-muted-foreground">{Math.round(o.overallProgress ?? 0)}%</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {detail && !loading && (
        <div className="sticky bottom-0 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-card pt-4">
          {err && <p className="mr-auto text-meta font-medium text-rose-500">{err}</p>}
          {editing ? (
            <>
              <Btn variant="ghost" onClick={() => { setEditing(false); setEditF(null); setErr(null); }}>Cancel</Btn>
              <Btn variant="primary" onClick={saveEdit} className={busy ? "opacity-60" : ""} disabled={busy}>Save changes</Btn>
              <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={deleteEmployee} disabled={busy}><Trash2 className="size-3.5" /> Delete</Btn>
            </>
          ) : (
            <Btn variant="outline" onClick={openEdit}><Pencil className="size-3.5" /> Edit profile</Btn>
          )}
        </div>
      )}
    </Modal>
  );
}