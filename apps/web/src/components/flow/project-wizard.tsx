"use client";

/**
 * New / edit project wizard.
 *
 * The old form was one long scroll where everything was visible at once and a
 * single red line at the bottom reported every mistake. This version is a
 * 4-step flow (basics → commercials → team & links → milestones) with:
 *   · a stepper you can jump back through,
 *   · inline, per-field validation,
 *   · a live summary rail so the numbers are visible while typing,
 *   · quick-add for a client that does not exist yet,
 *   · a success screen after create (with the milestones that were created).
 * Edit mode reuses the same steps but skips the milestone step — milestones are
 * managed from the project workspace.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Facebook,
  Flag,
  Globe,
  Instagram,
  Link2,
  Linkedin,
  Loader2,
  Music2,
  Package,
  Plus,
  Repeat,
  Rocket,
  Search,
  Sparkles,
  Trash2,
  Twitter,
  Users,
  Wallet,
  Youtube,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Input, Modal, Select, Textarea } from "@/components/ui";
import { ImagePicker } from "@/components/media/image-picker";

/* ─────────────────────────────── constants ─────────────────────────────── */

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID", "OVERDUE"];
const BILLING_INTERVALS = ["7-days", "15-days", "30-days", "monthly"];
const CURRENCIES = ["BDT", "USD", "SAR", "AED"];
const CATEGORIES = [
  "Branding",
  "Web Development",
  "Video Production",
  "App Development",
  "Performance Marketing",
  "Influencer Marketing",
  "Content Retainer",
  "Social Media",
  "SEO",
  "Other",
];
const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];

const TYPES = [
  { value: "FIXED", label: "Fixed price", hint: "One-off deliverable", icon: Package },
  { value: "RETAINER", label: "Retainer", hint: "Ongoing monthly work", icon: Repeat },
  { value: "CAMPAIGN", label: "Campaign", hint: "Time-boxed push", icon: Rocket },
];

const STATUS_HINT: Record<string, string> = {
  PLANNING: "Not started",
  ACTIVE: "In delivery",
  PAUSED: "On hold",
  COMPLETED: "Delivered",
  ARCHIVED: "Closed",
};

const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$", SAR: "SAR ", AED: "AED " };
const label = (v: string) => v.replace(/_/g, " ").toLowerCase();
const todayISO = () => new Date().toISOString().slice(0, 10);

