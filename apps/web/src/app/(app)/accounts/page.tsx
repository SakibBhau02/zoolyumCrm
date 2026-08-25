"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Columns,
  ExternalLink,
  FileText,
  Gauge,
  HeartPulse,
  Layers,
  LayoutGrid,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  Table as TableIcon,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import type {
  AccountsOverview,
  Client,
  ClientCategory,
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
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";

const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const BILLING_CYCLES = ["PROJECT_BASED", "MONTHLY_RETAINER", "QUARTERLY_RETAINER", "ONE_TIME"];
const DOC_TYPES = ["MOU", "PROPOSAL", "BRAND_ASSET", "CREDENTIAL"];
const CATEGORIES = ["ACTIVE", "ON_HOLD", "ARCHIVED"] as const;

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

const categoryTone = (cat: string) =>
  cat === "ACTIVE"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : cat === "ON_HOLD"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : "border-zinc-400/30 bg-zinc-400/10 text-zinc-500 dark:text-zinc-400";

// ── tier helper ────────────────────────────────────────────────────────────
function getTierForClient(
  totalInvoiced: number | undefined | null,
  tiers: { name: string; minValue: number; color: string }[] | undefined
): { name: string; color: string } | null {
  const v = totalInvoiced ?? 0;
  if (tiers && tiers.length) {
    const sorted = [...tiers].sort((a, b) => b.minValue - a.minValue);
    for (const t of sorted) {
      if (v >= t.minValue) return { name: t.name, color: t.color };
    }
    return sorted[sorted.length - 1] ? { name: sorted[sorted.length - 1].name, color: sorted[sorted.length - 1].color } : null;
  }
  // fallback to control defaults
  if (v >= 100000) return { name: "Enterprise", color: "#f59e0b" };
  if (v >= 25000) return { name: "Professional", color: "#3b82f6" };
  if (v >= 0) return { name: "Starter", color: "#64748b" };
  return null;
}

// ── Client form modal (create / edit) ────────────────────────────────────
interface ClientFormState {
  companyName: string;
  industryVertical: string;
  category: string;
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
  projects,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  initial?: Client | null;
  onSaved: () => void;
  projects?: { id: string; name: string; status: string; healthStatus?: string }[];
}) {
  const [f, setF] = useState<ClientFormState>({
    companyName: "",
    industryVertical: "OTHER",
    category: "ACTIVE",
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
            category: (initial as any).category ?? "ACTIVE",
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
            category: "ACTIVE",
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
        category: f.category,
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
      <form onSubmit={save} className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <Avatar name={f.companyName || "New Client"} />
          <div className="min-w-0 flex-1">
            <p className="font-heading text-[15px] font-semibold truncate">{editing ? initial.companyName : "New Client"}</p>
            <p className="text-[11px] text-muted-foreground">{editing ? "Update client details and integrations" : "Add a new client — projects & billing will be linked automatically"}</p>
          </div>
          {editing && (
            <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", categoryTone(f.category))}>
              {label(f.category)}
            </span>
          )}
        </div>

        <div>
          <SectionTitle icon={<Building2 className="size-3.5" />} title="Company Information" />
          <p className="mb-3 text-[11px] text-muted-foreground">Identity and business category</p>
          <div className="mt-3 flex flex-col gap-4">
            <Field label="Company name *">
              <Input value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} placeholder="Acme Ltd." autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Industry vertical">
                <Select value={f.industryVertical} onChange={(e) => setF({ ...f, industryVertical: e.target.value })}>
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>{label(v)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Business category">
                <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{label(c)}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </div>

        <div>
          <SectionTitle icon={<UserRound className="size-3.5" />} title="Ownership & Billing" />
          <p className="mb-3 text-[11px] text-muted-foreground">Account owner and contract terms</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
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
        </div>

        {editing && projects && projects.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card p-3">
            <SectionTitle icon={<Layers className="size-3.5" />} title={`Running Projects (${projects.length})`} />
            <p className="mb-3 text-[11px] text-muted-foreground">Integrated with Flow — click to view in Projects</p>
            <div className="mt-3 flex max-h-[160px] flex-col gap-2 overflow-y-auto pr-1">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">{p.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">{label(p.status)} · {p.healthStatus ? label(p.healthStatus) : "—"}</p>
                  </div>
                  <a href={`/flow?clientId=${initial?.id}`} className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary/90">
                    View
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Context, commitments, payment terms…" />
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
  const { data: settings } = useApi<any>("/control/settings");

  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [health, setHealth] = useState(searchParams.get("health") ?? "");
  const [vertical, setVertical] = useState(searchParams.get("vertical") ?? "");
  const [ownerId, setOwnerId] = useState(searchParams.get("ownerId") ?? "");
  const [refresh, setRefresh] = useState(0);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsErr, setClientsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "projects" | "invoices">("overview");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<string | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    setDetailTab("overview");
    setInvoiceStatusFilter(null);
    setProjectStatusFilter(null);
    setExpandedInvoiceId(null);
  }, [selectedId]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [contactModal, setContactModal] = useState<{ open: boolean; initial?: ClientContact | null }>({ open: false });
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"client" | ClientContact | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [view, setView] = useState<"table" | "grid" | "kanban">(
    (searchParams.get("view") as any) ?? "table"
  );
  const [category, setCategory] = useState(searchParams.get("category") ?? "");

  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  // sync view/category from URL (back/forward, direct link)
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "table" || v === "grid" || v === "kanban") setView(v as any);
    const c = searchParams.get("category");
    setCategory(c ?? "");
    const qp = searchParams.get("q");
    if (qp !== null) setQ(qp);
    const hp = searchParams.get("health");
    if (hp !== null) setHealth(hp);
    const vp = searchParams.get("vertical");
    if (vp !== null) setVertical(vp);
    const op = searchParams.get("ownerId");
    if (op !== null) setOwnerId(op);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setViewWithUrl = useCallback(
    (v: "table" | "grid" | "kanban") => {
      setView(v);
      const p = new URLSearchParams(searchParams.toString());
      p.set("view", v);
      if (category) p.set("category", category);
      if (q) p.set("q", q);
      else p.delete("q");
      if (health) p.set("health", health);
      else p.delete("health");
      if (vertical) p.set("vertical", vertical);
      else p.delete("vertical");
      if (ownerId) p.set("ownerId", ownerId);
      else p.delete("ownerId");
      if (category) p.set("category", category);
      else p.delete("category");
      router.push(`?${p.toString()}`, { scroll: false });
    },
    [router, searchParams, category, q, health, vertical, ownerId]
  );

  const setCategoryWithUrl = useCallback(
    (c: string) => {
      setCategory(c);
      const p = new URLSearchParams(searchParams.toString());
      if (c) p.set("category", c);
      else p.delete("category");
      if (view) p.set("view", view);
      if (q) p.set("q", q);
      else p.delete("q");
      if (health) p.set("health", health);
      else p.delete("health");
      if (vertical) p.set("vertical", vertical);
      else p.delete("vertical");
      if (ownerId) p.set("ownerId", ownerId);
      else p.delete("ownerId");
      router.push(`?${p.toString()}`, { scroll: false });
    },
    [router, searchParams, view, q, health, vertical, ownerId]
  );

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (health) p.set("health", health);
    if (vertical) p.set("vertical", vertical);
    if (ownerId) p.set("ownerId", ownerId);
    if (category) p.set("category", category);
    return p.toString();
  }, [q, health, vertical, ownerId, category]);

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

  const moveCategory = async (client: Client, newCategory: ClientCategory) => {
    if (client.category === newCategory) return;
    try {
      await apiFetch(`/accounts/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: newCategory }),
      });
      notify(`Moved ${client.companyName} → ${label(newCategory)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Move failed");
    }
  };

  const handleInlineCategoryChange = async (client: Client, newCat: string) => {
    try {
      await apiFetch(`/accounts/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: newCat }),
      });
      notify(`${client.companyName} → ${label(newCat)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
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
    (c) =>
      (!q || c.companyName.toLowerCase().includes(q.toLowerCase())) &&
      (!category || (c.category ?? "ACTIVE") === category)
  );

  const clientTiers: { name: string; minValue: number; color: string }[] | undefined = (settings as any)?.clientTiers;

  const kanbanGroups = useMemo(() => {
    const groups: Record<string, Client[]> = { ACTIVE: [], ON_HOLD: [], ARCHIVED: [] };
    for (const c of filtered) {
      const cat = (c.category ?? "ACTIVE") as ClientCategory;
      if (groups[cat]) groups[cat].push(c);
      else groups["ACTIVE"].push(c);
    }
    return groups;
  }, [filtered]);

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
          <Select value={category} onChange={(e) => setCategoryWithUrl(e.target.value)} className="!w-36">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{label(c)}</option>
            ))}
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

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented
            value={view}
            onChange={setViewWithUrl as any}
            options={[
              { value: "table", label: <span className="flex items-center gap-1.5"><TableIcon className="size-3.5" /> Table</span> },
              { value: "grid", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-3.5" /> Grid</span> },
              { value: "kanban", label: <span className="flex items-center gap-1.5"><Columns className="size-3.5" /> Kanban</span> },
            ]}
          />
          <span className="text-[11.5px] text-muted-foreground">{filtered.length} clients{category ? ` · ${label(category)}` : ""}</span>
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
          <AnimatePresence mode="wait">
            {view === "table" && (
              <motion.div
                key="table"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <FadeIn>
                  <TableShell hideScrollbar footer={<span className="text-[11.5px] text-muted-foreground">{filtered.length} clients</span>}>
                    <table className="w-full min-w-[960px]">
                      <THead>
                        <Th>Company</Th>
                        <Th>Vertical</Th>
                        <Th>Health</Th>
                        <Th>Category</Th>
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
                          const tier = getTierForClient(c.totalInvoiced, clientTiers);
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
                                    <p className="flex items-center gap-1.5 font-medium">
                                      {c.companyName}
                                      {tier && (
                                        <span
                                          className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold"
                                          style={{ borderColor: `${tier.color}40`, background: `${tier.color}15`, color: tier.color }}
                                        >
                                          {tier.name}
                                        </span>
                                      )}
                                    </p>
                                    <p className="max-w-[200px] truncate text-[11px] text-muted-foreground">
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
                              <Td onClick={(e) => e.stopPropagation()}>
                                <Select
                                  value={(c.category ?? "ACTIVE") as string}
                                  onChange={(e) => handleInlineCategoryChange(c, e.target.value)}
                                  className="!w-28 !py-1 text-[11px]"
                                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                >
                                  {CATEGORIES.map((cat) => (
                                    <option key={cat} value={cat}>{label(cat)}</option>
                                  ))}
                                </Select>
                              </Td>
                              <Td className=""><span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatBDT(c.totalPaid ?? 0)}</span></Td>
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
                              <Td className="">
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
              </motion.div>
            )}

            {view === "grid" && (
              <motion.div
                key="grid"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filtered.map((c) => {
                    const tier = getTierForClient(c.totalInvoiced, clientTiers);
                    const cat = (c.category ?? "ACTIVE") as string;
                    return (
                      <div
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className="group cursor-pointer rounded-2xl border bg-card p-4 transition-all hover:-translate-y-1 hover:shadow-lg"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={c.companyName} />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold">{c.companyName}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{label(c.industryVertical)}</p>
                            </div>
                          </div>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold", healthTone(c.healthLevel))}>
                            {c.healthLevel}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize", categoryTone(cat))}>
                            {label(cat)}
                          </span>
                          {tier && (
                            <span
                              className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                              style={{ borderColor: `${tier.color}30`, background: `${tier.color}12`, color: tier.color }}
                            >
                              {tier.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <ScoreBar score={c.healthScore} />
                          <span className="ml-auto text-[11px] font-semibold tabular-nums">
                            {(c.totalDue ?? 0) > 0 ? (
                              <span className="text-rose-500 dark:text-rose-400">{formatBDT(c.totalDue ?? 0)} due</span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400">settled</span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">{label(c.billingCycleType)}</span>
                          <span className="text-[11px] font-medium text-muted-foreground">{formatBDT(c.totalPaid ?? 0)} paid</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                          <span className="font-semibold tabular-nums">{c._count?.projects ?? 0} projects</span>
                          <span className="truncate">{c.accountOwner?.name ?? "Unassigned"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {view === "kanban" && (
              <motion.div
                key="kanban"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {CATEGORIES.map((cat) => {
                    const list = kanbanGroups[cat] ?? [];
                    const sumDue = list.reduce((s, c) => s + (c.totalDue ?? 0), 0);
                    const headerTone =
                      cat === "ACTIVE"
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : cat === "ON_HOLD"
                          ? "border-amber-500/20 bg-amber-500/5"
                          : "border-zinc-400/20 bg-zinc-400/5";
                    return (
                      <div key={cat} className={cn("rounded-2xl border p-3", headerTone)}>
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", categoryTone(cat))}>{label(cat)}</span>
                            <span className="text-muted-foreground">{list.length}</span>
                          </h3>
                          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{formatBDT(sumDue)} due</span>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          {list.length === 0 && (
                            <p className="rounded-xl border border-dashed border-border bg-card/60 py-8 text-center text-[11.5px] text-muted-foreground">No clients</p>
                          )}
                          {list.map((c) => {
                            const tier = getTierForClient(c.totalInvoiced, clientTiers);
                            return (
                              <div
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className="group cursor-pointer rounded-xl border bg-card p-3 transition-all hover:shadow-md"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Avatar name={c.companyName} size="size-7" />
                                    <div className="min-w-0">
                                      <p className="truncate text-[12.5px] font-semibold">{c.companyName}</p>
                                      <p className="truncate text-[10.5px] text-muted-foreground">{label(c.industryVertical)}</p>
                                    </div>
                                  </div>
                                  <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold", healthTone(c.healthLevel))}>
                                    {c.healthLevel}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {tier && (
                                    <span
                                      className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold"
                                      style={{ borderColor: `${tier.color}30`, background: `${tier.color}12`, color: tier.color }}
                                    >
                                      {tier.name}
                                    </span>
                                  )}
                                  <span className="text-[10.5px] tabular-nums text-muted-foreground">{formatBDT(c.totalDue ?? 0)} due · {c._count?.projects ?? 0} projects</span>
                                </div>
                                <div className="mt-2">
                                  <ScoreBar score={c.healthScore} />
                                </div>
                                <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-[10px] font-semibold text-muted-foreground">Move:</span>
                                  <Select
                                    value={(c.category ?? "ACTIVE") as string}
                                    onChange={(e) => moveCategory(c, e.target.value as ClientCategory)}
                                    className="!w-auto !py-1 text-[11px]"
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  >
                                    {CATEGORIES.map((opt) => (
                                      <option key={opt} value={opt}>{label(opt)}</option>
                                    ))}
                                  </Select>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
          const tier = getTierForClient(detail.totalInvoiced, clientTiers);
          const aging = detail.aging ?? { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
          const maxAging = Math.max(aging.current, aging.d30, aging.d60, aging.d90, aging.d90p, 1);
          const invStatusCounts: Record<string, number> = detail.invoices.reduce((acc: Record<string, number>, inv) => {
            acc[inv.status] = (acc[inv.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const projStatusCounts: Record<string, number> = detail.projects.reduce((acc: Record<string, number>, pr) => {
            acc[pr.status] = (acc[pr.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const filteredInvoices = invoiceStatusFilter ? detail.invoices.filter((inv) => inv.status === invoiceStatusFilter) : detail.invoices;
          const filteredProjects = projectStatusFilter ? detail.projects.filter((pr) => pr.status === projectStatusFilter) : detail.projects;
          const handleDetailCategoryChange = async (next: string) => {
            if (next === detail.category) return;
            try {
              await apiFetch("/accounts/clients/" + detail.id, { method: "PATCH", body: JSON.stringify({ category: next }) });
              notify("Category \u2192 " + label(next));
              reload();
              setDetail((prev) => (prev ? { ...prev, category: next as ClientCategory } : prev));
            } catch (e: any) {
              notify(e.message ?? "Update failed");
            }
          };
          return (
          <div className="flex flex-col gap-4">
            {/* top bar: category + tier + health */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <span className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Category</span>
              <Select value={detail.category} onChange={(e) => handleDetailCategoryChange(e.target.value)} className="!w-32 !py-1 text-[11px]">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{label(c)}</option>
                ))}
              </Select>
              <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize", categoryTone(detail.category))}>
                {label(detail.category)}
              </span>
              <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", healthTone(detail.healthLevel))}>
                {detail.healthLevel} {detail.healthScore != null ? "\u00B7 " + detail.healthScore : ""}
              </span>
              {tier && (
                <span className="rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ borderColor: tier.color + "40", background: tier.color + "15", color: tier.color }}>
                  {tier.name}
                </span>
              )}
              <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                <CalendarClock className="size-3" /> Renewal {formatDate(detail.renewalDate)}
              </span>
            </div>

            {/* financial summary strip */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Total invoiced</p>
                <p className="mt-1.5 text-xl font-black tabular-nums sm:text-2xl">{formatBDT(detail.totalInvoiced ?? 0)}</p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                  {detail.invoices.length} invoice{detail.invoices.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-emerald-400">Paid</p>
                <p className="mt-1.5 text-xl font-black tabular-nums text-emerald-600 dark:text-emerald-300 sm:text-2xl">{formatBDT(detail.totalPaid ?? 0)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/20">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: paidPct + "%" }} />
                </div>
              </div>
              <div className={cn("rounded-2xl border p-4", (detail.totalDue ?? 0) > 0 ? "border-rose-500/25 bg-rose-500/10" : "border-border/60 bg-card")}>
                <p className={cn("text-[10.5px] font-bold uppercase tracking-widest", (detail.totalDue ?? 0) > 0 ? "text-rose-400" : "text-muted-foreground")}>Due</p>
                <p className={cn("mt-1.5 text-xl font-black tabular-nums sm:text-2xl", (detail.totalDue ?? 0) > 0 && "text-rose-500 dark:text-rose-300")}>{formatBDT(detail.totalDue ?? 0)}</p>
                <p className={cn("mt-0.5 text-[10.5px]", (detail.totalDue ?? 0) > 0 ? "font-semibold text-rose-400/80" : "text-muted-foreground")}>
                  {(detail.totalDue ?? 0) > 0 ? "outstanding balance" : "all settled"}
                </p>
              </div>
            </div>

            {/* health banner */}
            <div className={cn("rounded-2xl border p-4", healthTone(detail.healthLevel))}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide">Health Score</p>
                <span className="text-lg font-black tabular-nums">{detail.healthScore}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/20">
                <div
                  className={cn(
                    "h-full rounded-full",
                    (detail.healthScore ?? 0) >= 70 ? "bg-emerald-400" : (detail.healthScore ?? 0) >= 40 ? "bg-amber-400" : "bg-rose-400"
                  )}
                  style={{ width: (detail.healthScore ?? 0) + "%" }}
                />
              </div>
              <p className="mt-2 text-[11.5px] font-medium">
                {detail.healthDriver ?? "Healthy \u2014 no active drivers"}
              </p>
              {detail.churnFlags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.churnFlags.map((f) => (
                    <span key={f.id} className="rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-semibold">
                      \u2691 {label(f.matchedPattern ?? f.riskLevel)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* segmented tabs */}
            <Segmented
              value={detailTab}
              onChange={(v) => setDetailTab(v)}
              options={[
                { value: "overview", label: <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Overview</span> },
                { value: "projects", label: <span className="flex items-center gap-1.5"><Building2 className="size-3.5" /> Projects ({detail.projects.length})</span> },
                { value: "invoices", label: <span className="flex items-center gap-1.5"><Receipt className="size-3.5" /> Invoices & Billing ({detail.invoices.length})</span> },
              ]}
            />

            {/* OVERVIEW TAB */}
            {detailTab === "overview" && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="flex flex-col gap-5">
                    <section>
                      <SectionTitle icon={<CalendarClock className="size-3.5" />} title="Client details" />
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <Fact label="Vertical" value={label(detail.industryVertical)} />
                        <Fact label="Billing cycle" value={label(detail.billingCycleType)} />
                        <Fact label="Currency" value={detail.currencyPreference ?? "BDT"} />
                        <Fact label="Owner" value={detail.accountOwner?.name ?? "Unassigned"} />
                        <Fact label="Contract start" value={formatDate(detail.contractStartDate)} />
                        <Fact label="Renewal" value={formatDate(detail.renewalDate)} />
                        <Fact label="Created" value={formatDate(detail.createdAt ?? null)} />
                        <Fact label="Category" value={label(detail.category)} />
                      </div>
                      {detail.notes && (
                        <div className="mt-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
                          <p className="mt-1.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                            {detail.notes}
                          </p>
                        </div>
                      )}
                    </section>
                    <section>
                      <SectionTitle icon={<Gauge className="size-3.5" />} title="Health history" />
                      <div className="mt-2 flex max-h-[260px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.healthLogs.length === 0 && <p className="text-[11.5px] text-muted-foreground">No history yet</p>}
                        {detail.healthLogs.slice(0, 8).map((h, i) => (
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
                    <section>
                      <SectionTitle
                        icon={<Users className="size-3.5" />}
                        title={"Contacts (" + detail.contacts.length + ")"}
                        action={
                          <button onClick={() => setContactModal({ open: true })} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                            <UserPlus className="size-3" /> Add
                          </button>
                        }
                      />
                      <div className="mt-2 flex max-h-[260px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.contacts.length === 0 && <p className="text-[11.5px] text-muted-foreground">No contacts \u2014 add one</p>}
                        {detail.contacts.map((c) => (
                          <div key={c.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                            <Avatar name={c.name} size="size-7" />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-1.5 truncate text-[12.5px] font-semibold">
                                <span className="truncate">{c.name}</span>
                                {c.isPrimary && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">PRIMARY</span>}
                                {c.portalAccessEnabled && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-500">PORTAL</span>}
                              </p>
                              <p className="truncate text-[10.5px] text-muted-foreground">
                                {[c.roleTitle, c.email, c.phone].filter(Boolean).join(" \u00B7 ") || "No details"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
                    <section>
                      <SectionTitle
                        icon={<FileText className="size-3.5" />}
                        title={"Documents (" + detail.documents.length + ")"}
                        action={
                          <button onClick={() => setDocModalOpen(true)} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                            <Plus className="size-3" /> Attach
                          </button>
                        }
                      />
                      <div className="mt-2 flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.documents.length === 0 && <p className="text-[11.5px] text-muted-foreground">No documents</p>}
                        {detail.documents.map((d) => (
                          <div key={d.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-semibold">{label(d.type)}</p>
                              <p className="truncate text-[10.5px] text-muted-foreground">
                                {d.fileUrl} \u00B7 {d.uploadedBy?.name ?? "unknown"} \u00B7 {timeAgo(d.uploadedAt)}
                              </p>
                            </div>
                            <a href={d.fileUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-bold text-primary hover:text-primary">
                              open
                            </a>
                            <button onClick={() => removeDocument(d.id)} className="shrink-0 rounded-lg p-1 text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100">
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            {/* PROJECTS TAB */}
            {detailTab === "projects" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Filter:</span>
                  <button
                    onClick={() => setProjectStatusFilter(null)}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", !projectStatusFilter ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/60 text-muted-foreground hover:text-foreground")}
                  >
                    All ({detail.projects.length})
                  </button>
                  {Object.entries(projStatusCounts).map(([st, cnt]) => (
                    <button
                      key={st}
                      onClick={() => setProjectStatusFilter((prev) => (prev === st ? null : st))}
                      className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize transition-colors", projectStatusFilter === st ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/60 text-muted-foreground hover:text-foreground")}
                    >
                      {label(st)} ({cnt})
                    </button>
                  ))}
                  <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                    <span className="size-2 rounded-full bg-emerald-500" /> {projStatusCounts["ON_TRACK"] ?? 0} on-track
                    <span className="ml-2 size-2 rounded-full bg-amber-500" /> {projStatusCounts["AT_RISK"] ?? 0} at-risk
                    <span className="ml-2 size-2 rounded-full bg-rose-500" /> {projStatusCounts["DELAYED"] ?? 0} delayed
                  </span>
                </div>
                {filteredProjects.length === 0 ? (
                  <EmptyState title="No projects" hint={projectStatusFilter ? "No projects match this filter." : "This client has no projects yet."} />
                ) : (
                  <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                    {filteredProjects.map((p) => (
                      <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold">{p.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {p.budgetAmount ? <span className="font-semibold tabular-nums text-foreground">{formatBDT(p.budgetAmount)}</span> : <span>No budget</span>}
                            {p.targetEndDate ? <span>· ends {formatDate(p.targetEndDate)}</span> : null}
                            {p.riskScore != null ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">risk {p.riskScore}</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={p.status} />
                          <StatusBadge status={p.healthStatus} />
                          <a
                            href={"/flow?clientId=" + detail.id}
                            onClick={(e) => { e.preventDefault(); router.push("/flow?clientId=" + detail.id); }}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-muted"
                          >
                            Flow <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <a href={"/flow?clientId=" + detail.id} onClick={(e) => { e.preventDefault(); router.push("/flow?clientId=" + detail.id); }} className="inline-flex items-center gap-1 self-start text-[11.5px] font-bold text-primary hover:underline">
                  View all in Flow <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}

            {/* INVOICES / BILLING TAB */}
            {detailTab === "invoices" && (
              <div className="flex flex-col gap-5">
                {/* aging buckets */}
                <div>
                  <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <Wallet className="size-3.5" /> Aging buckets
                  </h4>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {[
                      { key: "current", label: "Current", value: aging.current, tone: "emerald" },
                      { key: "d30", label: "0\u201330d", value: aging.d30, tone: "amber" },
                      { key: "d60", label: "30\u201360d", value: aging.d60, tone: "amber" },
                      { key: "d90", label: "60\u201390d", value: aging.d90, tone: "orange" },
                      { key: "d90p", label: "90d+", value: aging.d90p, tone: "rose" },
                    ].map((b) => {
                      const pct = maxAging > 0 ? Math.round((b.value / maxAging) * 100) : 0;
                      const barTone = b.tone === "emerald" ? "bg-emerald-500" : b.tone === "amber" ? "bg-amber-500" : b.tone === "orange" ? "bg-orange-500" : "bg-rose-500";
                      const borderTone = b.tone === "emerald" ? "border-emerald-500/25 bg-emerald-500/5" : b.tone === "rose" ? "border-rose-500/25 bg-rose-500/5" : b.tone === "orange" ? "border-orange-500/25 bg-orange-500/5" : "border-amber-500/25 bg-amber-500/5";
                      return (
                        <div key={b.key} className={cn("rounded-xl border p-3", borderTone)}>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{b.label}</p>
                          <p className="mt-1 truncate text-[13px] font-black tabular-nums">{formatBDT(b.value)}</p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", barTone)} style={{ width: pct + "%" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* invoice status breakdown */}
                <div>
                  <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <FileText className="size-3.5" /> Invoice status
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => setInvoiceStatusFilter(null)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", !invoiceStatusFilter ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/60 text-muted-foreground hover:text-foreground")}>
                      All ({detail.invoices.length})
                    </button>
                    {Object.entries(invStatusCounts).map(([st, cnt]) => (
                      <button key={st} onClick={() => setInvoiceStatusFilter((prev) => (prev === st ? null : st))} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize transition-colors", invoiceStatusFilter === st ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/60 text-muted-foreground hover:text-foreground")}>
                        {label(st)} ({cnt})
                      </button>
                    ))}
                  </div>
                </div>

                {/* invoice list */}
                <div>
                  <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <Receipt className="size-3.5" /> Invoices ({filteredInvoices.length}{invoiceStatusFilter ? " filtered" : ""})
                  </h4>
                  {filteredInvoices.length === 0 ? (
                    <div className="mt-2"><EmptyState title="No invoices" hint={invoiceStatusFilter ? "No invoices match this filter." : "No invoices for this client yet."} /></div>
                  ) : (
                    <div className="mt-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
                      {filteredInvoices.map((inv) => {
                        const total = inv.total ?? inv.lineItems.reduce((s, li) => s + Number(li.amount), 0);
                        const paid = inv.paid ?? 0;
                        const due = Math.max(0, total - paid);
                        const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                        const isExpanded = expandedInvoiceId === inv.id;
                        const revenueTag = inv.lineItems.map((li) => li.revenueTag).filter(Boolean).join(", ") || "\u2014";
                        return (
                          <div key={inv.id} className="overflow-hidden rounded-xl border border-border/60 bg-card">
                            <button onClick={() => setExpandedInvoiceId((prev) => (prev === inv.id ? null : inv.id))} className="flex w-full items-center gap-3 px-3 py-3 text-left">
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-1.5 truncate text-[12.5px] font-semibold">
                                  <span className="truncate">{inv.invoiceNumber}</span>
                                  <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">\u00B7 {formatDate(inv.issueDate)}{inv.dueDate ? " \u2192 " + formatDate(inv.dueDate) : ""}</span>
                                </p>
                                <p className="mt-0.5 text-[10.5px] text-muted-foreground sm:hidden">{formatDate(inv.issueDate)}{inv.dueDate ? " \u00B7 due " + formatDate(inv.dueDate) : ""}</p>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-rose-500")} style={{ width: pct + "%" }} />
                                  </div>
                                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatBDT(paid)} / {formatBDT(total)}</span>
                                </div>
                                <p className="mt-1 text-[10.5px] text-muted-foreground">Due {formatBDT(due)} \u00B7 {revenueTag}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <StatusBadge status={inv.status} />
                                <span className="text-[12px] font-bold tabular-nums">{formatBDT(total)}</span>
                                <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                                  {isExpanded ? <><ChevronUp className="size-3" /> Hide</> : <><ChevronDown className="size-3" /> Details</>}
                                </span>
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-border/60 bg-muted/20 px-3 py-2">
                                <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Line items</p>
                                <div className="mt-1.5 flex flex-col gap-1">
                                  {inv.lineItems.length === 0 ? <p className="text-[11px] text-muted-foreground">No line items</p> : inv.lineItems.map((li, idx) => (
                                    <div key={idx} className="flex items-center justify-between rounded-lg border border-border/40 bg-card px-2.5 py-1.5 text-[11.5px]">
                                      <span className="truncate font-medium">{li.revenueTag}</span>
                                      <span className="shrink-0 font-bold tabular-nums">{formatBDT(Number(li.amount))}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                                  <span className="rounded-lg bg-card px-2 py-1 text-center"><span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</span><span className="font-bold tabular-nums">{formatBDT(total)}</span></span>
                                  <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-center"><span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-600">Paid</span><span className="font-bold tabular-nums text-emerald-600">{formatBDT(paid)}</span></span>
                                  <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-center"><span className="block text-[10px] font-bold uppercase tracking-widest text-rose-500">Due</span><span className="font-bold tabular-nums text-rose-500">{formatBDT(due)}</span></span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <a href={"/capital?clientId=" + detail.id} onClick={(e) => { e.preventDefault(); router.push("/capital?clientId=" + detail.id); }} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-bold text-primary hover:underline">
                    Full billing in Capital <ExternalLink className="size-3.5" />
                  </a>
                </div>

                {/* recent payments */}
                <div>
                  <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <Wallet className="size-3.5" /> Recent payments
                  </h4>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {!detail.payments?.length && <p className="text-[11.5px] text-muted-foreground">No payments recorded</p>}
                    {detail.payments?.slice(0, 5).map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">{label(p.paymentMethod)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold">{p.invoice.invoiceNumber}</p>
                          <p className="text-[10.5px] text-muted-foreground">{formatDate(p.paymentDate)}{p.referenceId ? " \u00B7 " + p.referenceId : ""}</p>
                        </div>
                        <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-emerald-600 dark:text-emerald-300">+{formatBDT(Number(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* footer actions */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-card px-6 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
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
        projects={(detail as any)?.projects ?? (editClient as any)?.projects}
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
            className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02]"
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
