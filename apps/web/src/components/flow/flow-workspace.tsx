"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  AlertTriangle, ArrowUpRight, Banknote, Calendar, Camera, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, Download, Eye, Facebook, FileArchive,
  FileSpreadsheet, FileText, Globe, HandCoins, History, Image, Instagram, LayoutGrid, Linkedin, Link2, List, Music2, Pencil, Plus, ReceiptText, RefreshCw,
  Rocket, Search, Send, SlidersHorizontal, SquareKanban, Trash2, Twitter, Upload, UploadCloud, Users, Wallet, X, Youtube,
} from "lucide-react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatMoney, formatDate, timeAgo } from "@/lib/format";
import type { ProjectDeliverable, ProjectReport, Shoot } from "@/lib/types";
import { Avatar, EmptyState, FadeIn, PageHeader, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { ProgressRing } from "@/components/charts";
import { Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { ShootTab } from "./shoot-tab";
import { DeliverablesTab } from "./deliverables-tab";
import { ReportsTab } from "./reports-tab";
import { useAuth } from "@/lib/auth";
// The invoice modal pulls jsPDF + qrcode (~170 KB gz). Project management does
// not need a PDF engine until someone actually opens an invoice.
const InvoiceDetailModal = dynamic(
  () => import("@/app/(app)/capital/_components/invoice-detail-modal").then((m) => m.InvoiceDetailModal),
  { ssr: false }
);
import { ProjectModal } from "./project-wizard";

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];
const HEALTH_STATUSES = ["ON_TRACK", "AT_RISK", "DELAYED"];
const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];
const CATEGORIES = ["Branding", "Web Development", "Video Production", "App Development", "Performance Marketing", "Influencer Marketing", "Content Retainer", "Social Media", "SEO", "Other"];
const EXPENSE_CATEGORIES = ["AD_SPEND", "FREELANCER", "PRODUCTION", "SALARY", "SOFTWARE", "RENT", "MARKETING", "TRAVEL", "BANK_CHARGE", "MISC"];
const label = (v: string) => v.replace(/_/g, " ").toLowerCase();
/** Money in the project's own currency; falls back to BDT when unset. */
const money = (value: unknown, currency?: string | null) =>
  formatMoney(value as number | string | null | undefined, currency || "BDT");

// stored file URLs are API-relative ("/api/flow/uploads/…") — resolve to the API origin
function absoluteUrl(url: string) {
  return url.startsWith("/api/") ? `${API_URL.replace(/\/api\/?$/, "")}${url}` : url;
}

/** Pasted links often arrive as "docs.google.com/…" — add the scheme. */
function withProtocol(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
}

const STATUS_STYLE: Record<string, string> = {
  PLANNING: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  PAUSED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  COMPLETED: "border-primary/30 bg-primary/10 text-primary",
  ARCHIVED: "border-border bg-muted/60 text-muted-foreground",
};
/** Solid colour per project status — used by the portfolio composition bar. */
const STATUS_BAR: Record<string, string> = {
  PLANNING: "bg-sky-500",
  ACTIVE: "bg-emerald-500",
  PAUSED: "bg-amber-500",
  COMPLETED: "bg-primary",
  ARCHIVED: "bg-muted-foreground/40",
};
/** Removable chip for one active filter. */
function FilterPill({ label: text, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-micro font-bold text-primary">
      {text}
      <button onClick={onClear} title="Remove filter" className="rounded-full p-0.5 transition-colors hover:bg-primary/20">
        <X className="size-3.5" />
      </button>
    </span>
  );
}
const PRIORITY_STYLE: Record<string, string> = {
  LOW: "border-border bg-muted/60 text-muted-foreground",
  MEDIUM: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  HIGH: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  URGENT: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};
const PAYMENT_STYLE: Record<string, string> = {
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  PARTIAL: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  PAID: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  OVERDUE: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};
interface ProjectRow {
  id: string; uid?: string | null; name: string; code?: string | null; status: string; healthStatus: string;
  riskScore: number | null; riskDriver: string | null; budgetAmount: number | null;
  amount?: number | null; currency?: string | null;
  spentAmount?: number | null; budgetSpent?: number | null; startDate: string | null; targetEndDate: string | null;
  progress?: number | null; category?: string | null; priority?: string | null; team?: string[];
  type?: string | null;
  description?: string | null;
  billingType?: string | null; recurringInterval?: string | null; nextBillingDate?: string | null;
  monthlyRate?: number | null; totalBilled?: number | null; paymentStatus?: string | null;
  projectLink?: string | null; websiteUrl?: string | null;
  logoUrl?: string | null; logoJxlUrl?: string | null;
  socialLinks?: {
    facebook?: string; linkedin?: string; instagram?: string;
    youtube?: string; tiktok?: string; x?: string;
  } | null;
  referenceLinks?: any; references?: any[];
  briefLink?: string | null; driveLink?: string | null; researchLink?: string | null;
  tasksTotal?: number; tasksCompleted?: number;
  client: { id: string; companyName: string };
  assignedPm?: { id: string; name: string } | null;
  milestones?: { id: string; name: string; dueDate: string | null; status: string }[];
  _count?: { tasks: number; files: number; milestones: number };
}

interface ProjectProposal {
  id: string;
  title: string;
  fileUrl: string | null;
  fileName?: string | null;
  downloadUrl?: string | null;
  link: string | null;
  notes: string | null;
  amount: number | string | null;
  status: string;
  sentDate: string | null;
  updatedAt: string;
  updatedBy?: { id: string; name: string } | null;
}

interface ProjectDetail extends ProjectRow {
  description?: string | null; type?: string;
  sourceLead?: {
    id: string; name: string; company: string | null; source: string; vertical: string;
    estimatedDealSize: number | null; contactEmail: string | null; contactPhone: string | null;
  } | null;
  sourceProposal?: {
    id: string; versionNumber: number; status: string;
    fileUrl: string | null; portalLink: string | null; sentDate: string | null;
  } | null;
  /** The project's one final proposal (PDF and/or shared link). */
  proposal?: ProjectProposal | null;
  milestones: { id: string; name: string; dueDate: string | null; status: string }[];
  files: {
    id: string; name?: string | null; fileName?: string | null; fileUrl: string;
    downloadUrl?: string | null;
    uploadedAt: string; size?: number | null; uploadedBy: { name: string } | null;
    approvalStatus: string;
  }[];
  tasks: {
    id: string; title: string; status: string; priority: string;
    dueDate: string | null; assignedTo: { name: string } | null;
  }[];
  deliverables: ProjectDeliverable[];
  shoots: Shoot[];
  reports: ProjectReport[];
  reportFrequency?: string | null;
  reportMode?: string | null;
  nextReportDate?: string | null;
  teamMembers?: any[]; risks?: any[];
  confidenceScore?: number | null;
  healthStatusOverride?: string | null;
  healthOverrideReason?: string | null;
  healthComputedAt?: string | null;
  healthBreakdown?: any;
  _count?: { tasks: number; files: number; milestones: number };
}

interface Discussion { id: string; content: string; createdAt: string; author?: { name: string } | null; portalUser?: { name: string } | null }
interface CapacityRow {
  id: string;
  name: string;
  roleTitle?: string | null;
  department?: string | null;
  totalHours: number;
  capacityHours: number;
  utilizationPct: number;
  projects: {
    projectId: string;
    projectName: string;
    client: string;
    hours: number;
    sharePct: number;
  }[];
}

