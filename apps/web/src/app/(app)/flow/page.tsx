"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, Banknote, Calendar, CheckCircle2, ChevronRight, CircleDollarSign, Download, Eye, Facebook, FileArchive,
  FileSpreadsheet, FileText, Globe, HandCoins, Image, Instagram, LayoutGrid, Linkedin, Link2, List, Pencil, Plus, ReceiptText, RefreshCw,
  Rocket, Search, Send, SquareKanban, Trash2, Upload, UploadCloud, Users, Wallet, Workflow, X,
} from "lucide-react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import { Avatar, EmptyState, FadeIn, PageHeader, SectionTitle, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { ProgressRing } from "@/components/charts";
import { Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { TaskFormModal } from "@/components/tasks/task-form-modal";

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];
const HEALTH_STATUSES = ["ON_TRACK", "AT_RISK", "DELAYED"];
const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const CATEGORIES = ["Branding", "Web Development", "Video Production", "App Development", "Performance Marketing", "Influencer Marketing", "Content Retainer", "Social Media", "SEO", "Other"];
const BILLING_INTERVALS = ["7-days", "15-days", "30-days", "monthly"];
const PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID", "OVERDUE"];
const EXPENSE_CATEGORIES = ["AD_SPEND", "FREELANCER", "PRODUCTION", "SALARY", "SOFTWARE", "RENT", "MARKETING", "TRAVEL", "BANK_CHARGE", "MISC"];
const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

const STATUS_STYLE: Record<string, string> = {
  PLANNING: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  PAUSED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  COMPLETED: "border-primary/30 bg-primary/10 text-primary",
  ARCHIVED: "border-border bg-muted/60 text-muted-foreground",
};
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
  projectLink?: string | null; websiteUrl?: string | null; socialLinks?: { facebook?: string; linkedin?: string; instagram?: string } | null;
  referenceLinks?: any; references?: any[];
  briefLink?: string | null; driveLink?: string | null; researchLink?: string | null;
  tasksTotal?: number; tasksCompleted?: number;
  client: { id: string; companyName: string };
  assignedPm?: { id: string; name: string } | null;
  milestones?: { id: string; name: string; dueDate: string | null; status: string }[];
  _count?: { tasks: number; files: number; milestones: number };
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
  milestones: { id: string; name: string; dueDate: string | null; status: string }[];
  files: {
    id: string; name?: string | null; fileName?: string | null; fileUrl: string;
    uploadedAt: string; size?: number | null; uploadedBy: { name: string } | null;
    approvalStatus: string;
  }[];
  tasks: {
    id: string; title: string; status: string; priority: string;
    dueDate: string | null; assignedTo: { name: string } | null;
  }[];
  teamMembers?: any[]; risks?: any[];
  _count?: { tasks: number; files: number; milestones: number };
}

interface Discussion { id: string; content: string; createdAt: string; author?: { name: string } | null; portalUser?: { name: string } | null }
interface CapacityRow { project: { id: string; name: string }; members: { employee: { id: string; name: string }; loggedHours: number; targetHours: number; utilizationPct: number }[] }

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

