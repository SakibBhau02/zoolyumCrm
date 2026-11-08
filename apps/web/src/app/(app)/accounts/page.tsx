"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Columns,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Gauge,
  HeartPulse,
  Layers,
  LayoutGrid,
  Mail,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Table as TableIcon,
  Trash2,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  FormSection,
  FormError,
  Collapsible,
  CountBadge,
  Toggle,
  Input,
  Modal,
  ScoreBar,
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";
import { CollectionsModal, type CollectionsMode } from "./_components/collections-modal";

const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
// NOTE: must stay in sync with the Prisma BillingCycleType enum — values outside
// it 500 on save (QUARTERLY_RETAINER was removed for exactly this reason).
const BILLING_CYCLES = ["PROJECT_BASED", "MONTHLY_RETAINER", "ONE_TIME"];
const DOC_TYPES = ["MOU", "PROPOSAL", "BRAND_ASSET", "CREDENTIAL"];
const CATEGORIES = ["ACTIVE", "ON_HOLD", "ARCHIVED"] as const;

const LABEL_EXCEPTIONS: Record<string, string> = { D2C: "D2C" };
const label = (v: string) =>
  LABEL_EXCEPTIONS[v] ??
  v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

/**
 * Documents may be external links (https) or same-origin relative paths
 * (`/storage/...`). Anything else — notably `javascript:` — is not rendered
 * as a clickable link.
 */
const isSafeUrl = (value?: string | null) => {
  const v = value ?? "";
  return /^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v);
};

const money = (n: number | null | undefined) => formatBDT(n ?? 0);

const healthTone = (level: string) =>
  level === "GREEN"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : level === "YELLOW"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";

const categoryTone = (cat: string) =>
  cat === "ACTIVE"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : cat === "ON_HOLD"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-zinc-400/30 bg-zinc-400/10 text-zinc-500 dark:text-zinc-400";

const tierOf = (
  totalInvoiced: number | undefined | null,
  tiers: { name: string; minValue: number; color: string }[] | undefined
): { name: string; color: string } | null => {
  // No tiers configured = no tier badge. The old fallback stamped "Enterprise"
  // on every client, which made the badge meaningless.
  if (!tiers || !tiers.length) return null;
  const v = totalInvoiced ?? 0;
  const sorted = [...tiers].sort((a, b) => b.minValue - a.minValue);
  for (const t of sorted) if (v >= t.minValue) return { name: t.name, color: t.color };
  return null;
};