function ProjectFinancePanel({ finance, loading, onInvoice, onExpense, currency }: { finance: any; loading: boolean; onInvoice: () => void; onExpense: () => void; currency?: string | null }) {
  const invoices = finance?.invoices ?? [];
  const expenses = finance?.expenses ?? [];
  const cur = currency ?? finance?.project?.currency ?? "BDT";
  // professional invoice view (same modal as Capital) — view-only from Flow
  const [selInv, setSelInv] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <InvoiceDetailModal selectedId={selInv} onClose={() => setSelInv(null)} onEdit={() => setSelInv(null)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Invoiced</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold tabular-nums">{money(finance?.totalInvoiced, cur)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Collected</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold tabular-nums text-emerald-500">{money(finance?.collected, cur)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Outstanding</p>
          <p className={cn("mt-0.5 text-body-lg font-heading font-bold tabular-nums", Number(finance?.outstanding ?? 0) > 0 ? "text-amber-500" : "text-emerald-500")}>{money(finance?.outstanding, cur)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold tabular-nums text-rose-500">{money(finance?.expensesTotal, cur)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Project profit</p>
          <p className={cn("mt-0.5 text-body-lg font-heading font-bold tabular-nums", Number(finance?.profit ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{money(finance?.profit, cur)}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Margin</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold tabular-nums">{finance?.margin != null ? `${finance.margin}%` : "—"}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Payment status</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold">{finance?.project?.paymentStatus ? label(finance.project.paymentStatus) : "—"}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Next billing</p>
          <p className="mt-0.5 text-body-lg font-heading font-bold">{finance?.project?.nextBillingDate ? formatDate(finance.project.nextBillingDate) : "—"}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-meta font-bold uppercase tracking-wider text-muted-foreground">Invoices</p>
        <div className="flex items-center gap-2">
          <Btn variant="outline" onClick={onExpense}><ReceiptText className="size-3.5" /> Add Expense</Btn>
          <Btn variant="primary" onClick={onInvoice}><Plus className="size-3.5" /> Create Invoice</Btn>
        </div>
      </div>
      <TableShell>
        <table className="w-full">
          <THead><Th>Invoice</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Due</Th></THead>
          <tbody>
            {invoices.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6"><EmptyState title="No invoices for this project" hint="Create an invoice to start billing this project." /></td></tr>
            )}
            {invoices.map((inv: any, i: number) => (
              <Tr key={inv.id} index={i} onClick={() => setSelInv(inv.id)} className="cursor-pointer transition-colors hover:bg-muted/40">
                <Td>
                  <span className="font-medium tabular-nums">{inv.invoiceNumber}</span>
                  {inv.invoiceType === "ADVANCE" && (
                    <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Adv</span>
                  )}
                  {inv.title && <span className="block text-micro font-normal text-muted-foreground">{inv.title}</span>}
                </Td>
                <Td><StatusBadge status={inv.status} /></Td>
                <Td className="text-right font-semibold tabular-nums">{money(inv.amount, cur)}</Td>
                <Td className="text-right tabular-nums text-emerald-500">{money(inv.paid, cur)}</Td>
                <Td className={cn("text-right font-medium tabular-nums", inv.balance > 0 ? "text-amber-500" : "text-emerald-500")}>{money(inv.balance, cur)}</Td>
                <Td className="text-muted-foreground">{formatDate(inv.dueDate)}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <p className="text-meta font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
      <TableShell>
        <table className="w-full">
          <THead><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Date</Th><Th>Status</Th><Th>By</Th></THead>
          <tbody>
            {expenses.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6"><EmptyState title="No expenses for this project" hint="Add an expense to track project costs." /></td></tr>
            )}
            {expenses.map((e: any, i: number) => (
              <Tr key={e.id} index={i}>
                <Td className="font-medium">{e.description}</Td>
                <Td className="text-muted-foreground">{label(e.category)}</Td>
                <Td className="text-right font-semibold tabular-nums">{money(e.amount, cur)}</Td>
                <Td className="text-muted-foreground">{formatDate(e.date)}</Td>
                <Td><StatusBadge status={e.approvalStatus} /></Td>
                <Td className="text-muted-foreground">{e.submittedBy ?? "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}

function ProjectInvoiceModal({ open, project, onClose, onSaved }: { open: boolean; project: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ description: "", amount: "", dueDate: "", notes: "" });
  const [fin, setFin] = useState<any | null>(null);
  const [pct, setPct] = useState("");
  const lastAuto = useRef<string | null>(null);
  const lastPct = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    // project name comes pre-filled; amount follows once billing status arrives
    setF({ description: project?.name ?? "", amount: "", dueDate: "", notes: "" });
    setFin(null);
    setPct("");
    lastAuto.current = null;
    lastPct.current = null;
    if (project?.id) apiFetch<any>(`/capital/projects/${project.id}/finance`).then(setFin).catch(() => {});
  }, [open]);
  const projectValue = Number(project?.amount ?? project?.budgetAmount ?? fin?.project?.budgetAmount ?? 0);
  // auto-fill the REMAINING project balance — only while the amount is still untouched
  useEffect(() => {
    if (!open || !fin || f.amount || !project) return;
    if ((project.billingType ?? "ONE_TIME") !== "ONE_TIME") return;
    const remaining = Math.max(Math.round((projectValue - (fin.totalInvoiced ?? 0)) * 100) / 100, 0);
    if (remaining > 0) {
      lastAuto.current = String(remaining);
      setF((prev) => (prev.amount ? prev : { ...prev, amount: String(remaining) }));
    }
  }, [fin]);
  // milestone billing: type a % of the project value → amount auto-calculated
  const applyPct = (v: string) => {
    setPct(v);
    const p = Number(v);
    if (!project || !(p > 0) || p > 100 || !(projectValue > 0)) return;
    if ((project.billingType ?? "ONE_TIME") !== "ONE_TIME") return;
    if (f.amount && f.amount !== lastAuto.current) return; // user typed — don't clobber
    const amount = Math.round((projectValue * p) / 100 * 100) / 100;
    const pctLabel = String(Number(v));
    // if the description is our own previous % label, refresh it too (1 → 10 → 100)
    const prevAutoDesc = lastPct.current ? `${lastPct.current}% Advance — ${project.name}` : null;
    lastAuto.current = String(amount);
    lastPct.current = pctLabel;
    setF((prev) => ({
      ...prev,
      amount: String(amount),
      description:
        !prev.description || prev.description === project.name || prev.description === prevAutoDesc
          ? `${pctLabel}% Advance — ${project.name}`
          : prev.description,
    }));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/invoices", {
        method: "POST",
        body: JSON.stringify({
          clientId: project.clientId,
          projectId: project.id,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: f.dueDate || undefined,
          status: "DRAFT",
          notes: f.notes.trim() || undefined,
          lines: [{ description: f.description.trim(), unitPrice: Number(f.amount), quantity: 1 }],
        }),
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
    <Modal open={open} onClose={onClose} title={`Create invoice — ${project?.name ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        {fin && (
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-body">
            <div className="flex justify-between"><span className="text-muted-foreground">Project value</span><span className="font-bold tabular-nums">{money(Number(project?.amount ?? project?.budgetAmount ?? fin.project?.budgetAmount ?? 0))}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Billed so far</span><span className="font-medium tabular-nums">{money(fin.totalInvoiced ?? 0, project?.currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(fin.collected ?? 0, project?.currency)}</span></div>
            <div className="flex justify-between border-t border-border/60 pt-1"><span className="font-bold">Remaining</span><span className="font-bold tabular-nums">{money(Math.max(Number(project?.amount ?? project?.budgetAmount ?? fin.project?.budgetAmount ?? 0) - (fin.totalInvoiced ?? 0), 0), project?.currency)}</span></div>
          </div>
        )}
        <Field label="Line description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Monthly retainer — August" autoFocus /></Field>
        {(project?.billingType ?? "ONE_TIME") === "ONE_TIME" && projectValue > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative w-28">
              <Input type="number" min={0} max={100} step="any" value={pct} onChange={(e) => applyPct(e.target.value)} placeholder="50" className="pr-7" />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-body font-bold text-muted-foreground">%</span>
            </div>
            <p className="text-meta text-muted-foreground">
              {Number(pct) > 0 && Number(pct) <= 100
                ? <span>Advance <span className="font-bold tabular-nums text-foreground">{money(Math.round((projectValue * Number(pct)) / 100 * 100) / 100, project?.currency)}</span> of {money(projectValue, project?.currency)}</span>
                : "Milestone % of project value"}
            </p>
          </div>
        )}
        {Number(pct) > 0 && Number(pct) <= 100 && f.amount && f.amount !== lastAuto.current && (
          <p className="-mt-2 text-meta text-amber-600 dark:text-amber-400">Amount was edited by hand — clear it to apply the % again.</p>
        )}
        {fin && Number(pct) > 0 && Number(pct) <= 100 && Math.round((projectValue * Number(pct)) / 100 * 100) / 100 > Math.max(projectValue - (fin.totalInvoiced ?? 0), 0) && (
          <p className="-mt-2 text-meta text-amber-600 dark:text-amber-400">
            {String(Number(pct))}% of full value ({money(projectValue, project?.currency)}) exceeds the remaining {money(Math.max(projectValue - (fin.totalInvoiced ?? 0), 0), project?.currency)} — {money(fin.totalInvoiced ?? 0, project?.currency)} already billed.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (BDT) *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="25000" /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms…" /></Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create invoice" />
      </form>
    </Modal>
  );
}

function ProjectExpenseModal({ open, project, bankAccounts, onClose, onSaved }: { open: boolean; project: any; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const canDirect = ["Owner", "Finance", "Admin", "HR/Admin", "CONTROL"].includes(user?.role ?? "");
  const [f, setF] = useState({ description: "", amount: "", category: "MISC", date: new Date().toISOString().slice(0, 10), bankAccountId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ description: "", amount: "", category: "MISC", date: new Date().toISOString().slice(0, 10), bankAccountId: bankAccounts[0]?.id ?? "" });
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/expenses", {
        method: "POST",
        body: JSON.stringify({ description: f.description.trim(), amount: Number(f.amount), category: f.category, date: f.date || undefined, projectId: project.id, clientId: project.clientId ?? project.client?.id ?? undefined, bankAccountId: f.bankAccountId || undefined, approvalStatus: canDirect ? "APPROVED" : "PENDING" }),
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
    <Modal open={open} onClose={onClose} title={`Add expense — ${project?.name ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        {(project?.client?.companyName || project?.clientId) && (
          <p className="rounded-xl bg-muted/40 px-3 py-2 text-meta text-muted-foreground">
            Project expense{project?.client?.companyName ? ` · ${project.client.companyName}` : ""} — what kind of cost is recorded via Category below.
          </p>
        )}
        <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Google Ads — August" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (BDT) *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="8000" /></Field>
          <Field label="Category *"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName}</option>)}</Select></Field>
        </div>
        {canDirect ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-meta text-emerald-600 dark:text-emerald-400">Posts to bank & ledger immediately.</p>
        ) : (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-600 dark:text-amber-400">Sends a request — admin approves it in Expenses before accounts update.</p>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add expense" />
      </form>
    </Modal>
  );
}

type ChannelKey = "facebook" | "instagram" | "linkedin" | "youtube" | "tiktok" | "x";
const CHANNEL_FIELDS: { key: ChannelKey; label: string; Icon: typeof Facebook }[] = [
  { key: "facebook", label: "Facebook", Icon: Facebook },
  { key: "instagram", label: "Instagram", Icon: Instagram },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
  { key: "youtube", label: "YouTube", Icon: Youtube },
  { key: "tiktok", label: "TikTok", Icon: Music2 },
  { key: "x", label: "X / Twitter", Icon: Twitter },
];
const blankChannels = () => ({
  projectLink: "",
  websiteUrl: "",
  briefLink: "",
  driveLink: "",
  researchLink: "",
  socialLinks: { facebook: "", instagram: "", linkedin: "", youtube: "", tiktok: "", x: "" } as Record<ChannelKey, string>,
});

/**
 * One place to add or edit every external link on a project: the live URL,
 * the client's website, the six social handles, and the brief / drive /
 * research docs. Previously these were only reachable from step 3 of the
 * project wizard (and hidden behind a collapsed panel), so the project page
 * looked like it had no way to add them at all.
 */
function ChannelsModal({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: ProjectRow | null;
  onClose: () => void;
  onSaved: (fields: Record<string, any>) => void;
}) {
  const [f, setF] = useState(blankChannels);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const sl = (project?.socialLinks ?? {}) as Record<string, string>;
    setF({
      projectLink: project?.projectLink ?? "",
      websiteUrl: project?.websiteUrl ?? "",
      briefLink: project?.briefLink ?? "",
      driveLink: project?.driveLink ?? "",
      researchLink: project?.researchLink ?? "",
      socialLinks: {
        facebook: sl.facebook ?? "",
        instagram: sl.instagram ?? "",
        linkedin: sl.linkedin ?? "",
        youtube: sl.youtube ?? "",
        tiktok: sl.tiktok ?? "",
        x: sl.x ?? "",
      },
    });
    setErr(null);
  }, [open, project]);

  const setSocial = (key: ChannelKey, value: string) =>
    setF((p) => ({ ...p, socialLinks: { ...p.socialLinks, [key]: value } }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const social = Object.fromEntries(
      Object.entries(f.socialLinks)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v)
    );
    const fields = {
      projectLink: f.projectLink.trim() || null,
      websiteUrl: f.websiteUrl.trim() || null,
      briefLink: f.briefLink.trim() || null,
      driveLink: f.driveLink.trim() || null,
      researchLink: f.researchLink.trim() || null,
      socialLinks: Object.keys(social).length ? social : null,
    };
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/flow/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(fields) });
      onSaved(fields);
    } catch (e: any) {
      setErr(e.message ?? "Could not save the links");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Project links & social" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-meta leading-relaxed text-muted-foreground">
          Everything clients see on the project page and portal — the live URL, their website, social
          handles, and working docs. Leave a field blank to remove that link.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Project / live link">
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={f.projectLink} onChange={(e) => setF({ ...f, projectLink: e.target.value })} placeholder="https://live.example.com" className="pl-9" />
            </div>
          </Field>
          <Field label="Client website">
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={f.websiteUrl} onChange={(e) => setF({ ...f, websiteUrl: e.target.value })} placeholder="https://client.com" className="pl-9" />
            </div>
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-micro font-bold tracking-wide text-muted-foreground uppercase">Social handles</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {CHANNEL_FIELDS.map(({ key, label: text, Icon }) => (
              <Field key={key} label={text}>
                <div className="relative">
                  <Icon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={f.socialLinks[key]} onChange={(e) => setSocial(key, e.target.value)} placeholder="https://…" className="pl-9 text-body" />
                </div>
              </Field>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-micro font-bold tracking-wide text-muted-foreground uppercase">Working docs</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Field label="Brief"><Input value={f.briefLink} onChange={(e) => setF({ ...f, briefLink: e.target.value })} placeholder="Brief doc URL" className="text-body" /></Field>
            <Field label="Drive"><Input value={f.driveLink} onChange={(e) => setF({ ...f, driveLink: e.target.value })} placeholder="Drive folder URL" className="text-body" /></Field>
            <Field label="Research"><Input value={f.researchLink} onChange={(e) => setF({ ...f, researchLink: e.target.value })} placeholder="Research URL" className="text-body" /></Field>
          </div>
        </div>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save links" />
      </form>
    </Modal>
  );
}

const DETAIL_TABS = [
  "overview", "proposal", "deliverables", "shoot", "tasks", "milestones", "files", "discussions", "finance", "reports", "references",
] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export default function FlowWorkspace({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: overview } = useApi<any>("/flow/overview");
  // Lookup only (id + name): Flow users may not have the Accounts module, so
  // the full client list is deliberately not requested here.
  const { data: clients, mutate: reloadClients } = useApi<any[]>("/accounts/client-lookup");
  const { data: templates } = useApi<any[]>("/flow/templates");
  const { data: managers } = useApi<any[]>("/flow/managers");
  const { data: employees } = useApi<any[]>("/people/employees");
  const { data: bankAccounts } = useApi<any[]>("/capital/bank-accounts");
  const [tab, setTab] = useState<"projects" | "capacity">("projects");
  const [view, setView] = useState<"table" | "grid" | "kanban">("table");
  // persist view to localStorage + searchParams ?view=table|grid|kanban (migrate legacy "list" -> "table")
  useEffect(() => {
    const sp = searchParams.get("view");
    if (sp === "table" || sp === "grid" || sp === "kanban") {
      if (sp !== view) setView(sp as any);
      return;
    }
    if (sp === "list" && view !== "table") {
      setView("table");
      return;
    }
    try {
      const ls = localStorage.getItem("flow-view");
      if (ls === "table" || ls === "grid" || ls === "kanban") {
        if (ls !== view) setView(ls as any);
      } else if (ls === "list" && view !== "table") {
        setView("table");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    try {
      localStorage.setItem("flow-view", view);
    } catch {}
  }, [view]);

  const setViewWithUrl = useCallback(
    (v: "table" | "grid" | "kanban") => {
      setView(v);
      try {
        localStorage.setItem("flow-view", v);
      } catch {}
      const p = new URLSearchParams(searchParams.toString());
      p.set("view", v);
      router.push(`?${p.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [healthFilter, setHealthFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [refresh, setRefresh] = useState(0);
  /** Advanced filters stay collapsed so the toolbar reads as one line. */
  const [advanced, setAdvanced] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
    // The open project is a URL, not component state: /flow/<id> is linkable,
  // survives a refresh and works with the browser back button.
  const [selectedId, setSelectedId] = useState<string | null>(projectId ?? null);
  useEffect(() => {
    setSelectedId(projectId ?? null);
  }, [projectId]);
  const openProject = useCallback((id: string) => { router.push("/flow/" + id); }, [router]);
  const closeProject = useCallback(() => { router.push("/flow"); }, [router]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  // Campaigns are client-scoped: the report and deliverable forms only offer
  // campaigns that belong to this project's client.
  const { data: flowCampaignData } = useApi<any[]>(
    detail ? `/calendar/campaigns?clientId=${detail.client?.id ?? ""}` : null
  );
  const reportsCampaigns = useMemo(
    () =>
      (flowCampaignData ?? [])
        .filter((c) => !detail?.client?.id || c.clientId === detail.client.id)
        .map((c) => ({ id: c.id, name: c.name })),
    [flowCampaignData, detail?.client?.id]
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const selectDetailTab = useCallback(
    (id: DetailTab) => {
      setDetailTab(id);
      if (!projectId) return;
      // Keep the tab in the URL so a refresh or a shared link lands on the same
      // pane; notification deep links add ?report=/?file= on top of this.
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", id);
      params.delete("report");
      params.delete("file");
      router.replace(`/flow/${projectId}?${params.toString()}`, { scroll: false });
    },
    [projectId, router, searchParams]
  );
  // Notification deep links: /flow/<id>?tab=reports&report=<reportId>.
  const focusReport = projectId ? searchParams.get("report") : null;
  const focusFile = projectId ? searchParams.get("file") : null;
  useEffect(() => {
    if (!projectId) return;
    const t = searchParams.get("tab");
    if (t && (DETAIL_TABS as readonly string[]).includes(t)) setDetailTab(t as DetailTab);
  }, [projectId, searchParams]);
  useEffect(() => {
    if (!focusReport || detailTab !== "reports") return;
    const el = document.getElementById(`report-${focusReport}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusReport, detailTab, detail?.reports]);
  useEffect(() => {
    if (!focusFile || detailTab !== "files") return;
    const el = document.getElementById(`file-${focusFile}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusFile, detailTab, detail?.files]);
  const [finance, setFinance] = useState<any | null>(null);
  const [finLoading, setFinLoading] = useState(false);
  const [finInvOpen, setFinInvOpen] = useState(false);
  const [finExpOpen, setFinExpOpen] = useState(false);
  const [finBusy, setFinBusy] = useState(false);
  const [capacity, setCapacity] = useState<CapacityRow[] | null>(null);
  const [capLoading, setCapLoading] = useState(true);
  const [capErr, setCapErr] = useState<string | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[] | null>(null);
  const [discLoading, setDiscLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [msName, setMsName] = useState("");
  const [msDue, setMsDue] = useState("");
  const [msBusy, setMsBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [confidence, setConfidence] = useState("");
  const [riskBusy, setRiskBusy] = useState(false);
  const [pmBusy, setPmBusy] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // references & research
  const [references, setReferences] = useState<any[] | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [refTitle, setRefTitle] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [refType, setRefType] = useState("OTHER");
  const [refBusy, setRefBusy] = useState(false);
  const [refUploading, setRefUploading] = useState(false);
  const refFileRef = useRef<HTMLInputElement>(null);
  // project proposal (one final proposal per project)
  const [proposalOpen, setProposalOpen] = useState(false);
  const [propTitle, setPropTitle] = useState("");
  const [propLink, setPropLink] = useState("");
  const [propNotes, setPropNotes] = useState("");
  const [propAmount, setPropAmount] = useState("");
  const [propFile, setPropFile] = useState<{ fileUrl: string; fileName: string } | null>(null);
  const [propStatus, setPropStatus] = useState("DRAFT");
  const [propUploading, setPropUploading] = useState(false);
  const [propBusy, setPropBusy] = useState(false);
  const propFileRef = useRef<HTMLInputElement>(null);
  // bulk task assign
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTasks, setBulkTasks] = useState<any[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // deliverables + reports live in <DeliverablesTab /> and <ReportsTab />
  // project links & social editor
  const [channelsOpen, setChannelsOpen] = useState(false);

  // glimpse description inline edit
  const [descEdit, setDescEdit] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [descBusy, setDescBusy] = useState(false);

  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const notify = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    apiFetch<ProjectRow[]>("/flow/projects")
      .then((d) => { if (!cancelled && Array.isArray(d)) setProjects(d); })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setCapLoading(true);
    setCapErr(null);
    apiFetch<CapacityRow[]>("/flow/capacity")
      .then((d) => { if (!cancelled && Array.isArray(d)) setCapacity(d); })
      .catch((e) => !cancelled && setCapErr(e.message))
      .finally(() => !cancelled && setCapLoading(false));
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDiscussions(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<ProjectDetail>(`/flow/projects/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => { if (cancelled) return; setDetail(null); setSelectedId(null); if (projectId) router.replace("/flow"); })
      .finally(() => !cancelled && setDetailLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  useEffect(() => {
    if (!selectedId) { setDiscussions(null); return; }
    let cancelled = false;
    setDiscLoading(true);
    apiFetch<Discussion[]>(`/flow/projects/${selectedId}/discussions`)
      .then((d) => !cancelled && setDiscussions(d))
      .catch(() => !cancelled && setDiscussions(null))
      .finally(() => !cancelled && setDiscLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  useEffect(() => {
    if (!selectedId) { setFinance(null); return; }
    let cancelled = false;
    setFinLoading(true);
    apiFetch<any>(`/capital/projects/${selectedId}/finance`)
      .then((d) => !cancelled && setFinance(d))
      .catch(() => !cancelled && setFinance(null))
      .finally(() => !cancelled && setFinLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  useEffect(() => {
    if (!selectedId) { setReferences(null); return; }
    let cancelled = false;
    setRefsLoading(true);
    apiFetch<any[]>(`/flow/projects/${selectedId}/references`)
      .then((d) => !cancelled && setReferences(d))
      .catch(() => !cancelled && setReferences([]))
      .finally(() => !cancelled && setRefsLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  // fetch bulk tasks when bulk modal opens
  useEffect(() => {
    if (!bulkOpen || !detail) return;
    let cancelled = false;
    setBulkLoading(true);
    apiFetch<any>("/tasks")
      .then((d: any) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : d?.items ?? d?.data ?? [];
        setBulkTasks(list);
      })
      .catch(() => !cancelled && setBulkTasks([]))
      .finally(() => !cancelled && setBulkLoading(false));
    return () => { cancelled = true; };
  }, [bulkOpen, detail]);

  useEffect(() => {
    if (!detail) return;
    setConfidence(detail.confidenceScore != null ? String(detail.confidenceScore) : "");
  }, [detail]);

  const filtered = useMemo(
    () => (projects ?? []).filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.client.companyName.toLowerCase().includes(q.toLowerCase()) || (p.uid ?? "").toLowerCase().includes(q.toLowerCase())) &&
        (!statusFilter || p.status === statusFilter) &&
        (!healthFilter || p.healthStatus === healthFilter) &&
        (!clientFilter || p.client.id === clientFilter) &&
        (!managerFilter || p.assignedPm?.id === managerFilter)
    ),
    [projects, q, statusFilter, healthFilter, clientFilter, managerFilter]
  );

  const stats = useMemo(() => {
    const list = projects ?? [];
    // Portfolio totals are per currency: adding USD and BDT produces a number
    // that means nothing.
    const totals = new Map<string, { budget: number; spent: number }>();
    for (const p of list) {
      const currency = p.currency || "BDT";
      const entry = totals.get(currency) ?? { budget: 0, spent: 0 };
      entry.budget += Number(p.budgetAmount ?? (p as any).amount ?? 0);
      entry.spent += Number(p.spentAmount ?? (p as any).budgetSpent ?? 0);
      totals.set(currency, entry);
    }
    const currencies = Array.from(totals.entries())
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => b.budget - a.budget);
    return {
      total: overview?.totalProjects ?? list.length,
      active: overview?.active ?? list.filter((p) => p.status === "ACTIVE").length,
      completed: list.filter((p) => p.status === "COMPLETED").length,
      totals: currencies,
      // A burn percentage only means something inside one currency.
      budget: currencies.length === 1 ? currencies[0].budget : 0,
      spent: currencies.length === 1 ? currencies[0].spent : 0,
      atRisk: (overview?.byHealth?.AT_RISK ?? 0) + (overview?.byHealth?.DELAYED ?? 0) || list.filter((p) => p.healthStatus === "AT_RISK" || p.healthStatus === "DELAYED").length,
    };
  }, [projects, overview]);

  const byStatus = useMemo(
    () => PROJECT_STATUSES.map((s) => ({ status: s, items: filtered.filter((p) => p.status === s) })),
    [filtered]
  );

  // Capacity is per employee and already windowed by the API (default: last
  // 4 weeks). The old UI divided all-time hours by a 40h weekly target.
  const capRows = useMemo(() => capacity ?? [], [capacity]);
  const capWindow = useMemo(() => {
    const first = (capacity ?? [])[0] as any;
    return first?.capacityHours ? { capacityHours: first.capacityHours } : { capacityHours: 0 };
  }, [capacity]);

  const patchProject = async (fields: any) => {
    if (!detail) return;
    try {
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify(fields) });
      setDetail({ ...detail, ...fields });
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const saveDescription = async () => {
    if (!detail) return;
    setDescBusy(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ description: descDraft.trim() || null }) });
      setDetail({ ...detail, description: descDraft.trim() || null });
      setDescEdit(false);
      notify("Description updated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    } finally {
      setDescBusy(false);
    }
  };

  const patchStatus = async (p: ProjectRow, status: string) => {
    try {
      await apiFetch(`/flow/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`${p.name} → ${label(status)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const saveRisk = async () => {
    if (!detail) return;
    setRiskBusy(true);
    try {
      const body = { confidenceScore: confidence === "" ? null : Number(confidence) };
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify("Confidence saved — score recomputed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setRiskBusy(false);
    }
  };

  const setHealthOverride = async (value: string) => {
    if (!detail) return;
    try {
      const body =
        value === "AUTO"
          ? { healthStatus: null }
          : { healthStatus: value, healthOverrideReason: "Set manually from the project detail" };
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify(value === "AUTO" ? "Back to the computed health" : "Health overridden (computed score still visible)");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const assignPm = async (id: string) => {
    if (!detail) return;
    setPmBusy(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ assignedPmId: id || null }) });
      setDetail({ ...detail, assignedPm: (managers ?? []).find((e) => e.id === id) ?? null });
      notify("Project manager updated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    } finally {
      setPmBusy(false);
    }
  };

  const deleteProject = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/flow/projects/${deleteTarget.id}`, { method: "DELETE" });
      notify("Project deleted");
      setDeleteTarget(null);
      closeProject();
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_URL}/flow/export`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `projects_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify("Projects exported");
    } catch (e: any) {
      notify(e.message ?? "Export failed");
    }
  };

  const onPickImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/flow/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Import failed");
      notify(`Imported ${body?.imported ?? 0} projects${body?.skipped?.length ? ` · skipped ${body.skipped.length}` : ""}`);
      reload();
    } catch (e2: any) {
      notify(e2.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const addMilestone = async () => {
    if (!detail || !msName.trim()) return;
    setMsBusy(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}/milestones`, {
        method: "POST",
        body: JSON.stringify({ name: msName.trim(), dueDate: msDue || null, status: "PENDING" }),
      });
      setMsName("");
      setMsDue("");
      notify("Milestone added");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Add failed");
    } finally {
      setMsBusy(false);
    }
  };

  const setMilestoneStatus = async (m: { id: string; name: string }, status: string) => {
    try {
      await apiFetch(`/flow/milestones/${m.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`Milestone marked ${label(status)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const deleteMilestone = async (id: string) => {
    try {
      await apiFetch(`/flow/milestones/${id}`, { method: "DELETE" });
      notify("Milestone removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const setApproval = async (fileId: string, approvalStatus: string) => {
    try {
      await apiFetch(`/flow/files/${fileId}/approval`, { method: "PATCH", body: JSON.stringify({ status: approvalStatus }) });
      notify(`File ${label(approvalStatus)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const deleteFile = async (fileId: string) => {
    try {
      await apiFetch(`/flow/files/${fileId}`, { method: "DELETE" });
      notify("File removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !detail) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/flow/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.fileUrl) throw new Error(body?.message ?? "Upload failed");
      await apiFetch(`/flow/projects/${detail.id}/files`, {
        method: "POST",
        body: JSON.stringify({
          fileUrl: body.fileUrl,
          fileName: body.fileName ?? body.originalName ?? file.name,
          size: body.size ?? file.size,
          mimeType: body.mimeType ?? file.type,
        }),
      });
      notify("File uploaded");
      reload();
    } catch (e2: any) {
      notify(e2.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const sendDiscussion = async () => {
    if (!detail || !msg.trim() || sending) return;
    setSending(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}/discussions`, { method: "POST", body: JSON.stringify({ content: msg.trim() }) });
      setMsg("");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  };

  // ── References & Research handlers ────────────────────────────────
  const reloadReferences = async () => {
    if (!detail) return;
    try {
      const data = await apiFetch<any[]>(`/flow/projects/${detail.id}/references`);
      setReferences(data);
    } catch {}
  };

  const addReferenceLink = async () => {
    if (!detail) return;
    if (!refTitle.trim() || !refUrl.trim()) { notify("Title and URL are required"); return; }
    setRefBusy(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}/references`, { method: "POST", body: JSON.stringify({ title: refTitle.trim(), url: refUrl.trim(), type: refType }) });
      setRefTitle(""); setRefUrl("");
      await reloadReferences(); reload();
      notify("Reference added");
    } catch (e: any) { notify(e.message ?? "Add reference failed"); } finally { setRefBusy(false); }
  };

  const handleRefFile = async (file: File) => {
    if (!detail) return;
    setRefUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_URL}/flow/upload`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.fileUrl) throw new Error(body?.message ?? "Upload failed");
      const title = body.originalName ?? file.name;
      await apiFetch(`/flow/projects/${detail.id}/references`, { method: "POST", body: JSON.stringify({ title, fileUrl: body.fileUrl, type: refType ?? "OTHER" }) });
      await reloadReferences(); reload();
      notify("Reference file uploaded");
    } catch (e: any) { notify(e.message ?? "Upload failed"); } finally { setRefUploading(false); }
  };

  const onPickRefFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handleRefFile(file);
  };

  const deleteReference = async (id: string) => {
    try {
      await apiFetch(`/flow/references/${id}`, { method: "DELETE" });
      setReferences((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      notify("Reference removed");
      reload();
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };

  // ── Project proposal (one final proposal per project) ────────────
  /** Prefer the shared link (Google Doc / Notion) and fall back to the PDF. */
  const proposalTarget = (p?: ProjectProposal | null) => {
    if (!p) return "";
    if (p.link?.trim()) return p.link.trim();
    if (p.fileUrl) return p.downloadUrl ?? absoluteUrl(p.fileUrl);
    return "";
  };

  useEffect(() => {
    setPropStatus(detail?.proposal?.status ?? "DRAFT");
  }, [detail?.proposal?.status]);

  const openProposalForm = () => {
    const p = detail?.proposal;
    setPropTitle(p?.title ?? "Final proposal");
    setPropLink(p?.link ?? "");
    setPropNotes(p?.notes ?? "");
    setPropAmount(p?.amount != null ? String(p.amount) : "");
    setPropFile(p?.fileUrl ? { fileUrl: p.fileUrl, fileName: p.fileName ?? "proposal.pdf" } : null);
    setProposalOpen(true);
  };

  /** One click from the project header: open the proposal, or start it. */
  const viewProposal = () => {
    const target = proposalTarget(detail?.proposal);
    if (target) {
      window.open(target, "_blank", "noopener,noreferrer");
      return;
    }
    selectDetailTab("proposal");
    openProposalForm();
  };

  const handleProposalFile = async (file: File) => {
    setPropUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_URL}/flow/upload`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.fileUrl) throw new Error(body?.message ?? "Upload failed");
      setPropFile({ fileUrl: body.fileUrl, fileName: body.originalName ?? file.name });
      notify("PDF attached - save to finish");
    } catch (e: any) { notify(e.message ?? "Upload failed"); } finally { setPropUploading(false); }
  };

  const saveProposal = async () => {
    if (!detail) return;
    if (!propFile && !propLink.trim() && !propNotes.trim()) {
      notify("Attach a PDF, paste a link, or write a summary first");
      return;
    }
    setPropBusy(true);
    try {
      await apiFetch(`/flow/projects/${detail.id}/proposal`, {
        method: "PUT",
        body: JSON.stringify({
          title: propTitle.trim() || "Final proposal",
          fileUrl: propFile?.fileUrl ?? undefined,
          fileName: propFile?.fileName ?? undefined,
          link: propLink.trim() ? withProtocol(propLink) : undefined,
          notes: propNotes.trim() || undefined,
          amount: propAmount.trim() ? Number(propAmount) : undefined,
          status: propStatus,
        }),
      });
      setProposalOpen(false);
      reload();
      notify(detail.proposal ? "Proposal updated" : "Proposal saved");
    } catch (e: any) { notify(e.message ?? "Save failed"); } finally { setPropBusy(false); }
  };

  const deleteProposal = async () => {
    if (!detail?.proposal) return;
    if (!window.confirm("Remove this project's proposal? You can add a new one afterwards.")) return;
    try {
      await apiFetch(`/flow/projects/${detail.id}/proposal`, { method: "DELETE" });
      setProposalOpen(false);
      reload();
      notify("Proposal removed");
    } catch (e: any) { notify(e.message ?? "Delete failed"); }
  };

  // ── Bulk task assign handlers ────────────────────────────────────
  const toggleBulkSelected = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doBulkAssign = async () => {
    if (!detail || bulkSelected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ count: number; rejected: string[] }>(`/flow/projects/${detail.id}/tasks/bulk`, {
        method: "POST",
        body: JSON.stringify({ taskIds: Array.from(bulkSelected) }),
      });
      const skipped = res?.rejected?.length ?? 0;
      notify(`${res?.count ?? 0} task(s) assigned to ${detail.name}${skipped ? ` · ${skipped} skipped (another client)` : ""}`);
      setBulkOpen(false);
      setBulkSelected(new Set());
      reload();
    } catch (e: any) { notify(e.message ?? "Bulk assign failed"); } finally { setBulkBusy(false); }
  };

  // ── Deliverables + reports live in their own tab components ───────
  const riskBar = (score: number | null) => {
    const s = score ?? 0;
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${s >= 60 ? "bg-rose-500" : s >= 35 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(s, 100)}%` }} />
        </div>
        <span className="text-meta font-semibold tabular-nums text-muted-foreground">{s}</span>
      </div>
    );
  };

  const budgetPct = (p: ProjectRow) => {
    const budget = (p as any).amount ?? p.budgetAmount;
    if (!budget) return 0;
    return Math.min(100, Math.round(((p.spentAmount ?? (p as any).budgetSpent ?? 0) / budget) * 100));
  };

  const budgetBar = (p: ProjectRow) => {
    const pct = budgetPct(p);
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-meta font-semibold tabular-nums text-muted-foreground">{money(p.spentAmount ?? (p as any).budgetSpent ?? 0, p.currency)} / {money((p as any).amount ?? p.budgetAmount, p.currency)}</span>
      </div>
    );
  };

  const badge = (style: string, text: string) => (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide", style)}>{text}</span>
  );

  const progressBar = (p: ProjectRow) => {
    const prog = p.progress ?? 0;
    return (
      <div>
        <div className="flex items-center justify-between text-micro text-muted-foreground">
          <span className="font-semibold">Progress</span>
          <span className="font-bold tabular-nums">{prog}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(prog, 100)}%` }} />
        </div>
      </div>
    );
  };

  const ProjectCard = ({ p, kanban = false }: { p: ProjectRow; kanban?: boolean }) => (
    <div
      draggable={kanban}
      onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => setDragId(null)}
      onClick={() => openProject(p.id)}
      role="button"
      tabIndex={0}
      aria-label={`Open project ${p.name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openProject(p.id);
        }
      }}
      className={cn(
        "group rounded-2xl border bg-card p-3.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        dragId === p.id ? "border-primary/50 opacity-40" : "border-border hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5",
        kanban && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {p.category && badge("border-border bg-muted/60 text-muted-foreground", p.category)}
          {badge(PRIORITY_STYLE[p.priority ?? "MEDIUM"] ?? PRIORITY_STYLE.MEDIUM, p.priority ?? "MEDIUM")}
          {p.billingType === "RECURRING" && badge("border-primary/30 bg-primary/10 text-primary", "recurring")}
        </div>
        <span className="text-micro font-bold tabular-nums text-muted-foreground">{p.uid ?? ""}</span>
      </div>
      <h3 className="mt-2.5 truncate text-body-lg font-bold">{p.name}</h3>
      <p className="mt-0.5 truncate text-meta text-muted-foreground">{p.client.companyName}{p.assignedPm ? ` · PM: ${p.assignedPm.name}` : ""}</p>
      <div className="mt-3">{progressBar(p)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {badge(STATUS_STYLE[p.status] ?? STATUS_STYLE.PLANNING, label(p.status))}
        {p.targetEndDate && (
          <span className="flex items-center gap-1 text-micro text-muted-foreground">
            <Calendar className="size-3.5" /> {formatDate(p.targetEndDate)}
          </span>
        )}
        <span className="ml-auto text-micro font-semibold tabular-nums text-muted-foreground">
          {p.tasksCompleted ?? 0}/{p.tasksTotal ?? 0} tasks
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <div className="flex items-center gap-1.5">
          {p.team?.length ? (
            <div className="flex -space-x-1.5">
              {p.team.slice(0, 3).map((n, i) => <Avatar key={i} name={n} size="size-5" />)}
              {p.team.length > 3 && <span className="flex size-5 items-center justify-center rounded-full border border-border bg-muted text-micro font-bold text-muted-foreground">+{p.team.length - 3}</span>}
            </div>
          ) : (
            <span className="text-micro text-muted-foreground">no team</span>
          )}
          <span className="text-micro font-semibold tabular-nums text-muted-foreground">{money(p.spentAmount ?? p.budgetSpent ?? 0, p.currency)} / {money(p.budgetAmount, p.currency)}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); openProject(p.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="View">
            <Eye className="size-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setEditTarget(p); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Edit">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  const fileIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return <Image className="size-4" />;
    if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="size-4" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FileArchive className="size-4" />;
    return <FileText className="size-3.5" />;
  };

  const fileSize = (n: number | null | undefined) =>
    n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n ?? 0) / 1024))} KB`;

  const clearFilters = () => {
    setQ(""); setStatusFilter(""); setHealthFilter(""); setClientFilter(""); setManagerFilter("");
  };

  const hasFilters = !!(q || statusFilter || healthFilter || clientFilter || managerFilter);
  const activeFilterCount = [q, clientFilter, managerFilter, statusFilter, healthFilter].filter(Boolean).length;

  return (
    <div>
      {flash && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-body font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}
      {/* The list only exists on /flow — /flow/<id> is the workspace. */}
      {!projectId && (
        <>
      <PageHeader
        title="Flow"
        subtitle="Projects, budgets and delivery health in one place."
        actions={
          <>
            <Segmented
              options={[{ value: "projects", label: "Projects" }, { value: "capacity", label: "Capacity" }]}
              value={tab}
              onChange={setTab}
            />
            <Btn variant="ghost" onClick={exportCsv}>
              <Download className="size-3.5" /> Export
            </Btn>
            <Btn variant="ghost" onClick={() => importRef.current?.click()} className={importing ? "opacity-50" : ""}>
              <Upload className="size-3.5" /> {importing ? "Importing…" : "Import"}
            </Btn>
            <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onPickImport} />
            <Btn variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New Project
            </Btn>
          </>
        }
      />
      {tab === "projects" ? (
        <>
          {/* Portfolio band — one glance at size, mix and money. */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-heading text-page font-bold leading-none tabular-nums">{stats.total}</span>
                  <span className="text-body font-semibold text-muted-foreground">projects</span>
                  <span className="ml-2 text-meta font-semibold text-emerald-500">{stats.active} running</span>
                </div>
                <span className="text-meta font-semibold text-muted-foreground">
                  {overview?.completion != null ? `${overview.completion}% of all tasks done` : ""}
                </span>
              </div>
              <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-full bg-muted">
                {PROJECT_STATUSES.map((s) => {
                  const n = (projects ?? []).filter((p) => p.status === s).length;
                  if (!n) return null;
                  return <div key={s} className={cn("h-full", STATUS_BAR[s])} style={{ width: `${(n / Math.max(stats.total, 1)) * 100}%` }} title={`${label(s)}: ${n}`} />;
                })}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                {PROJECT_STATUSES.map((s) => {
                  const n = (projects ?? []).filter((p) => p.status === s).length;
                  if (!n) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter((v) => (v === s ? "" : s))}
                      className={cn("flex items-center gap-1.5 text-meta font-semibold transition-opacity hover:opacity-70", statusFilter === s ? "text-foreground" : "text-muted-foreground")}
                    >
                      <span className={cn("size-2 rounded-sm", STATUS_BAR[s])} />
                      {label(s)}
                      <span className="tabular-nums text-foreground">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Budget burn</span>
                <span className={cn("text-meta font-bold tabular-nums", stats.budget && stats.spent / stats.budget >= 0.9 ? "text-rose-500" : "text-muted-foreground")}>
                  {stats.totals.length === 1 && stats.budget ? `${Math.round((stats.spent / stats.budget) * 100)}%` : "—"}
                </span>
              </div>
              {stats.totals.length ? (
                <div className="mt-1 flex flex-col gap-0.5">
                  {stats.totals.map((t) => (
                    <div key={t.currency} className="flex items-baseline justify-between gap-2">
                      <span className="font-heading text-title font-bold tabular-nums">{money(t.spent, t.currency)}</span>
                      <span className="text-micro tabular-nums text-muted-foreground">of {money(t.budget, t.currency)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 font-heading text-stat font-bold tabular-nums">—</p>
              )}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", stats.budget && stats.spent / stats.budget >= 0.9 ? "bg-rose-500" : stats.budget && stats.spent / stats.budget >= 0.7 ? "bg-amber-400" : "bg-emerald-500")}
                  style={{ width: `${stats.budget ? Math.min(100, Math.round((stats.spent / stats.budget) * 100)) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-micro text-muted-foreground">
                {stats.totals.length === 1
                  ? `${money(Math.max(0, stats.budget - stats.spent), stats.totals[0].currency)} remaining`
                  : `${stats.totals.length} currencies — totals shown per currency`}
              </p>
            </div>
          </div>
          {stats.atRisk > 0 && (
            <button onClick={() => setHealthFilter("AT_RISK")} className="mt-3 flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-left text-meta font-semibold text-amber-500 transition-colors hover:bg-amber-500/15">
              <AlertTriangle className="size-3.5" /> {stats.atRisk} project{stats.atRisk > 1 ? "s" : ""} at risk or delayed — click to filter
            </button>
          )}
          <div className="mt-4">
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:min-w-44 sm:max-w-sm sm:flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search projects, clients, uid…"
                    className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <Btn variant="outline" onClick={() => setAdvanced((v) => !v)}>
                  <SlidersHorizontal className="size-3.5" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Btn>
                {hasFilters && (
                  <button onClick={clearFilters} className="flex items-center gap-1 text-meta font-bold text-primary hover:underline">
                    <X className="size-3.5" /> Clear all
                  </button>
                )}
                <span className="ml-auto text-meta font-semibold tabular-nums text-muted-foreground">
                  {filtered.length} project{filtered.length === 1 ? "" : "s"}
                </span>
                <Segmented
                  label="Project view"
                  options={[
                    { value: "table", label: <List className="size-4" aria-hidden="true" />, ariaLabel: "Table view" },
                    { value: "grid", label: <LayoutGrid className="size-4" aria-hidden="true" />, ariaLabel: "Grid view" },
                    { value: "kanban", label: <SquareKanban className="size-4" aria-hidden="true" />, ariaLabel: "Board view" },
                  ]}
                  value={view}
                  onChange={(v) => setViewWithUrl(v as any)}
                />
              </div>
              {activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {q && <FilterPill label={`"${q}"`} onClear={() => setQ("")} />}
                  {clientFilter && <FilterPill label={(clients ?? []).find((c) => c.id === clientFilter)?.companyName ?? "Client"} onClear={() => setClientFilter("")} />}
                  {managerFilter && <FilterPill label={(managers ?? []).find((m) => m.id === managerFilter)?.name ?? "Manager"} onClear={() => setManagerFilter("")} />}
                  {statusFilter && <FilterPill label={label(statusFilter)} onClear={() => setStatusFilter("")} />}
                  {healthFilter && <FilterPill label={label(healthFilter)} onClear={() => setHealthFilter("")} />}
                </div>
              )}
              {advanced && (
                <div className="grid grid-cols-2 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2 sm:flex sm:flex-wrap">
                  <Select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="w-full sm:!w-40">
                    <option value="">All clients</option>
                    {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </Select>
                  <Select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="w-full sm:!w-40">
                    <option value="">All managers</option>
                    {(managers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:!w-36">
                    <option value="">All statuses</option>
                    {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </Select>
                  <Select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="w-full sm:!w-32">
                    <option value="">All health</option>
                    {HEALTH_STATUSES.map((h) => <option key={h} value={h}>{label(h)}</option>)}
                  </Select>
                </div>
              )}
            </div>
            {loading ? (
              <div className="flex flex-col gap-2">
                {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
              </div>
            ) : err ? (
              <EmptyState title={err} hint="Check your connection and try again." />
            ) : filtered.length ? (
              <FadeIn>
                {view === "grid" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {filtered.map((p) => <ProjectCard key={p.id} p={p} />)}
                  </div>
                )}
                {view === "table" && (
                  <TableShell
                    footer={
                      <>
                        <span className="text-meta text-muted-foreground">{filtered.length} projects · on-time rate {overview?.onTimeRate ?? "—"}%</span>
                        <Btn variant="ghost" onClick={() => setTab("capacity")}>Capacity planner</Btn>
                      </>
                    }
                  >
                    <table className="w-full">
                      <THead>
                        <Th>Project</Th>
                        <Th>Status</Th>
                        <Th>Priority</Th>
                        <Th>Progress</Th>
                        <Th>Budget / Spent</Th>
                        <Th>Due</Th>
                        <Th />
                      </THead>
                      <tbody>
                        {filtered.map((p, i) => (
                          <Tr key={p.id} index={i} onClick={() => openProject(p.id)} className="cursor-pointer">
                            <Td>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={p.client.companyName} />
                                <div>
                                  <p className="flex items-center gap-1.5 font-medium">
                                    {p.name}
                                    {p.uid && <span className="text-micro font-semibold text-muted-foreground">{p.uid}</span>}
                                  </p>
                                  <p className="text-meta text-muted-foreground">{p.client.companyName}{p.assignedPm ? ` · ${p.assignedPm.name}` : ""}{p.category ? ` · ${p.category}` : ""}</p>
                                </div>
                              </div>
                            </Td>
                            <Td onClick={(e) => e.stopPropagation()}>
                              <span
                                className={cn(
                                  "relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide",
                                  STATUS_STYLE[p.status] ?? STATUS_STYLE.PLANNING
                                )}
                                title="Move to another status"
                              >
                                {label(p.status)}
                                <ChevronDown className="size-3.5 opacity-50" />
                                <select
                                  value={p.status}
                                  onChange={(e) => patchStatus(p, e.target.value)}
                                  className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
                                  aria-label="Project status"
                                >
                                  {PROJECT_STATUSES.map((s) => (
                                    <option key={s} value={s}>{label(s)}</option>
                                  ))}
                                </select>
                              </span>
                            </Td>
                            <Td>{badge(PRIORITY_STYLE[p.priority ?? "MEDIUM"] ?? PRIORITY_STYLE.MEDIUM, p.priority ?? "MEDIUM")}</Td>
                            <Td className="font-semibold tabular-nums">{p.progress != null ? `${p.progress}%` : "—"}</Td>
                            <Td>{budgetBar(p)}</Td>
                            <Td className="text-muted-foreground">{formatDate(p.targetEndDate)}</Td>
                            <Td>
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditTarget(p); }}
                                  className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                                  title="Edit"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                                  aria-label={`Delete project ${p.name}`}
                                  className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </table>
                  </TableShell>
                )}
                {view === "kanban" && (
                  <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
                    {byStatus.map((col) => (
                      <div
                        key={col.status}
                        className={cn("w-[85vw] max-w-[300px] shrink-0 snap-start rounded-2xl border bg-muted/30 p-2.5 sm:w-64 sm:max-w-none", dragId && "border-dashed")}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          const p = projects?.find((x) => x.id === dragId);
                          if (p && p.status !== col.status) patchStatus(p, col.status);
                          setDragId(null);
                        }}
                      >
                        <div className="mb-2.5 flex items-center justify-between px-1">
                          <span className="flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase">
                            <span className={cn("size-1.5 rounded-full", STATUS_STYLE[col.status].split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted")} />
                            {label(col.status)}
                          </span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground">{col.items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {col.items.map((p) => <ProjectCard key={p.id} p={p} kanban />)}
                          {!col.items.length && (
                            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-micro text-muted-foreground">Drop projects here</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </FadeIn>
            ) : (
              <EmptyState title="No projects found" hint="Adjust filters or create a new project." />
            )}
          </div>
        </>
      ) : (
        <div>
          {capLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
            </div>
          ) : capErr ? (
            <EmptyState title={capErr} hint="Check your connection and try again." />
          ) : capRows.length ? (
            <FadeIn>
              <TableShell
                footer={
                  <span className="text-meta text-muted-foreground">
                    {capRows.length} active {capRows.length === 1 ? "person" : "people"} · {capWindow.capacityHours || 160}h capacity each (rolling 4 weeks)
                  </span>
                }
              >
                <table className="w-full">
                  <THead>
                    <Th>Member</Th>
                    <Th>Projects</Th>
                    <Th>Logged</Th>
                    <Th>Capacity</Th>
                    <Th>Utilization</Th>
                    <Th>Status</Th>
                  </THead>
                  <tbody>
                    {capRows.map((e, i) => (
                      <Tr key={e.id} index={i}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={e.name} size="size-7" />
                            <div className="min-w-0">
                              <p className="font-medium">{e.name}</p>
                              <p className="text-micro text-muted-foreground">{e.roleTitle || e.department || "—"}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          {e.projects.length ? (
                            <div className="flex max-w-[340px] flex-wrap gap-1">
                              {e.projects.slice(0, 3).map((p) => (
                                <span key={p.projectId} className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-micro font-semibold text-muted-foreground">
                                  {p.projectName} · {p.hours}h
                                </span>
                              ))}
                              {e.projects.length > 3 && (
                                <span className="text-micro font-semibold text-muted-foreground">+{e.projects.length - 3} more</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-meta text-muted-foreground">no logged time</span>
                          )}
                        </Td>
                        <Td className="font-semibold tabular-nums">{e.totalHours}h</Td>
                        <Td className="text-muted-foreground tabular-nums">{e.capacityHours}h</Td>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <ProgressRing value={Math.min(100, Math.max(0, e.utilizationPct))} size={40} label={`${e.utilizationPct}%`} />
                            <span className="text-meta text-muted-foreground">
                              {e.capacityHours ? `${Math.round((e.totalHours / e.capacityHours) * 100)}% of capacity` : "—"}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          {e.utilizationPct > 100 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-micro font-bold text-rose-400">
                              <AlertTriangle className="size-3.5" /> overbooked
                            </span>
                          ) : e.utilizationPct >= 85 ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-micro font-bold text-amber-400">near limit</span>
                          ) : (
                            <span className="text-meta text-muted-foreground">healthy</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          ) : (
            <EmptyState title="No capacity data" hint="Assign team members to projects to see utilization." />
          )}
        </div>
      )}
        </>
      )}
      <Modal
        open={!!selectedId}
        onClose={closeProject}
        size="full"
        bare={!!projectId}
        bodyClassName="!px-0"
        title={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <Avatar name={detail?.name ?? detail?.client?.companyName ?? "?"} src={detail?.logoUrl} jxlSrc={detail?.logoJxlUrl} rounded="rounded-xl" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate font-heading text-section font-bold leading-tight">{detail?.name ?? "Project"}</h3>
                {detail && (
                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide", STATUS_STYLE[detail.status] ?? STATUS_STYLE.PLANNING)}>
                    {label(detail.status)}
                  </span>
                )}
                {detail && (
                  <span className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide",
                    detail.healthStatus === "ON_TRACK" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : detail.healthStatus === "AT_RISK" ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-500"
                  )}>
                    {label(detail.healthStatus)}
                  </span>
                )}
              </div>
              {detail && (
                <p className="truncate text-meta text-muted-foreground">
                  {detail.client?.companyName ?? ""}
                  {detail.uid ? " · " + detail.uid : ""}
                  {detail.category ? " · " + detail.category : ""}
                  {detail.startDate ? " · started " + formatDate(detail.startDate) : ""}
                </p>
              )}
            </div>
            {detail && (
              <div className="ml-auto flex min-w-0 items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1">
                  <Avatar name={detail.assignedPm?.name ?? "?"} size="size-5" />
                  <Select
                    value={detail.assignedPm?.id ?? ""}
                    onChange={(e) => assignPm(e.target.value)}
                    className={cn("!w-32 !border-0 !bg-transparent !py-0.5 text-meta font-semibold", pmBusy ? "opacity-50" : "")}
                    title="Project manager"
                  >
                    <option value="">Unassigned</option>
                    {(managers ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                </div>
                <Btn
                  variant="outline"
                  onClick={viewProposal}
                  className="!px-2.5 !py-1.5 text-meta"
                  title={detail.proposal ? "Open the final proposal" : "Add the final proposal"}
                >
                  <FileText className="size-3.5" /> {detail.proposal ? "Proposal" : "Add proposal"}
                </Btn>
                <button
                  onClick={() => setEditTarget(detail)}
                  title="Edit project"
                  className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(detail)}
                  title="Delete project"
                  className="flex size-8 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        }
      >
        {detailLoading ? (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
          </div>
        ) : !detail ? null : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* ── status pipeline — click to move ── */}
            <section className="rounded-2xl border border-border/60 bg-muted/10 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Status — click to move</p>
                {detail.status === "COMPLETED" && <span className="text-micro font-semibold text-emerald-400">delivered ✓</span>}
                {detail.status === "ARCHIVED" && <span className="text-micro font-semibold text-muted-foreground">archived</span>}
              </div>
              <div className="mt-2.5 flex items-center gap-1 overflow-x-auto pb-0.5">
                {(["PLANNING", "ACTIVE", "COMPLETED"] as const).map((s, i, arr) => {
                  const order = ["PLANNING", "ACTIVE", "COMPLETED"];
                  const curIdx = order.indexOf(detail.status);
                  const isCurrent = detail.status === s;
                  const isDone = curIdx >= 0 && i < curIdx && detail.status !== "PAUSED";
                  return (
                    <div key={s} className="flex items-center gap-1">
                      {i > 0 && <div className={cn("h-0.5 w-4 shrink-0 rounded-full sm:w-6", isDone ? "bg-primary/50" : "bg-border")} />}
                      <button
                        onClick={() => patchProject({ status: s })}
                        className={cn(
                          "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-micro font-bold transition-colors",
                          isCurrent && s === "COMPLETED" && "border-primary bg-primary text-primary-foreground shadow-sm",
                          isCurrent && s !== "COMPLETED" && "border-primary bg-primary text-primary-foreground shadow-sm",
                          !isCurrent && isDone && "border-primary/30 bg-primary/10 text-primary",
                          !isCurrent && !isDone && "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        {isDone && !isCurrent && <CheckCircle2 className="size-3.5" />}
                        {label(s)}
                      </button>
                    </div>
                  );
                })}
                {detail.status === "PAUSED" ? (
                  <button
                    onClick={() => patchProject({ status: "ACTIVE" })}
                    className="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500 text-micro font-bold text-white shadow-sm"
                  >
                    paused — resume?
                  </button>
                ) : (
                  <button
                    onClick={() => patchProject({ status: "PAUSED" })}
                    className="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-micro font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                  >
                    hold
                  </button>
                )}
                {detail.status !== "ARCHIVED" && (
                  <button
                    onClick={() => patchProject({ status: "ARCHIVED" })}
                    className="ml-1 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-micro font-bold text-muted-foreground transition-colors hover:bg-muted/60"
                    title="Archive project"
                  >
                    archive
                  </button>
                )}
              </div>
            </section>

            {/* ── KPI strip ── */}
            <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/40 lg:grid-cols-6">
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">Progress</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, detail.progress ?? 0)}%` }} />
                  </div>
                  <span className="text-body font-bold tabular-nums">{detail.progress ?? 0}%</span>
                </div>
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{detail.tasksCompleted ?? 0}/{detail.tasksTotal ?? detail.tasks.length} tasks</p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">Budget</p>
                <p className="mt-0.5 truncate font-heading text-body-lg font-bold tabular-nums">{(detail as any).amount != null || detail.budgetAmount != null ? money((detail as any).amount ?? detail.budgetAmount, detail.currency) : "—"}</p>
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{money(detail.spentAmount ?? (detail as any).budgetSpent ?? 0, detail.currency)} spent · {budgetPct(detail)}%</p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">Invoiced</p>
                <p className="mt-0.5 truncate font-heading text-body-lg font-bold tabular-nums">{money(finance?.totalInvoiced ?? detail.totalBilled, detail.currency)}</p>
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{finance?.invoices?.length ?? 0} invoices</p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">Collected</p>
                <p className="mt-0.5 truncate font-heading text-body-lg font-bold tabular-nums text-emerald-400">{money(finance?.collected ?? 0, detail.currency)}</p>
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{detail.paymentStatus ? label(detail.paymentStatus) : "—"}</p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">Outstanding</p>
                <p className={cn("mt-0.5 truncate font-heading text-body-lg font-bold tabular-nums", Number(finance?.outstanding ?? 0) > 0 ? "text-amber-400" : "text-emerald-400")}>{money(finance?.outstanding, detail.currency)}</p>
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{finance?.expensesTotal ? `${money(finance.expensesTotal, detail.currency)} exp` : "no expenses"}</p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-micro font-bold tracking-wide text-muted-foreground uppercase">{detail.billingType === "RECURRING" ? "Next billing" : "Due"}</p>
                {(() => {
                  if (detail.billingType === "RECURRING" && detail.nextBillingDate) {
                    return <p className="mt-0.5 truncate text-body font-bold text-primary">{formatDate(detail.nextBillingDate)}</p>;
                  }
                  if (!detail.targetEndDate) return <p className="mt-0.5 text-body font-semibold text-muted-foreground/60">no date</p>;
                  const overdue = new Date(detail.targetEndDate).getTime() < Date.now() && detail.status !== "COMPLETED";
                  return (
                    <p className={cn("mt-0.5 truncate text-body font-bold", overdue ? "text-rose-400" : "text-foreground")}>
                      {overdue ? "overdue · " : ""}{formatDate(detail.targetEndDate)}
                    </p>
                  );
                })()}
                <p className="mt-0.5 truncate text-micro text-muted-foreground">start {formatDate(detail.startDate)}</p>
              </div>
            </section>

            {/* ── workspace: vertical rail + scrollable pane ── */}
            <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
              <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-40 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-0 sm:py-1 sm:pr-2">
                {([
                  { id: "overview", name: "Overview", icon: LayoutGrid },
                  { id: "proposal", name: "Proposal", icon: FileText, count: detail.proposal ? 1 : 0 },
                  { id: "deliverables", name: "Deliverables", icon: ClipboardList, count: detail.deliverables?.length ?? 0 },
                  { id: "shoot", name: "Shoot", icon: Camera, count: detail.shoots?.length ?? 0 },
                  { id: "tasks", name: "Tasks", icon: SquareKanban, count: detail.tasks.length },
                  { id: "milestones", name: "Milestones", icon: Calendar, count: detail.milestones.length },
                  { id: "files", name: "Files", icon: FileText, count: detail.files.length },
                  { id: "finance", name: "Finance", icon: Wallet, count: finance?.invoices?.length ?? 0 },
                  { id: "reports", name: "Reports", icon: History, count: detail.reports?.length ?? 0 },
                  { id: "discussions", name: "Discussion", icon: Send },
                  { id: "references", name: "Docs & Links", icon: FileArchive, count: references?.length },
                ] as { id: typeof detailTab; name: string; icon: typeof LayoutGrid; count?: number }[]).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectDetailTab(t.id)}
                    className={cn(
                      "relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-body font-semibold transition-colors sm:w-full",
                      detailTab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <t.icon className="size-3.5 shrink-0" />
                    <span className="truncate">{t.name}</span>
                    {t.count != null && t.count > 0 && (
                      <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-micro font-bold tabular-nums text-muted-foreground">{t.count}</span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="min-w-0 flex-1 overflow-y-auto py-3 pr-1 sm:pl-5">
            {detailTab === "overview" && (
              <div className="flex flex-col gap-5">
                {/* ── project glimpse — what is this project ── */}
                <section className="rounded-2xl border border-border/60 bg-muted/10 p-4">
                  {/* chips: type, category, billing, priority, health */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.type && (
                      <span className="rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-micro font-bold uppercase tracking-wide text-primary">{label(detail.type)}</span>
                    )}
                    {detail.category && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 text-micro font-bold text-foreground">{detail.category}</span>
                    )}
                    {detail.billingType && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-micro font-bold text-primary">
                        {label(detail.billingType)}{detail.recurringInterval ? ` · ${detail.recurringInterval}` : ""}
                      </span>
                    )}
                    {detail.priority && (
                      <span className={cn("rounded-full border px-2.5 py-1 text-micro font-bold uppercase", PRIORITY_STYLE[detail.priority])}>{label(detail.priority)}</span>
                    )}
                    <span className={cn("rounded-full border px-2.5 py-1 text-micro font-bold uppercase", detail.healthStatus === "ON_TRACK" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : detail.healthStatus === "AT_RISK" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400")}>
                      {label(detail.healthStatus)}
                    </span>
                  </div>

                  {/* description — inline editable */}
                  <div className="mt-2.5">
                    {descEdit ? (
                      <div className="flex flex-col gap-1.5">
                        <Textarea
                          value={descDraft}
                          onChange={(e) => setDescDraft(e.target.value)}
                          placeholder="What is this project about? Scope, goals, commitments…"
                          autoFocus
                          className="min-h-16"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setDescEdit(false)} className="rounded-lg px-2 py-1 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted">Cancel</button>
                          <button onClick={saveDescription} disabled={descBusy} className="rounded-lg bg-brand-gradient px-2.5 py-1 text-meta font-bold text-white disabled:opacity-60">{descBusy ? "Saving…" : "Save"}</button>
                        </div>
                      </div>
                    ) : (detail as any).description ? (
                      <div className="group/desc">
                        <p className={cn("text-body leading-relaxed text-muted-foreground whitespace-pre-wrap", !descExpanded && "line-clamp-3")}>
                          {(detail as any).description}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {(detail as any).description.length > 140 && (
                            <button onClick={() => setDescExpanded((v) => !v)} className="text-micro font-bold text-primary hover:underline">
                              {descExpanded ? "show less" : "read more"}
                            </button>
                          )}
                          <button
                            onClick={() => { setDescEdit(true); setDescDraft((detail as any).description ?? ""); }}
                            className="flex items-center gap-1 text-micro font-bold text-muted-foreground transition-colors hover:text-foreground"
                            title="Edit the project description"
                          >
                            <Pencil className="size-3.5" /> edit description
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setDescEdit(true); setDescDraft(""); }}
                        className="flex items-center gap-1 text-meta font-bold text-primary transition-colors hover:underline"
                      >
                        <Plus className="size-3.5" /> add description — what is this project about?
                      </button>
                    )}
                  </div>

                  {/* channels — client web & social */}
                  <div className="mt-3 border-t border-border/50 pt-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Channels — web &amp; social</p>
                      <button
                        onClick={() => setChannelsOpen(true)}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-micro font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Add or edit the website, social handles and docs"
                      >
                        <Pencil className="size-3.5" /> edit links
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(detail as any).websiteUrl && (
                        <a href={(detail as any).websiteUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-meta font-bold text-sky-400 transition-colors hover:bg-sky-500/20" title={(detail as any).websiteUrl}>
                          <Globe className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).projectLink && (
                        <a href={(detail as any).projectLink} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-meta font-bold text-primary transition-colors hover:bg-primary/20" title={(detail as any).projectLink}>
                          <Globe className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">live · {(detail as any).projectLink.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.facebook && (
                        <a href={(detail as any).socialLinks.facebook} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-meta font-bold text-blue-500 transition-colors hover:bg-blue-500/20" title={(detail as any).socialLinks.facebook}>
                          <Facebook className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.facebook.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.instagram && (
                        <a href={(detail as any).socialLinks.instagram} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-pink-500/30 bg-pink-500/10 px-2.5 py-1.5 text-meta font-bold text-pink-500 transition-colors hover:bg-pink-500/20" title={(detail as any).socialLinks.instagram}>
                          <Instagram className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.instagram.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.linkedin && (
                        <a href={(detail as any).socialLinks.linkedin} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-sky-600/30 bg-sky-600/10 px-2.5 py-1.5 text-meta font-bold text-sky-400 transition-colors hover:bg-sky-600/20" title={(detail as any).socialLinks.linkedin}>
                          <Linkedin className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.linkedin.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.youtube && (
                        <a href={(detail as any).socialLinks.youtube} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-meta font-bold text-red-400 transition-colors hover:bg-red-500/20" title={(detail as any).socialLinks.youtube}>
                          <Youtube className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.youtube.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.tiktok && (
                        <a href={(detail as any).socialLinks.tiktok} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-teal-500/30 bg-teal-500/10 px-2.5 py-1.5 text-meta font-bold text-teal-300 transition-colors hover:bg-teal-500/20" title={(detail as any).socialLinks.tiktok}>
                          <Music2 className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.tiktok.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {(detail as any).socialLinks?.x && (
                        <a href={(detail as any).socialLinks.x} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-muted/60 px-2.5 py-1.5 text-meta font-bold text-foreground transition-colors hover:bg-muted" title={(detail as any).socialLinks.x}>
                          <Twitter className="size-3.5 shrink-0" /> <span className="max-w-40 truncate">{(detail as any).socialLinks.x.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                        </a>
                      )}
                      {detail.briefLink && (
                        <a href={detail.briefLink} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-meta font-bold text-primary transition-colors hover:bg-primary/20" title={detail.briefLink}>
                          <FileText className="size-3.5 shrink-0" /> brief
                        </a>
                      )}
                      {detail.driveLink && (
                        <a href={detail.driveLink} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-meta font-bold text-sky-400 transition-colors hover:bg-sky-500/20" title={detail.driveLink}>
                          <FileArchive className="size-3.5 shrink-0" /> drive
                        </a>
                      )}
                      {detail.researchLink && (
                        <a href={detail.researchLink} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-meta font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20" title={detail.researchLink}>
                          <Search className="size-3.5 shrink-0" /> research
                        </a>
                      )}
                      {!(detail as any).websiteUrl && !(detail as any).projectLink && !(detail as any).socialLinks?.facebook && !(detail as any).socialLinks?.instagram && !(detail as any).socialLinks?.linkedin && !(detail as any).socialLinks?.youtube && !(detail as any).socialLinks?.tiktok && !(detail as any).socialLinks?.x && (
                        <button onClick={() => setChannelsOpen(true)} className="flex items-center gap-1 text-meta font-bold text-primary hover:underline">
                          <Plus className="size-3.5" /> add channels — website, social pages
                        </button>
                      )}
                    </div>
                  </div>
                </section>
                {/* health & risk — computed by the scoring engine */}
                <section className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase">
                      <AlertTriangle className="size-3.5" /> Health &amp; risk
                      <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-micro font-bold text-violet-400">
                        computed
                      </span>
                    </h4>
                    <Select
                      value={detail.healthStatusOverride ?? "AUTO"}
                      onChange={(e) => setHealthOverride(e.target.value)}
                      className="!w-44 !py-1.5 text-meta"
                      title="AUTO uses the engine's derived level. Picking a level stores a manual override."
                    >
                      <option value="AUTO">AUTO (computed)</option>
                      {HEALTH_STATUSES.map((h) => (
                        <option key={h} value={h}>{label(h)} — override</option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                      <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Health</p>
                      <p className="text-stat font-heading font-semibold tabular-nums">
                        {detail.riskScore != null ? 100 - detail.riskScore : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                      <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Risk</p>
                      <p className="text-stat font-heading font-semibold tabular-nums">{detail.riskScore ?? "—"}</p>
                    </div>
                    <Field label="PM confidence (1–5)">
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={confidence}
                        onChange={(e) => setConfidence(e.target.value)}
                        placeholder="—"
                        className="!w-24"
                      />
                    </Field>
                    <Btn variant="outline" onClick={saveRisk} className={riskBusy ? "opacity-50" : ""}>
                      <RefreshCw className="size-3.5" /> Save
                    </Btn>
                  </div>
                  {Array.isArray((detail as any).healthBreakdown?.breakdown) && (
                    <div className="mt-3 space-y-1.5">
                      {(detail as any).healthBreakdown.breakdown.map((f: any) => (
                        <div key={f.code} className="flex items-center gap-2 text-micro">
                          <span className="w-32 truncate font-medium text-muted-foreground">{f.label}</span>
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
                          <span className="w-16 text-right tabular-nums text-muted-foreground">
                            {f.subScore == null ? "no data" : `${f.subScore}/100`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.riskDriver && (
                    <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta font-semibold text-amber-400">
                      <AlertTriangle className="size-3.5" /> {detail.riskDriver}
                    </p>
                  )}
                </section>
                {/* Gantt-like milestone bars */}
                {detail.milestones && detail.milestones.length > 0 && (
                  <section className="rounded-2xl border border-border/60 p-3">
                    <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase"><Calendar className="size-3.5" /> Timeline (Gantt)</h4>
                    <div className="flex flex-col gap-1.5">
                      {detail.milestones.slice(0, 6).map((m) => {
                        const done = m.status === "COMPLETED";
                        const prog = m.status === "IN_PROGRESS" ? 55 : done ? 100 : 10;
                        return (
                          <div key={m.id} className="flex items-center gap-2">
                            <span className="w-28 truncate text-meta font-medium">{m.name}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${done ? "bg-emerald-500" : prog > 10 ? "bg-primary" : "bg-muted-foreground/30"}`} style={{ width: `${prog}%` }} /></div>
                            <span className="text-micro text-muted-foreground">{formatDate(m.dueDate)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
                {detail.sourceLead && (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                    <p className="mb-2.5 flex items-center gap-1.5 text-meta font-bold tracking-wide text-primary uppercase">
                      <Rocket className="size-3.5" /> Onboarded from lead
                    </p>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div>
                        <p className="text-micro font-bold text-muted-foreground uppercase">Lead</p>
                        <p className="text-body font-semibold">{detail.sourceLead.name}</p>
                        <p className="text-micro text-muted-foreground">{detail.sourceLead.company ?? "—"} · source: {label(detail.sourceLead.source)} · {label(detail.sourceLead.vertical)}</p>
                      </div>
                      <div>
                        <p className="text-micro font-bold text-muted-foreground uppercase">Deal size</p>
                        <p className="text-body font-semibold tabular-nums">{money(detail.sourceLead.estimatedDealSize, detail.currency)}</p>
                      </div>
                      <div>
                        <p className="text-micro font-bold text-muted-foreground uppercase">Contact</p>
                        <p className="text-body font-semibold">{detail.sourceLead.contactEmail ?? detail.sourceLead.contactPhone ?? "—"}</p>
                      </div>
                      {detail.sourceProposal ? (
                        <div className="ml-auto">
                          <p className="text-micro font-bold text-muted-foreground uppercase">Proposal v{detail.sourceProposal.versionNumber}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge status={detail.sourceProposal.status} />
                            {detail.sourceProposal.fileUrl && (
                              <a href={absoluteUrl(detail.sourceProposal.fileUrl)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-meta font-bold text-primary hover:underline">
                                <FileText className="size-3.5" /> file
                              </a>
                            )}
                            {detail.sourceProposal.portalLink && (
                              <a href={detail.sourceProposal.portalLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-meta font-bold text-primary hover:underline">
                                <Link2 className="size-3.5" /> portal
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="ml-auto rounded-xl border border-dashed border-border px-3 py-1.5 text-micro text-muted-foreground">No proposal linked</div>
                      )}
                    </div>
                  </div>
                )}
                {detail.team && detail.team.length > 0 && (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase">
                      <Users className="size-3.5" /> Team ({detail.team.length})
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.team.map((n, i) => (
                        <span key={i} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-meta font-semibold">
                          <Avatar name={n} size="size-4" /> {n}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
                {detail.risks && detail.risks.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-meta font-bold tracking-wide text-muted-foreground uppercase">Risks</h4>
                    <div className="flex flex-col gap-1.5">
                      {detail.risks.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-body">
                          <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                          <span className="flex-1">{typeof r === "string" ? r : r.title ?? r.description ?? r.driver ?? "Risk"}</span>
                          {r.level && <StatusBadge status={r.level} />}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
            {/* ── tab: final proposal (limit: one per project) ── */}
            {detailTab === "proposal" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-body font-bold">Final proposal</p>
                    <p className="text-micro text-muted-foreground">
                      One proposal per project — the PDF or shared link that carries the scope, price and what shipped.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-micro font-bold tabular-nums text-muted-foreground">
                    {detail.proposal ? "1 of 1 used" : "0 of 1 used"}
                  </span>
                </div>

                {detail.proposal ? (
                  (() => {
                    const p = detail.proposal;
                    const target = proposalTarget(p);
                    return (
                      <section className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="size-4 text-primary" />
                          <p className="text-body-lg font-bold">{p.title || "Final proposal"}</p>
                          <StatusBadge status={p.status} />
                          {p.amount != null && (
                            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-micro font-bold tabular-nums text-foreground">
                              {money(p.amount, detail.currency)}
                            </span>
                          )}
                          <span className="text-micro text-muted-foreground">
                            updated {timeAgo(p.updatedAt)}{p.updatedBy?.name ? ` by ${p.updatedBy.name}` : ""}
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-meta text-muted-foreground">{target || "No file or link attached"}</p>
                        {p.notes && (
                          <p className="mt-2 whitespace-pre-line rounded-xl border border-border/60 bg-card/60 p-2.5 text-meta text-foreground/90">
                            {p.notes}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {target && (
                            <a
                              href={target}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-3 py-1.5 text-meta font-bold text-white transition-transform hover:scale-[1.02]"
                            >
                              <ArrowUpRight className="size-3.5" /> View proposal
                            </a>
                          )}
                          {p.fileUrl && (
                            <a
                              href={p.downloadUrl ?? absoluteUrl(p.fileUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Download className="size-3.5" /> PDF
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              if (!target) return;
                              try { await navigator.clipboard.writeText(target); notify("Proposal link copied"); }
                              catch { notify("Copy failed"); }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Link2 className="size-3.5" /> Copy link
                          </button>
                          <button
                            type="button"
                            onClick={openProposalForm}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-3.5" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={deleteProposal}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-meta font-bold text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                          >
                            <Trash2 className="size-3.5" /> Remove
                          </button>
                        </div>
                      </section>
                    );
                  })()
                ) : (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                    <FileText className="size-6 text-muted-foreground/60" />
                    <p className="text-body font-semibold">No proposal yet</p>
                    <p className="max-w-md text-meta text-muted-foreground">
                      Upload the final PDF or paste a Google Doc / Notion link. Each project holds exactly one proposal, so this is the version the client sees.
                    </p>
                    <Btn variant="primary" onClick={openProposalForm} className="mt-1">
                      <Plus className="size-3.5" /> Add proposal
                    </Btn>
                  </div>
                )}
              </div>
            )}
            {/* ── tab: deliverables ── */}
            {detailTab === "deliverables" && (
              <DeliverablesTab
                projectId={detail.id}
                clientId={detail.client?.id}
                deliverables={detail.deliverables ?? []}
                employees={(employees ?? []).map((e: any) => ({ id: e.id, name: e.name, roleTitle: e.roleTitle, employmentStatus: e.employmentStatus }))}
                onChanged={reload}
                notify={notify}
              />
            )}
            {/* ── tab: shoot ── */}
            {detailTab === "shoot" && (
              <ShootTab
                projectId={detail.id}
                clientId={detail.client?.id}
                shoots={detail.shoots ?? []}
                employees={(employees ?? []).map((e: any) => ({ id: e.id, name: e.name, roleTitle: e.roleTitle }))}
                onChanged={reload}
                notify={notify}
              />
            )}
            {/* ── tab: reports ── */}
            {detailTab === "reports" && (
              <ReportsTab
                projectId={detail.id}
                project={detail}
                reports={detail.reports ?? []}
                campaigns={reportsCampaigns}
                focusReportId={focusReport}
                onChanged={reload}
                notify={notify}
              />
            )}
            {detailTab === "milestones" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Input value={msName} onChange={(e) => setMsName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMilestone()} placeholder="Milestone name…" />
                  <Input type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} className="!w-40" />
                  <Btn variant="primary" onClick={addMilestone} className={msBusy ? "opacity-50" : ""}>
                    <Plus className="size-3.5" /> Add
                  </Btn>
                </div>
                {!detail.milestones.length ? (
                  <p className="mt-2 text-meta text-muted-foreground">No milestones yet</p>
                ) : (
                  detail.milestones.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
                      <span className={cn("size-2 shrink-0 rounded-full", m.status === "COMPLETED" ? "bg-emerald-500" : m.status === "IN_PROGRESS" ? "bg-amber-400" : "bg-muted")} />
                      <p className="min-w-0 flex-1 truncate text-body font-semibold">{m.name}</p>
                      <span className="flex items-center gap-1 text-micro text-muted-foreground">
                        <Calendar className="size-3.5" /> {formatDate(m.dueDate)}
                      </span>
                      <Segmented options={MILESTONE_STATUSES.map((s) => ({ value: s, label: label(s) }))} value={m.status} onChange={(v) => setMilestoneStatus(m, v)} />
                      <button onClick={() => deleteMilestone(m.id)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            {detailTab === "files" && (
              <div className="flex flex-col gap-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-meta text-muted-foreground">{detail.files.length} attachments</span>
                  <Btn variant="outline" onClick={() => fileRef.current?.click()} className={uploading ? "opacity-50" : ""}>
                    <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload"}
                  </Btn>
                  <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
                </div>
                {!detail.files.length ? (
                  <p className="text-meta text-muted-foreground">No files yet — upload the first one.</p>
                ) : (
                  detail.files.map((f) => (
                    <div
                      key={f.id}
                      id={`file-${f.id}`}
                      className={cn(
                        "flex flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2",
                        focusFile === f.id ? "border-primary/60 ring-2 ring-primary/20" : "border-border/60"
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {fileIcon(f.fileName ?? f.name ?? "file.pdf")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold">{f.fileName ?? (f as any).name ?? "file"}</p>
                        <p className="truncate text-micro text-muted-foreground">{fileSize(f.size)} · {f.uploadedBy?.name ?? "unknown"} · {timeAgo(f.uploadedAt)}</p>
                      </div>
                      <StatusBadge status={f.approvalStatus ?? "PENDING"} />
                      {f.approvalStatus !== "APPROVED" && (
                        <button onClick={() => setApproval(f.id, "APPROVED")} className="rounded-lg px-2 py-1 text-micro font-bold text-emerald-400 transition-colors hover:bg-emerald-500/10">approve</button>
                      )}
                      {f.approvalStatus !== "REVISION_REQUESTED" && (
                        <button onClick={() => setApproval(f.id, "REVISION_REQUESTED")} className="rounded-lg px-2 py-1 text-micro font-bold text-amber-400 transition-colors hover:bg-amber-500/10">revise</button>
                      )}
                      <a href={f.downloadUrl ?? absoluteUrl(f.fileUrl)} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Download">
                        <Download className="size-3.5" />
                      </a>
                      <button onClick={() => deleteFile(f.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            {detailTab === "discussions" && (
              <div className="flex flex-col gap-3">
                {discLoading ? (
                  <div className="flex flex-col gap-2">
                    {[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}
                  </div>
                ) : !discussions?.length ? (
                  <p className="text-meta text-muted-foreground">No discussions yet — start the conversation.</p>
                ) : (
                  discussions.map((d) => {
                    const name = d.author?.name ?? d.portalUser?.name ?? "Team";
                    return (
                      <div key={d.id} className="flex items-start gap-2.5">
                        <Avatar name={name} size="size-7" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-body font-bold">{name}</p>
                            <span className="text-micro text-muted-foreground">{timeAgo(d.createdAt)}</span>
                            {d.portalUser && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-micro font-bold text-primary">client</span>}
                          </div>
                          <p className="mt-1 rounded-xl rounded-tl-sm border border-border/60 bg-muted/30 px-3 py-2 text-body leading-relaxed">{d.content}</p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                  <Input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendDiscussion()} placeholder="Write a message…" />
                  <Btn variant="primary" onClick={sendDiscussion} className={sending ? "opacity-50" : ""}>
                    <Send className="size-3.5" /> Send
                  </Btn>
                </div>
              </div>
            )}
            {detailTab === "tasks" && (
              <div className="flex flex-col gap-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-meta text-muted-foreground">{detail.tasks.length} linked tasks</span>
                  <div className="flex items-center gap-2">
                    <Btn variant="outline" onClick={() => setBulkOpen(true)}>
                      <Users className="size-3.5" /> Bulk assign
                    </Btn>
                    <Btn variant="primary" onClick={() => setTaskOpen(true)}>
                      <Plus className="size-3.5" /> New task
                    </Btn>
                  </div>
                </div>
                {!detail.tasks.length ? (
                  <p className="text-meta text-muted-foreground">No tasks linked to this project</p>
                ) : (
                  detail.tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => router.push(`/tasks?task=${t.id}`)}
                      className="group flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold">{t.title}</p>
                        <p className="text-micro text-muted-foreground">{t.assignedTo?.name ?? "unassigned"}{t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}</p>
                      </div>
                      <StatusBadge status={t.status} />
                      <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))
                )}
              </div>
            )}
            {detailTab === "finance" &&
              (finLoading && !finance ? (
                <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
              ) : finance ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase"><Wallet className="size-3.5" /> Budget burn</p>
                    <div className="flex items-center justify-between text-meta">
                      <span className="font-semibold tabular-nums">{money(detail.spentAmount ?? (detail as any).budgetSpent ?? 0, detail.currency)} spent</span>
                      <span className="text-muted-foreground tabular-nums">of {money((detail as any).amount ?? detail.budgetAmount ?? finance?.project?.budgetAmount, detail.currency)}</span>
                      <span className="font-bold tabular-nums">{budgetPct(detail)}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${budgetPct(detail) >= 90 ? "bg-rose-500" : budgetPct(detail) >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${budgetPct(detail)}%` }} />
                    </div>
                  </div>
                  <ProjectFinancePanel
                    finance={finance}
                    loading={finLoading}
                    currency={detail.currency}
                    onInvoice={() => setFinInvOpen(true)}
                    onExpense={() => setFinExpOpen(true)}
                  />
                  {/* payment ledger */}
                  {!!finance?.payments?.length && (
                    <section>
                      <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase">
                        <HandCoins className="size-3.5" /> Payment ledger
                      </h4>
                      <div className="overflow-hidden rounded-xl border border-border/60">
                        <table className="w-full text-left">
                          <thead className="bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-bold">Date</th>
                              <th className="px-3 py-2 font-bold">Amount</th>
                              <th className="px-3 py-2 font-bold">Method</th>
                              <th className="px-3 py-2 font-bold">Invoice</th>
                              <th className="px-3 py-2 font-bold">Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {finance.payments.map((p: any) => (
                              <tr key={p.id} className="border-t border-border/40">
                                <td className="px-3 py-2 text-meta font-semibold">{formatDate(p.paymentDate)}</td>
                                <td className="px-3 py-2 text-meta font-bold tabular-nums text-emerald-400">{money(p.amount, detail.currency)}</td>
                                <td className="px-3 py-2 text-meta">{label(p.paymentMethod)}</td>
                                <td className="px-3 py-2 text-meta font-mono text-micro">{p.invoiceNumber}</td>
                                <td className="px-3 py-2 text-meta text-muted-foreground">{p.referenceId ?? p.notes ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <EmptyState title="Finance data unavailable" hint="Could not load project finance." />
              ))}
            {detailTab === "references" && (
              <div className="flex flex-col gap-4">
                {/* proposal — source of the project */}
                {detail.sourceProposal && (
                  <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="size-3.5 text-primary" />
                      <p className="text-body font-bold">Proposal v{detail.sourceProposal.versionNumber}</p>
                      <StatusBadge status={detail.sourceProposal.status} />
                      {detail.sourceProposal.sentDate && (
                        <span className="text-micro text-muted-foreground">sent {formatDate(detail.sourceProposal.sentDate)}</span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {detail.sourceProposal.fileUrl && (
                          <a href={absoluteUrl(detail.sourceProposal.fileUrl)} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border border-primary/30 bg-card px-2.5 py-1 text-micro font-bold text-primary transition-colors hover:bg-primary/10">
                            <FileText className="size-3.5" /> PDF <ArrowUpRight className="size-3" />
                          </a>
                        )}
                        {detail.sourceProposal.portalLink && (
                          <a href={detail.sourceProposal.portalLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-card px-2.5 py-1 text-micro font-bold text-sky-400 transition-colors hover:bg-sky-500/10">
                            <Link2 className="size-3.5" /> portal <ArrowUpRight className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-micro text-muted-foreground">The proposal this project was confirmed from — deliverables were committed here.</p>
                  </section>
                )}

                {/* upload + add link */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => refFileRef.current?.click()}
                    disabled={refUploading}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-body font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
                  >
                    <UploadCloud className="size-5" />
                    {refUploading ? "Uploading…" : "Upload PDF / document"}
                    <span className="text-micro font-medium text-muted-foreground/70">PDF, image or zip — max 15MB</span>
                  </button>
                  <input ref={refFileRef} type="file" className="hidden" onChange={onPickRefFile} accept=".pdf,.png,.jpg,.jpeg,.webp,.zip" />
                  <div className="flex flex-col gap-2 rounded-2xl border border-border/60 p-3">
                    <p className="text-meta font-bold uppercase tracking-wide text-muted-foreground">Add link</p>
                    <Input value={refTitle} onChange={(e) => setRefTitle(e.target.value)} placeholder="Title — e.g. Brand assets, Media plan" />
                    <Input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://drive.google.com/… / Notion / Figma / any URL" />
                    <div className="flex items-center gap-2">
                      <Select value={refType} onChange={(e) => setRefType(e.target.value)} className="!w-32 !py-1.5 text-meta">
                        {["DRIVE", "NOTION", "FIGMA", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                      <Btn variant="primary" onClick={addReferenceLink} className={refBusy ? "opacity-50" : ""}>
                        <Link2 className="size-3.5" /> Add link
                      </Btn>
                    </div>
                  </div>
                </div>

                {/* list */}
                {refsLoading ? (
                  <div className="flex flex-col gap-2">{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
                ) : !references || references.length === 0 ? (
                  <EmptyState title="No documents or links yet" hint="Upload the proposal PDF or add shared links — Drive, Notion, Figma, anything." />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {references.map((r: any) => {
                      const isPdf = (r.fileUrl ?? "").toLowerCase().includes(".pdf");
                      const isLink = !r.fileUrl && !!r.url;
                      return (
                        <div key={r.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 p-2.5">
                          <span className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                            isPdf ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                              : isLink ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                                : "border-border bg-muted/40 text-muted-foreground"
                          )}>
                            {isPdf ? <FileText className="size-3.5" /> : isLink ? <Link2 className="size-3.5" /> : <FileSpreadsheet className="size-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body font-semibold" title={r.title}>{r.title}</p>
                            <p className="truncate text-micro text-muted-foreground">
                              {r.fileUrl ? "uploaded file" : r.url?.replace(/^https?:\/\/(www\.)?/, "")} · {r.uploadedBy?.name ?? "—"} · {timeAgo(r.createdAt)}
                            </p>
                          </div>
                          <a
                            href={r.downloadUrl ?? absoluteUrl(r.fileUrl ?? r.url)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Open"
                          >
                            <Download className="size-3.5" />
                          </a>
                          <button
                            onClick={() => deleteReference(r.id)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              <span className="text-meta text-muted-foreground">{detail.milestones.length} milestones · {detail.files.length} files · {detail.tasks.length} tasks · {detail.deliverables?.length ?? 0} deliverables · {detail.shoots?.length ?? 0} shoots</span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Btn variant="outline" onClick={() => setFinExpOpen(true)}>
                  <ReceiptText className="size-3.5" /> Add Expense
                </Btn>
                <Btn variant="ghost" onClick={() => setEditTarget(detail)}>
                  <Pencil className="size-3.5" /> Edit
                </Btn>
                <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteTarget(detail)}>
                  <Trash2 className="size-3.5" /> Delete
                </Btn>
              </div>
            </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <ProjectInvoiceModal
        open={finInvOpen}
        project={detail}
        onClose={() => setFinInvOpen(false)}
        onSaved={() => { setFinInvOpen(false); notify("Invoice created"); reload(); }}
      />
      <ProjectExpenseModal
        open={finExpOpen}
        project={detail}
        bankAccounts={bankAccounts ?? []}
        onClose={() => setFinExpOpen(false)}
        onSaved={() => { setFinExpOpen(false); notify("Expense added"); reload(); }}
      />
      {/* Final proposal — exactly one per project */}
      <Modal
        open={proposalOpen}
        onClose={() => setProposalOpen(false)}
        size="md"
        eyebrow="Project proposal"
        title={detail?.proposal ? "Edit final proposal" : "Add final proposal"}
        subtitle="Upload the PDF and/or share a Google Doc / Notion link. Each project keeps one proposal — saving replaces it."
      >
        <form
          onSubmit={(e) => { e.preventDefault(); if (!propBusy) saveProposal(); }}
          className="flex flex-col gap-3"
        >
          <Field label="Title">
            <Input value={propTitle} onChange={(e) => setPropTitle(e.target.value)} placeholder="Final proposal" maxLength={160} />
          </Field>

          <Field label="Proposal PDF" hint="Optional — PDF, max 15MB">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={propFileRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) await handleProposalFile(file);
                }}
              />
              <Btn variant="outline" onClick={() => propFileRef.current?.click()} disabled={propUploading}>
                <UploadCloud className="size-3.5" /> {propUploading ? "Uploading…" : propFile ? "Replace PDF" : "Upload PDF"}
              </Btn>
              {propFile && (
                <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-micro font-semibold">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-40 truncate" title={propFile.fileName}>{propFile.fileName}</span>
                  <button type="button" onClick={() => setPropFile(null)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-rose-400" title="Remove file">
                    <X className="size-3" />
                  </button>
                </span>
              )}
            </div>
          </Field>

          <Field label="Shared link" hint="Google Doc, Notion, Drive — anything the client can open">
            <Input value={propLink} onChange={(e) => setPropLink(e.target.value)} placeholder="https://docs.google.com/…" maxLength={500} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" hint={`In ${detail?.currency || "BDT"}`}>
              <Input type="number" min={0} step="0.01" value={propAmount} onChange={(e) => setPropAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Status">
              <Select value={propStatus} onChange={(e) => setPropStatus(e.target.value)}>
                <option value="DRAFT">Draft</option>
                <option value="SENT">Sent</option>
                <option value="APPROVED">Approved</option>
              </Select>
            </Field>
          </div>

          <Field label="Summary" hint="Price, scope, what shipped and what didn't — this is what the client reads first">
            <Textarea
              rows={5}
              value={propNotes}
              onChange={(e) => setPropNotes(e.target.value)}
              placeholder={"Scope: …\nDelivered: …\nPending: …\nTotal: …"}
              maxLength={5000}
            />
          </Field>

          <FormActions
            busy={propBusy}
            cancel={() => setProposalOpen(false)}
            submitLabel={detail?.proposal ? "Save changes" : "Save proposal"}
            hint="Limit: 1 proposal per project"
          />
        </form>
      </Modal>
      <TaskFormModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        tasks={(detail?.tasks ?? []) as any}
        users={(employees ?? []).map((e) => ({ id: e.id, name: e.name }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name, clientId: p.client?.id }))}
        clients={(clients ?? []).map((c: any) => ({ id: c.id, companyName: c.companyName }))}
        projectId={detail?.id}
        onSaved={() => { setTaskOpen(false); notify("Task created"); reload(); }}
      />
      {/* Bulk assign tasks modal */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Bulk assign tasks — ${detail?.name ?? ""}`} size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-meta text-muted-foreground">Select tasks from backlog (or any project) to assign to <span className="font-semibold text-foreground">{detail?.name}</span>. This will call <code className="rounded bg-muted px-1">POST /flow/projects/:id/tasks/bulk</code>.</p>
          {bulkLoading ? (
            <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}</div>
          ) : !bulkTasks || bulkTasks.length === 0 ? (
            <EmptyState title="No tasks found" hint="Create tasks in Tasks module first." />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-meta font-bold text-muted-foreground">{bulkTasks.length} tasks • {bulkSelected.size} selected</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setBulkSelected(new Set(bulkTasks.map((t:any)=>t.id)))} className="rounded-lg border border-border px-2.5 py-1 text-meta font-semibold hover:bg-muted">Select all</button>
                  <button onClick={() => setBulkSelected(new Set())} className="rounded-lg border border-border px-2.5 py-1 text-meta font-semibold hover:bg-muted">Clear</button>
                </div>
              </div>
              <div className="max-h-[360px] overflow-auto rounded-xl border border-border/60">
                {(bulkTasks as any[]).map((t:any) => {
                  const checked = bulkSelected.has(t.id);
                  const isAlready = t.projectId === detail?.id;
                  return (
                    <label key={t.id} className={`flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2 hover:bg-muted/30 ${checked ? "bg-primary/5" : ""} ${isAlready ? "opacity-60" : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleBulkSelected(t.id)} className="size-3.5 accent-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold">{t.title}</p>
                        <p className="text-micro text-muted-foreground">{t.status ?? "BACKLOG"} • {t.project?.name ?? (t.projectId ? t.projectId.slice(0,6) : "no project")} {isAlready ? "• already linked" : ""}</p>
                      </div>
                      <StatusBadge status={t.status ?? "BACKLOG"} />
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setBulkOpen(false)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={doBulkAssign} disabled={bulkBusy || bulkSelected.size===0} className="rounded-xl bg-primary px-4 py-2 text-body font-bold text-primary-foreground disabled:opacity-60 hover:bg-primary/90">{bulkBusy ? "Assigning…" : `Assign ${bulkSelected.size} task(s)`}</button>
              </div>
            </>
          )}
        </div>
      </Modal>
      <ChannelsModal
        open={channelsOpen}
        project={detail}
        onClose={() => setChannelsOpen(false)}
        onSaved={(fields) => {
          if (detail) setDetail({ ...detail, ...fields });
          setChannelsOpen(false);
          notify("Project links updated");
          reload();
        }}
      />
      <ProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        editing={null}
        clients={clients ?? []}
        managers={managers ?? null}
        employees={employees ?? null}
        templates={templates ?? null}
        onClientCreated={reloadClients}
        onSaved={() => {
          notify("Project created");
          reload();
        }}
      />
      <ProjectModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        editing={editTarget}
        clients={clients ?? []}
        managers={managers ?? null}
        employees={employees ?? null}
        templates={templates ?? null}
        onClientCreated={reloadClients}
        onSaved={() => {
          notify("Project updated");
          reload();
        }}
      />
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete project?">
        <p className="text-body leading-relaxed text-muted-foreground">
          {deleteTarget ? `This permanently deletes "${deleteTarget.name}" and its milestones, files, reports and discussions. Projects that still have tasks, invoices, expenses, income or vendor engagements are blocked — archive those instead.` : ""}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button onClick={deleteProject} className="rounded-xl bg-rose-500 px-4 py-2 text-body font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02]">
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 truncate text-body font-semibold">{value}</p>
    </div>
  );
}
