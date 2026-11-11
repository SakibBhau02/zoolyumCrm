"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Laptop, Pencil, Plus, Trash2, Undo2, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { Avatar, CardShell, EmptyState, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";
import { Toast, useList, useToast } from "../_components/hooks";
import { Pager, TableToolbar, useTable } from "../_components/table-kit";
import { PeopleHero } from "../_components/hero";
import { usePeopleAccess } from "../_components/permissions";

const STATUSES = ["AVAILABLE", "ASSIGNED", "REPAIR", "RETIRED"] as const;
const CATEGORIES = ["Laptop", "Desktop", "Monitor", "Camera", "Lens", "Phone", "Tablet", "Audio", "Licence", "Furniture", "Other"];

const STATUS_TONE: Record<string, string> = {
  AVAILABLE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20",
  ASSIGNED: "bg-primary/10 text-primary dark:text-primary ring-primary/20",
  REPAIR: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20",
  RETIRED: "bg-muted text-muted-foreground ring-border",
};

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function AssetsPage() {
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: assets, loading, error } = useList<any[]>("/people/assets", refresh);
  const { canEdit } = usePeopleAccess();
  const { data: summary } = useList<any>("/people/assets/summary", refresh);
  const { data: employees } = useList<any[]>("/people/employees");
  const { flash, notify } = useToast();

  const [status, setStatus] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [assigning, setAssigning] = useState<any | null>(null);

  const rows = useMemo(() => (assets ?? []).filter((a: any) => !status || a.status === status), [assets, status]);
  const table = useTable<any>(rows, { keys: (a) => [a.tag, a.name, a.category, a.serialNumber, a.assignedTo?.name, a.status], pageSize: 8 });

  const returnAsset = async (a: any) => {
    if (!window.confirm(`Mark ${a.tag} (${a.name}) as returned?`)) return;
    try {
      await apiFetch(`/people/assets/${a.id}/return`, { method: "POST" });
      notify(`${a.tag} returned to stock`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not return");
    }
  };

  const removeAsset = async (a: any) => {
    if (!window.confirm(`Delete ${a.tag} — ${a.name}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/people/assets/${a.id}`, { method: "DELETE" });
      notify("Asset deleted");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not delete");
    }
  };

  return (
    <div>
      <Toast flash={flash} />
      <PeopleHero
        title="Assets"
        subtitle="Laptops, cameras, phones and licences — who holds what, and what it is worth"
        stats={[
          { label: "Total", value: summary?.total ?? "—", sub: "items" },
          { label: "Assigned", value: summary?.assigned ?? "—", sub: "with team", tone: "sky" },
          { label: "Available", value: summary?.available ?? "—", sub: "in stock", tone: "emerald" },
          { label: "In repair", value: summary?.repair ?? "—", sub: "vendor", tone: summary?.repair ? "amber" : "default" },
          { label: "Book value", value: summary?.totalValue != null ? formatBDT(summary.totalValue) : "—", sub: "cost" },
        ]}
        actions={canEdit ? <Btn variant="primary" onClick={() => setAddOpen(true)} className="!px-2.5 !py-1.5 text-meta"><Plus className="size-3.5" /> Add</Btn> : undefined}
      />

      <div className="mt-3">
      <TableToolbar
        q={table.q}
        onQ={table.setQ}
        placeholder="Search tag, name, serial or holder…"
        count={`${table.total} item${table.total === 1 ? "" : "s"}`}
        right={
          <div className="flex flex-wrap gap-1.5">
            {["", ...STATUSES].map((s) => (
              <button
                key={s || "all"}
                onClick={() => { setStatus(s); table.setPage(0); }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-micro font-semibold transition-colors",
                  status === s ? "bg-brand-gradient text-white" : "border border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {s ? label(s) : "All"}
              </button>
            ))}
          </div>
        }
      />

      {!loading && !error && table.total === 0 ? (
        <EmptyState
          title={assets?.length ? "No assets match that filter" : "No assets yet"}
          hint="Add a laptop, camera or licence — then assign it to a person so the register stays truthful."
        />
      ) : (
        <CardShell className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40">
                  {["Tag", "Asset", "Holder", "Status", "Value", "Purchased", "Actions"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-micro font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.paged.map((a: any) => (
                  <tr key={a.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-meta font-semibold text-muted-foreground">{a.tag}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-body font-semibold">{a.name}</p>
                      <p className="text-micro text-muted-foreground">
                        {a.category}{a.serialNumber ? ` · ${a.serialNumber}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.assignedTo ? (
                        <Link href={`/people/directory/${a.assignedTo.id}`} className="flex items-center gap-1.5 text-body font-medium hover:text-primary hover:underline">
                          <Avatar name={a.assignedTo.name} size="size-5" />{a.assignedTo.name}
                        </Link>
                      ) : (
                        <span className="text-meta text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide ring-1", STATUS_TONE[a.status] ?? "bg-muted text-muted-foreground")}>
                        {label(a.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-body tabular-nums">{a.value != null ? formatBDT(a.value) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-meta text-muted-foreground">{a.purchaseDate ? formatDate(a.purchaseDate) : "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {canEdit && (a.status === "ASSIGNED" ? (
                          <Btn variant="ghost" onClick={() => returnAsset(a)} className="!px-2 !py-1 text-micro"><Undo2 className="size-3.5" /> Return</Btn>
                        ) : a.status !== "RETIRED" ? (
                          <Btn variant="outline" onClick={() => setAssigning(a)} className="!px-2 !py-1 text-micro"><UserPlus className="size-3.5" /> Assign</Btn>
                        ) : null)}
                        {canEdit && (
                          <>
                            <button onClick={() => setEdit(a)} title="Edit asset" aria-label={`Edit ${a.name}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                              <Pencil className="size-3.5" />
                            </button>
                            <button onClick={() => removeAsset(a)} title="Delete asset" aria-label={`Delete ${a.name}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500">
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border/60 px-4">
            <Pager page={table.page} pages={table.pages} onPage={table.setPage} total={table.total} pageSize={8} label="assets" />
          </div>
        </CardShell>
      )}
      </div>

      <AssetModal open={addOpen || !!edit} asset={edit} onClose={() => { setAddOpen(false); setEdit(null); }} onSaved={() => { notify(edit ? "Asset updated" : "Asset added"); reload(); }} />
      <AssignModal asset={assigning} employees={employees ?? []} onClose={() => setAssigning(null)} onSaved={() => { notify("Asset assigned"); reload(); }} />
    </div>
  );
}

function AssetModal({ open, asset, onClose, onSaved }: { open: boolean; asset: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: "", category: "Laptop", serialNumber: "", value: "", purchaseDate: "", notes: "", status: "AVAILABLE", tag: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  // Re-seed the form whenever the modal opens for a different asset.
  const incoming = asset?.id ?? "new";
  if (open && key !== incoming) {
    setKey(incoming);
    setF(asset
      ? { name: asset.name ?? "", category: asset.category ?? "Laptop", serialNumber: asset.serialNumber ?? "", value: asset.value != null ? String(asset.value) : "", purchaseDate: asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : "", notes: asset.notes ?? "", status: asset.status ?? "AVAILABLE", tag: asset.tag ?? "" }
      : { name: "", category: "Laptop", serialNumber: "", value: "", purchaseDate: "", notes: "", status: "AVAILABLE", tag: "" });
    setErr(null);
  }
  if (!open && key !== null) setKey(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr("Give the asset a name"); return; }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: f.name.trim(), category: f.category, serialNumber: f.serialNumber.trim() || undefined,
        value: f.value === "" ? undefined : Number(f.value), purchaseDate: f.purchaseDate || undefined,
        notes: f.notes.trim() || undefined, status: f.status, tag: f.tag.trim() || undefined,
      };
      if (asset) await apiFetch(`/people/assets/${asset.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await apiFetch("/people/assets", { method: "POST", body: JSON.stringify(payload) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal closeOnBackdrop={false} open={open} onClose={onClose} title={asset ? `Edit ${asset.tag}` : "Add asset"} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="MacBook Air M3 13″" autoFocus /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Serial number"><Input value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} placeholder="C02XXXXXXX" /></Field>
          <Field label="Tag" hint="Leave blank to auto-number"><Input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="AST-0001" /></Field>
          <Field label="Purchase value (BDT)"><Input type="number" min={0} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="185000" /></Field>
          <Field label="Purchased on"><Input type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Charger + sleeve included" /></Field>
        {err && <p className="text-body font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={asset ? "Save changes" : "Add asset"} />
      </form>
    </Modal>
  );
}

function AssignModal({ asset, employees, onClose, onSaved }: { asset: any | null; employees: any[]; onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The component stays mounted between opens, so the previous asset's holder
  // must be cleared — otherwise one Enter assigns the wrong laptop.
  useEffect(() => {
    if (asset) { setEmployeeId(""); setErr(null); }
  }, [asset?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) { setErr("Pick a person"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/people/assets/${asset.id}/assign`, { method: "POST", body: JSON.stringify({ employeeId }) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Could not assign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal closeOnBackdrop={false} open={!!asset} onClose={onClose} title={`Assign ${asset?.tag ?? ""}`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-body text-muted-foreground">
          <span className="font-semibold text-foreground">{asset?.name}</span> — {asset?.category}
          {asset?.serialNumber ? ` · ${asset.serialNumber}` : ""}
        </p>
        <Field label="Assign to *">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select a person…</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name} — {emp.roleTitle}</option>)}
          </Select>
        </Field>
        {err && <p className="text-body font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Assign" />
      </form>
    </Modal>
  );
}