const retainerAmountOf = (c: Client) => {
  const n = Number(c.monthlyAmount ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Retainer rows with no amount silently auto-bill ৳0 invoices. */
const hasRetainerGap = (c: Client) =>
  c.billingCycleType === "MONTHLY_RETAINER" && retainerAmountOf(c) <= 0;

const hasGap = (c: Client) =>
  hasRetainerGap(c) || (c._count?.contacts ?? 0) === 0 || !c.accountOwner;

const renewalTone = (days: number) =>
  days <= 7
    ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
    : days <= 30
      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400";

type Preset = "all" | "attention" | "overdue" | "renewing" | "risk" | "gaps" | "onhold" | "archived";
type SortKey = "client" | "health" | "due" | "renewal" | "projects";
type Sort = { key: SortKey; dir: "asc" | "desc" };
type Tone = "success" | "error";

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
  billingDayOfMonth: string;
  monthlyAmount: string;
  monthlyServiceDescription: string;
  autoGenerateInvoice: boolean;
  paymentDueDays: string;
  retainerInterval: string;
  contactId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
}

const EMPTY_FORM: ClientFormState = {
  companyName: "",
  industryVertical: "OTHER",
  category: "ACTIVE",
  accountOwnerId: "",
  billingCycleType: "PROJECT_BASED",
  currencyPreference: "BDT",
  contractStartDate: "",
  renewalDate: "",
  notes: "",
  billingDayOfMonth: "1",
  monthlyAmount: "",
  monthlyServiceDescription: "",
  autoGenerateInvoice: true,
  paymentDueDays: "15",
  retainerInterval: "MONTHLY",
  contactId: "",
  contactName: "",
  contactRole: "",
  contactEmail: "",
  contactPhone: "",
};

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
  const [f, setF] = useState<ClientFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [companyErr, setCompanyErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [dupHint, setDupHint] = useState<string | null>(null);
  const [dupChecking, setDupChecking] = useState(false);
  const editing = !!initial;

  const checkDuplicates = async (name: string) => {
    const q = name.trim();
    if (q.length < 3) {
      setDupHint(null);
      return;
    }
    setDupChecking(true);
    try {
      const list = await apiFetch<Client[]>(`/accounts/clients?q=${encodeURIComponent(q)}`);
      const others = (list ?? []).filter(
        (c) => (!editing || c.id !== initial?.id) && c.companyName?.toLowerCase().includes(q.toLowerCase())
      );
      setDupHint(
        others.length
          ? `${others.length} similar client${others.length > 1 ? "s" : ""} already exist${others.length > 1 ? "" : "s"} — ${others
              .slice(0, 2)
              .map((c) => c.companyName)
              .join(", ")}`
          : null
      );
    } catch {
      setDupHint(null);
    } finally {
      setDupChecking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCompanyErr(null);
    setEmailErr(null);
    setDupHint(null);
    if (!initial) {
      setF(EMPTY_FORM);
      return;
    }
    const primary =
      (initial as any).contacts?.find((c: any) => c.isPrimary) ?? (initial as any).contacts?.[0] ?? null;
    setF({
      companyName: initial.companyName,
      industryVertical: initial.industryVertical,
      category: initial.category ?? "ACTIVE",
      accountOwnerId: initial.accountOwner?.id ?? "",
      billingCycleType: initial.billingCycleType,
      currencyPreference: initial.currencyPreference ?? "BDT",
      contractStartDate: initial.contractStartDate?.slice(0, 10) ?? "",
      renewalDate: initial.renewalDate?.slice(0, 10) ?? "",
      notes: initial.notes ?? "",
      billingDayOfMonth: initial.billingDayOfMonth != null ? String(initial.billingDayOfMonth) : "0",
      monthlyAmount: initial.monthlyAmount != null ? String(Number(initial.monthlyAmount)) : "",
      monthlyServiceDescription: initial.monthlyServiceDescription ?? "",
      autoGenerateInvoice: initial.autoGenerateInvoice !== false,
      paymentDueDays: String(initial.paymentDueDays ?? 15),
      retainerInterval: initial.retainerInterval ?? "MONTHLY",
      contactId: primary?.id ?? "",
      contactName: primary?.name ?? "",
      contactRole: primary?.roleTitle ?? "",
      contactEmail: primary?.email ?? "",
      contactPhone: primary?.phone ?? "",
    });
  }, [open, initial]);

  const isRetainer = f.billingCycleType === "MONTHLY_RETAINER";
  const retainerRef = useRef<HTMLDivElement>(null);
  const wasRetainer = useRef(isRetainer);
  // Picking a retainer reveals a whole billing block below the fold — show it
  // instead of letting the user wonder whether anything happened.
  useEffect(() => {
    if (isRetainer && !wasRetainer.current) {
      const id = window.requestAnimationFrame(() =>
        retainerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      );
      wasRetainer.current = isRetainer;
      return () => window.cancelAnimationFrame(id);
    }
    wasRetainer.current = isRetainer;
  }, [isRetainer]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.companyName.trim()) {
      setCompanyErr("Company name is required");
      return;
    }
    setCompanyErr(null);
    if (f.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail.trim())) {
      setEmailErr("That email address looks invalid");
      return;
    }
    setEmailErr(null);
    // New retainers must be priced before auto-billing can run. An existing
    // client can still be edited (owner, dates, notes) without the amount —
    // the form shows a warning instead of blocking the save.
    if (!editing && isRetainer && !(Number(f.monthlyAmount) > 0))
      return setErr("Set the retainer amount — auto-billing cannot issue a zero-value invoice");
    setBusy(true);
    setErr(null);
    try {
      const contactName = f.contactName.trim();
      const body = {
        companyName: f.companyName.trim(),
        industryVertical: f.industryVertical,
        category: f.category,
        // `null` (not undefined) so "Unassigned" actually clears the owner.
        accountOwnerId: f.accountOwnerId || null,
        billingCycleType: f.billingCycleType,
        currencyPreference: f.currencyPreference,
        contractStartDate: f.contractStartDate || null,
        renewalDate: f.renewalDate || null,
        notes: f.notes.trim() || null,
        billingDayOfMonth: isRetainer && Number(f.billingDayOfMonth) > 0 ? Number(f.billingDayOfMonth) : null,
        monthlyAmount: isRetainer && f.monthlyAmount ? Number(f.monthlyAmount) : null,
        monthlyServiceDescription: isRetainer ? f.monthlyServiceDescription.trim() || null : null,
        autoGenerateInvoice: f.autoGenerateInvoice,
        paymentDueDays: isRetainer ? Number(f.paymentDueDays) || 15 : null,
        retainerInterval: isRetainer ? f.retainerInterval : null,
        primaryContact: contactName
          ? {
              ...(editing && f.contactId ? { id: f.contactId } : {}),
              name: contactName,
              roleTitle: f.contactRole.trim() || null,
              email: f.contactEmail.trim() || null,
              phone: f.contactPhone.trim() || null,
            }
          : undefined,
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

  const contactFilled = [f.contactName, f.contactRole, f.contactEmail, f.contactPhone].filter((v) => v.trim()).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Building2 className="size-4" />}
      title={editing ? "Edit client" : "Add client"}
      subtitle={
        editing
          ? "Update identity, contacts and commercial terms."
          : "Start with the company and one contact — billing can wait."
      }
      size="lg"
      footer={
        <FormActions
          formId="client-form"
          busy={busy}
          cancel={onClose}
          submitLabel={editing ? "Save changes" : "Create client"}
          submitIcon={<Check className="size-3.5" />}
          hint="Fields marked * are required"
        />
      }
    >
      <form id="client-form" onSubmit={save} className="flex flex-col gap-5">
        <FormError>{err}</FormError>
        {/* Live identity strip — the name you type shows up here immediately. */}
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-primary/[0.04] p-3.5">
          <Avatar name={f.companyName || "New Client"} size="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-[14.5px] font-semibold">
              {f.companyName.trim() || (editing ? initial!.companyName : "New client")}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {f.contactName.trim()
                ? `${f.contactName.trim()}${f.contactRole.trim() ? ` · ${f.contactRole.trim()}` : ""}`
                : editing
                  ? "Update details, ownership and billing terms"
                  : "Projects, invoices and health score link automatically"}
            </p>
          </div>
          {editing && (
            <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold", categoryTone(f.category))}>
              {label(f.category)}
            </span>
          )}
        </div>

        {/* ── 1. Company ── */}
        <FormSection step={1} title="Company" hint="The account you are billing. Only the name is required.">
          <Field label="Company name" required error={companyErr}>
            <Input
              value={f.companyName}
              onChange={(e) => {
                setF({ ...f, companyName: e.target.value });
                if (companyErr) setCompanyErr(null);
                if (dupHint) setDupHint(null);
              }}
              onBlur={(e) => void checkDuplicates(e.target.value)}
              placeholder="Acme Ltd."
              autoFocus
              className="!py-2.5 !text-[13.5px] font-medium"
            />
          </Field>
          {dupChecking && <p className="mt-1.5 text-[11px] text-muted-foreground">Checking for duplicates…</p>}
          {dupHint && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {dupHint}
            </p>
          )}
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Industry vertical">
              <Select value={f.industryVertical} onChange={(e) => setF({ ...f, industryVertical: e.target.value })}>
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>{label(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Lifecycle stage" hint="Where the relationship stands today">
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{label(c)}</option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        {/* ── 2. The person you actually talk to ── */}
        <FormSection
          step={2}
          title="Primary contact"
          hint="Portal access is granted separately from the client view."
          action={contactFilled > 0 ? <CountBadge>{contactFilled}/4</CountBadge> : undefined}
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Tanvir Ahmed" />
            </Field>
            <Field label="Role / title">
              <Input value={f.contactRole} onChange={(e) => setF({ ...f, contactRole: e.target.value })} placeholder="Operations Head" />
            </Field>
            <Field label="Email" error={emailErr}>
              <Input
                type="email"
                value={f.contactEmail}
                onChange={(e) => {
                  setF({ ...f, contactEmail: e.target.value });
                  if (emailErr) setEmailErr(null);
                }}
                placeholder="tanvir@client.com"
              />
            </Field>
            <Field label="Phone">
              <Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="+8801…" inputMode="tel" />
            </Field>
          </div>
        </FormSection>

        {/* ── 3. Money, ownership and dates ── */}
        <FormSection step={3} title="Commercials" hint="Who owns the account, what it is worth, and until when.">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Account owner">
              <Select value={f.accountOwnerId} onChange={(e) => setF({ ...f, accountOwnerId: e.target.value })}>
                <option value="">Unassigned</option>
                {(users ?? []).map((u) => (
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
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Currency">
              <Select value={f.currencyPreference} onChange={(e) => setF({ ...f, currencyPreference: e.target.value })}>
                {["BDT", "USD", "EUR", "GBP", "INR", "SAR", "AED"].map((cur) => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </Select>
            </Field>
            <Field label="Contract start">
              <Input type="date" value={f.contractStartDate} onChange={(e) => setF({ ...f, contractStartDate: e.target.value })} />
            </Field>
            <Field label="Renewal date">
              <Input type="date" value={f.renewalDate} onChange={(e) => setF({ ...f, renewalDate: e.target.value })} />
            </Field>
          </div>

          {isRetainer && (
            <div
              ref={retainerRef}
              className="mt-4 scroll-mb-4 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04]"
            >
              <div className="flex items-center gap-2 border-b border-primary/15 px-3 py-2">
                <Wallet className="size-3.5 text-primary" />
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-primary">Retainer auto-billing</p>
              </div>
              <div className="grid grid-cols-1 gap-3.5 p-3 sm:grid-cols-2">
                <Field label="Interval">
                  <Select value={f.retainerInterval} onChange={(e) => setF({ ...f, retainerInterval: e.target.value })}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="BIWEEKLY">Every 15 days</option>
                    <option value="WEEKLY">Every 7 days</option>
                  </Select>
                </Field>
                <Field label="Retainer amount" required>
                  <div className="flex">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={f.monthlyAmount}
                      onChange={(e) => setF({ ...f, monthlyAmount: e.target.value })}
                      placeholder="85000"
                      className="rounded-r-none"
                    />
                    <span className="flex items-center rounded-r-xl border border-l-0 border-border bg-muted/60 px-2.5 text-[11.5px] font-semibold text-muted-foreground">
                      {f.currencyPreference}
                    </span>
                  </div>
                </Field>
                <Field label="Billing day of month">
                  <Select
                    value={f.billingDayOfMonth}
                    onChange={(e) => setF({ ...f, billingDayOfMonth: e.target.value })}
                    disabled={f.retainerInterval !== "MONTHLY"}
                  >
                    <option value="0">Not set</option>
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={String(i + 1)}>Day {i + 1}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment due (days)">
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={f.paymentDueDays}
                    onChange={(e) => setF({ ...f, paymentDueDays: e.target.value })}
                    placeholder="15"
                  />
                </Field>
              </div>
              {!(Number(f.monthlyAmount) > 0) && (
                <p className="mx-3 mb-3 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  Without an amount the auto-billing cron skips this client — no retainer invoice will be raised.
                </p>
              )}
              <div className="px-3 pb-3">
                <Field label="Service description">
                  <Input
                    value={f.monthlyServiceDescription}
                    onChange={(e) => setF({ ...f, monthlyServiceDescription: e.target.value })}
                    placeholder="Monthly retainer — social + performance"
                  />
                </Field>
                <Toggle
                  className="mt-3"
                  checked={f.autoGenerateInvoice}
                  onChange={(v) => setF({ ...f, autoGenerateInvoice: v })}
                  label="Auto-generate invoice"
                  hint={`Runs from the backend cron — ${
                    f.retainerInterval === "WEEKLY" ? "every 7 days" : f.retainerInterval === "BIWEEKLY" ? "every 15 days" : "every month"
                  }`}
                />
              </div>
            </div>
          )}
        </FormSection>

        <Collapsible
          icon={<FileText className="size-3.5" />}
          title="Notes"
          hint="Context, commitments, payment terms"
          badge={f.notes.trim() ? <CountBadge>1</CountBadge> : undefined}
        >
          <Textarea
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            placeholder="Context, commitments, payment terms…"
          />
        </Collapsible>
      </form>
    </Modal>
  );
}

// ── Contact form modal ───────────────────────────────────────────────────
function ContactFormModal({
  open,
  onClose,
  clientId,
  clientName,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName?: string;
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
    if (!f.name.trim()) return setErr("Name is required");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
      return setErr("Email looks invalid");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(
        editing ? `/accounts/clients/${clientId}/contacts/${initial!.id}` : `/accounts/clients/${clientId}/contacts`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(f) }
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
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="block">
          {editing ? "Edit contact" : "Add contact"}
          {clientName && <span className="block text-[11.5px] font-normal text-muted-foreground">{clientName}</span>}
        </span>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Full name *">
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
        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
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
    if (!open) return;
    setType("MOU");
    setFileUrl("");
    setErr(null);
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileUrl.trim()) return setErr("File URL is required");
    if (!/^https?:\/\//i.test(fileUrl.trim())) return setErr("Use a full https:// link");
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
        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Attach" />
      </form>
    </Modal>
  );
}

// ── Small building blocks ────────────────────────────────────────────────
function SectionTitle({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
          {icon} {title}
        </h4>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string | null; tone?: "warn" | "muted" }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-[12.5px] font-semibold",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground"
        )}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

function SortTh({
  labelText,
  k,
  sort,
  onSort,
}: {
  labelText: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <Th>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
          active && "text-foreground"
        )}
        aria-label={`Sort by ${labelText}`}
      >
        {labelText}
        {active ? (
          sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-30" />
        )}
      </button>
    </Th>
  );
}

function QuickIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      {children}
    </a>
  );
}

export default function AccountsPage() {
  const { data: overview, mutate: refreshOverview } = useApi<AccountsOverview>("/accounts/overview");
  const { data: users } = useApi<UserLite[]>("/users");
  const { data: settings } = useApi<any>("/control/settings");
  const { user } = useAuth();
  // Write actions require the ACCOUNTS `edit` level from the role matrix.
  // Finance is view-only, so its UI must not offer buttons the API rejects.
  const canEdit = user?.role === "Owner" || user?.permissions?.ACCOUNTS?.edit === true;

  const router = useRouter();
  const searchParams = useSearchParams();

  // ── filters (only the search term goes to the server) ───────────────────
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [health, setHealth] = useState(searchParams.get("health") ?? "");
  const [vertical, setVertical] = useState(searchParams.get("vertical") ?? "");
  const [ownerId, setOwnerId] = useState(searchParams.get("ownerId") ?? "");
  const [preset, setPreset] = useState<Preset>((searchParams.get("preset") as Preset) ?? "all");
  const [showFilters, setShowFilters] = useState(
    !!(searchParams.get("health") || searchParams.get("vertical") || searchParams.get("ownerId"))
  );
  const [sort, setSort] = useState<Sort>({ key: "health", dir: "desc" });
  const [view, setView] = useState<"table" | "grid" | "kanban">(
    (searchParams.get("view") as any) ?? "table"
  );
  const [focusOpen, setFocusOpen] = useState(true);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const [refresh, setRefresh] = useState(0);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsErr, setClientsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scoreProfiles, setScoreProfiles] = useState<any[]>([]);
  const [detailTab, setDetailTab] = useState<"overview" | "projects" | "invoices">("overview");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<string | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  // "N overdue" chips drill straight into the exact bill, not just a client row.
  const [billingFocus, setBillingFocus] = useState<"overdue" | "unpaid" | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionsMode, setCollectionsMode] = useState<CollectionsMode>("overdue");
  // Which sub-view to open when a click targets a specific part of the file.
  // The `selectedId` reset effect reads and clears it.
  const pendingDetailView = useRef<{
    tab: "overview" | "projects" | "invoices";
    filter?: string | null;
    focus?: "overdue" | "unpaid" | null;
  } | null>(null);

  const openCollections = (mode: CollectionsMode) => {
    setCollectionsMode(mode);
    setCollectionsOpen(true);
  };

  /** Open one client file on its billing tab, focused on overdue/unpaid bills. */
  const openClientBilling = (clientId: string, mode: "overdue" | "unpaid" = "overdue") => {
    pendingDetailView.current = {
      tab: "invoices",
      filter: mode === "overdue" ? "__overdue" : "__unpaid",
      focus: mode,
    };
    setSelectedId(clientId);
  };

  /** Open a client file on its projects tab. */
  const openClientProjects = (clientId: string) => {
    pendingDetailView.current = { tab: "projects" };
    setSelectedId(clientId);
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [contactModal, setContactModal] = useState<{ open: boolean; initial?: ClientContact | null }>({ open: false });
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"client" | ClientContact | null>(null);
  const [docDelete, setDocDelete] = useState<{ id: string; label: string } | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: Tone } | null>(null);

  const notify = useCallback((msg: string, tone: Tone = "success") => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const reload = useCallback(() => {
    setRefresh((r) => r + 1);
    // The KPI strip and focus tiles read from /accounts/overview (react-query),
    // which does not refetch on its own after a mutation.
    refreshOverview();
  }, [refreshOverview]);

  // Segment profiles configured in Control → Scoring. The client file can pin
  // one explicitly instead of relying on the billing-cycle match.
  useEffect(() => {
    apiFetch<any[]>("/scoring/profiles")
      .then((rows) => setScoreProfiles(Array.isArray(rows) ? rows : []))
      .catch(() => setScoreProfiles([]));
  }, []);

  // debounce search so typing does not fire a request per keystroke
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const intent = pendingDetailView.current;
    pendingDetailView.current = null;
    setDetailTab(intent?.tab ?? "overview");
    setInvoiceStatusFilter(intent?.filter ?? null);
    setProjectStatusFilter(null);
    setExpandedInvoiceId(null);
    setBillingFocus(intent?.focus ?? null);
  }, [selectedId]);

  // "/" focuses search, Escape leaves the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setClientsErr(null);
    apiFetch<Client[]>(`/accounts/clients${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ""}`)
      .then((d) => !cancelled && setClients(d))
      .catch((e) => !cancelled && setClientsErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    apiFetch<ClientDetail>(`/accounts/clients/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setSelectedId(null))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, refresh]);

  // After a "N overdue / awaiting payment" click, expand the oldest matching
  // invoice inside the client file and bring it into view. This is what makes
  // the indicator a real drill-down instead of a filter.
  useEffect(() => {
    if (!detail || !billingFocus) return;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const candidates = (detail.invoices ?? [])
      .filter((inv) => !["DRAFT", "CANCELLED", "VOID"].includes(inv.status))
      .filter((inv) => Number(inv.balance ?? (Number(inv.total ?? 0) - Number(inv.paid ?? 0))) > 0)
      .filter((inv) => {
        if (billingFocus === "unpaid") return true;
        return Boolean(inv.dueDate) && new Date(inv.dueDate as string) < midnight;
      })
      .sort((a, b) => {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });
    const target = candidates[0];
    if (target) {
      setExpandedInvoiceId(target.id);
      window.setTimeout(() => {
        document.getElementById(`client-invoice-${target.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 160);
    }
    setBillingFocus(null);
  }, [detail, billingFocus]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (health) p.set("health", health);
    if (vertical) p.set("vertical", vertical);
    if (ownerId) p.set("ownerId", ownerId);
    if (preset !== "all") p.set("preset", preset);
    if (view !== "table") p.set("view", view);
    const next = p.toString();
    if (next !== searchParams.toString()) router.replace(`?${next}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, health, vertical, ownerId, preset, view]);

  // ── actions ─────────────────────────────────────────────────────────────
  const recompute = async (id: string) => {
    setRecomputing(true);
    try {
      const r = await apiFetch<{ score: number; level: string; drivers: string[] }>(
        `/accounts/clients/${id}/recompute-health`,
        { method: "POST" }
      );
      notify(`Health recomputed → ${r.score} (${r.level})`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Recompute failed", "error");
    } finally {
      setRecomputing(false);
    }
  };

  const setCategory = async (client: Client, newCategory: ClientCategory) => {    if (client.category === newCategory) return;
    try {
      await apiFetch(`/accounts/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: newCategory }),
      });
      setClients((prev) => prev?.map((c) => (c.id === client.id ? { ...c, category: newCategory } : c)) ?? prev);
      setDetail((prev) => (prev && prev.id === client.id ? { ...prev, category: newCategory } : prev));
      notify(`${client.companyName} → ${label(newCategory)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed", "error");
    }
  };

  const setScoreProfile = async (client: Client, value: string) => {
    try {
      await apiFetch(`/accounts/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ scoreProfile: value || null }),
      });
      setDetail((prev) => (prev && prev.id === client.id ? ({ ...prev, scoreProfile: value || null } as any) : prev));
      notify(value ? "Scoring profile updated" : "Scoring profile set to automatic");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed", "error");
    }
  };

  const removeContact = async (contactId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}/contacts/${contactId}`, { method: "DELETE" });
      setDeleteTarget(null);
      notify("Contact removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed", "error");
    }
  };

  const removeDocument = async (docId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}/documents/${docId}`, { method: "DELETE" });
      notify("Document removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed", "error");
    }
  };

  const deleteClient = async () => {
    if (!selectedId) return;
    try {
      await apiFetch(`/accounts/clients/${selectedId}`, { method: "DELETE" });
      notify("Client deleted");
      setDeleteTarget(null);
      setSelectedId(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed", "error");
      setDeleteTarget(null);
    }
  };

  const archiveClient = async () => {
    if (!detail) return;
    await setCategory(detail as Client, "ARCHIVED");
    setDeleteTarget(null);
  };

  const exportCsv = () => {
    const rows = [
      ["Company", "Vertical", "Category", "Health", "Score", "Invoiced", "Paid", "Due", "Overdue", "Owner", "Renewal", "Projects"],
      ...sorted.map((c) => [
        c.companyName,
        label(c.industryVertical),
        label(c.category ?? "ACTIVE"),
        c.healthLevel,
        String(c.healthScore ?? ""),
        String(c.totalInvoiced ?? 0),
        String(c.totalPaid ?? 0),
        String(c.totalDue ?? 0),
        String(c.overdueCount ?? 0),
        c.accountOwner?.name ?? "",
        c.renewalDate ? formatDate(c.renewalDate) : "",
        String(c._count?.projects ?? 0),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── derived data ────────────────────────────────────────────────────────
  const all = clients ?? [];
  const clientTiers: { name: string; minValue: number; color: string }[] | undefined = settings?.clientTiers;

  const enriched = useMemo(
    () =>
      all.map((c) => ({
        ...c,
        _days: daysUntil(c.renewalDate),
        _overdue: c.overdueCount ?? 0,
        _gap: hasGap(c),
        _tier: tierOf(c.totalInvoiced, clientTiers),
      })),
    [all, clientTiers]
  );

  const counts = useMemo(
    () => ({
      all: enriched.filter((c) => c.category !== "ARCHIVED").length,
      attention: enriched.filter((c) => c.category !== "ARCHIVED" && (c._overdue > 0 || c.healthLevel !== "GREEN")).length,
      overdue: enriched.filter((c) => c._overdue > 0).length,
      renewing: enriched.filter((c) => c._days != null && c._days >= 0 && c._days <= 30).length,
      risk: enriched.filter((c) => c.category !== "ARCHIVED" && c.healthLevel !== "GREEN").length,
      gaps: enriched.filter((c) => c._gap).length,
      onhold: enriched.filter((c) => c.category === "ON_HOLD").length,
      archived: enriched.filter((c) => c.category === "ARCHIVED").length,
    }),
    [enriched]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enriched.filter((c) => {
      if (needle) {
        const hay = [
          c.companyName,
          c.primaryContact?.name,
          c.primaryContact?.email,
          c.accountOwner?.name,
          // Every contact returned by the list, so a secondary contact or an
          // owner name is not filtered out after the server matched it.
          ...(c.contacts ?? []).flatMap((ct) => [ct.name, ct.email, ct.phone]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (health && c.healthLevel !== health) return false;
      if (vertical && c.industryVertical !== vertical) return false;
      if (ownerId && c.accountOwner?.id !== ownerId) return false;
      switch (preset) {
        case "attention":
          return c.category !== "ARCHIVED" && (c._overdue > 0 || c.healthLevel !== "GREEN" || c._gap);
        case "overdue":
          return c._overdue > 0;
        case "renewing":
          return c._days != null && c._days >= 0 && c._days <= 30;
        case "risk":
          return c.category !== "ARCHIVED" && c.healthLevel !== "GREEN";
        case "gaps":
          return c._gap;
        case "onhold":
          return c.category === "ON_HOLD";
        case "archived":
          return c.category === "ARCHIVED";
        default:
          return c.category !== "ARCHIVED";
      }
    });
  }, [enriched, q, health, vertical, ownerId, preset]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (c: (typeof enriched)[number]) => {
      switch (sort.key) {
        case "client":
          return c.companyName.toLowerCase();
        case "health":
          return c.healthScore ?? 0;
        case "due":
          return c.totalDue ?? 0;
        case "renewal":
          return c.renewalDate ? new Date(c.renewalDate).getTime() : Number.MAX_SAFE_INTEGER;
        case "projects":
          return c._count?.projects ?? 0;
      }
    };
    return [...visible].sort((a, b) => {
      // Clients with no renewal date always sit at the end, in either direction.
      if (sort.key === "renewal") {
        const at = a.renewalDate ? new Date(a.renewalDate).getTime() : null;
        const bt = b.renewalDate ? new Date(b.renewalDate).getTime() : null;
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return (at - bt) * dir;
      }
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [visible, sort]);

  const activeFilterCount = [health, vertical, ownerId].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0 || preset !== "all" || !!q.trim();

  const resetFilters = () => {
    setQ("");
    setHealth("");
    setVertical("");
    setOwnerId("");
    setPreset("all");
  };

  const kanban = useMemo(() => {
    const groups: Record<string, typeof sorted> = { ACTIVE: [], ON_HOLD: [], ARCHIVED: [] };
    for (const c of sorted) {
      const cat = (c.category ?? "ACTIVE") as string;
      (groups[cat] ?? groups.ACTIVE).push(c);
    }
    return groups;
  }, [sorted]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "client" ? "asc" : "desc" }));

  const SORT_LABELS: Record<SortKey, string> = {
    client: "Name",
    health: "Health",
    due: "Outstanding",
    renewal: "Renewal",
    projects: "Projects",
  };
  const sortValue = `${sort.key}:${sort.dir}`;
  const sortOptions: { value: string; label: string }[] = [
    { value: "health:desc", label: "Health · high to low" },
    { value: "due:desc", label: "Outstanding · high to low" },
    { value: "renewal:asc", label: "Renewal · soonest" },
    { value: "client:asc", label: "Name · A to Z" },
    { value: "projects:desc", label: "Projects · most" },
  ];
  // A header click can land on a direction the shortcut list does not cover —
  // keep the control in sync instead of falling back to a blank value.
  if (!sortOptions.some((o) => o.value === sortValue)) {
    sortOptions.unshift({
      value: sortValue,
      label: `${SORT_LABELS[sort.key]} · ${sort.dir === "asc" ? "low to high" : "high to low"}`,
    });
  }

  const renewals = overview?.renewalsNext30 ?? [];
  const nextRenewal = renewals[0];

  // A tier badge only earns its space when clients actually sit in different tiers.
  const tierVariety = useMemo(() => new Set(sorted.map((c) => c._tier?.name).filter(Boolean)).size, [sorted]);

  const presetLabel: Record<Preset, string> = {
    all: "All",
    attention: "Needs attention",
    overdue: "Overdue",
    renewing: "Renewing ≤30d",
    risk: "At risk",
    gaps: "Setup gaps",
    onhold: "On hold",
    archived: "Archived",
  };

  const goPreset = (p: Preset) => {
    setPreset(p);
    if (p === "attention" || p === "overdue" || p === "renewing") setFocusOpen(true);
  };

  const clientName = detailLoading ? "Loading…" : detail?.companyName ?? "Client";

  return (
    <div>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
              "fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-xl",
              toast.tone === "error" ? "bg-rose-600" : "bg-sidebar"
            )}
            role="status"
          >
            {toast.tone === "error" ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <PageHeader
        title="Accounts"
        subtitle="Every client relationship, its money and its health — in one place."
        actions={
          canEdit ? (
            <>
              <Btn
                variant="outline"
                onClick={async () => {
                  setRecomputing(true);
                  try {
                    await apiFetch("/accounts/recompute-all", { method: "POST" });
                    notify("Health scores recomputed for all clients");
                    reload();
                  } catch (e: any) {
                    notify(e.message ?? "Recompute failed", "error");
                  } finally {
                    setRecomputing(false);
                  }
                }}
                disabled={recomputing}
              >
                <RefreshCw className={cn("size-3.5", recomputing && "animate-spin")} /> Recompute
              </Btn>
              <Btn variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> New client
              </Btn>
            </>
          ) : undefined
        }
      />

      {/* ── Today's focus ─────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setFocusOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <Sparkles className="size-4 text-primary" />
          <span className="text-[12.5px] font-bold">Today's focus</span>
          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-bold text-rose-600 dark:text-rose-400">
            {counts.attention} need attention
          </span>
          {!focusOpen && (
            <span className="ml-2 hidden truncate text-[11.5px] text-muted-foreground sm:inline">
              {money(overview?.overdueAmount)} overdue · {counts.renewing} renewing · {overview?.dataGaps ?? 0} setup gaps
            </span>
          )}
          <span className="ml-auto text-muted-foreground">
            {focusOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {focusOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-border/60"
            >
              <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                <FocusTile
                  icon={<Wallet className="size-4" />}
                  label="Overdue collections"
                  value={money(overview?.overdueAmount)}
                  hint={`${overview?.overdueClients ?? 0} clients · click for the exact invoices`}
                  tone="rose"
                  active={false}
                  onClick={() => openCollections("overdue")}
                  disabled={(overview?.overdueAmount ?? 0) === 0}
                />
                <FocusTile
                  icon={<CalendarClock className="size-4" />}
                  label="Renewals in 30 days"
                  value={String(renewals.length)}
                  hint={
                    nextRenewal
                      ? `Next: ${nextRenewal.companyName} · ${Math.max(0, daysUntil(nextRenewal.renewalDate) ?? 0)}d`
                      : "Nothing due in the next month"
                  }
                  tone="amber"
                  active={preset === "renewing"}
                  onClick={() => goPreset(preset === "renewing" ? "all" : "renewing")}
                  disabled={renewals.length === 0}
                />
                <FocusTile
                  icon={<HeartPulse className="size-4" />}
                  label="At-risk clients"
                  value={String(counts.risk)}
                  hint={`${overview?.distribution.RED ?? 0} red · ${overview?.distribution.YELLOW ?? 0} yellow · ${overview?.churnFlagged ?? 0} churn flagged`}
                  tone="rose"
                  active={preset === "risk"}
                  onClick={() => goPreset(preset === "risk" ? "all" : "risk")}
                  disabled={(overview?.atRiskCount ?? 0) === 0}
                />
                <FocusTile
                  icon={<ShieldAlert className="size-4" />}
                  label="Setup gaps"
                  value={String(counts.gaps)}
                  hint={[
                    `${overview?.retainerMissingAmount ?? 0} retainers bill ৳0`,
                    `${overview?.noContact ?? 0} without contact`,
                    ...((overview?.noOwner ?? 0) > 0 ? [`${overview?.noOwner} without owner`] : []),
                  ].join(" · ")}
                  tone="sky"
                  active={preset === "gaps"}
                  onClick={() => goPreset(preset === "gaps" ? "all" : "gaps")}
                  disabled={(overview?.dataGaps ?? 0) === 0}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ── KPI row ───────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div onClick={resetFilters} className="cursor-pointer" role="presentation">
          <StatCard
            index={0}
            label="Total clients"
            value={overview?.totalClients ?? "—"}
            sub={`${overview?.newThisMonth ?? 0} added this month · ${counts.onhold} on hold${
              overview?.archivedClients ? ` · ${overview.archivedClients} archived` : ""
            }`}
            icon={<Building2 className="size-5" />}
          />
        </div>
        <div onClick={() => openCollections("overdue")} className="cursor-pointer" role="presentation">
          <StatCard
            index={1}
            label="Outstanding"
            value={money(overview?.totalDue)}
            sub={
              (overview?.overdueAmount ?? 0) > 0
                ? `${money(overview?.overdueAmount)} overdue`
                : "Nothing overdue — nice"
            }
            tone={(overview?.overdueAmount ?? 0) > 0 ? "rose" : "emerald"}
            icon={<Wallet className="size-5" />}
          />
        </div>
        <div onClick={() => setShowFilters(true)} className="cursor-pointer" role="presentation">
          <StatCard
            index={2}
            label="Retainer MRR"
            value={overview?.mrr ? money(overview.mrr) : "৳0"}
            sub={
              (overview?.retainerMissingAmount ?? 0) > 0
                ? `${overview?.retainerMissingAmount} retainer${(overview?.retainerMissingAmount ?? 0) === 1 ? "" : "s"} without an amount`
                : "All retainers priced"
            }
            tone={(overview?.retainerMissingAmount ?? 0) > 0 ? "amber" : "emerald"}
            icon={<Receipt className="size-5" />}
          />
        </div>
        <div onClick={() => goPreset("risk")} className="cursor-pointer" role="presentation">
          <StatCard
            index={3}
            label="Avg health"
            value={overview?.avgHealth != null ? overview.avgHealth : "—"}
            sub={`${counts.risk} at risk of churn`}
            tone="primary"
            icon={<Gauge className="size-5" />}
          />
        </div>
      </div>

      {/* ── Presets + toolbar ─────────────────────────────────────────── */}
      <div className="mt-5 rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
          {(
            [
              ["all", "All", counts.all],
              ["attention", "Needs attention", counts.attention],
              ["overdue", "Overdue", counts.overdue],
              ["renewing", "Renewing ≤30d", counts.renewing],
              ["risk", "At risk", counts.risk],
              ["gaps", "Setup gaps", counts.gaps],
              ["onhold", "On hold", counts.onhold],
              ["archived", "Archived", counts.archived],
            ] as [Preset, string, number][]
          ).map(([key, text, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => goPreset(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
                preset === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              aria-pressed={preset === key}
            >
              {text}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  preset === key ? "bg-white/20" : "bg-muted text-muted-foreground"
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
              placeholder="Search client, contact or owner…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-9 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              aria-label="Search clients"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:block">
                /
              </kbd>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors",
              showFilters || activeFilterCount
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
            aria-expanded={showFilters}
          >
            <Filter className="size-3.5" /> Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <Select
              value={sortValue}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
                setSort({ key, dir });
              }}
              className="!w-auto !py-2 text-[12px]"
              aria-label="Sort clients"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <Segmented
              value={view}
              onChange={(v) => setView(v)}
              options={[
                { value: "table", label: <span className="flex items-center gap-1.5"><TableIcon className="size-3.5" /> Table</span> },
                { value: "grid", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-3.5" /> Cards</span> },
                { value: "kanban", label: <span className="flex items-center gap-1.5"><Columns className="size-3.5" /> Board</span> },
              ]}
            />
            <Btn variant="ghost" onClick={exportCsv} title="Export visible clients to CSV">
              <Download className="size-3.5" />
            </Btn>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden border-t border-border/60"
            >
              <div className="flex flex-wrap items-end gap-3 px-3 py-3">
                <Field label="Health">
                  <Select value={health} onChange={(e) => setHealth(e.target.value)} className="!w-36">
                    <option value="">Any health</option>
                    <option value="GREEN">Green</option>
                    <option value="YELLOW">Yellow</option>
                    <option value="RED">Red</option>
                  </Select>
                </Field>
                <Field label="Vertical">
                  <Select value={vertical} onChange={(e) => setVertical(e.target.value)} className="!w-40">
                    <option value="">Any vertical</option>
                    {VERTICALS.map((v) => (
                      <option key={v} value={v}>{label(v)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Account owner">
                  <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="!w-44">
                    <option value="">Anyone</option>
                    {(users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>
                </Field>
                {(activeFilterCount > 0 || q || preset !== "all") && (
                  <Btn variant="ghost" onClick={resetFilters}>
                    <X className="size-3.5" /> Clear all
                  </Btn>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(activeFilterCount > 0 || preset !== "all" || !!q.trim()) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Active</span>
            {q.trim() && <Chip onClear={() => setQ("")}>Search: {q.trim()}</Chip>}
            {preset !== "all" && (
              <Chip onClear={() => setPreset("all")}>{presetLabel[preset]}</Chip>
            )}
            {health && <Chip onClear={() => setHealth("")}>Health: {label(health)}</Chip>}
            {vertical && <Chip onClear={() => setVertical("")}>{label(vertical)}</Chip>}
            {ownerId && <Chip onClear={() => setOwnerId("")}>Owner: {(users ?? []).find((u) => u.id === ownerId)?.name ?? "—"}</Chip>}
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              {sorted.length} of {counts.all} clients
            </span>
          </div>
        )}
      </div>

      {/* ── Views ─────────────────────────────────────────────────────── */}
      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(5)].map((_, i) => (
              <SkeletonBlock key={i} className="h-14" />
            ))}
          </div>
        ) : clientsErr ? (
          <EmptyState title="Could not load clients" hint={clientsErr} />
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <p className="text-[13px] font-semibold">
              {hasAnyFilter ? "No clients match these filters" : "No clients yet"}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {hasAnyFilter
                ? "Try a different search, or clear the filters to see every client."
                : "Add your first client to start tracking health and billing."}
            </p>
            <div className="mt-3 flex justify-center gap-2">
              {hasAnyFilter && <Btn variant="outline" onClick={resetFilters}>Clear filters</Btn>}
              {!hasAnyFilter && canEdit && (
                <Btn variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> New client
                </Btn>
              )}
            </div>
          </div>
        ) : (
          <>
            {view === "table" && (
              <motion.div key="table" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                <TableShell
                  footer={
                    <>
                      <span className="text-[11.5px] text-muted-foreground">
                        {sorted.length} client{sorted.length === 1 ? "" : "s"} · {money(sorted.reduce((s, c) => s + (c.totalDue ?? 0), 0))} outstanding
                      </span>
                      <span className="text-[11px] text-muted-foreground">Click a row for the full client file</span>
                    </>
                  }
                >
                  <table className="w-full min-w-[1020px]">
                    <THead>
                      <SortTh labelText="Client" k="client" sort={sort} onSort={toggleSort} />
                      <SortTh labelText="Health" k="health" sort={sort} onSort={toggleSort} />
                      <SortTh labelText="Outstanding" k="due" sort={sort} onSort={toggleSort} />
                      <SortTh labelText="Renewal" k="renewal" sort={sort} onSort={toggleSort} />
                      <Th>Owner</Th>
                      <SortTh labelText="Work" k="projects" sort={sort} onSort={toggleSort} />
                      <Th><span className="sr-only">Actions</span></Th>
                    </THead>
                    <tbody>
                      {sorted.map((c, i) => {
                        const due = c.totalDue ?? 0;
                        const overdue = c._overdue;
                        const contact = c.primaryContact;
                        return (
                          <Tr key={c.id} index={Math.min(i, 12)} onClick={() => setSelectedId(c.id)} className="group cursor-pointer">
                            <Td>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={c.companyName} />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate font-semibold">{c.companyName}</span>
                                    {c.category !== "ACTIVE" && (
                                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold", categoryTone(c.category))}>
                                        {label(c.category)}
                                      </span>
                                    )}
                                    {c._tier && tierVariety > 1 && (
                                      <span
                                        className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold"
                                        style={{ borderColor: `${c._tier.color}40`, background: `${c._tier.color}15`, color: c._tier.color }}
                                      >
                                        {c._tier.name}
                                      </span>
                                    )}
                                    {c._gap && (
                                      <span title="Setup gap — missing retainer amount, contact or owner">
                                        <AlertTriangle className="size-3 text-amber-500" aria-label="Setup gap" />
                                      </span>
                                    )}
                                  </div>
                                  <p className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                                    {contact
                                      ? `${contact.name}${contact.roleTitle ? ` · ${contact.roleTitle}` : ""}`
                                      : "No contact on file"}
                                  </p>
                                  {c.healthLevel !== "GREEN" && c.healthDriver && (
                                    <p className="max-w-[260px] truncate text-[10px] font-medium text-amber-600 dark:text-amber-400/90">
                                      {c.healthDriver}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", healthTone(c.healthLevel))}>
                                  {c.healthLevel}
                                </span>
                                <ScoreBar score={c.healthScore} />
                              </div>
                            </Td>
                            <Td>
                              <div className="flex flex-col gap-0.5">
                                <span className={cn("font-bold tabular-nums", due > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                                  {money(due)}
                                </span>
                                {overdue > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openClientBilling(c.id, "overdue"); }}
                                    className="w-fit text-left text-[10px] font-semibold text-rose-500 hover:underline"
                                    title="Open the oldest overdue invoice"
                                  >
                                    {overdue} overdue · {money(c.overdueAmount)} →
                                  </button>
                                ) : due > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openClientBilling(c.id, "unpaid"); }}
                                    className="w-fit text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                                    title="Open the unpaid invoices"
                                  >
                                    awaiting payment →
                                  </button>
                                ) : (c.draftCount ?? 0) > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      pendingDetailView.current = { tab: "invoices", filter: "DRAFT" };
                                      setSelectedId(c.id);
                                    }}
                                    className="w-fit text-left text-[10px] font-medium text-amber-600 hover:underline dark:text-amber-400"
                                    title="Open the draft invoices"
                                  >
                                    {c.draftCount} draft{(c.draftCount ?? 0) === 1 ? "" : "s"} · {money(c.draftAmount)} not issued
                                  </button>
                                ) : (
                                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">settled</span>
                                )}
                              </div>
                            </Td>
                            <Td>
                              {c._days != null && c._days >= 0 && c._days <= 30 ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold", renewalTone(c._days))}>
                                    {c._days === 0 ? "today" : `in ${c._days}d`}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">{formatDate(c.renewalDate)}</span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[12px]">{formatDate(c.renewalDate)}</span>
                                  <span className="text-[10px] text-muted-foreground">{label(c.billingCycleType)}</span>
                                </div>
                              )}
                            </Td>
                            <Td>
                              {c.accountOwner ? (
                                <div className="flex items-center gap-1.5">
                                  <Avatar name={c.accountOwner.name} size="size-6" />
                                  <span className="text-[12px]">{c.accountOwner.name}</span>
                                </div>
                              ) : (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                  Unassigned
                                </span>
                              )}
                            </Td>
                            <Td>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openClientProjects(c.id); }}
                                className="flex flex-col items-start gap-0.5 text-left text-[11.5px] hover:text-primary"
                                title="See this client's projects"
                              >
                                <span className="font-semibold tabular-nums">
                                  {c._count?.projects ?? 0} project{(c._count?.projects ?? 0) === 1 ? "" : "s"}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {c._count?.invoices ?? 0} invoice{(c._count?.invoices ?? 0) === 1 ? "" : "s"}
                                </span>
                              </button>
                            </Td>
                            <Td>
                              <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                {contact?.phone && (
                                  <QuickIcon href={`tel:${contact.phone}`} label={`Call ${contact.name}`}>
                                    <Phone className="size-3.5" />
                                  </QuickIcon>
                                )}
                                {contact?.email && (
                                  <QuickIcon href={`mailto:${contact.email}`} label={`Email ${contact.name}`}>
                                    <Mail className="size-3.5" />
                                  </QuickIcon>
                                )}
                                {canEdit && (
                                  <button
                                    type="button"
                                    aria-label={`Edit ${c.companyName}`}
                                    title="Edit client"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditClient(c);
                                    }}
                                    className="inline-flex size-7 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Open ${c.companyName}`}
                                  title="Open client"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedId(c.id);
                                  }}
                                  className="inline-flex size-7 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                >
                                  <ArrowRight className="size-3.5" />
                                </button>
                              </div>
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableShell>
              </motion.div>
            )}

            {view === "grid" && (
              <motion.div key="grid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {sorted.map((c) => {
                    const due = c.totalDue ?? 0;
                    const contact = c.primaryContact;
                    return (
                      <div
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className="group cursor-pointer rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setSelectedId(c.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={c.companyName} />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold">{c.companyName}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {label(c.industryVertical)} · {label(c.billingCycleType)}
                              </p>
                            </div>
                          </div>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold", healthTone(c.healthLevel))}>
                            {c.healthLevel}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <ScoreBar score={c.healthScore} />
                          <span className={cn("ml-auto text-[12px] font-bold tabular-nums", due > 0 ? "text-rose-600 dark:text-rose-400" : (c.draftCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                            {due > 0 ? money(due) : (c.draftCount ?? 0) > 0 ? `${c.draftCount} draft` : "settled"}
                          </span>
                        </div>
                        {c._overdue > 0 && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openClientBilling(c.id, "overdue"); }}
                            className="mt-1 block w-fit text-left text-[10.5px] font-semibold text-rose-500 hover:underline"
                            title="Open the oldest overdue invoice"
                          >
                            {c._overdue} overdue · {money(c.overdueAmount)} →
                          </button>
                        )}

                        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                          <span className="truncate">{contact ? contact.name : "No contact"}</span>
                          <span className="shrink-0">
                            {c._count?.projects ?? 0} project{(c._count?.projects ?? 0) === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate">{c.accountOwner?.name ?? "Unassigned"}</span>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {contact?.phone && (
                              <QuickIcon href={`tel:${contact.phone}`} label={`Call ${contact.name}`}>
                                <Phone className="size-3.5" />
                              </QuickIcon>
                            )}
                            {contact?.email && (
                              <QuickIcon href={`mailto:${contact.email}`} label={`Email ${contact.name}`}>
                                <Mail className="size-3.5" />
                              </QuickIcon>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {view === "kanban" && (
              <motion.div key="kanban" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {CATEGORIES.map((cat) => {
                    const list = kanban[cat] ?? [];
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
                          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{money(sumDue)} due</span>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          {list.length === 0 && (
                            <p className="rounded-xl border border-dashed border-border bg-card/60 py-8 text-center text-[11.5px] text-muted-foreground">
                              Nothing here
                            </p>
                          )}
                          {list.map((c) => (
                            <div
                              key={c.id}
                              onClick={() => setSelectedId(c.id)}
                              className="cursor-pointer rounded-xl border border-border/60 bg-card p-3 transition-all hover:shadow-md"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Avatar name={c.companyName} size="size-7" />
                                  <div className="min-w-0">
                                    <p className="truncate text-[12.5px] font-semibold">{c.companyName}</p>
                                    <p className="truncate text-[10.5px] text-muted-foreground">
                                      {c.accountOwner?.name ?? "Unassigned"} · {c._count?.projects ?? 0} project
                                      {(c._count?.projects ?? 0) === 1 ? "" : "s"}
                                    </p>
                                  </div>
                                </div>
                                <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold", healthTone(c.healthLevel))}>
                                  {c.healthLevel}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if ((c.totalDue ?? 0) > 0) openClientBilling(c.id, (c._overdue ?? 0) > 0 ? "overdue" : "unpaid");
                                    else setSelectedId(c.id);
                                  }}
                                  className={cn("w-fit text-left text-[10.5px] font-semibold tabular-nums hover:underline", (c.totalDue ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}
                                  title={(c.totalDue ?? 0) > 0 ? "See the unpaid invoices" : "Open client"}
                                >
                                  {money(c.totalDue ?? 0)} due{(c._overdue ?? 0) > 0 ? ` · ${c._overdue} overdue →` : ""}
                                </button>
                                <span className="text-[10px] text-muted-foreground">{formatDate(c.renewalDate)}</span>
                              </div>
                              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                <Select
                                  value={c.category ?? "ACTIVE"}
                                  onChange={(e) => setCategory(c as Client, e.target.value as ClientCategory)}
                                  disabled={!canEdit}
                                  className="!w-full !py-1 text-[11px]"
                                  aria-label={`Move ${c.companyName}`}
                                >
                                  {CATEGORIES.map((opt) => (
                                    <option key={opt} value={opt}>Move to {label(opt)}</option>
                                  ))}
                                </Select>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>

      {/* ── Client detail ─────────────────────────────────────────────── */}
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size="2xl"
        title={
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={clientName} size="size-10" />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-[16px] font-semibold">{clientName}</h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {detail ? `${label(detail.industryVertical)}${detail.accountOwner ? ` · ${detail.accountOwner.name}` : " · Unassigned"}` : ""}
              </p>
            </div>
          </div>
        }
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <>
                    <Btn variant="primary" onClick={() => setEditClient(detail)}>
                      <Pencil className="size-3.5" /> Edit client
                    </Btn>
                    <Btn variant="outline" onClick={() => setDocModalOpen(true)}>
                      <FileText className="size-3.5" /> Attach doc
                    </Btn>
                    <Btn variant="ghost" onClick={() => (recomputing ? undefined : recompute(detail.id))} disabled={recomputing}>
                      <RefreshCw className={cn("size-3.5", recomputing && "animate-spin")} /> Recompute
                    </Btn>
                  </>
                )}
                <Btn variant="ghost" onClick={() => { setSelectedId(null); router.push(`/flow?clientId=${detail.id}`); }}>
                  <Layers className="size-3.5" /> Open Flow
                </Btn>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <Btn variant="ghost" onClick={() => setDeleteTarget("client")} className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-500">
                    <Archive className="size-3.5" /> Archive / delete
                  </Btn>
                </div>
              )}
            </div>
          ) : undefined
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
          const tier = tierOf(detail.totalInvoiced, clientTiers);
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
          const today0 = new Date();
          today0.setHours(0, 0, 0, 0);
          const balanceOf = (inv: any) => Number(inv.balance ?? Math.max(0, Number(inv.total ?? 0) - Number(inv.paid ?? 0)));
          const isLive = (inv: any) => !["DRAFT", "CANCELLED", "VOID"].includes(inv.status);
          const unpaidInvoices = detail.invoices
            .filter((inv) => isLive(inv) && balanceOf(inv) > 0)
            .sort((a, b) => +new Date(a.dueDate ?? 0) - +new Date(b.dueDate ?? 0));
          const overdueInvoices = unpaidInvoices.filter(
            (inv) => inv.dueDate && new Date(inv.dueDate) < today0
          );
          const overdueCountList = overdueInvoices.length;
          const filteredInvoices = invoiceStatusFilter === "__overdue"
            ? overdueInvoices
            : invoiceStatusFilter === "__unpaid"
              ? unpaidInvoices
              : invoiceStatusFilter
                ? detail.invoices.filter((inv) => inv.status === invoiceStatusFilter)
                : detail.invoices;
          const filteredProjects = projectStatusFilter === "__attention"
            ? detail.projects.filter((pr) => ["AT_RISK", "DELAYED"].includes(pr.healthStatus))
            : projectStatusFilter
              ? detail.projects.filter((pr) => pr.status === projectStatusFilter)
              : detail.projects;
          const invoiceCount = detail.invoiceCount ?? detail.invoices.length;
          const projectCount = detail.projectCount ?? detail.projects.length;
          const primary = detail.contacts.find((c) => c.isPrimary) ?? detail.contacts[0] ?? null;
          const retainerGap = hasRetainerGap(detail as Client);
          const days = daysUntil(detail.renewalDate);

          return (
            <div className="flex flex-col gap-4">
              {/* status row */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                <Select
                  value={detail.category}
                  onChange={(e) => setCategory(detail as Client, e.target.value as ClientCategory)}
                  disabled={!canEdit}
                  className={cn(
                    "!w-auto !rounded-full !py-1 !pl-2.5 !pr-7 !text-[10px] !font-bold",
                    categoryTone(detail.category)
                  )}
                  aria-label="Lifecycle stage"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{label(c)}</option>
                  ))}
                </Select>
                <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", healthTone(detail.healthLevel))}>
                  {detail.healthLevel} · {detail.healthScore ?? "—"}
                </span>
                <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                  {label(detail.billingCycleType)}
                </span>
                {tier && (
                  <span
                    className="rounded-full border px-2.5 py-1 text-[10px] font-bold"
                    style={{ borderColor: `${tier.color}40`, background: `${tier.color}15`, color: tier.color }}
                  >
                    {tier.name}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarClock className="size-3" />
                  Renewal {formatDate(detail.renewalDate)}
                  {days != null && days >= 0 && days <= 30 && (
                    <span className={cn("ml-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold", renewalTone(days))}>
                      in {days}d
                    </span>
                  )}
                </span>
              </div>

              {/* factor-level explainability — why the score is what it is */}
              {Array.isArray((detail as any).healthBreakdown?.breakdown) && (
                <div className="rounded-xl border border-border/50 bg-card px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Why this score
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {(detail as any).healthBreakdown.coverage ?? 0}% data coverage
                      </span>
                      {scoreProfiles.length > 0 && (
                        <Select
                          value={(detail as any).scoreProfile ?? ""}
                          onChange={(e) => setScoreProfile(detail as any, e.target.value)}
                          disabled={!canEdit}
                          className="!h-7 !w-44 !py-0.5 !text-[10px]"
                          title="Scoring profile for this client"
                        >
                          <option value="">Auto (by billing cycle)</option>
                          {scoreProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {(detail as any).healthBreakdown.breakdown.map((f: any) => (
                      <div key={f.code} className="flex items-center gap-2 text-[10.5px]">
                        <span className="w-28 truncate text-muted-foreground">{f.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              f.subScore == null
                                ? "bg-muted-foreground/30"
                                : f.subScore >= 70
                                  ? "bg-emerald-500"
                                  : f.subScore >= 40
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                            )}
                            style={{ width: `${f.subScore ?? 0}%` }}
                          />
                        </div>
                        <span className="w-14 text-right tabular-nums text-muted-foreground">
                          {f.subScore == null ? "no data" : `${f.subScore}/100`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* setup warning */}
              {retainerGap && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-bold text-amber-700 dark:text-amber-300">Retainer amount not set</p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                      Auto-billing is on but there is no amount, so the daily cron skips this client — no retainer invoice is ever raised.
                    </p>
                  </div>
                  {canEdit && (
                    <Btn variant="outline" onClick={() => setEditClient(detail)}>
                      Set amount
                    </Btn>
                  )}
                </div>
              )}

              {/* money */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-card p-4">
                  <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Invoiced</p>
                  <p className="mt-1.5 text-xl font-heading font-bold tabular-nums sm:text-2xl">{money(detail.totalInvoiced)}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {invoiceCount - (detail.draftCount ?? 0)} issued invoice
                    {invoiceCount - (detail.draftCount ?? 0) === 1 ? "" : "s"}
                  </p>
                  {(detail.draftCount ?? 0) > 0 && (
                    <p className="mt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      +{detail.draftCount} draft{(detail.draftCount ?? 0) === 1 ? "" : "s"} ({money(detail.draftAmount)}) not issued yet
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                  <p className="text-[10.5px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Collected</p>
                  <p className="mt-1.5 text-xl font-heading font-bold tabular-nums text-emerald-600 dark:text-emerald-300 sm:text-2xl">
                    {money(detail.totalPaid)}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/20">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, paidPct)}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-emerald-700/80 dark:text-emerald-300/80">{paidPct}% of invoiced</p>
                </div>
                <div className={cn("rounded-2xl border p-4", (detail.totalDue ?? 0) > 0 ? "border-rose-500/25 bg-rose-500/10" : "border-border/60 bg-card")}>
                  <p className={cn("text-[10.5px] font-bold uppercase tracking-widest", (detail.totalDue ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                    Outstanding
                  </p>
                  <p className={cn("mt-1.5 text-xl font-heading font-bold tabular-nums sm:text-2xl", (detail.totalDue ?? 0) > 0 && "text-rose-600 dark:text-rose-300")}>
                    {money(detail.totalDue)}
                  </p>
                  <p className={cn("mt-0.5 text-[10.5px]", (detail.overdueCount ?? 0) > 0 ? "font-semibold text-rose-500" : "text-muted-foreground")}>
                    {(detail.overdueCount ?? 0) > 0
                      ? `${detail.overdueCount} overdue · ${money(detail.overdueAmount)}`
                      : (detail.totalDue ?? 0) > 0
                        ? "not yet overdue"
                        : "all settled"}
                  </p>
                  {(detail.totalDue ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailTab("invoices");
                        setInvoiceStatusFilter((detail.overdueCount ?? 0) > 0 ? "__overdue" : "__unpaid");
                      }}
                      className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-bold text-primary hover:underline"
                    >
                      See which invoices <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* health + quick contact */}
              <div className="grid gap-3 lg:grid-cols-2">
                <div className={cn("rounded-2xl border p-4", healthTone(detail.healthLevel))}>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wide">Health score</p>
                    <span className="text-lg font-black tabular-nums">{detail.healthScore ?? "—"}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-black/20">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (detail.healthScore ?? 0) >= 70 ? "bg-emerald-500" : (detail.healthScore ?? 0) >= 40 ? "bg-amber-500" : "bg-rose-500"
                      )}
                      style={{ width: `${detail.healthScore ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11.5px] font-medium">{detail.healthDriver ?? "Healthy — no active drivers"}</p>
                  {detail.churnFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {detail.churnFlags.map((f) => (
                        <span key={f.id} className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold dark:bg-black/20">
                          ⚑ {label(f.matchedPattern ?? f.riskLevel)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-border/60 bg-card p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Primary contact</p>
                  {primary ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Avatar name={primary.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{primary.name}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">
                          {[primary.roleTitle, primary.email, primary.phone].filter(Boolean).join(" · ") || "No details"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {primary.phone && (
                          <QuickIcon href={`tel:${primary.phone}`} label={`Call ${primary.name}`}>
                            <Phone className="size-3.5" />
                          </QuickIcon>
                        )}
                        {primary.email && (
                          <QuickIcon href={`mailto:${primary.email}`} label={`Email ${primary.name}`}>
                            <Mail className="size-3.5" />
                          </QuickIcon>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setContactModal({ open: true, initial: primary })}
                            aria-label="Edit primary contact"
                            className="inline-flex size-7 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[11.5px] text-muted-foreground">No contact — follow-ups have nowhere to go.</p>
                      {canEdit && (
                        <Btn variant="outline" onClick={() => setContactModal({ open: true })}>
                          <UserPlus className="size-3.5" /> Add
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Segmented
                value={detailTab}
                onChange={setDetailTab}
                options={[
                  { value: "overview", label: <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Overview</span> },
                  { value: "projects", label: <span className="flex items-center gap-1.5"><Briefcase className="size-3.5" /> Projects ({projectCount})</span> },
                  { value: "invoices", label: <span className="flex items-center gap-1.5"><Receipt className="size-3.5" /> Billing ({invoiceCount})</span> },
                ]}
              />

              {/* OVERVIEW */}
              {detailTab === "overview" && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="flex flex-col gap-5">
                    {detail.finance && (
                      <section>
                        <SectionTitle
                          icon={<TrendingUp className="size-3.5" />}
                          title="Profitability"
                          hint="Billed to the client vs. expenses booked against it"
                          action={
                            <a
                              href="/capital/profitability"
                              onClick={(e) => { e.preventDefault(); setSelectedId(null); router.push("/capital/profitability"); }}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                            >
                              Capital <ExternalLink className="size-3" />
                            </a>
                          }
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-border/60 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Revenue</p>
                            <p className="mt-0.5 text-[13px] font-bold tabular-nums">{money(detail.totalInvoiced)}</p>
                          </div>
                          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-rose-500/80">Expenses</p>
                            <p className="mt-0.5 text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                              {money(detail.finance.expensesTotal)}
                            </p>
                          </div>
                          <div className={cn("rounded-xl border px-3 py-2", detail.finance.profit >= 0 ? "border-emerald-500/25 bg-emerald-500/5" : "border-rose-500/25 bg-rose-500/5")}>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Profit</p>
                            <p className={cn("mt-0.5 text-[13px] font-bold tabular-nums", detail.finance.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                              {money(detail.finance.profit)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border/60 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Margin</p>
                            <p className="mt-0.5 text-[13px] font-bold tabular-nums">
                              {detail.finance.margin != null ? `${detail.finance.margin}%` : "—"}
                            </p>
                          </div>
                        </div>
                        {(detail.finance.pendingExpenses > 0 || detail.finance.expenseCount > 0) && (
                          <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                            {detail.finance.expenseCount} approved expense{detail.finance.expenseCount === 1 ? "" : "s"}
                            {detail.finance.pendingExpenses > 0
                              ? ` · ${money(detail.finance.pendingExpenses)} awaiting approval (not counted)`
                              : ""}
                          </p>
                        )}
                        {detail.finance.recentExpenses.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1">
                            {detail.finance.recentExpenses.slice(0, 3).map((e) => (
                              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5">
                                <span className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                  e.approvalStatus === "APPROVED"
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : e.approvalStatus === "REJECTED"
                                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                )}>
                                  {label(e.approvalStatus)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px]">{e.description}</span>
                                <span className="shrink-0 text-[11px] font-bold tabular-nums">{money(e.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                    <section>
                      <SectionTitle icon={<Building2 className="size-3.5" />} title="Client details" />
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <Fact label="Vertical" value={label(detail.industryVertical)} />
                        <Fact label="Owner" value={detail.accountOwner?.name ?? "Unassigned"} tone={detail.accountOwner ? undefined : "warn"} />
                        <Fact label="Billing cycle" value={label(detail.billingCycleType)} />
                        <Fact label="Currency" value={detail.currencyPreference ?? "BDT"} />
                        <Fact label="Contract start" value={formatDate(detail.contractStartDate)} />
                        <Fact label="Renewal" value={formatDate(detail.renewalDate)} />
                        <Fact label="Created" value={formatDate(detail.createdAt ?? null)} />
                        <Fact label="Contacts" value={String(detail.contacts.length)} />
                        {detail.billingCycleType === "MONTHLY_RETAINER" && (
                          <>
                            <Fact
                              label="Retainer amount"
                              value={Number(detail.monthlyAmount) > 0 ? money(Number(detail.monthlyAmount)) : "Not set"}
                              tone={Number(detail.monthlyAmount) > 0 ? undefined : "warn"}
                            />
                            <Fact
                              label="Interval"
                              value={
                                (detail.retainerInterval ?? "MONTHLY") === "WEEKLY"
                                  ? "Every 7 days"
                                  : (detail.retainerInterval ?? "MONTHLY") === "BIWEEKLY"
                                    ? "Every 15 days"
                                    : "Monthly"
                              }
                            />
                            <Fact label="Billing day" value={detail.billingDayOfMonth ? `Day ${detail.billingDayOfMonth}` : "Not set"} />
                            <Fact label="Auto-generate" value={detail.autoGenerateInvoice === false ? "Off" : "On"} />
                            <Fact label="Last billed cycle" value={detail.lastAutoInvoiceCycle ?? "—"} />
                          </>
                        )}
                      </div>
                      {detail.notes && (
                        <div className="mt-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
                          <p className="mt-1.5 whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                            {detail.notes}
                          </p>
                        </div>
                      )}
                    </section>

                    <section>
                      <SectionTitle icon={<Gauge className="size-3.5" />} title="Health history" hint="Latest snapshots, newest first" />
                      <div className="mt-2 flex max-h-[240px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.healthLogs.length === 0 && <p className="text-[11.5px] text-muted-foreground">No history yet</p>}
                        {detail.healthLogs.slice(0, 8).map((h, i) => (
                          <div key={h.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-1.5 text-[11.5px]">
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                h.score >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : h.score >= 40 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
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
                        title={`Contacts (${detail.contacts.length})`}
                        action={
                          canEdit ? (
                            <button
                              type="button"
                              onClick={() => setContactModal({ open: true })}
                              className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:underline"
                            >
                              <UserPlus className="size-3" /> Add
                            </button>
                          ) : undefined
                        }
                      />
                      <div className="mt-2 flex max-h-[260px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.contacts.length === 0 && (
                          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-muted-foreground">
                            No contacts yet
                          </p>
                        )}
                        {detail.contacts.map((c) => (
                          <div key={c.id} className="group/contact flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                            <Avatar name={c.name} size="size-7" />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                                <span className="truncate">{c.name}</span>
                                {c.isPrimary && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">PRIMARY</span>}
                                {c.portalAccessEnabled && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">PORTAL</span>}
                              </p>
                              <p className="truncate text-[10.5px] text-muted-foreground">
                                {[c.roleTitle, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/contact:opacity-100 focus-within:opacity-100">
                              {c.phone && (
                                <QuickIcon href={`tel:${c.phone}`} label={`Call ${c.name}`}>
                                  <Phone className="size-3" />
                                </QuickIcon>
                              )}
                              {c.email && (
                                <QuickIcon href={`mailto:${c.email}`} label={`Email ${c.name}`}>
                                  <Mail className="size-3" />
                                </QuickIcon>
                              )}
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Edit ${c.name}`}
                                    onClick={() => setContactModal({ open: true, initial: c })}
                                    className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${c.name}`}
                                    onClick={() => setDeleteTarget(c)}
                                    className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <SectionTitle
                        icon={<FileText className="size-3.5" />}
                        title={`Documents (${detail.documents.length})`}
                        action={
                          canEdit ? (
                            <button
                              type="button"
                              onClick={() => setDocModalOpen(true)}
                              className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:underline"
                            >
                              <Plus className="size-3" /> Attach
                            </button>
                          ) : undefined
                        }
                      />
                      <div className="mt-2 flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {detail.documents.length === 0 && (
                          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-muted-foreground">
                            No MOU, proposal or brand assets attached
                          </p>
                        )}
                        {detail.documents.map((d) => (
                          <div key={d.id} className="group/doc flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-semibold">{label(d.type)}</p>
                              <p className="truncate text-[10.5px] text-muted-foreground">
                                {d.uploadedBy?.name ?? "unknown"} · {timeAgo(d.uploadedAt)}
                              </p>
                            </div>
                            {isSafeUrl(d.fileUrl) ? (
                              <a
                                href={d.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10.5px] font-bold text-primary hover:bg-muted"
                              >
                                Open
                              </a>
                            ) : (
                              <span
                                className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10.5px] font-bold text-amber-600 dark:text-amber-400"
                                title="This link is not a valid web address and was blocked for safety"
                              >
                                Invalid link
                              </span>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                aria-label={`Remove ${label(d.type)}`}
                                onClick={() => setDocDelete({ id: d.id, label: label(d.type) })}
                                className="shrink-0 rounded-lg p-1 text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-500 group-hover/doc:opacity-100"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {/* PROJECTS */}
              {detailTab === "projects" && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Filter</span>
                    <button
                      type="button"
                      onClick={() => setProjectStatusFilter(null)}
                      className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", !projectStatusFilter ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card text-muted-foreground hover:text-foreground")}
                    >
                      All ({projectCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectStatusFilter((p) => (p === "__attention" ? null : "__attention"))}
                      className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", projectStatusFilter === "__attention" ? "border-rose-500 bg-rose-500 text-white" : "border-rose-500/40 bg-rose-500/5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300")}
                      title="Projects that are at risk or delayed"
                    >
                      Needs attention ({(projStatusCounts["AT_RISK"] ?? 0) + (projStatusCounts["DELAYED"] ?? 0)})
                    </button>
                    {Object.entries(projStatusCounts).map(([st, cnt]) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setProjectStatusFilter((prev) => (prev === st ? null : st))}
                        className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", projectStatusFilter === st ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card text-muted-foreground hover:text-foreground")}
                      >
                        {label(st)} ({cnt})
                      </button>
                    ))}
                    <span className="ml-auto hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
                      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> {projStatusCounts["ON_TRACK"] ?? 0} on track</span>
                      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" /> {projStatusCounts["AT_RISK"] ?? 0} at risk</span>
                      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" /> {projStatusCounts["DELAYED"] ?? 0} delayed</span>
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
                              {p.budgetAmount ? <span className="font-semibold tabular-nums text-foreground">{money(p.budgetAmount)}</span> : <span>No budget</span>}
                              {p.targetEndDate ? <span>· ends {formatDate(p.targetEndDate)}</span> : null}
                              {p.riskScore != null ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">risk {p.riskScore}</span> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={p.status} />
                            {p.healthStatus && <StatusBadge status={p.healthStatus} />}
                            <a
                              href={`/flow/${p.id}`}
                              onClick={(e) => { e.preventDefault(); setSelectedId(null); router.push(`/flow/${p.id}`); }}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-muted"
                              title={`Open ${p.name} in Flow`}
                            >
                              Open project <ExternalLink className="size-3" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <a
                    href={`/flow?clientId=${detail.id}`}
                    onClick={(e) => { e.preventDefault(); setSelectedId(null); router.push(`/flow?clientId=${detail.id}`); }}
                    className="inline-flex items-center gap-1 self-start text-[11.5px] font-bold text-primary hover:underline"
                  >
                    View all projects in Flow <ExternalLink className="size-3.5" />
                  </a>
                </div>
              )}

              {/* BILLING */}
              {detailTab === "invoices" && (
                <div className="flex flex-col gap-5">
                  <div>
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Wallet className="size-3.5" /> Aging buckets
                    </h4>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      {[
                        { key: "current", label: "Current", value: aging.current, tone: "emerald" },
                        { key: "d30", label: "1–30d", value: aging.d30, tone: "amber" },
                        { key: "d60", label: "31–60d", value: aging.d60, tone: "amber" },
                        { key: "d90", label: "61–90d", value: aging.d90, tone: "orange" },
                        { key: "d90p", label: "90d+", value: aging.d90p, tone: "rose" },
                      ].map((b) => {
                        const pct = maxAging > 0 ? Math.round((b.value / maxAging) * 100) : 0;
                        const barTone = b.tone === "emerald" ? "bg-emerald-500" : b.tone === "amber" ? "bg-amber-500" : b.tone === "orange" ? "bg-orange-500" : "bg-rose-500";
                        const borderTone = b.tone === "emerald" ? "border-emerald-500/25 bg-emerald-500/5" : b.tone === "rose" ? "border-rose-500/25 bg-rose-500/5" : b.tone === "orange" ? "border-orange-500/25 bg-orange-500/5" : "border-amber-500/25 bg-amber-500/5";
                        return (
                          <div key={b.key} className={cn("rounded-xl border p-3", borderTone)}>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{b.label}</p>
                            <p className="mt-1 truncate text-[13px] font-black tabular-nums">{money(b.value)}</p>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className={cn("h-full rounded-full", barTone)} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <FileText className="size-3.5" /> Invoice status
                    </h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setInvoiceStatusFilter((p) => (p === "__overdue" ? null : "__overdue"))} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", invoiceStatusFilter === "__overdue" ? "border-rose-500 bg-rose-500 text-white" : "border-rose-500/40 bg-rose-500/5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300")}>
                        Overdue ({overdueCountList})
                      </button>
                      <button type="button" onClick={() => setInvoiceStatusFilter((p) => (p === "__unpaid" ? null : "__unpaid"))} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", invoiceStatusFilter === "__unpaid" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-500/40 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10 dark:text-amber-300")}>
                        Unpaid ({unpaidInvoices.length})
                      </button>
                      <button type="button" onClick={() => setInvoiceStatusFilter(null)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", !invoiceStatusFilter ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card text-muted-foreground hover:text-foreground")}>
                        All ({detail.invoices.length})
                      </button>
                      {Object.entries(invStatusCounts).map(([st, cnt]) => (
                        <button key={st} type="button" onClick={() => setInvoiceStatusFilter((prev) => (prev === st ? null : st))} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", invoiceStatusFilter === st ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card text-muted-foreground hover:text-foreground")}>
                          {label(st)} ({cnt})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Receipt className="size-3.5" /> Invoices ({filteredInvoices.length}{invoiceStatusFilter === "__overdue" ? " overdue" : invoiceStatusFilter === "__unpaid" ? " unpaid" : invoiceStatusFilter ? " filtered" : ""})

                    </h4>
                    {filteredInvoices.length === 0 ? (
                      <div className="mt-2">
                        <EmptyState title="No invoices" hint={invoiceStatusFilter ? "No invoices match this filter." : "No invoices for this client yet."} />
                      </div>
                    ) : (
                      <div className="mt-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
                        {filteredInvoices.map((inv) => {
                          const total = inv.total ?? inv.lineItems.reduce((s, li) => s + Number(li.amount), 0);
                          const paid = inv.paid ?? 0;
                          const due = Math.max(0, total - paid);
                          const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                          const isExpanded = expandedInvoiceId === inv.id;
                          const revenueTag = inv.lineItems.map((li) => li.revenueTag).filter(Boolean).join(", ") || "—";
                          const daysLate = due > 0 && inv.dueDate
                            ? Math.max(0, Math.floor((today0.getTime() - new Date(inv.dueDate).getTime()) / 86400000))
                            : 0;
                          const overdueNow = daysLate > 0 && !["DRAFT", "CANCELLED", "VOID"].includes(inv.status);
                          return (
                            <div
                              key={inv.id}
                              id={`client-invoice-${inv.id}`}
                              className={cn(
                                "overflow-hidden rounded-xl border bg-card scroll-mt-2",
                                overdueNow ? "border-rose-500/40 ring-1 ring-rose-500/20" : "border-border/60"
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setExpandedInvoiceId((prev) => (prev === inv.id ? null : inv.id))}
                                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                                aria-expanded={isExpanded}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                                    <span className="truncate">{inv.invoiceNumber}</span>
                                    {overdueNow && (
                                      <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[9px] font-bold text-rose-600 dark:text-rose-300">
                                        {daysLate}d overdue
                                      </span>
                                    )}
                                    <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">
                                      · {formatDate(inv.issueDate)}{inv.dueDate ? ` → ${formatDate(inv.dueDate)}` : ""}
                                    </span>
                                  </p>
                                  <p className="mt-0.5 text-[10.5px] text-muted-foreground sm:hidden">
                                    {formatDate(inv.issueDate)}{inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : ""}
                                  </p>
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{money(paid)} / {money(total)}</span>
                                  </div>
                                  <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
                                    Due {money(due)}
                                    {inv.project ? ` · ${inv.project.name}` : ""} · {revenueTag}
                                    {(inv.refunded ?? 0) > 0 ? ` · refunded ${money(inv.refunded)}` : ""}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <StatusBadge status={inv.status} />
                                  <span className="text-[12px] font-bold tabular-nums">{money(total)}</span>
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                                    {isExpanded ? <><ChevronUp className="size-3" /> Hide</> : <><ChevronDown className="size-3" /> Details</>}
                                  </span>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="border-t border-border/60 bg-muted/20 px-3 py-2">
                                  <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">Line items</p>
                                  <div className="mt-1.5 flex flex-col gap-1">
                                    {inv.lineItems.length === 0 ? (
                                      <p className="text-[11px] text-muted-foreground">No line items</p>
                                    ) : (
                                      inv.lineItems.map((li, idx) => (
                                        <div key={idx} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card px-2.5 py-1.5 text-[11.5px]">
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">
                                              {li.description || label(li.revenueTag)}
                                            </span>
                                            {Number(li.quantity) > 1 && Number(li.unitPrice) > 0 && (
                                              <span className="block truncate text-[9.5px] text-muted-foreground">
                                                {Number(li.quantity)} × {money(Number(li.unitPrice))} · {label(li.revenueTag)}
                                              </span>
                                            )}
                                          </span>
                                          <span className="shrink-0 font-bold tabular-nums">{money(Number(li.amount))}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                                    <span className="rounded-lg bg-card px-2 py-1 text-center">
                                      <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</span>
                                      <span className="font-bold tabular-nums">{money(total)}</span>
                                    </span>
                                    <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-center">
                                      <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-600">Paid</span>
                                      <span className="font-bold tabular-nums text-emerald-600">{money(paid)}</span>
                                    </span>
                                    <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-center">
                                      <span className="block text-[10px] font-bold uppercase tracking-widest text-rose-500">Due</span>
                                      <span className="font-bold tabular-nums text-rose-500">{money(due)}</span>
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                                    <p className="text-[10px] text-muted-foreground">
                                      Payments, installments &amp; reminders live in Capital.
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                      {daysLate > 0 && (
                                        <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[9.5px] font-bold text-rose-600 dark:text-rose-300">
                                          {daysLate} day{daysLate === 1 ? "" : "s"} overdue
                                        </span>
                                      )}
                                      <Link
                                        href={`/capital/invoices?clientId=${detail.id}&inv=${inv.id}`}
                                        className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90"
                                      >
                                        <ExternalLink className="size-3" /> Open invoice
                                      </Link>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <a
                      href={`/capital/invoices?clientId=${detail.id}`}
                      onClick={(e) => { e.preventDefault(); setSelectedId(null); router.push(`/capital/invoices?clientId=${detail.id}`); }}
                      className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-bold text-primary hover:underline"
                    >
                      Full billing in Capital <ExternalLink className="size-3.5" />
                    </a>
                  </div>

                  <div>
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Wallet className="size-3.5" /> Recent payments
                    </h4>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {!detail.payments?.length && <p className="text-[11.5px] text-muted-foreground">No payments recorded</p>}
                      {detail.payments?.slice(0, 5).map((p) => (
                        <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            {label(p.paymentMethod)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-semibold">{p.invoice.invoiceNumber}</p>
                            <p className="text-[10.5px] text-muted-foreground">
                              {formatDate(p.paymentDate)}{p.referenceId ? ` · ${p.referenceId}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                            +{money(Number(p.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <ClientFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users ?? []}
        onSaved={() => {
          notify("Client created");
          reload();
        }}
      />
      <ClientFormModal
        open={!!editClient}
        onClose={() => setEditClient(null)}
        users={users ?? []}
        initial={editClient}
        onSaved={() => {
          notify("Client updated");
          reload();
        }}
      />
      <ContactFormModal
        open={contactModal.open}
        onClose={() => setContactModal({ open: false })}
        clientId={selectedId ?? ""}
        clientName={detail?.companyName}
        initial={contactModal.initial ?? null}
        onSaved={() => {
          notify("Contact saved");
          reload();
        }}
      />
      <DocumentFormModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        clientId={selectedId ?? ""}
        onSaved={() => {
          notify("Document attached");
          reload();
        }}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget === "client" ? "Archive or delete client" : "Remove contact?"}
      >
        {deleteTarget === "client" ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">{detail?.companyName}</strong> has{" "}
              {detail?.invoiceCount ?? 0} invoice{(detail?.invoiceCount ?? 0) === 1 ? "" : "s"} and{" "}
              {detail?.projectCount ?? 0} project{(detail?.projectCount ?? 0) === 1 ? "" : "s"}.
            </p>
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
              Archiving keeps every invoice, project and health log. Deleting is only possible for a client with no
              billing history and cannot be undone.
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              {(detail?.invoiceCount ?? 0) === 0 && (detail?.projectCount ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={deleteClient}
                  className="rounded-xl border border-rose-500/40 px-4 py-2 text-[12.5px] font-bold text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  Delete permanently
                </button>
              )}
              <button
                type="button"
                onClick={archiveClient}
                className="rounded-xl bg-primary px-4 py-2 text-[12.5px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Archive className="mr-1 inline size-3.5" /> Archive client
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Remove <strong className="text-foreground">{deleteTarget?.name}</strong> from this client? The health score
              will be recomputed.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteTarget && removeContact(deleteTarget.id)}
                className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-rose-500/90"
              >
                Remove contact
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!docDelete} onClose={() => setDocDelete(null)} title="Remove document?">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Remove <strong className="text-foreground">{docDelete?.label}</strong> from this client?
          The file itself is not deleted — only the link on this record.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDocDelete(null)}
            className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const target = docDelete;
              setDocDelete(null);
              if (target) void removeDocument(target.id);
            }}
            className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-rose-500/90"
          >
            Remove
          </button>
        </div>
      </Modal>

      <CollectionsModal
        open={collectionsOpen}
        mode={collectionsMode}
        onClose={() => setCollectionsOpen(false)}
        onOpenClient={(clientId, tab) => {
          setCollectionsOpen(false);
          if (!clientId) return;
          if (tab === "projects") openClientProjects(clientId);
          else openClientBilling(clientId, "unpaid");
        }}
      />
    </div>
  );
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-primary">
      {children}
      <button type="button" onClick={onClear} aria-label="Remove filter" className="rounded-full p-0.5 hover:bg-primary/15">
        <X className="size-3" />
      </button>
    </span>
  );
}

const FOCUS_TONES: Record<string, { wrap: string; icon: string }> = {
  rose: { wrap: "hover:bg-rose-500/5", icon: "bg-rose-500/10 text-rose-500" },
  amber: { wrap: "hover:bg-amber-500/5", icon: "bg-amber-500/10 text-amber-500" },
  sky: { wrap: "hover:bg-sky-500/5", icon: "bg-sky-500/10 text-sky-500" },
  emerald: { wrap: "hover:bg-emerald-500/5", icon: "bg-emerald-500/10 text-emerald-500" },
};

function FocusTile({
  icon,
  label: title,
  value,
  hint,
  tone,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof FOCUS_TONES;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-start gap-3 px-4 py-3 text-left transition-colors disabled:cursor-default disabled:opacity-60",
        FOCUS_TONES[tone].wrap,
        active && "bg-primary/5 ring-1 ring-inset ring-primary/30"
      )}
    >
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl", FOCUS_TONES[tone].icon)}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="mt-0.5 block text-[18px] font-heading font-bold leading-tight tabular-nums">{value}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{hint}</span>
      </span>
      {!disabled && <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />}
    </button>
  );
}