function money(v: number | null | undefined, currency: string) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${CURRENCY_SYMBOL[currency] ?? ""}${Math.round(v).toLocaleString("en-US")}`;
}

function computeNextBilling(start: string, interval: string): string {
  if (!start || !interval) return "";
  const s = new Date(start);
  if (interval === "monthly") {
    const d = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  }
  const days = interval === "7-days" ? 7 : interval === "15-days" ? 15 : 30;
  return new Date(s.getTime() + days * 86400000).toISOString().slice(0, 10);
}

function addMonths(date: string, months: number) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

/* ──────────────────────────────── types ──────────────────────────────── */

export interface WizardProjectRow {
  id: string;
  name: string;
  status?: string;
  priority?: string | null;
  category?: string | null;
  type?: string | null;
  templateId?: string | null;
  tasksTotal?: number;
  amount?: number | null;
  budgetAmount?: number | null;
  spentAmount?: number | null;
  budgetSpent?: number | null;
  progress?: number | null;
  currency?: string | null;
  startDate?: string | null;
  targetEndDate?: string | null;
  billingType?: string | null;
  recurringInterval?: string | null;
  nextBillingDate?: string | null;
  monthlyRate?: number | null;
  totalBilled?: number | null;
  paymentStatus?: string | null;
  description?: string | null;
  projectLink?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  logoJxlUrl?: string | null;
  socialLinks?: Record<string, string> | null;
  briefLink?: string | null;
  driveLink?: string | null;
  researchLink?: string | null;
  team?: string[] | null;
  client: { id: string; companyName: string };
  assignedPm?: { id: string; name: string } | null;
}

interface ClientLite {
  id: string;
  companyName: string;
}
interface PersonLite {
  id: string;
  name: string;
  designation?: string | null;
  role?: string | null;
}
interface TemplateLite {
  id: string;
  name: string;
  description?: string | null;
  benchmarkDurationDays?: number | null;
  benchmarkHours?: number | null;
  defaultTaskList?: string[] | null;
}

interface FormState {
  name: string;
  clientId: string;
  templateId: string;
  status: string;
  priority: string;
  category: string;
  type: string;
  assignedPmId: string;
  amount: string;
  spentAmount: string;
  progress: string;
  currency: string;
  startDate: string;
  targetEndDate: string;
  billingType: string;
  recurringInterval: string;
  nextBillingDate: string;
  monthlyRate: string;
  totalBilled: string;
  paymentStatus: string;
  description: string;
  projectLink: string;
  websiteUrl: string;
  socialLinks: { facebook: string; linkedin: string; instagram: string; youtube: string; tiktok: string; x: string };
  briefLink: string;
  driveLink: string;
  researchLink: string;
  team: string[];
}

interface MilestoneDraft {
  key: string;
  name: string;
  dueDate: string;
}

const blankForm = (): FormState => ({
  name: "",
  clientId: "",
  templateId: "",
  status: "PLANNING",
  priority: "MEDIUM",
  category: "",
  type: "FIXED",
  assignedPmId: "",
  amount: "",
  spentAmount: "",
  progress: "0",
  currency: "BDT",
  startDate: todayISO(),
  targetEndDate: "",
  billingType: "ONE_TIME",
  recurringInterval: "30-days",
  nextBillingDate: "",
  monthlyRate: "",
  totalBilled: "",
  paymentStatus: "PENDING",
  description: "",
  projectLink: "",
  websiteUrl: "",
  socialLinks: { facebook: "", linkedin: "", instagram: "", youtube: "", tiktok: "", x: "" },
  briefLink: "",
  driveLink: "",
  researchLink: "",
  team: [],
});

function formFromProject(p: WizardProjectRow): FormState {
  const sl = (p.socialLinks ?? {}) as Record<string, string>;
  const amount = p.amount ?? p.budgetAmount ?? null;
  const spent = p.spentAmount ?? p.budgetSpent ?? null;
  return {
    name: p.name ?? "",
    clientId: p.client?.id ?? "",
    templateId: p.templateId ?? "",
    status: p.status ?? "PLANNING",
    priority: p.priority ?? "MEDIUM",
    category: p.category ?? "",
    type: p.type ?? "FIXED",
    assignedPmId: p.assignedPm?.id ?? "",
    amount: amount != null ? String(amount) : "",
    spentAmount: spent != null ? String(spent) : "",
    progress: p.progress != null ? String(p.progress) : "0",
    currency: p.currency ?? "BDT",
    startDate: p.startDate ? String(p.startDate).slice(0, 10) : "",
    targetEndDate: p.targetEndDate ? String(p.targetEndDate).slice(0, 10) : "",
    billingType: p.billingType ?? "ONE_TIME",
    recurringInterval: p.recurringInterval ?? "30-days",
    nextBillingDate: p.nextBillingDate ? String(p.nextBillingDate).slice(0, 10) : "",
    monthlyRate: p.monthlyRate != null ? String(p.monthlyRate) : "",
    totalBilled: p.totalBilled != null ? String(p.totalBilled) : "",
    paymentStatus: p.paymentStatus ?? "PENDING",
    description: p.description ?? "",
    projectLink: p.projectLink ?? "",
    websiteUrl: p.websiteUrl ?? "",
    socialLinks: {
      facebook: sl.facebook ?? "",
      linkedin: sl.linkedin ?? "",
      instagram: sl.instagram ?? "",
      youtube: sl.youtube ?? "",
      tiktok: sl.tiktok ?? "",
      x: sl.x ?? "",
    },
    briefLink: p.briefLink ?? "",
    driveLink: p.driveLink ?? "",
    researchLink: p.researchLink ?? "",
    team: Array.isArray(p.team) ? p.team : [],
  };
}

/* ──────────────────────────── small building blocks ──────────────────────────── */

function FieldShell({
  label: text,
  required,
  hint,
  error,
  children,
  className,
  as = "label",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  /** Use `div` when the field holds buttons, so label activation cannot hijack clicks. */
  as?: "label" | "div";
}) {
  const Root = as as any;
  return (
    <Root className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-meta font-semibold text-muted-foreground">
        {text}
        {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-micro font-semibold text-rose-500">{error}</span>
      ) : hint ? (
        <span className="text-micro text-muted-foreground/70">{hint}</span>
      ) : null}
    </Root>
  );
}

const errRing = "border-rose-500/60 focus:border-rose-500/60 focus:ring-rose-500/20";

function Card({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && <p className="font-heading text-body font-bold leading-tight">{title}</p>}
            {hint && <p className="mt-0.5 text-micro leading-snug text-muted-foreground">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function Pill({
  active,
  onClick,
  children,
  tone = "primary",
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "primary" | "amber" | "rose" | "emerald" | "sky";
  className?: string;
}) {
  const tones: Record<string, string> = {
    primary: "border-primary/40 bg-primary/12 text-primary",
    amber: "border-amber-500/40 bg-amber-500/12 text-amber-600 dark:text-amber-400",
    rose: "border-rose-500/40 bg-rose-500/12 text-rose-600 dark:text-rose-400",
    emerald: "border-emerald-500/40 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    sky: "border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors",
        active ? tones[tone] : "border-border bg-muted/30 text-muted-foreground hover:border-primary/25 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function StepRail({
  steps,
  step,
  reachable,
  onPick,
}: {
  steps: { title: string; hint: string }[];
  step: number;
  reachable: (i: number) => boolean;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = i < step;
        const active = i === step;
        const can = reachable(i);
        return (
          <div key={s.title} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => can && onPick(i)}
              disabled={!can}
              className={cn(
                "group flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-left transition-colors",
                can ? "hover:bg-muted/50" : "cursor-not-allowed"
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-meta font-bold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span
                  className={cn(
                    "block truncate text-meta font-bold leading-tight",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {s.title}
                </span>
                <span className="block truncate text-micro leading-tight text-muted-foreground/70">{s.hint}</span>
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={cn("hidden h-px w-4 shrink-0 sm:block", done ? "bg-primary/50" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────── client picker ──────────────────────────── */

function ClientPicker({
  clients,
  value,
  onChange,
  onClientCreated,
  error,
}: {
  clients: ClientLite[];
  value: string;
  onChange: (id: string) => void;
  onClientCreated?: () => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ companyName: "", industryVertical: "OTHER", contactName: "", contactEmail: "", contactPhone: "" });
  const [err, setErr] = useState<string | null>(null);
  // Clients created from this picker — the parent list refetches, but showing
  // them here immediately keeps the selected name from flashing back to empty.
  const [createdClients, setCreatedClients] = useState<ClientLite[]>([]);

  const all = useMemo(
    () => [...createdClients.filter((c) => !clients.some((x) => x.id === c.id)), ...clients],
    [clients, createdClients]
  );

  const selected = all.find((c) => c.id === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.companyName?.toLowerCase().includes(q));
  }, [all, query]);

  const close = () => {
    setOpen(false);
    setMode("list");
    setQuery("");
    setErr(null);
  };

  const createClient = async () => {
    if (!form.companyName.trim()) return setErr("Company name is required");
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<any>("/accounts/clients", {
        method: "POST",
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          industryVertical: form.industryVertical,
          category: "ACTIVE",
          billingCycleType: "PROJECT_BASED",
          primaryContact: form.contactName.trim()
            ? {
                name: form.contactName.trim(),
                email: form.contactEmail.trim() || null,
                phone: form.contactPhone.trim() || null,
              }
            : undefined,
        }),
      });
      if (created?.id) {
        setCreatedClients((prev) => [
          { id: created.id, companyName: created.companyName ?? form.companyName.trim() },
          ...prev,
        ]);
        onChange(created.id);
      }
      onClientCreated?.();
      setForm({ companyName: "", industryVertical: "OTHER", contactName: "", contactEmail: "", contactPhone: "" });
      close();
    } catch (e: any) {
      setErr(e?.message ?? "Could not create client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-body-lg outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/20",
          error && errRing
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <Avatar name={selected.companyName} size="size-5" />
              <span className="truncate font-medium">{selected.companyName}</span>
            </>
          ) : (
            <span className="text-muted-foreground/70">Choose a client…</span>
          )}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close client list" className="fixed inset-0 z-10 cursor-default" onClick={close} />
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-primary/5">
            {mode === "list" ? (
              <>
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search clients…"
                    className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onChange(c.id);
                        close();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body transition-colors hover:bg-muted/60",
                        c.id === value && "bg-primary/8 font-semibold text-primary"
                      )}
                    >
                      <Avatar name={c.companyName} size="size-5" />
                      <span className="truncate">{c.companyName}</span>
                      {c.id === value && <Check className="ml-auto size-3.5" />}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="px-3 py-4 text-center text-meta text-muted-foreground">
                      No client matches “{query}”
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2.5 text-body font-bold text-primary transition-colors hover:bg-primary/5"
                >
                  <Plus className="size-3.5" /> Add a new client
                </button>
              </>
            ) : (
              <div className="space-y-2.5 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-heading text-body font-bold">Quick add client</p>
                  <button
                    type="button"
                    onClick={() => setMode("list")}
                    className="text-meta font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Back
                  </button>
                </div>
                <Input
                  autoFocus
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  placeholder="Company name *"
                  className="text-body"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={form.industryVertical}
                    onChange={(e) => setForm({ ...form, industryVertical: e.target.value })}
                    className="text-body"
                  >
                    {VERTICALS.map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    placeholder="Contact person"
                    className="text-body"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                    placeholder="Email"
                    className="text-body"
                  />
                  <Input
                    value={form.contactPhone}
                    onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    placeholder="Phone"
                    className="text-body"
                  />
                </div>
                {err && <p className="text-meta font-semibold text-rose-500">{err}</p>}
                <div className="flex justify-end gap-2">
                  <Btn variant="outline" onClick={close}>
                    Cancel
                  </Btn>
                  <Btn variant="primary" onClick={createClient} disabled={busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    {busy ? "Creating…" : "Create client"}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────── summary rail ──────────────────────────── */

function SummaryRail({
  f,
  clients,
  managers,
  milestoneCount,
  editing,
  step,
  steps,
}: {
  f: FormState;
  clients: ClientLite[];
  managers: PersonLite[];
  milestoneCount: number;
  editing: boolean;
  step: number;
  steps: number;
}) {
  const client = clients.find((c) => c.id === f.clientId);
  const pm = managers.find((m) => m.id === f.assignedPmId);
  const amountNum = f.amount ? Number(f.amount) : null;
  const days = daysBetween(f.startDate, f.targetEndDate);
  const checklist = [
    { label: "Client selected", done: !!f.clientId },
    { label: "Project named", done: !!f.name.trim() },
    { label: "Budget set", done: !!(f.amount && Number(f.amount) > 0) },
    { label: "Timeline scheduled", done: !!(f.startDate && f.targetEndDate) },
    { label: "Team assigned", done: f.team.length > 0 },
    { label: editing ? "Manager assigned" : "Milestones planned", done: editing ? !!f.assignedPmId : milestoneCount > 0 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <aside className="hidden w-[268px] shrink-0 flex-col gap-3 lg:flex">
      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
        <p className="text-micro font-bold uppercase tracking-[0.14em] text-muted-foreground">Live summary</p>
        <div className="mt-2.5 flex items-center gap-2">
          <Avatar name={client?.companyName ?? "?"} size="size-7" />
          <div className="min-w-0">
            <p className="truncate text-body font-semibold">{client?.companyName ?? "No client yet"}</p>
            <p className="text-micro text-muted-foreground">{f.category || label(f.type)}</p>
          </div>
        </div>
        <p className="mt-2.5 truncate font-heading text-body-lg font-bold leading-snug">
          {f.name.trim() || (editing ? "Untitled project" : "New project")}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border/60 bg-card px-2.5 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Value</p>
            <p className="mt-0.5 truncate text-body font-bold tabular-nums">{money(amountNum, f.currency)}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card px-2.5 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Timeline</p>
            <p className="mt-0.5 truncate text-body font-bold tabular-nums">
              {days != null && days >= 0 ? `${days} days` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card px-2.5 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Billing</p>
            <p className="mt-0.5 truncate text-body font-bold">
              {f.billingType === "RECURRING" ? f.recurringInterval : "one-time"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card px-2.5 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
              {editing ? "Manager" : "Milestones"}
            </p>
            <p className="mt-0.5 truncate text-body font-bold">
              {editing ? pm?.name?.split(" ")[0] ?? "—" : milestoneCount}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-micro font-semibold text-muted-foreground">
            {label(f.status)}
          </span>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-micro font-semibold text-muted-foreground">
            {label(f.priority)} priority
          </span>
          {f.team.length > 0 && (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-micro font-semibold text-muted-foreground">
              {f.team.length} member{f.team.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-micro font-semibold text-muted-foreground">
            <span>
              Step {step + 1} of {steps}
            </span>
            <span>{Math.round(((step + 1) / steps) * 100)}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((step + 1) / steps) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-muted-foreground">Checklist</p>
          <span className="text-micro font-bold tabular-nums text-muted-foreground">
            {doneCount}/{checklist.length}
          </span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-meta">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  c.done ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-500" : "border-border text-transparent"
                )}
              >
                <Check className="size-3.5" />
              </span>
              <span className={c.done ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 rounded-lg bg-muted/60 px-2 py-1.5 text-micro leading-snug text-muted-foreground">
          {editing ? "Changes are saved when you press Save." : "Nothing is saved until the last step."}
        </p>
      </div>
    </aside>
  );
}

/* ──────────────────────────── main wizard ──────────────────────────── */

export function ProjectModal({
  open,
  onClose,
  editing,
  clients,
  managers,
  employees,
  templates,
  onSaved,
  onClientCreated,
}: {
  open: boolean;
  onClose: () => void;
  editing: WizardProjectRow | null;
  clients: ClientLite[];
  managers: PersonLite[] | null;
  employees: PersonLite[] | null;
  templates: TemplateLite[] | null;
  onSaved: () => void;
  onClientCreated?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(blankForm);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [milestoneHint, setMilestoneHint] = useState<string | null>(null);
  const [empQuery, setEmpQuery] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; added: number; requested: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Logo upload persists immediately, so the preview cannot come from `editing`
  // (the parent keeps the pre-upload row until the modal is reopened).
  const [logo, setLogo] = useState<{ url: string | null; jxl: string | null }>({ url: null, jxl: null });
  useEffect(() => {
    setLogo({ url: editing?.logoUrl ?? null, jxl: editing?.logoJxlUrl ?? null });
  }, [editing?.id, open]);

  const isEditing = !!editing;
  const clientOptions = clients;

  const stepDefs = useMemo(
    () =>
      isEditing
        ? [
            { title: "Basics", hint: "Client, scope and dates" },
            { title: "Commercials", hint: "Budget and billing" },
            { title: "Team & links", hint: "People and assets" },
          ]
        : [
            { title: "Basics", hint: "Client, scope and dates" },
            { title: "Commercials", hint: "Budget and billing" },
            { title: "Team & links", hint: "People and assets" },
            { title: "Milestones", hint: "Delivery checkpoints" },
          ],
    [isEditing]
  );
  const LAST = stepDefs.length - 1;

  useEffect(() => {
    if (!open) return;
    setF(editing ? formFromProject(editing) : blankForm());
    setStep(0);
    setMaxStep(0);
    setErrors({});
    setApiError(null);
    setMilestones([]);
    setMilestoneHint(null);
    setEmpQuery("");
    setCreated(null);
  }, [open, editing]);

  useEffect(() => {
    if (isEditing) setMaxStep(Math.max(maxStep, LAST));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, LAST]);

  // Each step starts at the top of its own content, not where the last one ended.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((p) => ({ ...p, [key]: value }));  const setSocial = (key: keyof FormState["socialLinks"], value: string) =>
    setF((p) => ({ ...p, socialLinks: { ...p.socialLinks, [key]: value } }));

  const effectiveNextBilling = useMemo(() => {
    if (f.billingType === "ONE_TIME") return "";
    return f.nextBillingDate || computeNextBilling(f.startDate, f.recurringInterval);
  }, [f.billingType, f.nextBillingDate, f.startDate, f.recurringInterval]);

  /* ── validation ─────────────────────────────────────────────────────── */

  const validateAll = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Project name is required";
    else if (f.name.trim().length > 120) e.name = "Keep the name under 120 characters";
    if (!f.clientId) e.clientId = "Select a client (or create one)";
    if (f.amount && Number(f.amount) < 0) e.amount = "Amount cannot be negative";
    if (f.billingType === "RECURRING" && !(Number(f.monthlyRate) >= 1)) e.monthlyRate = "Monthly rate is required";
    if (f.startDate && f.targetEndDate && new Date(f.startDate) > new Date(f.targetEndDate))
      e.targetEndDate = "Due date must be after the start date";
    if (f.description.length > 2000) e.description = "Keep the description under 2000 characters";
    const urls: [string, string][] = [
      ["projectLink", f.projectLink],
      ["websiteUrl", f.websiteUrl],
    ];
    for (const [key, value] of urls) {
      if (value.trim() && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#]\S*)?$/i.test(value.trim()))
        e[key] = "Enter a valid URL";
    }
    return e;
  };

  const fieldsByStep: string[][] = [
    ["name", "clientId", "startDate", "targetEndDate", "description", "category"],
    ["amount", "spentAmount", "monthlyRate", "totalBilled", "nextBillingDate"],
    ["projectLink", "websiteUrl", "briefLink", "driveLink", "researchLink"],
  ];

  const goNext = () => {
    const all = validateAll();
    setErrors(all);
    setApiError(null);
    const stepKeys = fieldsByStep[step] ?? [];
    if (stepKeys.some((k) => all[k])) return;
    const next = Math.min(step + 1, LAST);
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
  };

  const goBack = () => {
    setApiError(null);
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async () => {
    const all = validateAll();
    setErrors(all);
    const firstBadStep = fieldsByStep.findIndex((keys) => keys.some((k) => all[k]));
    if (firstBadStep >= 0) {
      setStep(firstBadStep);
      setMaxStep((m) => Math.max(m, firstBadStep));
      setApiError("Some required details are missing — check the highlighted fields.");
      return;
    }
    setBusy(true);
    setApiError(null);

    // On edit, "no handles left" must clear the stored object — `undefined`
    // would be dropped by the PATCH and silently keep the old links.
    const social = Object.values(f.socialLinks).some((v) => v.trim())
      ? Object.fromEntries(
          Object.entries(f.socialLinks)
            .map(([k, v]) => [k, v.trim()])
            .filter(([, v]) => v)
        )
      : isEditing
        ? null
        : undefined;
    const amountNum = f.amount ? Number(f.amount) : null;
    // On edit, blank means "clear it" — `undefined` would silently keep the old value.
    const cleared = (v: string) => v.trim() || (isEditing ? null : undefined);
    const body: any = {
      name: f.name.trim(),
      clientId: f.clientId,
      templateId: f.templateId || undefined,
      status: f.status,
      priority: f.priority,
      category: f.category.trim() || "General",
      type: f.type,
      assignedPmId: f.assignedPmId || (isEditing ? null : undefined),
      description: cleared(f.description),
      amount: amountNum,
      budgetAmount: amountNum,
      currency: f.currency,
      spentAmount: f.spentAmount ? Number(f.spentAmount) : null,
      progress: Math.min(100, Math.max(0, Number(f.progress) || 0)),
      startDate: f.startDate || null,
      targetEndDate: f.targetEndDate || null,
      billingType: f.billingType,
      recurringInterval: f.billingType === "RECURRING" ? f.recurringInterval : undefined,
      nextBillingDate: f.billingType === "RECURRING" ? effectiveNextBilling || null : null,
      monthlyRate: f.monthlyRate ? Number(f.monthlyRate) : null,
      totalBilled: f.totalBilled ? Number(f.totalBilled) : 0,
      paymentStatus: f.paymentStatus,
      projectLink: cleared(f.projectLink) ?? null,
      websiteUrl: cleared(f.websiteUrl) ?? null,
      socialLinks: social,
      briefLink: cleared(f.briefLink) ?? null,
      driveLink: cleared(f.driveLink) ?? null,
      researchLink: cleared(f.researchLink) ?? null,
      team: f.team,
    };

    try {
      if (isEditing && editing) {
        await apiFetch(`/flow/projects/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        onSaved();
        onClose();
        return;
      }

      const project = await apiFetch<{ id: string }>("/flow/projects", { method: "POST", body: JSON.stringify(body) });
      const requested = milestones.filter((m) => m.name.trim()).length;
      let added = 0;
      if (project?.id && requested > 0) {
        const results = await Promise.allSettled(
          milestones
            .filter((m) => m.name.trim())
            .map((m) =>
              apiFetch(`/flow/projects/${project.id}/milestones`, {
                method: "POST",
                body: JSON.stringify({ name: m.name.trim(), dueDate: m.dueDate || undefined }),
              })
            )
        );
        added = results.filter((r) => r.status === "fulfilled").length;
      }
      onSaved();
      setCreated({ id: project.id, name: body.name, added, requested });
    } catch (e: any) {
      setApiError(e?.message ?? (isEditing ? "Update failed" : "Create failed"));
    } finally {
      setBusy(false);
    }
  };

  /* ── milestone helpers ──────────────────────────────────────────────── */

  const addMilestoneRow = () =>
    setMilestones((rows) => [...rows, { key: Math.random().toString(36).slice(2), name: "", dueDate: "" }]);

  const removeMilestoneRow = (key: string) => setMilestones((rows) => rows.filter((r) => r.key !== key));

  const suggestMilestones = () => {
    if (!f.startDate || !f.targetEndDate) {
      setMilestoneHint("Add a start and due date in Basics first.");
      return;
    }
    const start = new Date(f.startDate).getTime();
    const end = new Date(f.targetEndDate).getTime();
    if (!(end > start)) {
      setMilestoneHint("The due date must be after the start date.");
      return;
    }
    const at = (p: number) => new Date(start + (end - start) * p).toISOString().slice(0, 10);
    setMilestones([
      { key: "m1", name: "Kickoff & briefing", dueDate: at(0.05) },
      { key: "m2", name: "First draft / design review", dueDate: at(0.35) },
      { key: "m3", name: "Production complete", dueDate: at(0.75) },
      { key: "m4", name: "Launch & handover", dueDate: at(1) },
    ]);
    setMilestoneHint(null);
  };

  /* ── team helpers ───────────────────────────────────────────────────── */

  const toggleTeam = (name: string) =>
    setF((p) => ({ ...p, team: p.team.includes(name) ? p.team.filter((t) => t !== name) : [...p.team, name] }));

  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees ?? [];
    return (employees ?? []).filter((e) => e.name?.toLowerCase().includes(q));
  }, [employees, empQuery]);

  const applyTemplate = (templateId: string) => {
    const t = (templates ?? []).find((x) => x.id === templateId);
    if (!t) return;
    const days = Number(t.benchmarkDurationDays ?? 0);
    setF((p) => {
      const start = p.startDate || todayISO();
      const target =
        days > 0 ? new Date(new Date(start).getTime() + days * 86400000).toISOString().slice(0, 10) : p.targetEndDate;
      return { ...p, templateId: t.id, targetEndDate: target };
    });
    setMilestoneHint(
      days > 0
        ? `${t.name}: ${days}-day benchmark applied · ${(t.defaultTaskList ?? []).length} starter tasks will be created`
        : `${t.name} selected`
    );
  };

  /* ── derived display ────────────────────────────────────────────────── */

  const activeMilestones = milestones.filter((m) => m.name.trim()).length;
  const reachable = (i: number) => isEditing || i <= maxStep;
  const title = created ? "Project created" : isEditing ? "Edit project" : "New project";
  const subtitle = created
    ? "Here is what was set up"
    : isEditing
      ? editing?.name ?? ""
      : "Four short steps — jump back any time";

  /* ── render ─────────────────────────────────────────────────────────── */

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="3xl"
      closeOnBackdrop={false}
      bodyClassName="flex min-h-0 flex-col overflow-hidden !p-0"
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-heading text-section font-bold leading-tight">{title}</p>
            <p className="truncate text-meta text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      }
    >
      {created ? (
        /* ── success screen ── */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <motion.span
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-500"
          >
            <CheckCircle2 className="size-3.5" />
          </motion.span>
          <div>
            <p className="font-heading text-title font-bold">{created.name}</p>
            <p className="mt-1 text-body text-muted-foreground">
              Saved to Flow for {clientOptions.find((c) => c.id === f.clientId)?.companyName ?? "the client"}.
            </p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-3 text-left">
            <div className="flex items-center justify-between text-meta">
              <span className="text-muted-foreground">Project ID</span>
              <span className="font-semibold">auto-generated</span>
            </div>
            <div className="flex items-center justify-between text-meta">
              <span className="text-muted-foreground">Billing</span>
              <span className="font-semibold">
                {f.billingType === "RECURRING" ? `recurring · ${f.recurringInterval}` : "one-time"}
              </span>
            </div>
            <div className="flex items-center justify-between text-meta">
              <span className="text-muted-foreground">Milestones</span>
              <span className="font-semibold">
                {created.requested > 0
                  ? `${created.added} of ${created.requested} added`
                  : "none added"}
              </span>
            </div>
            {f.startDate && (
              <div className="flex items-center justify-between text-meta">
                <span className="text-muted-foreground">Timeline</span>
                <span className="font-semibold">
                  {formatDate(f.startDate)} → {formatDate(f.targetEndDate)}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Btn variant="outline" onClick={onClose}>
              Close
            </Btn>
            <Btn
              variant="primary"
              onClick={() => {
                onClose();
                router.push(`/flow/${created.id}`);
              }}
            >
              Open project <ArrowRight className="size-3.5" />
            </Btn>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step < LAST) goNext();
            else void submit();
          }}
          className="flex min-h-[560px] flex-1 flex-col"
        >
          {/* stepper */}
          <div className="shrink-0 border-b border-border/60 px-5 py-3">
            <StepRail
              steps={stepDefs}
              step={step}
              reachable={reachable}
              onPick={(i) => {
                setStep(i);
                setErrors({});
                setApiError(null);
              }}
            />
            <p className="mt-1.5 text-micro font-semibold text-muted-foreground sm:hidden">
              Step {step + 1} of {stepDefs.length} · {stepDefs[step]?.title}
            </p>
          </div>

          {/* body */}
          <div ref={scrollRef} className="flex min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-4">
                {/* ── STEP 1 · BASICS ── */}
                {step === 0 && (
                  <>
                    <Card
                      title="Client & project"
                      hint="Project IDs are generated automatically."
                      action={
                        templates && templates.length > 0 && !isEditing ? (
                          <Select
                            value={f.templateId}
                            onChange={(e) => applyTemplate(e.target.value)}
                            className="!w-full !py-1.5 text-meta sm:!w-44"
                            aria-label="Start from template"
                          >
                            <option value="">Start from template…</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </Select>
                        ) : undefined
                      }
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldShell label="Client" required error={errors.clientId} as="div">
                          <ClientPicker
                            clients={clientOptions}
                            value={f.clientId}
                            onChange={(id) => {
                              set("clientId", id);
                              setErrors((p) => ({ ...p, clientId: "" }));
                            }}
                            onClientCreated={() => {
                              onClientCreated?.();
                            }}
                            error={errors.clientId}
                          />
                        </FieldShell>
                        <FieldShell label="Project name" required error={errors.name}>
                          <Input
                            autoFocus
                            value={f.name}
                            onChange={(e) => set("name", e.target.value)}
                            placeholder="e.g. Ramadan campaign — 2027"
                            className={cn(errors.name && errRing)}
                          />
                        </FieldShell>
                      </div>

                      <div className="mt-3">
                        <FieldShell label="Category" hint="Pick a preset or type your own." as="div">
                          <div className="flex flex-wrap gap-1.5">
                            {CATEGORIES.map((c) => (
                              <Pill
                                key={c}
                                active={f.category === c}
                                onClick={() => set("category", f.category === c ? "" : c)}
                              >
                                {c}
                              </Pill>
                            ))}
                          </div>
                          <Input
                            value={f.category}
                            onChange={(e) => set("category", e.target.value)}
                            placeholder="Custom category"
                            className="mt-2"
                          />
                        </FieldShell>
                      </div>
                    </Card>

                    <Card title="Nature of the work" hint="How it is sold, how urgent it is, and where it sits.">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {TYPES.map((t) => {
                          const Icon = t.icon;
                          const active = f.type === t.value;
                          return (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() => set("type", t.value)}
                              className={cn(
                                "flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors",
                                active
                                  ? "border-primary/50 bg-primary/8 ring-1 ring-primary/20"
                                  : "border-border bg-card hover:border-primary/25 hover:bg-muted/40"
                              )}
                            >
                              <span
                                className={cn(
                                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                                )}
                              >
                                <Icon className="size-3.5" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-meta font-bold leading-tight">{t.label}</span>
                                <span className="block text-micro leading-snug text-muted-foreground">{t.hint}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldShell label="Priority" as="div">
                          <div className="flex flex-wrap gap-1.5">
                            {PRIORITIES.map((p) => (
                              <Pill
                                key={p}
                                active={f.priority === p}
                                tone={p === "URGENT" ? "rose" : p === "HIGH" ? "amber" : p === "MEDIUM" ? "sky" : "primary"}
                                onClick={() => set("priority", p)}
                              >
                                {label(p)}
                              </Pill>
                            ))}
                          </div>
                        </FieldShell>
                        <FieldShell label="Status" hint={STATUS_HINT[f.status]} as="div">
                          <div className="flex flex-wrap gap-1.5">
                            {PROJECT_STATUSES.map((s) => (
                              <Pill
                                key={s}
                                active={f.status === s}
                                tone={s === "ACTIVE" ? "emerald" : s === "PAUSED" ? "amber" : s === "PLANNING" ? "sky" : "primary"}
                                onClick={() => set("status", s)}
                              >
                                {label(s)}
                              </Pill>
                            ))}
                          </div>
                        </FieldShell>
                      </div>
                    </Card>

                    <Card title="Timeline" hint="Start date, delivery window and a short scope note.">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldShell label="Start date">
                          <Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
                        </FieldShell>
                        <FieldShell label="Due date" error={errors.targetEndDate}>
                          <Input
                            type="date"
                            value={f.targetEndDate}
                            onChange={(e) => set("targetEndDate", e.target.value)}
                            className={cn(errors.targetEndDate && errRing)}
                          />
                        </FieldShell>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-micro font-semibold text-muted-foreground">Quick duration:</span>
                        {[1, 2, 3, 6].map((m) => {
                          const target = addMonths(f.startDate, m);
                          const active = !!target && target === f.targetEndDate;
                          return (
                            <Pill
                              key={m}
                              active={active}
                              onClick={() => target && set("targetEndDate", target)}
                              className="!px-2 !py-0.5"
                            >
                              {m} month{m > 1 ? "s" : ""}
                            </Pill>
                          );
                        })}
                        <Pill active={false} onClick={() => set("targetEndDate", "")} className="!px-2 !py-0.5">
                          Clear
                        </Pill>
                      </div>

                      <div className="mt-3">
                        <FieldShell
                          label="Description"
                          error={errors.description}
                          hint={`${f.description.length}/2000 — scope, deliverables, out of scope`}
                        >
                          <Textarea
                            value={f.description}
                            onChange={(e) => set("description", e.target.value)}
                            placeholder="What are we delivering, for whom, and what is explicitly out of scope?"
                            rows={3}
                            className={cn("min-h-[76px]", errors.description && errRing)}
                          />
                        </FieldShell>
                      </div>
                    </Card>
                  </>
                )}

                {/* ── STEP 2 · COMMERCIALS ── */}
                {step === 1 && (
                  <>
                    <Card title="Budget" hint="The contract value. Leave blank if it is not agreed yet.">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr_1fr]">
                        <FieldShell label="Currency">
                          <div className="flex flex-wrap gap-1.5">
                            {CURRENCIES.map((c) => (
                              <Pill key={c} active={f.currency === c} onClick={() => set("currency", c)}>
                                {c}
                              </Pill>
                            ))}
                          </div>
                        </FieldShell>
                        <FieldShell label="Project value" error={errors.amount}>
                          <Input
                            type="number"
                            min={0}
                            value={f.amount}
                            onChange={(e) => set("amount", e.target.value)}
                            placeholder="500000"
                            className={cn("text-section font-bold tabular-nums", errors.amount && errRing)}
                          />
                        </FieldShell>
                        <FieldShell label="Spent so far">
                          <Input
                            type="number"
                            min={0}
                            value={f.spentAmount}
                            onChange={(e) => set("spentAmount", e.target.value)}
                            placeholder="0"
                            className="tabular-nums"
                          />
                        </FieldShell>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                        <CircleDollarSign className="size-3.5" />
                        <span>
                          {f.amount ? money(Number(f.amount), f.currency) : "No value set"}
                          {f.spentAmount ? ` · ${money(Number(f.spentAmount), f.currency)} spent` : ""}
                          {f.amount && f.spentAmount
                            ? ` · ${Math.round((Number(f.spentAmount) / Math.max(Number(f.amount), 1)) * 100)}% burned`
                            : ""}
                        </span>
                      </div>
                    </Card>

                    <Card title="Billing" hint="One invoice, or a repeating retainer.">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {[
                          { value: "ONE_TIME", title: "One-time", hint: "Invoice on start, close on completion" },
                          { value: "RECURRING", title: "Recurring", hint: "Auto-repeat on a fixed interval" },
                        ].map((b) => {
                          const active = f.billingType === b.value;
                          return (
                            <button
                              key={b.value}
                              type="button"
                              onClick={() => set("billingType", b.value)}
                              className={cn(
                                "flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors",
                                active
                                  ? "border-primary/50 bg-primary/8 ring-1 ring-primary/20"
                                  : "border-border bg-card hover:border-primary/25 hover:bg-muted/40"
                              )}
                            >
                              <span
                                className={cn(
                                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                                )}
                              >
                                {b.value === "RECURRING" ? <Repeat className="size-3.5" /> : <Wallet className="size-3.5" />}
                              </span>
                              <span>
                                <span className="block text-meta font-bold leading-tight">{b.title}</span>
                                <span className="block text-micro text-muted-foreground">{b.hint}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {f.billingType === "RECURRING" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="mt-3 grid grid-cols-2 gap-3 overflow-hidden sm:grid-cols-4"
                        >
                          <FieldShell label="Interval">
                            <Select
                              value={f.recurringInterval}
                              onChange={(e) => set("recurringInterval", e.target.value)}
                            >
                              {BILLING_INTERVALS.map((i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </Select>
                          </FieldShell>
                          <FieldShell label="Monthly rate" required error={errors.monthlyRate}>
                            <Input
                              type="number"
                              min={1}
                              value={f.monthlyRate}
                              onChange={(e) => set("monthlyRate", e.target.value)}
                              placeholder="40000"
                              className={cn("tabular-nums", errors.monthlyRate && errRing)}
                            />
                          </FieldShell>
                          <FieldShell label="Total billed">
                            <Input
                              type="number"
                              min={0}
                              value={f.totalBilled}
                              onChange={(e) => set("totalBilled", e.target.value)}
                              placeholder="0"
                              className="tabular-nums"
                            />
                          </FieldShell>
                          <FieldShell label="Next billing">
                            <Input
                              type="date"
                              value={effectiveNextBilling}
                              onChange={(e) => set("nextBillingDate", e.target.value)}
                            />
                          </FieldShell>
                        </motion.div>
                      )}

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldShell label="Payment status" as="div">
                          <div className="flex flex-wrap gap-1.5">
                            {PAYMENT_STATUSES.map((s) => (
                              <Pill
                                key={s}
                                active={f.paymentStatus === s}
                                tone={s === "PAID" ? "emerald" : s === "OVERDUE" ? "rose" : s === "PARTIAL" ? "sky" : "amber"}
                                onClick={() => set("paymentStatus", s)}
                              >
                                {label(s)}
                              </Pill>
                            ))}
                          </div>
                        </FieldShell>
                        {isEditing && (editing?.tasksTotal ?? 0) > 0 ? (
                          <FieldShell label="Progress" hint="Derived from tasks — update task status instead." as="div">
                            <p className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-body font-semibold tabular-nums text-muted-foreground">
                              {f.progress}% · {editing?.tasksTotal} tasks
                            </p>
                          </FieldShell>
                        ) : (
                          <FieldShell label={`Progress — ${f.progress}%`} as="div">
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={f.progress}
                                onChange={(e) => set("progress", e.target.value)}
                                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                              />
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={f.progress}
                                onChange={(e) => set("progress", e.target.value)}
                                className="!w-16 text-center tabular-nums"
                              />
                            </div>
                          </FieldShell>
                        )}
                      </div>

                      <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-micro font-medium leading-relaxed text-amber-700 dark:text-amber-300">
                        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          Starting a project (status → active) and completing it automatically raise DRAFT invoices —
                          review them in Capital before sending.
                        </span>
                      </p>
                    </Card>
                  </>
                )}

                {/* ── STEP 3 · TEAM & LINKS ── */}
                {step === 2 && (
                  <>
                    <Card title="Delivery team" hint="Who owns this day to day.">
                      <FieldShell label="Project manager" as="div">
                        <div className="grid max-h-[150px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => set("assignedPmId", "")}
                            className={cn(
                              "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-meta transition-colors",
                              !f.assignedPmId
                                ? "border-primary/50 bg-primary/8 font-semibold text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                            )}
                          >
                            <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-current">
                              <Users className="size-3.5" />
                            </span>
                            Unassigned
                          </button>
                          {(managers ?? []).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => set("assignedPmId", m.id)}
                              className={cn(
                                "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-meta transition-colors",
                                f.assignedPmId === m.id
                                  ? "border-primary/50 bg-primary/8 font-semibold text-primary"
                                  : "border-border bg-card hover:bg-muted/40"
                              )}
                            >
                              <Avatar name={m.name} size="size-5" />
                              <span className="truncate">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      </FieldShell>

                      <div className="mt-3">
                        <FieldShell label={`Team members (${f.team.length})`} hint="Optional — you can add more later." as="div">
                          {f.team.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {f.team.map((name) => (
                                <span
                                  key={name}
                                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-1 pr-1.5 text-meta font-semibold text-primary"
                                >
                                  <Avatar name={name} size="size-4" />
                                  {name}
                                  <button
                                    type="button"
                                    onClick={() => toggleTeam(name)}
                                    className="rounded-full p-0.5 hover:bg-primary/20"
                                    aria-label={`Remove ${name}`}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5">
                            <Search className="size-3.5 shrink-0 text-muted-foreground" />
                            <input
                              value={empQuery}
                              onChange={(e) => setEmpQuery(e.target.value)}
                              placeholder="Search people…"
                              className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground/60"
                            />
                          </div>
                          <div className="mt-1.5 flex max-h-[132px] flex-wrap gap-1.5 overflow-y-auto">
                            {filteredEmployees.map((emp) => {
                              const on = f.team.includes(emp.name);
                              return (
                                <Pill key={emp.id} active={on} onClick={() => toggleTeam(emp.name)}>
                                  {on && <Check className="size-3.5" />}
                                  {emp.name}
                                </Pill>
                              );
                            })}
                            {filteredEmployees.length === 0 && (
                              <span className="py-2 text-meta text-muted-foreground">No people match that search.</span>
                            )}
                          </div>
                        </FieldShell>
                      </div>
                    </Card>

                    <Card title="Links & social media" hint="Live URL, client website, and social handles — editable later from the project page.">
                      {isEditing && editing && (
                        <div className="mb-4 rounded-xl border border-border/60 bg-muted/20 p-3">
                          <ImagePicker
                            src={logo.url}
                            jxlSrc={logo.jxl}
                            name={editing.name}
                            endpoint={`/flow/projects/${editing.id}/logo`}
                            removeEndpoint={`/flow/projects/${editing.id}/logo`}
                            onDone={(res) => {
                              setLogo(res ? { url: res.logoUrl ?? null, jxl: res.logoJxlUrl ?? null } : { url: null, jxl: null });
                              onSaved();
                            }}
                            shape="rounded"
                            sizeClass="size-16"
                            title="Project logo"
                            hint="Shown on the project header and cards — saved automatically"
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldShell label="Project / live link" error={errors.projectLink}>
                          <div className="relative">
                            <Globe className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              value={f.projectLink}
                              onChange={(e) => set("projectLink", e.target.value)}
                              placeholder="https://live.example.com"
                              className={cn("pl-9", errors.projectLink && errRing)}
                            />
                          </div>
                        </FieldShell>
                        <FieldShell label="Client website" error={errors.websiteUrl}>
                          <div className="relative">
                            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              value={f.websiteUrl}
                              onChange={(e) => set("websiteUrl", e.target.value)}
                              placeholder="https://client.com"
                              className={cn("pl-9", errors.websiteUrl && errRing)}
                            />
                          </div>
                        </FieldShell>
                      </div>

                      <div className="mt-4 border-t border-border/50 pt-3">
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                          <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">
                            Social media &amp; brand links
                          </p>
                          <span className="text-micro text-muted-foreground/70">
                            Client handles — shown on the project card and portal
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {(
                            [
                              ["facebook", "Facebook", Facebook],
                              ["linkedin", "LinkedIn", Linkedin],
                              ["instagram", "Instagram", Instagram],
                              ["youtube", "YouTube", Youtube],
                              ["tiktok", "TikTok", Music2],
                              ["x", "X / Twitter", Twitter],
                            ] as const
                          ).map(([key, text, Icon]) => (
                            <FieldShell key={key} label={text}>
                              <div className="relative">
                                <Icon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  value={f.socialLinks[key]}
                                  onChange={(e) => setSocial(key, e.target.value)}
                                  placeholder="https://…"
                                  className="pl-9 text-body"
                                />
                              </div>
                            </FieldShell>
                          ))}
                        </div>
                        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          <FieldShell label="Brief" error={errors.briefLink}>
                            <Input
                              value={f.briefLink}
                              onChange={(e) => set("briefLink", e.target.value)}
                              placeholder="Brief doc URL"
                              className={cn("text-body", errors.briefLink && errRing)}
                            />
                          </FieldShell>
                          <FieldShell label="Drive" error={errors.driveLink}>
                            <Input
                              value={f.driveLink}
                              onChange={(e) => set("driveLink", e.target.value)}
                              placeholder="Drive folder URL"
                              className={cn("text-body", errors.driveLink && errRing)}
                            />
                          </FieldShell>
                          <FieldShell label="Research" error={errors.researchLink}>
                            <Input
                              value={f.researchLink}
                              onChange={(e) => set("researchLink", e.target.value)}
                              placeholder="Research URL"
                              className={cn("text-body", errors.researchLink && errRing)}
                            />
                          </FieldShell>
                        </div>
                      </div>
                    </Card>
                  </>
                )}

                {/* ── STEP 4 · MILESTONES (create only) ── */}
                {step === 3 && !isEditing && (
                  <Card
                    title="Delivery milestones"
                    hint="Optional checkpoints. They show up on the project timeline."
                    action={
                      <Btn variant="outline" onClick={suggestMilestones}>
                        <Sparkles className="size-3.5" /> Suggest timeline
                      </Btn>
                    }
                  >
                    {milestoneHint && (
                      <p className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-micro font-medium text-amber-700 dark:text-amber-300">
                        {milestoneHint}
                      </p>
                    )}
                    {milestones.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
                        <Flag className="size-5 text-muted-foreground/60" />
                        <p className="text-body font-semibold text-muted-foreground">No milestones yet</p>
                        <p className="max-w-xs text-micro text-muted-foreground/80">
                          Add checkpoints now, or let us spread four standard ones across your dates.
                        </p>
                        <div className="mt-1 flex gap-2">
                          <Btn variant="outline" onClick={suggestMilestones}>
                            <Sparkles className="size-3.5" /> Suggest
                          </Btn>
                          <Btn variant="primary" onClick={addMilestoneRow}>
                            <Plus className="size-3.5" /> Add milestone
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {milestones.map((m, i) => (
                          <div
                            key={m.key}
                            className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-2.5 sm:flex-row sm:items-end"
                          >
                            <span className="mb-0.5 flex size-5 shrink-0 items-center justify-center self-start rounded-full bg-primary/12 text-micro font-bold text-primary sm:self-center">
                              {i + 1}
                            </span>
                            <FieldShell label="Milestone" className="flex-1">
                              <Input
                                value={m.name}
                                onChange={(e) =>
                                  setMilestones((rows) =>
                                    rows.map((r) => (r.key === m.key ? { ...r, name: e.target.value } : r))
                                  )
                                }
                                placeholder="e.g. Design approval"
                              />
                            </FieldShell>
                            <FieldShell label="Due" className="sm:w-40">
                              <Input
                                type="date"
                                value={m.dueDate}
                                onChange={(e) =>
                                  setMilestones((rows) =>
                                    rows.map((r) => (r.key === m.key ? { ...r, dueDate: e.target.value } : r))
                                  )
                                }
                              />
                            </FieldShell>
                            <Btn
                              variant="ghost"
                              onClick={() => removeMilestoneRow(m.key)}
                              className="self-end text-muted-foreground hover:text-rose-500"
                              aria-label="Remove milestone"
                            >
                              <Trash2 className="size-3.5" />
                            </Btn>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <Btn variant="outline" onClick={addMilestoneRow}>
                            <Plus className="size-3.5" /> Add another
                          </Btn>
                          <span className="text-micro text-muted-foreground">
                            {activeMilestones} milestone{activeMilestones === 1 ? "" : "s"} will be created
                          </span>
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>

            <SummaryRail
              f={f}
              clients={clientOptions}
              managers={managers ?? []}
              milestoneCount={activeMilestones}
              editing={isEditing}
              step={step}
              steps={stepDefs.length}
            />
          </div>

          {/* footer */}
          <div className="shrink-0 border-t border-border/60 bg-card px-5 py-3">
            {apiError && (
              <p className="mb-2 flex items-center gap-1.5 text-meta font-semibold text-rose-500">
                <AlertTriangle className="size-3.5" /> {apiError}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="hidden min-w-0 items-center gap-1.5 text-meta text-muted-foreground sm:flex">
                <CalendarDays className="size-3.5 shrink-0" />
                <span className="truncate">
                  {step === 0
                    ? "Client and timeline first."
                    : step === 1
                      ? "Numbers stay editable later."
                      : step === 2
                        ? "Assign people and drop the links."
                        : "Last step — this creates the project."}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {step > 0 && (
                  <Btn variant="outline" onClick={goBack}>
                    <ArrowLeft className="size-3.5" /> Back
                  </Btn>
                )}
                {step < LAST ? (
                  <Btn variant="primary" type="submit">
                    Continue <ArrowRight className="size-3.5" />
                  </Btn>
                ) : (
                  <Btn variant="primary" type="submit" disabled={busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    {busy ? (isEditing ? "Saving…" : "Creating…") : isEditing ? "Save changes" : "Create project"}
                  </Btn>
                )}
              </div>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
