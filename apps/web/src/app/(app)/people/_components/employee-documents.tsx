"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, EmptyState, SectionTitle, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, FormActions, Input, Modal, Select } from "@/components/ui";
import { formatDate } from "@/lib/format";

export type EmployeeDoc = { id?: string; name: string; type?: string; url?: string; expiresAt?: string | null };

const DOC_TYPES = ["Contract", "National ID", "Passport / Visa", "NDA", "Certificate", "Other"];

const daysUntil = (date?: string | null) => {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const ms = new Date(d).setHours(23, 59, 59, 999) - Date.now();
  return Math.ceil(ms / 86400000);
};

/**
 * Document vault on the employee profile.
 *
 * Uses the existing `Employee.documents` JSON column (no migration) and keeps
 * the most expensive part of document management visible: the expiry. A work
 * permit that lapses silently is an operational incident, not a paperwork
 * detail, so anything inside 30 days is surfaced in amber and anything expired
 * in rose.
 */
export function EmployeeDocuments({
  employeeId,
  documents,
  onSaved,
  notify,
}: {
  employeeId: string;
  documents: EmployeeDoc[];
  onSaved: () => void;
  notify: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", type: "Contract", url: "", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const docs = useMemo(() => [...(documents ?? [])].sort((a, b) => {
    const da = daysUntil(a.expiresAt);
    const db = daysUntil(b.expiresAt);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  }), [documents]);

  const expiring = docs.filter((d) => { const n = daysUntil(d.expiresAt); return n != null && n <= 30; }).length;

  const persist = async (next: EmployeeDoc[]) => {
    await apiFetch(`/people/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify({ documents: next }) });
    onSaved();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr("Give the document a name"); return; }
    setBusy(true);
    setErr(null);
    try {
      const entry: EmployeeDoc = {
        id: `${Date.now()}`,
        name: f.name.trim(),
        type: f.type,
        url: f.url.trim() || undefined,
        expiresAt: f.expiresAt || null,
      };
      await persist([...(documents ?? []), entry]);
      notify("Document added");
      setOpen(false);
      setF({ name: "", type: "Contract", url: "", expiresAt: "" });
    } catch (e2: any) {
      setErr(e2.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: EmployeeDoc) => {
    if (!window.confirm(`Remove “${doc.name}” from this profile?`)) return;
    setBusy(true);
    try {
      await persist((documents ?? []).filter((d) => (d.id ? d.id !== doc.id : d.name !== doc.name)));
      notify("Document removed");
    } catch (e: any) {
      notify(e.message ?? "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell>
      <SectionTitle
        title={`Documents (${docs.length})`}
        subtitle={expiring ? `${expiring} expiring within 30 days` : "Contracts, IDs and certificates — expiry tracked"}
        icon={<ShieldCheck className="size-4" />}
        action={<Btn variant="outline" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add</Btn>}
      />

      {docs.length === 0 ? (
        <EmptyState title="No documents on file" hint="Add a contract, ID or certificate — anything with an expiry date gets flagged before it lapses." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {docs.map((d, i) => {
            const n = daysUntil(d.expiresAt);
            const tone = n == null ? "muted" : n < 0 ? "rose" : n <= 7 ? "rose" : n <= 30 ? "amber" : "emerald";
            return (
              <div key={d.id ?? `${d.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
                <span className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  tone === "rose" ? "bg-rose-500/10 text-rose-500" : tone === "amber" ? "bg-amber-500/10 text-amber-600 dark:text-amber-300" : "bg-muted text-muted-foreground"
                )}>
                  {tone === "rose" || tone === "amber" ? <AlertTriangle className="size-3.5" /> : <FileText className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold">{d.name}</p>
                  <p className="text-micro text-muted-foreground">
                    {d.type ?? "Document"}
                    {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}
                    {n != null ? n < 0 ? ` · expired ${Math.abs(n)}d ago` : ` · ${n}d left` : ""}
                  </p>
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-micro font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                )}
                <button onClick={() => remove(d)} disabled={busy} title="Remove document" aria-label={`Remove ${d.name}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Modal closeOnBackdrop={false} open={open} onClose={() => setOpen(false)} title="Add document">
        <form onSubmit={add} className="flex flex-col gap-4">
          <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Employment contract 2026" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Expiry date" hint="Leave blank for no expiry">
              <Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
            </Field>
          </div>
          <Field label="Link" hint="Drive / Dropbox / uploads URL">
            <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
          </Field>
          {err && <p className="text-body font-medium text-rose-500">{err}</p>}
          <FormActions busy={busy} cancel={() => setOpen(false)} submitLabel="Add document" />
        </form>
      </Modal>
    </CardShell>
  );
}