function ProjectModal({
  open, onClose, editing, clients, managers, employees, templates, onSaved,
}: {
  open: boolean; onClose: () => void; editing: ProjectRow | null;
  clients: { id: string; companyName: string }[]; managers: { id: string; name: string }[] | null;
  employees: { id: string; name: string }[] | null; templates: any[] | null; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: "", clientId: "", status: "PLANNING", priority: "MEDIUM", category: "",
    type: "FIXED", assignedPmId: "", amount: "", spentAmount: "", progress: "0",
    currency: "BDT",
    startDate: "", targetEndDate: "", billingType: "ONE_TIME", recurringInterval: "30-days",
    nextBillingDate: "", monthlyRate: "", totalBilled: "", paymentStatus: "PENDING",
    description: "",
    projectLink: "", websiteUrl: "", socialLinks: { facebook: "", linkedin: "", instagram: "" } as { facebook: string; linkedin: string; instagram: string },
    briefLink: "", driveLink: "", researchLink: "", team: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // references preview
  const [refs, setRefs] = useState<any[] | null>(null);
  const [refTitle, setRefTitle] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [refType, setRefType] = useState("OTHER");
  const [refBusy, setRefBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const refFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editing) {
      const sl: any = (editing as any).socialLinks ?? {};
      setF({
        name: editing.name, clientId: editing.client.id, status: editing.status,
        priority: editing.priority ?? "MEDIUM", category: editing.category ?? "",
        type: editing.type ?? "FIXED", assignedPmId: editing.assignedPm?.id ?? "",
        amount: (editing as any).amount != null ? String((editing as any).amount) : editing.budgetAmount != null ? String(editing.budgetAmount) : "",
        spentAmount: editing.spentAmount != null ? String(editing.spentAmount) : editing.budgetSpent != null ? String(editing.budgetSpent) : "",
        progress: editing.progress != null ? String(editing.progress) : "0",
        currency: (editing as any).currency ?? "BDT",
        startDate: editing.startDate ? String(editing.startDate).slice(0, 10) : "",
        targetEndDate: editing.targetEndDate ? String(editing.targetEndDate).slice(0, 10) : "",
        billingType: editing.billingType ?? "ONE_TIME", recurringInterval: editing.recurringInterval ?? "30-days",
        nextBillingDate: editing.nextBillingDate ? String(editing.nextBillingDate).slice(0, 10) : "",
        monthlyRate: editing.monthlyRate != null ? String(editing.monthlyRate) : "",
        totalBilled: editing.totalBilled != null ? String(editing.totalBilled) : "",
        paymentStatus: editing.paymentStatus ?? "PENDING",
        description: (editing as any).description ?? "",
        projectLink: (editing as any).projectLink ?? "", websiteUrl: (editing as any).websiteUrl ?? "",
        socialLinks: { facebook: sl.facebook ?? "", linkedin: sl.linkedin ?? "", instagram: sl.instagram ?? "" },
        briefLink: editing.briefLink ?? "", driveLink: editing.driveLink ?? "", researchLink: editing.researchLink ?? "",
        team: editing.team ?? [],
      });
      // fetch references preview
      setRefs(null);
      apiFetch<any[]>(`/flow/projects/${editing.id}/references`).then((r) => setRefs(r)).catch(() => setRefs([]));
    } else {
      setF({
        name: "", clientId: "", status: "PLANNING", priority: "MEDIUM", category: "",
        type: "FIXED", assignedPmId: "", amount: "", spentAmount: "", progress: "0",
        currency: "BDT",
        startDate: "", targetEndDate: "", billingType: "ONE_TIME", recurringInterval: "30-days",
        nextBillingDate: "", monthlyRate: "", totalBilled: "", paymentStatus: "PENDING",
        description: "",
        projectLink: "", websiteUrl: "", socialLinks: { facebook: "", linkedin: "", instagram: "" },
        briefLink: "", driveLink: "", researchLink: "", team: [],
      });
      setRefs(null);
      setRefTitle(""); setRefUrl(""); setRefType("OTHER");
    }
  }, [open, editing]);

  const effectiveNextBilling = useMemo(() => {
    if (f.billingType === "ONE_TIME") return "";
    if (f.nextBillingDate) return f.nextBillingDate;
    return computeNextBilling(f.startDate, f.recurringInterval);
  }, [f.billingType, f.nextBillingDate, f.startDate, f.recurringInterval]);

  const toggleTeam = (name: string) =>
    setF((p) => ({ ...p, team: p.team.includes(name) ? p.team.filter((t) => t !== name) : [...p.team, name] }));

  const addReferenceLink = async () => {
    if (!editing?.id) return;
    if (!refTitle.trim() || !refUrl.trim()) { setErr("Reference title and URL are required"); return; }
    setRefBusy(true); setErr(null);
    try {
      await apiFetch(`/flow/projects/${editing.id}/references`, { method: "POST", body: JSON.stringify({ title: refTitle.trim(), url: refUrl.trim(), type: refType }) });
      setRefTitle(""); setRefUrl("");
      const updated = await apiFetch<any[]>(`/flow/projects/${editing.id}/references`);
      setRefs(updated);
    } catch (e: any) { setErr(e.message ?? "Add reference failed"); } finally { setRefBusy(false); }
  };

  const handleRefFile = async (file: File) => {
    if (!editing?.id) { setErr("Save project first to attach files"); return; }
    if (!file) return;
    setRefBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_URL}/flow/upload`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.fileUrl) throw new Error(body?.message ?? "Upload failed");
      await apiFetch(`/flow/projects/${editing.id}/references`, { method: "POST", body: JSON.stringify({ title: body.originalName ?? file.name, fileUrl: body.fileUrl, type: "OTHER" }) });
      const updated = await apiFetch<any[]>(`/flow/projects/${editing.id}/references`);
      setRefs(updated);
    } catch (e: any) { setErr(e.message ?? "Upload failed"); } finally { setRefBusy(false); }
  };

  const onRefFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handleRefFile(file);
  };

  const onDropRef = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleRefFile(file);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Project name is required");
    if (!f.clientId) return setErr("Select a client");
    if (f.billingType === "RECURRING" && (!f.monthlyRate || Number(f.monthlyRate) < 1)) return setErr("Monthly rate is required for recurring billing (min 1)");
    if (f.amount && Number(f.amount) < 0) return setErr("Project amount must be >= 0");
    if (f.startDate && f.targetEndDate && new Date(f.startDate) > new Date(f.targetEndDate)) return setErr("Start date must be before due date");
    if (f.description && f.description.length > 2000) return setErr("Description is too long (max 2000)");
    setBusy(true);
    setErr(null);
    const social = (f.socialLinks.facebook || f.socialLinks.linkedin || f.socialLinks.instagram) ? { facebook: f.socialLinks.facebook.trim() || undefined, linkedin: f.socialLinks.linkedin.trim() || undefined, instagram: f.socialLinks.instagram.trim() || undefined } : undefined;
    const amountNum = f.amount ? Number(f.amount) : null;
    const body: any = {
      name: f.name.trim(), clientId: f.clientId, status: f.status, priority: f.priority,
      category: f.category.trim() || "General", type: f.type, assignedPmId: f.assignedPmId || undefined,
      description: f.description.trim() || undefined,
      amount: amountNum, budgetAmount: amountNum,
      currency: f.currency,
      spentAmount: f.spentAmount ? Number(f.spentAmount) : null,
      progress: Math.min(100, Math.max(0, Number(f.progress) || 0)),
      startDate: f.startDate || null, targetEndDate: f.targetEndDate || null,
      billingType: f.billingType, recurringInterval: f.billingType === "RECURRING" ? f.recurringInterval : undefined,
      nextBillingDate: f.billingType === "RECURRING" ? effectiveNextBilling || null : null,
      monthlyRate: f.monthlyRate ? Number(f.monthlyRate) : null,
      totalBilled: f.totalBilled ? Number(f.totalBilled) : 0,
      paymentStatus: f.paymentStatus,
      projectLink: f.projectLink.trim() || null, websiteUrl: f.websiteUrl.trim() || null,
      socialLinks: social,
      briefLink: f.briefLink.trim() || null, driveLink: f.driveLink.trim() || null,
      researchLink: f.researchLink.trim() || null, team: f.team,
      templateId: undefined,
    };
    try {
      if (editing) {
        await apiFetch(`/flow/projects/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await apiFetch("/flow/projects", { method: "POST", body: JSON.stringify(body) });
      }
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? (editing ? "Update failed" : "Create failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit project — ${editing.name}` : "New project"} size="xl">
      <form onSubmit={save} className="flex max-h-[72vh] flex-col gap-6 overflow-y-auto pr-1">
        {/* Company & Category */}
        <section>
          <SectionTitle title="Company & Category" subtitle="Client, type and scope" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project name *">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Project name" autoFocus />
            </Field>
            <Field label="Client *">
              <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                <option value="">Select client…</option>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Category">
              <Input list="project-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Branding" />
              <datalist id="project-categories">
                {CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Project type">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {["FIXED", "RETAINER", "CAMPAIGN"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                {PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Due date">
              <Input type="date" value={f.targetEndDate} onChange={(e) => setF({ ...f, targetEndDate: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Description">
              <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Scope, deliverables, out of scope…" rows={3} className="min-h-[72px]" />
            </Field>
          </div>
        </section>

        {/* Amount & Finance */}
        <section className="rounded-2xl border border-border/60 p-4">
          <SectionTitle title="Amount & Finance" subtitle="Budget, billing and progress" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Project Amount (BDT) *">
              <Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="500000" />
            </Field>
            <Field label="Spent (BDT)">
              <Input type="number" min={0} value={f.spentAmount} onChange={(e) => setF({ ...f, spentAmount: e.target.value })} placeholder="120000" />
            </Field>
            <Field label="Currency">
              <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {["BDT", "USD", "SAR", "AED"].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label={`Progress — ${f.progress}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={f.progress}
                onChange={(e) => setF({ ...f, progress: e.target.value })}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0%</span><span>100%</span></div>
            </Field>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11.5px] font-semibold text-muted-foreground">Billing type</p>
            <Segmented
              options={[{ value: "ONE_TIME", label: "One-time" }, { value: "RECURRING", label: "Recurring" }]}
              value={f.billingType}
              onChange={(v) => setF({ ...f, billingType: v })}
            />
          </div>
          {f.billingType === "RECURRING" && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Billing interval">
                <Select value={f.recurringInterval} onChange={(e) => setF({ ...f, recurringInterval: e.target.value })}>
                  {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                </Select>
              </Field>
              <Field label="Monthly rate (BDT) *">
                <Input type="number" min={1} value={f.monthlyRate} onChange={(e) => setF({ ...f, monthlyRate: e.target.value })} placeholder="40000" />
              </Field>
              <Field label="Total billed (BDT)">
                <Input type="number" min={0} value={f.totalBilled} onChange={(e) => setF({ ...f, totalBilled: e.target.value })} placeholder="160000" />
              </Field>
              <Field label="Next billing date">
                <Input type="date" value={f.nextBillingDate} onChange={(e) => setF({ ...f, nextBillingDate: e.target.value })} />
              </Field>
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Payment status">
              <Select value={f.paymentStatus} onChange={(e) => setF({ ...f, paymentStatus: e.target.value })}>
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
          </div>
          <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-300">
            Auto DRAFT on start (ACTIVE) and on finish (COMPLETED) — also manual via Finance tab
          </p>
          {f.billingType === "RECURRING" && effectiveNextBilling && (
            <p className="mt-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-[11.5px] font-semibold text-primary">
              Next billing will be {formatDate(effectiveNextBilling)} (auto from start date + interval)
            </p>
          )}
        </section>

        {/* Links — Project Overview */}
        <section className="rounded-2xl border border-border/60 p-4">
          <SectionTitle title="Links — Project Overview" subtitle="External URLs and social" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project Link">
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={f.projectLink} onChange={(e) => setF({ ...f, projectLink: e.target.value })} placeholder="https://live.example.com" className="pl-9" />
              </div>
            </Field>
            <Field label="Website URL">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={f.websiteUrl} onChange={(e) => setF({ ...f, websiteUrl: e.target.value })} placeholder="https://client.com" className="pl-9" />
              </div>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Facebook">
              <div className="relative">
                <Facebook className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={f.socialLinks.facebook} onChange={(e) => setF({ ...f, socialLinks: { ...f.socialLinks, facebook: e.target.value } })} placeholder="https://facebook.com/..." className="pl-9" />
              </div>
            </Field>
            <Field label="LinkedIn">
              <div className="relative">
                <Linkedin className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={f.socialLinks.linkedin} onChange={(e) => setF({ ...f, socialLinks: { ...f.socialLinks, linkedin: e.target.value } })} placeholder="https://linkedin.com/..." className="pl-9" />
              </div>
            </Field>
            <Field label="Instagram">
              <div className="relative">
                <Instagram className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={f.socialLinks.instagram} onChange={(e) => setF({ ...f, socialLinks: { ...f.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/..." className="pl-9" />
              </div>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Brief link">
              <Input value={f.briefLink} onChange={(e) => setF({ ...f, briefLink: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Drive link">
              <Input value={f.driveLink} onChange={(e) => setF({ ...f, driveLink: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Research link">
              <Input value={f.researchLink} onChange={(e) => setF({ ...f, researchLink: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
        </section>

        {/* Team */}
        <section className="rounded-2xl border border-border/60 p-4">
          <SectionTitle title="Team" subtitle="Assignees and manager" />
          <Field label={`Team members (${f.team.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {(employees ?? []).map((emp) => {
                const on = f.team.includes(emp.name);
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => toggleTeam(emp.name)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      on ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {on && <CheckCircle2 className="size-3" />}
                    {emp.name}
                  </button>
                );
              })}
              {(!employees || employees.length === 0) && <span className="text-[11px] text-muted-foreground">No employees found</span>}
            </div>
          </Field>
          <div className="mt-4">
            <Field label="Project manager">
              <Select value={f.assignedPmId} onChange={(e) => setF({ ...f, assignedPmId: e.target.value })}>
                <option value="">Unassigned</option>
                {(managers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* References preview if editing */}
        {editing && (
          <section className="rounded-2xl border border-border/60 p-4">
            <SectionTitle title="References (preview)" subtitle={refs ? `${refs.length} linked references` : "Loading references…"} />
            {refs && refs.length > 0 && (
              <div className="mb-3 max-h-40 overflow-auto rounded-xl border border-border/60">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Title</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Link / File</th></tr></thead>
                  <tbody>
                    {refs.map((r: any) => (
                      <tr key={r.id} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-medium">{r.title}</td>
                        <td className="px-3 py-1.5"><span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-bold uppercase">{r.type}</span></td>
                        <td className="px-3 py-1.5 truncate text-primary">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.url.slice(0, 40)}</a> : r.fileUrl ? <a href={r.fileUrl} target="_blank" rel="noreferrer" className="hover:underline">file</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {refs && refs.length === 0 && <p className="mb-3 text-[11px] text-muted-foreground">No references yet — add a drive link or upload a file.</p>}
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Reference title">
                <Input value={refTitle} onChange={(e) => setRefTitle(e.target.value)} placeholder="Drive — brand assets" />
              </Field>
              <Field label="URL">
                <Input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://drive.google.com/..." />
              </Field>
              <div className="flex gap-2">
                <Select value={refType} onChange={(e) => setRefType(e.target.value)} className="!w-28">
                  {["DRIVE", "NOTION", "FIGMA", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Btn variant="outline" onClick={addReferenceLink} className={refBusy ? "opacity-50" : ""}><Link2 className="size-3.5" /> Add</Btn>
              </div>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDropRef}
              onClick={() => refFileInput.current?.click()}
              className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors", dragOver ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/30 hover:bg-muted/30")}
            >
              <UploadCloud className="mb-1.5 size-5 text-muted-foreground" />
              <p className="text-[11.5px] font-semibold">Drop file or click to upload reference</p>
              <p className="text-[10.5px] text-muted-foreground">PDF, image, or any file — will be linked to this project</p>
              <input ref={refFileInput} type="file" className="hidden" onChange={onRefFileChange} />
            </div>
            {refBusy && <p className="mt-2 text-[11px] text-muted-foreground">Uploading…</p>}
          </section>
        )}

        {templates && templates.length > 0 && !editing && (
          <Field label="Template" hint="Applies the template type and default status">
            <Select value="" onChange={(e) => {
              const t = templates?.find((x) => x.id === e.target.value);
              if (t) setF((p) => ({ ...p, type: t.projectType ?? p.type, status: t.defaultStatus ?? p.status }));
            }}>
              <option value="">None</option>
              {(templates ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create project"} />
      </form>
    </Modal>
  );
}

function ProjectFinancePanel({ finance, loading, onInvoice, onExpense }: { finance: any; loading: boolean; onInvoice: () => void; onExpense: () => void }) {
  const invoices = finance?.invoices ?? [];
  const expenses = finance?.expenses ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Invoiced</p>
          <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums">{formatBDT(finance?.totalInvoiced)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Collected</p>
          <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-emerald-500">{formatBDT(finance?.collected)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Outstanding</p>
          <p className={cn("mt-0.5 text-[14px] font-heading font-bold tabular-nums", Number(finance?.outstanding ?? 0) > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(finance?.outstanding)}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
          <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-rose-500">{formatBDT(finance?.expensesTotal)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Project profit</p>
          <p className={cn("mt-0.5 text-[13px] font-heading font-bold tabular-nums", Number(finance?.profit ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(finance?.profit)}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Margin</p>
          <p className="mt-0.5 text-[13px] font-heading font-bold tabular-nums">{finance?.margin != null ? `${finance.margin}%` : "—"}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment status</p>
          <p className="mt-0.5 text-[13px] font-heading font-bold">{finance?.project?.paymentStatus ? label(finance.project.paymentStatus) : "—"}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next billing</p>
          <p className="mt-0.5 text-[13px] font-heading font-bold">{finance?.project?.nextBillingDate ? formatDate(finance.project.nextBillingDate) : "—"}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Invoices</p>
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
              <Tr key={inv.id} index={i}>
                <Td className="font-medium tabular-nums">{inv.invoiceNumber}</Td>
                <Td><StatusBadge status={inv.status} /></Td>
                <Td className="text-right font-semibold tabular-nums">{formatBDT(inv.amount)}</Td>
                <Td className="text-right tabular-nums text-emerald-500">{formatBDT(inv.paid)}</Td>
                <Td className={cn("text-right font-medium tabular-nums", inv.balance > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(inv.balance)}</Td>
                <Td className="text-muted-foreground">{formatDate(inv.dueDate)}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
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
                <Td className="text-right font-semibold tabular-nums">{formatBDT(e.amount)}</Td>
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ description: "", amount: "", dueDate: "", notes: "" });
  }, [open]);
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
        <Field label="Line description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Monthly retainer — August" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (BDT) *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="25000" /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms…" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create invoice" />
      </form>
    </Modal>
  );
}

function ProjectExpenseModal({ open, project, bankAccounts, onClose, onSaved }: { open: boolean; project: any; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
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
        body: JSON.stringify({ description: f.description.trim(), amount: Number(f.amount), category: f.category, date: f.date || undefined, projectId: project.id, bankAccountId: f.bankAccountId || undefined }),
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
        <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Google Ads — August" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (BDT) *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="8000" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName}</option>)}</Select></Field>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Add expense" />
      </form>
    </Modal>
  );
}

export default function FlowPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: overview } = useApi<any>("/flow/overview");
  const { data: clients } = useApi<any[]>("/accounts/clients");
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
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "milestones" | "files" | "discussions" | "tasks" | "finance">("overview");
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
  const [riskScore, setRiskScore] = useState("");
  const [riskDriver, setRiskDriver] = useState("");
  const [riskBusy, setRiskBusy] = useState(false);
  const [pmBusy, setPmBusy] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

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
      .then((d) => !cancelled && setProjects(d))
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setCapLoading(true);
    setCapErr(null);
    apiFetch<CapacityRow[]>("/flow/capacity")
      .then((d) => !cancelled && setCapacity(d))
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
      .catch(() => !cancelled && setSelectedId(null))
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
    if (!detail) return;
    setRiskScore(detail.riskScore != null ? String(detail.riskScore) : "");
    setRiskDriver(detail.riskDriver ?? "");
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
    const budget = list.reduce((s, p) => s + (p.budgetAmount ?? 0), 0);
    const spent = list.reduce((s, p) => s + (p.spentAmount ?? p.budgetSpent ?? 0), 0);
    return {
      total: overview?.totalProjects ?? list.length,
      active: overview?.active ?? list.filter((p) => p.status === "ACTIVE").length,
      completed: list.filter((p) => p.status === "COMPLETED").length,
      budget,
      spent,
      atRisk: (overview?.byHealth?.AT_RISK ?? 0) + (overview?.byHealth?.DELAYED ?? 0) || list.filter((p) => p.healthStatus === "AT_RISK" || p.healthStatus === "DELAYED").length,
    };
  }, [projects, overview]);

  const byStatus = useMemo(
    () => PROJECT_STATUSES.map((s) => ({ status: s, items: filtered.filter((p) => p.status === s) })),
    [filtered]
  );

  const capRows = useMemo(
    () =>
      (capacity ?? []).flatMap((e: any) =>
        (e.projects ?? []).map((p: any) => ({
          employee: { id: e.id, name: e.name },
          project: { id: p.projectId, name: p.projectName },
          loggedHours: p.hours ?? 0,
          targetHours: 40,
          utilizationPct: ((p.hours ?? 0) / 40) * 100,
        }))
      ),
    [capacity]
  );

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

  const patchStatus = async (p: ProjectRow, status: string) => {
    try {
      await apiFetch(`/flow/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`${p.name} ? ${label(status)}`);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };

  const saveRisk = async () => {
    if (!detail) return;
    setRiskBusy(true);
    try {
      const body = { riskScore: riskScore !== "" ? Number(riskScore) : null, riskDriver: riskDriver.trim() || null };
      await apiFetch(`/flow/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setDetail({ ...detail, ...body });
      notify("Risk updated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setRiskBusy(false);
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
      setSelectedId(null);
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
      notify(`Imported ${body?.imported ?? 0} projects${body?.skipped?.length ? ` � skipped ${body.skipped.length}` : ""}`);
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
      await apiFetch(`/flow/files/${fileId}/approval`, { method: "PATCH", body: JSON.stringify({ approvalStatus }) });
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
        body: JSON.stringify({ name: body.originalName ?? file.name, fileUrl: body.fileUrl, size: body.size ?? file.size }),
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

  const riskBar = (score: number | null) => {
    const s = score ?? 0;
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${s >= 60 ? "bg-rose-500" : s >= 35 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(s, 100)}%` }} />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{s}</span>
      </div>
    );
  };

  const budgetPct = (p: ProjectRow) => {
    if (!p.budgetAmount) return 0;
    return Math.min(100, Math.round(((p.spentAmount ?? p.budgetSpent ?? 0) / p.budgetAmount) * 100));
  };

  const budgetBar = (p: ProjectRow) => {
    const pct = budgetPct(p);
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{formatBDT(p.spentAmount ?? p.budgetSpent ?? 0)} / {formatBDT(p.budgetAmount)}</span>
      </div>
    );
  };

  const badge = (style: string, text: string) => (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide", style)}>{text}</span>
  );

  const progressBar = (p: ProjectRow) => {
    const prog = p.progress ?? 0;
    return (
      <div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
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
      onClick={() => setSelectedId(p.id)}
      className={cn(
        "group rounded-2xl border bg-card p-3.5 transition-all",
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
        <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{p.uid ?? ""}</span>
      </div>
      <h3 className="mt-2.5 truncate text-[13.5px] font-bold">{p.name}</h3>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.client.companyName}{p.assignedPm ? ` � PM: ${p.assignedPm.name}` : ""}</p>
      <div className="mt-3">{progressBar(p)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {badge(STATUS_STYLE[p.status] ?? STATUS_STYLE.PLANNING, label(p.status))}
        {p.targetEndDate && (
          <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <Calendar className="size-3" /> {formatDate(p.targetEndDate)}
          </span>
        )}
        <span className="ml-auto text-[10.5px] font-semibold tabular-nums text-muted-foreground">
          {p.tasksCompleted ?? 0}/{p.tasksTotal ?? 0} tasks
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <div className="flex items-center gap-1.5">
          {p.team?.length ? (
            <div className="flex -space-x-1.5">
              {p.team.slice(0, 3).map((n, i) => <Avatar key={i} name={n} size="size-5" />)}
              {p.team.length > 3 && <span className="flex size-5 items-center justify-center rounded-full border border-border bg-muted text-[8.5px] font-bold text-muted-foreground">+{p.team.length - 3}</span>}
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground">no team</span>
          )}
          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{formatBDT(p.spentAmount ?? p.budgetSpent ?? 0)} / {formatBDT(p.budgetAmount)}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="View">
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
    return <FileText className="size-4" />;
  };

  const fileSize = (n: number | null | undefined) =>
    n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n ?? 0) / 1024))} KB`;

  const clearFilters = () => {
    setQ(""); setStatusFilter(""); setHealthFilter(""); setClientFilter(""); setManagerFilter("");
  };

  const hasFilters = !!(q || statusFilter || healthFilter || clientFilter || managerFilter);

  return (
    <div>
      {flash && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl">
          {flash}
        </motion.div>
      )}
      <PageHeader
        title="Flow — Project Management"
        subtitle="Every engagement tracked end-to-end with predictive risk flagging."
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Total Projects" value={stats.total} sub={`${stats.active} in progress`} icon={<Workflow className="size-5" />} />
            <StatCard label="In Progress" value={stats.active} sub="currently running" icon={<Rocket className="size-5" />} />
            <StatCard label="Completed" value={stats.completed} sub="delivered" icon={<CheckCircle2 className="size-5" />} />
            <StatCard label="Total Budget" value={formatBDT(stats.budget)} sub="across all projects" icon={<Wallet className="size-5" />} />
            <StatCard label="Total Spent" value={formatBDT(stats.spent)} sub={stats.budget ? `${Math.round((stats.spent / stats.budget) * 100)}% of budget` : "—"} icon={<Wallet className="size-5" />} />
          </div>
          {stats.atRisk > 0 && (
            <button onClick={() => setHealthFilter("AT_RISK")} className="mt-3 flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-left text-[11.5px] font-semibold text-amber-400 transition-colors hover:bg-amber-500/15">
              <AlertTriangle className="size-3.5" /> {stats.atRisk} project{stats.atRisk > 1 ? "s" : ""} at risk or delayed — click to filter
            </button>
          )}
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, client or uid…"
                  className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <Select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="!w-40">
                <option value="">All clients</option>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
              <Select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="!w-40">
                <option value="">All managers</option>
                {(managers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-36">
                <option value="">All statuses</option>
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
              <Select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="!w-32">
                <option value="">All health</option>
                {HEALTH_STATUSES.map((h) => <option key={h} value={h}>{label(h)}</option>)}
              </Select>
              {hasFilters && (
                <button onClick={clearFilters} className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <X className="size-3" /> Clear
                </button>
              )}
              <Segmented
                options={[
                  { value: "table", label: <List className="size-3.5" /> },
                  { value: "grid", label: <LayoutGrid className="size-3.5" /> },
                  { value: "kanban", label: <SquareKanban className="size-3.5" /> },
                ]}
                value={view}
                onChange={(v) => setViewWithUrl(v as any)}
              />
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
                        <span className="text-[11.5px] text-muted-foreground">{filtered.length} projects � on-time rate {overview?.onTimeRate ?? "—"}%</span>
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
                          <Tr key={p.id} index={i} onClick={() => setSelectedId(p.id)} className="cursor-pointer">
                            <Td>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={p.client.companyName} />
                                <div>
                                  <p className="flex items-center gap-1.5 font-medium">
                                    {p.name}
                                    {p.uid && <span className="text-[10.5px] font-semibold text-muted-foreground">{p.uid}</span>}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">{p.client.companyName}{p.assignedPm ? ` � ${p.assignedPm.name}` : ""}{p.category ? ` � ${p.category}` : ""}</p>
                                </div>
                              </div>
                            </Td>
                            <Td onClick={(e) => e.stopPropagation()}>
                              <Select value={p.status} onChange={(e) => patchStatus(p, e.target.value)} className="!min-w-[132px] !py-1 text-[11px]">
                                {PROJECT_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {label(s)}
                                  </option>
                                ))}
                              </Select>
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
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {byStatus.map((col) => (
                      <div
                        key={col.status}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          const p = projects?.find((x) => x.id === dragId);
                          if (p && p.status !== col.status) patchStatus(p, col.status);
                          setDragId(null);
                        }}
                        className={cn("w-64 shrink-0 rounded-2xl border bg-muted/30 p-2.5", dragId && "border-dashed")}
                      >
                        <div className="mb-2.5 flex items-center justify-between px-1">
                          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                            <span className={cn("size-1.5 rounded-full", STATUS_STYLE[col.status].split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted")} />
                            {label(col.status)}
                          </span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{col.items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {col.items.map((p) => <ProjectCard key={p.id} p={p} kanban />)}
                          {!col.items.length && (
                            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[10.5px] text-muted-foreground">Drop projects here</div>
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
              <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{capRows.length} assignments across {capacity?.length ?? 0} employees</span>}>
                <table className="w-full">
                  <THead>
                    <Th>Project</Th>
                    <Th>Member</Th>
                    <Th>Logged</Th>
                    <Th>Target</Th>
                    <Th>Utilization</Th>
                    <Th>Status</Th>
                  </THead>
                  <tbody>
                    {capRows.map((m, i) => (
                      <Tr key={`${m.project.id}-${m.employee.id}`} index={i}>
                        <Td className="font-medium">{m.project.name}</Td>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={m.employee.name} size="size-7" />
                            <span className="font-medium">{m.employee.name}</span>
                          </div>
                        </Td>
                        <Td className="font-semibold tabular-nums">{m.loggedHours}h</Td>
                        <Td className="text-muted-foreground tabular-nums">{m.targetHours}h</Td>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <ProgressRing value={Math.min(100, Math.max(0, m.utilizationPct ?? 0))} size={40} label={`${Math.round(m.utilizationPct ?? 0)}%`} />
                            <span className="text-[11px] text-muted-foreground">{m.targetHours ? `${Math.round(((m.loggedHours ?? 0) / m.targetHours) * 100)}% of target` : "—"}</span>
                          </div>
                        </Td>
                        <Td>
                          {m.utilizationPct > 100 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-400">
                              <AlertTriangle className="size-3" /> overbooked
                            </span>
                          ) : m.utilizationPct >= 85 ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">near limit</span>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">healthy</span>
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
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={
          <div className="flex items-center gap-3">
            <Avatar name={detail?.client?.companyName ?? "?"} />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-[17px] font-semibold">{detail?.name ?? "Project"}</h3>
              <p className="truncate text-[11px] text-muted-foreground">{detail?.client?.companyName ?? ""}{detail?.uid ? ` � ${detail.uid}` : ""}{detail?.code ? ` � ${detail.code}` : ""}</p>
            </div>
          </div>
        }
      >
        {detailLoading ? (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
          </div>
        ) : !detail ? null : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Status</span>
              <Segmented options={PROJECT_STATUSES.map((s) => ({ value: s, label: label(s) }))} value={detail.status} onChange={(v) => patchProject({ status: v })} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Health</span>
              <Segmented options={HEALTH_STATUSES.map((h) => ({ value: h, label: label(h) }))} value={detail.healthStatus} onChange={(v) => patchProject({ healthStatus: v })} />
            </div>
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border/60 p-3">
              <Avatar name={detail.assignedPm?.name ?? "?"} size="size-9" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Project Manager</p>
                <Select
                  value={detail.assignedPm?.id ?? ""}
                  onChange={(e) => assignPm(e.target.value)}
                  className={cn("!mt-0.5", pmBusy ? "opacity-50" : "")}
                >
                  <option value="">Unassigned</option>
                  {(managers ?? []).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </Select>
              </div>
              {detail.priority && (
                <span className={cn("rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase", PRIORITY_STYLE[detail.priority])}>{label(detail.priority)}</span>
              )}
              {detail.category && (
                <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">{detail.category}</span>
              )}
              {detail.paymentStatus && <StatusBadge status={detail.paymentStatus} />}
              {(detail.briefLink || detail.driveLink || detail.researchLink) && (
                <div className="flex items-center gap-1.5">
                  {detail.briefLink && (
                    <a href={detail.briefLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10.5px] font-bold text-primary transition-colors hover:bg-primary/20">
                      <FileText className="size-3" /> brief
                    </a>
                  )}
                  {detail.driveLink && (
                    <a href={detail.driveLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10.5px] font-bold text-sky-400 transition-colors hover:bg-sky-500/20">
                      <FileArchive className="size-3" /> drive
                    </a>
                  )}
                  {detail.researchLink && (
                    <a href={detail.researchLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20">
                      <Search className="size-3" /> research
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-border/60 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Budget</p>
                <p className="mt-0.5 font-heading text-[16px] font-bold tabular-nums">{detail.budgetAmount != null ? formatBDT(detail.budgetAmount) : "—"}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${budgetPct(detail) >= 90 ? "bg-rose-500" : budgetPct(detail) >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, budgetPct(detail))}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatBDT(detail.spentAmount ?? detail.budgetSpent ?? 0)} spent � {budgetPct(detail)}%</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Progress</p>
                <p className="mt-0.5 font-heading text-[16px] font-bold tabular-nums">{detail.progress != null ? `${detail.progress}%` : "—"}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, detail.progress ?? 0)}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{(detail.tasksCompleted ?? 0)}/{detail.tasksTotal ?? detail.tasks.length} tasks done</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Invoiced</p>
                <p className="mt-0.5 font-heading text-[16px] font-bold tabular-nums">{formatBDT(finance?.totalInvoiced ?? detail.totalBilled)}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{formatBDT(finance?.collected ?? 0)} collected</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Outstanding</p>
                <p className={cn("mt-0.5 font-heading text-[16px] font-bold tabular-nums", Number(finance?.outstanding ?? 0) > 0 ? "text-amber-400" : "text-emerald-400")}>{formatBDT(finance?.outstanding)}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{finance?.expensesTotal ? `${formatBDT(finance.expensesTotal)} expenses` : "No expenses yet"}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
                <AlertTriangle className="size-3.5" /> Risk profile
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Score (0–100)">
                  <Input type="number" min={0} max={100} value={riskScore} onChange={(e) => setRiskScore(e.target.value)} className="!w-28" />
                </Field>
                <Field label="Driver">
                  <Input value={riskDriver} onChange={(e) => setRiskDriver(e.target.value)} placeholder="Scope creep, key-person risk…" className="!min-w-52" />
                </Field>
                <Btn variant="outline" onClick={saveRisk} className={riskBusy ? "opacity-50" : ""}>
                  <RefreshCw className="size-3.5" /> Save
                </Btn>
              </div>
              {detail.riskDriver && (
                <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] font-semibold text-amber-400">
                  <AlertTriangle className="size-3.5" /> {detail.riskDriver}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Fact label="Client" value={detail.client.companyName} />
              <Fact label="Start" value={formatDate(detail.startDate)} />
              <Fact label="Target" value={formatDate(detail.targetEndDate)} />
              <Fact label="Budget" value={formatBDT(detail.budgetAmount)} />
              <Fact label="Spent" value={formatBDT(detail.spentAmount ?? detail.budgetSpent ?? 0)} />
              <Fact label="Progress" value={detail.progress != null ? `${detail.progress}%` : "—"} />
              <Fact label="PM" value={detail.assignedPm?.name ?? "—"} />
              <Fact label="Tasks" value={`${detail.tasksCompleted ?? detail.tasks.length}/${detail.tasksTotal ?? detail.tasks.length}`} />
              <Fact label="Category" value={detail.category || "—"} />
              <Fact label="Priority" value={detail.priority ? label(detail.priority) : "—"} />
              <Fact label="Billing" value={detail.billingType ? `${label(detail.billingType)}${detail.recurringInterval ? ` � ${detail.recurringInterval}` : ""}` : "—"} />
              <Fact label="Next billing" value={detail.nextBillingDate ? formatDate(detail.nextBillingDate) : "—"} />
              <Fact label="Payment" value={detail.paymentStatus ? label(detail.paymentStatus) : "—"} />
              <Fact label="Total billed" value={formatBDT(detail.totalBilled)} />
            </div>
            <Segmented
              options={[
                { value: "overview", label: "Overview" },
                { value: "milestones", label: `Milestones (${detail.milestones.length})` },
                { value: "files", label: `Files (${detail.files.length})` },
                { value: "discussions", label: "Discussions" },
                { value: "tasks", label: `Tasks (${detail.tasks.length})` },
                { value: "finance", label: `Finance (${finance?.invoices?.length ?? 0})` },
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />
            {detailTab === "overview" && (
              <div className="flex flex-col gap-5">
                {detail.sourceLead && (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                    <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-primary uppercase">
                      <Rocket className="size-3.5" /> Onboarded from lead
                    </p>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Lead</p>
                        <p className="text-[12.5px] font-semibold">{detail.sourceLead.name}</p>
                        <p className="text-[10.5px] text-muted-foreground">{detail.sourceLead.company ?? "—"} � source: {label(detail.sourceLead.source)} � {label(detail.sourceLead.vertical)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Deal size</p>
                        <p className="text-[12.5px] font-semibold tabular-nums">{formatBDT(detail.sourceLead.estimatedDealSize)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Contact</p>
                        <p className="text-[12.5px] font-semibold">{detail.sourceLead.contactEmail ?? detail.sourceLead.contactPhone ?? "—"}</p>
                      </div>
                      {detail.sourceProposal ? (
                        <div className="ml-auto">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase">Proposal v{detail.sourceProposal.versionNumber}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge status={detail.sourceProposal.status} />
                            {detail.sourceProposal.fileUrl && (
                              <a href={detail.sourceProposal.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">
                                <FileText className="size-3" /> file
                              </a>
                            )}
                            {detail.sourceProposal.portalLink && (
                              <a href={detail.sourceProposal.portalLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">
                                <Link2 className="size-3" /> portal
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="ml-auto rounded-xl border border-dashed border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">No proposal linked</div>
                      )}
                    </div>
                  </div>
                )}
                {detail.team && detail.team.length > 0 && (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                      <Users className="size-3.5" /> Team ({detail.team.length})
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.team.map((n, i) => (
                        <span key={i} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold">
                          <Avatar name={n} size="size-4" /> {n}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
                {detail.budgetAmount ? (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                      <Wallet className="size-3.5" /> Budget
                    </h4>
                    <div className="rounded-xl border border-border/60 p-3">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-semibold tabular-nums">{formatBDT(detail.spentAmount ?? detail.budgetSpent ?? 0)} spent</span>
                        <span className="text-muted-foreground tabular-nums">of {formatBDT(detail.budgetAmount)}</span>
                        <span className="font-bold tabular-nums">{budgetPct(detail)}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${budgetPct(detail) >= 90 ? "bg-rose-500" : budgetPct(detail) >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${budgetPct(detail)}%` }} />
                      </div>
                    </div>
                  </section>
                ) : null}
                {detail.risks && detail.risks.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">Risks</h4>
                    <div className="flex flex-col gap-1.5">
                      {detail.risks.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-[12px]">
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
                  <p className="mt-2 text-[11.5px] text-muted-foreground">No milestones yet</p>
                ) : (
                  detail.milestones.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
                      <span className={cn("size-2 shrink-0 rounded-full", m.status === "COMPLETED" ? "bg-emerald-500" : m.status === "IN_PROGRESS" ? "bg-amber-400" : "bg-muted")} />
                      <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{m.name}</p>
                      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                        <Calendar className="size-3" /> {formatDate(m.dueDate)}
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
                  <span className="text-[11.5px] text-muted-foreground">{detail.files.length} attachments</span>
                  <Btn variant="outline" onClick={() => fileRef.current?.click()} className={uploading ? "opacity-50" : ""}>
                    <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload"}
                  </Btn>
                  <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
                </div>
                {!detail.files.length ? (
                  <p className="text-[11.5px] text-muted-foreground">No files yet — upload the first one.</p>
                ) : (
                  detail.files.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {fileIcon(f.fileName ?? f.name ?? "file.pdf")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{f.fileName ?? f.name ?? "file"}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">{fileSize(f.size)} � {f.uploadedBy?.name ?? "unknown"} � {timeAgo(f.uploadedAt)}</p>
                      </div>
                      <StatusBadge status={f.approvalStatus ?? "PENDING"} />
                      {f.approvalStatus !== "APPROVED" && (
                        <button onClick={() => setApproval(f.id, "APPROVED")} className="rounded-lg px-2 py-1 text-[10.5px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/10">approve</button>
                      )}
                      {f.approvalStatus !== "REVISION_REQUESTED" && (
                        <button onClick={() => setApproval(f.id, "REVISION_REQUESTED")} className="rounded-lg px-2 py-1 text-[10.5px] font-bold text-amber-400 transition-colors hover:bg-amber-500/10">revise</button>
                      )}
                      <a href={f.fileUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Download">
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
                  <p className="text-[11.5px] text-muted-foreground">No discussions yet — start the conversation.</p>
                ) : (
                  discussions.map((d) => {
                    const name = d.author?.name ?? d.portalUser?.name ?? "Team";
                    return (
                      <div key={d.id} className="flex items-start gap-2.5">
                        <Avatar name={name} size="size-7" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-[12px] font-bold">{name}</p>
                            <span className="text-[10px] text-muted-foreground">{timeAgo(d.createdAt)}</span>
                            {d.portalUser && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">client</span>}
                          </div>
                          <p className="mt-1 rounded-xl rounded-tl-sm border border-border/60 bg-muted/30 px-3 py-2 text-[12.5px] leading-relaxed">{d.content}</p>
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
                  <span className="text-[11.5px] text-muted-foreground">{detail.tasks.length} linked tasks</span>
                  <Btn variant="primary" onClick={() => setTaskOpen(true)}>
                    <Plus className="size-3.5" /> New task
                  </Btn>
                </div>
                {!detail.tasks.length ? (
                  <p className="text-[11.5px] text-muted-foreground">No tasks linked to this project</p>
                ) : (
                  detail.tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => router.push("/tasks")}
                      className="group flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{t.title}</p>
                        <p className="text-[10.5px] text-muted-foreground">{t.assignedTo?.name ?? "unassigned"}{t.dueDate ? ` � due ${formatDate(t.dueDate)}` : ""}</p>
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
                <ProjectFinancePanel
                  finance={finance}
                  loading={finLoading}
                  onInvoice={() => setFinInvOpen(true)}
                  onExpense={() => setFinExpOpen(true)}
                />
              ) : (
                <EmptyState title="Finance data unavailable" hint="Could not load project finance." />
              ))}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex items-center justify-between gap-2 border-t border-border/60 bg-card px-6 py-3.5">
              <span className="text-[11.5px] text-muted-foreground">{detail.milestones.length} milestones � {detail.files.length} files � {detail.tasks.length} tasks</span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Btn variant="outline" onClick={() => setFinExpOpen(true)}>
                  <ReceiptText className="size-3.5" /> Add Expense
                </Btn>
                <Btn variant="primary" onClick={() => setFinInvOpen(true)}>
                  <Plus className="size-3.5" /> Create Invoice
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
      <TaskFormModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        tasks={(detail?.tasks ?? []) as any}
        users={(employees ?? []).map((e) => ({ id: e.id, name: e.name }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
        projectId={detail?.id}
        onSaved={() => { setTaskOpen(false); notify("Task created"); reload(); }}
      />
      <ProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        editing={null}
        clients={clients ?? []}
        managers={managers ?? null}
        employees={employees ?? null}
        templates={templates ?? null}
        onSaved={() => {
          setCreateOpen(false);
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
        onSaved={() => {
          setEditTarget(null);
          notify("Project updated");
          reload();
        }}
      />
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete project?">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {deleteTarget ? `This permanently deletes "${deleteTarget.name}" and its milestones, files, and discussions. Tasks referencing it will be orphaned — proceed carefully.` : ""}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button onClick={deleteProject} className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02]">
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
      <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold">{value}</p>
    </div>
  );
}