"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  FileText,
  Gauge,
  HeartPulse,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import type {
  AccountsOverview,
  Client,
  ClientContact,
  ClientDetail,
  UserLite,
} from "@/lib/types";
import {
  Avatar,
  EmptyState,
  FadeIn,
  PageHeader,
  SkeletonBlock,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import {
  Field,
  FormActions,
  Input,
  Modal,
  ScoreBar,
  Select,
  Textarea,
} from "@/components/ui";

const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const BILLING_CYCLES = ["PROJECT_BASED", "MONTHLY_RETAINER", "QUARTERLY_RETAINER", "ONE_TIME"];
const DOC_TYPES = ["MOU", "PROPOSAL", "BRAND_ASSET", "CREDENTIAL"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return diff;
}

const healthTone = (level: string) =>
  level === "GREEN"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : level === "YELLOW"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : "border-rose-500/30 bg-rose-500/10 text-rose-400";

// ── Client form modal (create / edit) ────────────────────────────────────
interface ClientFormState {
  companyName: string;
  industryVertical: string;
  accountOwnerId: string;
  billingCycleType: string;
  currencyPreference: string;
  contractStartDate: string;
  renewalDate: string;
  notes: string;
}

function ClientFormModal({
  open,
  onClose,
  users,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  initial?: Client | null;
  onSaved: () => void;
}) {
  const [f, setF] = useState<ClientFormState>({
    companyName: "",
    industryVertical: "OTHER",
    accountOwnerId: "",
    billingCycleType: "PROJECT_BASED",
    currencyPreference: "BDT",
    contractStartDate: "",
    renewalDate: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      initial
        ? {
            companyName: initial.companyName,
            industryVertical: initial.industryVertical,
            accountOwnerId: initial.accountOwner?.id ?? "",
            billingCycleType: initial.billingCycleType,
            currencyPreference: initial.currencyPreference ?? "BDT",
            contractStartDate: initial.contractStartDate?.slice(0, 10) ?? "",
            renewalDate: initial.renewalDate?.slice(0, 10) ?? "",
            notes: initial.notes ?? "",
          }
        : {
            companyName: "",
            industryVertical: "OTHER",
            accountOwnerId: "",
            billingCycleType: "PROJECT_BASED",
            currencyPreference: "BDT",
            contractStartDate: "",
            renewalDate: "",
            notes: "",
          }
    );
  }, [open, initial]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.companyName.trim()) {
      setErr("Company name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        companyName: f.companyName.trim(),
        industryVertical: f.industryVertical,
        accountOwnerId: f.accountOwnerId || undefined,
        billingCycleType: f.billingCycleType,
        currencyPreference: f.currencyPreference,
        contractStartDate: f.contractStartDate || null,
        renewalDate: f.renewalDate || null,
        notes: f.notes || null,
      };
      await apiFetch(editing ? `/accounts/clients/${initial!.id}` : "/accounts/clients", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit client" : "Add client"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Company name">
          <Input
            value={f.companyName}
            onChange={(e) => setF({ ...f, companyName: e.target.value })}
            placeholder="Acme Ltd."
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry vertical">
            <Select value={f.industryVertical} onChange={(e) => setF({ ...f, industryVertical: e.target.value })}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{label(v)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Account owner">
            <Select value={f.accountOwnerId} onChange={(e) => setF({ ...f, accountOwnerId: e.target.value })}>
              <option value="">Unassigned</option>
              {(users ?? []).map((u: UserLite) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Billing cycle">
            <Select value={f.billingCycleType} onChange={(e) => setF({ ...f, billingCycleType: e.target.value })}>
              {BILLING_CYCLES.map((b) => (
                <option key={b} value={b}>{label(b)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={f.currencyPreference} onChange={(e) => setF({ ...f, currencyPreference: e.target.value })}>
              <option value="BDT">BDT</option>
              <option value="USD">USD</option>
              <option value="SAR">SAR</option>
              <option value="AED">AED</option>
            </Select>
          </Field>
          <Field label="Contract start">
            <Input type="date" value={f.contractStartDate} onChange={(e) => setF({ ...f, contractStartDate: e.target.value })} />
          </Field>
          <Field label="Renewal date">
            <Input type="date" value={f.renewalDate} onChange={(e) => setF({ ...f, renewalDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            placeholder="Context, commitments, payment terms…"
          />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create client"} />
      </form>
    </Modal>
  );
}

// ── Contact form modal ───────────────────────────────────────────────────
function ContactFormModal({
  open,
  onClose,
  clientId,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  initial?: ClientContact | null;
  onSaved: () => void;
}) {
  const [f, setF] = useState({ name: "", roleTitle: "", email: "", phone: "", isPrimary: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      initial
        ? {
            name: initial.name,
            roleTitle: initial.roleTitle ?? "",
            email: initial.email ?? "",
            phone: initial.phone ?? "",
            isPrimary: initial.isPrimary,
          }
        : { name: "", roleTitle: "", email: "", phone: "", isPrimary: false }
    );
  }, [open, initial]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(
        editing
          ? `/accounts/clients/${clientId}/contacts/${initial!.id}`
          : `/accounts/clients/${clientId}/contacts`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(f),
        }
      );
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit contact" : "Add contact"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Full name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Role / title">
          <Input value={f.roleTitle} onChange={(e) => setF({ ...f, roleTitle: e.target.value })} placeholder="Operations Head" />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="tanvir@client.com" />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+8801…" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
          <input
            type="checkbox"
            checked={f.isPrimary}
            onChange={(e) => setF({ ...f, isPrimary: e.target.checked })}
            className="size-3.5 accent-primary"
          />
          Primary contact
        </label>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save contact" : "Add contact"} />
      </form>
    </Modal>
  );
}

// ── Document form modal ──────────────────────────────────────────────────
function DocumentFormModal({
  open,
  onClose,
  clientId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  onSaved: () => void;
}) {
  const [type, setType] = useState("MOU");
  const [fileUrl, setFileUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType("MOU");
      setFileUrl("");
      setErr(null);
    }
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileUrl.trim()) {
      setErr("File URL is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/accounts/clients/${clientId}/documents`, {
        method: "POST",
        body: JSON.stringify({ type, fileUrl: fileUrl.trim() }),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Attach document">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{label(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="File URL" hint="Google Drive / shared link">
          <Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://drive.zoolyum.com/…" autoFocus />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Attach" />
      </form>
    </Modal>
  );
}

export default function AccountsPage() {
  const { data: overview } = useApi<AccountsOverview>("/accounts/overview");
  const { data: users } = useApi<UserLite[]>("/users");

  const [q, setQ] = useState("");
  const [health, setHealth] = useState("");
  const [vertical, setVertical] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsErr, setClientsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [contactModal, setContactModal] = useState<{ open: boolean; initial?: ClientContact | null }>({ open: false });
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"client" | ClientContact | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (health) p.set("health", health);
    if (vertical) p.set("vertical", vertical);
    if (ownerId) p.set("ownerId", ownerId);
    return p.toString();
  }, [q, health, vertical, ownerId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setClientsErr(null);
    apiFetch<Client[]>(`/accounts/clients${query ? `?${query}` : ""}`)
      .then((d) => !cancelled && setClients(d))
      .catch((e) => !cancelled && setClientsErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<ClientDetail>(`/accounts/clients/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setSelectedId(null))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, refresh]);

  const recompute = async (id: string) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ score: number; level: string; drivers: string[] }>(
        `/accounts/clients/${id}/recompute-health`,
        { method: "POST" }
      );
      notify(`Health recomputed → ${r.score} ${r.level}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Recompute failed");
    } finally {
      setBusy(false);
    }
  };

  const removeContact = async (contactId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}/contacts/${contactId}`, { method: "DELETE" });
      notify("Contact removed");
      setDeleteTarget(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const removeDocument = async (docId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}/documents/${docId}`, { method: "DELETE" });
      notify("Document removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const deleteClient = async () => {
    if (!deleteTarget || deleteTarget !== "client" || !selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}`, { method: "DELETE" });
      notify("Client deleted");
      setDeleteTarget(null);
      setSelectedId(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const filtered = (clients ?? []).filter(
    (c) => !q || c.companyName.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      {flash && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Accounts — Client Management"
        subtitle="Every client relationship with a live health score."
        actions={
          <Btn variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> Add Client
          </Btn>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Clients"
          value={overview?.totalClients ?? "—"}
          sub={`${overview?.newThisMonth ?? 0} added this month`}
          icon={<Building2 className="size-5" />}
        />
        <StatCard
          label="Avg Health Score"
          value={overview?.avgHealth != null ? `${overview.avgHealth}` : "—"}
          sub="across all clients"
          icon={<Gauge className="size-5" />}
        />
        <StatCard
          label="On Watchlist"
          value={(overview?.distribution.YELLOW ?? 0) + (overview?.distribution.RED ?? 0)}
          sub={`${overview?.churnFlagged ?? 0} churn patterns flagged`}
          delta={overview?.distribution.RED ? `-${overview.distribution.RED}` : "0"}
          deltaGood={!overview?.distribution.RED}
          icon={<HeartPulse className="size-5" />}
        />
        <StatCard
          label="Renewals in 30d"
          value={overview?.renewalsNext30.length ?? "—"}
          sub="retainer pipeline"
          icon={<CalendarClock className="size-5" />}
        />
      </div>

      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search clients…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select value={health} onChange={(e) => setHealth(e.target.value)} className="!w-32">
            <option value="">All health</option>
            <option value="GREEN">GREEN</option>
            <option value="YELLOW">YELLOW</option>
            <option value="RED">RED</option>
          </Select>
          <Select value={vertical} onChange={(e) => setVertical(e.target.value)} className="!w-32">
            <option value="">All verticals</option>
            {VERTICALS.map((v) => (
              <option key={v} value={v}>{label(v)}</option>
            ))}
          </Select>
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="!w-40">
            <option value="">All owners</option>
            {(users ?? []).map((u: UserLite) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(5)].map((_, i) => (
              <SkeletonBlock key={i} className="h-12" />
            ))}
          </div>
        ) : clientsErr ? (
          <EmptyState title={clientsErr} />
        ) : filtered.length ? (
          <FadeIn>
            <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{filtered.length} clients</span>}>
              <table className="w-full">
                <THead>
                  <Th>Company</Th>
                  <Th>Vertical</Th>
                  <Th>Health</Th>
                  <Th>Paid</Th>
                  <Th>Due</Th>
                  <Th>Billing</Th>
                  <Th>Owner</Th>
                  <Th>Renewal</Th>
                  <Th>Projects</Th>
                </THead>
                <tbody>
                  {filtered.map((c, i) => {
                    const days = daysUntil(c.renewalDate);
                    return (
                      <Tr
                        key={c.id}
                        index={i}
                        onClick={() => setSelectedId(c.id)}
                        className="cursor-pointer"
                      >
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.companyName} />
                            <div>
                              <p className="font-medium">{c.companyName}</p>
                              <p className="max-w-[240px] truncate text-[11px] text-muted-foreground">
                                {c.healthDriver ?? "No active flags"}
                              </p>
                            </div>
                          </div>
                        </Td>
                        <Td className="text-muted-foreground">{c.industryVertical}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", healthTone(c.healthLevel))}>
                              {c.healthLevel}
                            </span>
                            <ScoreBar score={c.healthScore} />
                          </div>
                        </Td>
                        <Td><span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatBDT(c.totalPaid ?? 0)}</span></Td>
                        <Td>
                          {(c.totalDue ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-bold tabular-nums text-rose-500 dark:text-rose-400">{formatBDT(c.totalDue ?? 0)}</span>
                              <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-400">due</span>
                            </span>
                          ) : (
                            <span className="text-[11.5px] tabular-nums text-muted-foreground">—</span>
                          )}
                        </Td>
                        <Td className="text-muted-foreground">{label(c.billingCycleType)}</Td>
                        <Td className="text-muted-foreground">{c.accountOwner?.name ?? "—"}</Td>
                        <Td>
                          {days != null && days <= 30 ? (
                            <span className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              days <= 14
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                : "border-sky-500/30 bg-sky-500/10 text-sky-400"
                            )}>
                              {days <= 0 ? "due" : `in ${days}d`}
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">{formatDate(c.renewalDate)}</span>
                          )}
                        </Td>
                        <Td className="font-semibold tabular-nums">{c._count?.projects ?? 0}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </FadeIn>
        ) : (
          <EmptyState title="No clients found" />
        )}
      </div>

      {/* ── Client detail popup (centered) ─────────────────────────────── */}
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={
          <div className="flex items-center gap-3">
            <Avatar name={detail?.companyName ?? "?"} size="size-10" />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-[16px] font-semibold">{detail?.companyName ?? "Client"}</h3>
              <p className="text-[11px] text-muted-foreground">
                {detail?.industryVertical ? label(detail.industryVertical) : ""}
                {detail?.accountOwner ? ` · ${detail.accountOwner.name}` : ""}
              </p>
            </div>
          </div>
        }
      >
        {detailLoading ? (
          <div className="flex flex-col gap-3">
            {[...Array(5)].map((_, i) => (
              <SkeletonBlock key={i} className="h-10" />
            ))}
          </div>
        ) : !detail ? null : (() => {
          const paidPct = detail.totalInvoiced ? Math.round(((detail.totalPaid ?? 0) / detail.totalInvoiced) * 100) : 0;
          return (
          <div className="flex flex-col gap-5">
            {/* financial summary strip */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Total invoiced</p>
                <p className="mt-1.5 text-2xl font-black tabular-nums">{formatBDT(detail.totalInvoiced ?? 0)}</p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                  {detail.invoices.length} invoice{detail.invoices.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-emerald-400">Paid</p>
                <p className="mt-1.5 text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-300">{formatBDT(detail.totalPaid ?? 0)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/20">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                </div>
              </div>
              <div className={cn("rounded-2xl border p-4", (detail.totalDue ?? 0) > 0 ? "border-rose-500/25 bg-rose-500/10" : "border-border/60 bg-card")}>
                <p className={cn("text-[10.5px] font-bold uppercase tracking-widest", (detail.totalDue ?? 0) > 0 ? "text-rose-400" : "text-muted-foreground")}>Due</p>
                <p className={cn("mt-1.5 text-2xl font-black tabular-nums", (detail.totalDue ?? 0) > 0 && "text-rose-500 dark:text-rose-300")}>{formatBDT(detail.totalDue ?? 0)}</p>
                <p className={cn("mt-0.5 text-[10.5px]", (detail.totalDue ?? 0) > 0 ? "font-semibold text-rose-400/80" : "text-muted-foreground")}>
                  {(detail.totalDue ?? 0) > 0 ? "outstanding balance" : "all settled"}
                </p>
              </div>
            </div>

            {/* health banner */}
            <div className={cn("rounded-2xl border p-4", healthTone(detail.healthLevel))}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold tracking-wide uppercase">Health Score</p>
                <span className="text-lg font-black tabular-nums">{detail.healthScore}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/20">
                <div
                  className={cn(
                    "h-full rounded-full",
                    (detail.healthScore ?? 0) >= 70 ? "bg-emerald-400" : (detail.healthScore ?? 0) >= 40 ? "bg-amber-400" : "bg-rose-400"
                  )}
                  style={{ width: `${detail.healthScore ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-[11.5px] font-medium">
                {detail.healthDriver ?? "Healthy — no active drivers"}
              </p>
              {detail.churnFlags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.churnFlags.map((f) => (
                    <span key={f.id} className="rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-semibold">
                      ⚑ {label(f.matchedPattern ?? f.riskLevel)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* main grid */}
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-5">
                {/* projects */}
                <section>
                  <SectionTitle icon={<Building2 className="size-3.5" />} title={`Projects (${detail.projects.length})`} />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.projects.length === 0 && <p className="text-[11.5px] text-muted-foreground">No projects</p>}
                    {detail.projects.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold">{p.name}</p>
                          <p className="text-[10.5px] text-muted-foreground">
                            {p.budgetAmount ? formatBDT(p.budgetAmount) : "No budget"}
                            {p.targetEndDate ? ` · ends ${formatDate(p.targetEndDate)}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={p.status} />
                        <StatusBadge status={p.healthStatus} />
                      </div>
                    ))}
                  </div>
                </section>

                {/* invoices */}
                <section>
                  <SectionTitle icon={<FileText className="size-3.5" />} title={`Invoices (${detail.invoices.length})`} />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.invoices.length === 0 && <p className="text-[11.5px] text-muted-foreground">No invoices</p>}
                    {detail.invoices.map((inv) => {
                      const total = inv.total ?? inv.lineItems.reduce((s, li) => s + Number(li.amount), 0);
                      const paid = inv.paid ?? 0;
                      const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                      return (
                        <div key={inv.id} className="rounded-xl border border-border/60 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-semibold">{inv.invoiceNumber}</p>
                              <p className="text-[10.5px] text-muted-foreground">
                                {formatDate(inv.issueDate)}
                                {inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : ""}
                              </p>
                            </div>
                            <span className="text-[12px] font-bold tabular-nums">{formatBDT(total)}</span>
                            <StatusBadge status={inv.status} />
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatBDT(paid)} / {formatBDT(total)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* health history */}
                <section>
                  <SectionTitle icon={<Gauge className="size-3.5" />} title="Health history" />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.healthLogs.length === 0 && <p className="text-[11.5px] text-muted-foreground">No history yet</p>}
                    {detail.healthLogs.slice(0, 5).map((h, i) => (
                      <div key={h.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-1.5 text-[11.5px]">
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                            h.score >= 70 ? "bg-emerald-500/15 text-emerald-400" : h.score >= 40 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"
                          )}
                        >
                          {h.score}
                        </span>
                        <span className="flex-1 truncate text-muted-foreground">{h.driverSummary ?? "healthy"}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">{timeAgo(h.recordedAt)}</span>
                        {i === 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9.5px] font-bold text-primary">now</span>}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

            <div className="flex flex-col gap-5">
                {/* key facts */}
                <section>
                  <SectionTitle icon={<CalendarClock className="size-3.5" />} title="Client details" />
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Fact label="Billing cycle" value={label(detail.billingCycleType)} />
                    <Fact label="Currency" value={detail.currencyPreference ?? "BDT"} />
                    <Fact label="Contract start" value={formatDate(detail.contractStartDate)} />
                    <Fact label="Renewal" value={formatDate(detail.renewalDate)} />
                    <Fact label="Owner" value={detail.accountOwner?.name ?? "Unassigned"} />
                    <Fact label="Created" value={formatDate(detail.createdAt ?? null)} />
                  </div>
                </section>

                {/* recent payments */}
                <section>
                  <SectionTitle icon={<Wallet className="size-3.5" />} title="Recent payments" />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {!detail.payments?.length && <p className="text-[11.5px] text-muted-foreground">No payments recorded</p>}
                    {detail.payments?.map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">{label(p.paymentMethod)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold">{p.invoice.invoiceNumber}</p>
                          <p className="text-[10.5px] text-muted-foreground">{formatDate(p.paymentDate)}</p>
                        </div>
                        <span className="text-[12.5px] font-bold tabular-nums text-emerald-600 dark:text-emerald-300">+{formatBDT(Number(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* contacts */}
                <section>
                  <SectionTitle
                    icon={<Users className="size-3.5" />}
                    title={`Contacts (${detail.contacts.length})`}
                    action={
                      <button onClick={() => setContactModal({ open: true })} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                        <UserPlus className="size-3" /> Add
                      </button>
                    }
                  />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.contacts.length === 0 && <p className="text-[11.5px] text-muted-foreground">No contacts — add one</p>}
                    {detail.contacts.map((c) => (
                      <div key={c.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <Avatar name={c.name} size="size-7" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold">
                            {c.name}
                            {c.isPrimary && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">PRIMARY</span>}
                          </p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {[c.roleTitle, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Btn variant="ghost" onClick={() => setContactModal({ open: true, initial: c })}>
                            <Pencil className="size-3" />
                          </Btn>
                          <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteTarget(c)}>
                            <Trash2 className="size-3" />
                          </Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* documents */}
                <section>
                  <SectionTitle
                    icon={<FileText className="size-3.5" />}
                    title={`Documents (${detail.documents.length})`}
                    action={
                      <button onClick={() => setDocModalOpen(true)} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                        <Plus className="size-3" /> Attach
                      </button>
                    }
                  />
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.documents.length === 0 && <p className="text-[11.5px] text-muted-foreground">No documents</p>}
                    {detail.documents.map((d) => (
                      <div key={d.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold">{label(d.type)}</p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {d.fileUrl} · {d.uploadedBy?.name ?? "unknown"} · {timeAgo(d.uploadedAt)}
                          </p>
                        </div>
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-bold text-primary transition-colors hover:text-primary"
                        >
                          open
                        </a>
                        <button
                          onClick={() => removeDocument(d.id)}
                          className="rounded-lg p-1 text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            {/* notes */}
            {detail.notes && (
              <section>
                <SectionTitle icon={<ShieldAlert className="size-3.5" />} title="Notes" />
                <p className="mt-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                  {detail.notes}
                </p>
              </section>
            )}

            {/* footer actions */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex items-center justify-between gap-2 border-t border-border/60 bg-card px-6 py-3.5">
              <div className="flex items-center gap-2">
                <Btn variant="ghost" onClick={() => setEditClient(detail)}>
                  <Pencil className="size-3.5" /> Edit
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() => busy ? undefined : recompute(detail.id)}
                  className={busy ? "opacity-50" : ""}
                >
                  <RefreshCw className="size-3.5" /> Recompute
                </Btn>
                <Btn variant="ghost" onClick={() => setDocModalOpen(true)}>
                  <FileText className="size-3.5" /> Attach doc
                </Btn>
              </div>
              <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteTarget("client")}>
                <Trash2 className="size-3.5" />
              </Btn>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* modals */}
      <ClientFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users ?? []}
        onSaved={() => {
          setCreateOpen(false);
          reload();
          notify("Client created");
        }}
      />
      <ClientFormModal
        open={!!editClient}
        onClose={() => setEditClient(null)}
        users={users ?? []}
        initial={editClient}
        onSaved={() => {
          setEditClient(null);
          reload();
          notify("Client updated");
        }}
      />
      <ContactFormModal
        open={contactModal.open}
        onClose={() => setContactModal({ open: false })}
        clientId={selectedId ?? ""}
        initial={contactModal.initial ?? null}
        onSaved={() => {
          setContactModal({ open: false });
          reload();
          notify("Contact saved");
        }}
      />
      <DocumentFormModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        clientId={selectedId ?? ""}
        onSaved={() => {
          setDocModalOpen(false);
          reload();
          notify("Document attached");
        }}
      />
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget === "client" ? "Delete client?" : "Remove contact?"}
      >
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {deleteTarget === "client"
            ? "This permanently deletes the client, its contacts, documents, and health history. Projects and invoices referencing it will be orphaned — proceed carefully."
            : deleteTarget
              ? `Remove ${deleteTarget.name} from this client? Health score will be recomputed.`
              : ""}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => setDeleteTarget(null)}
            className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (deleteTarget === "client") deleteClient();
              else if (deleteTarget) removeContact(deleteTarget.id);
            }}
            className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-rose-500/30 transition-all hover:scale-[1.02]"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold">{value ?? "—"}</p>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
        {icon} {title}
      </h4>
      {action}
    </div>
  );
}
