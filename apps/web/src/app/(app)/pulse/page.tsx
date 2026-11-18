"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Gauge,
  Globe,
  Hash,
  History,
  LayoutDashboard,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  StickyNote,
  Tag,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  Users,
  Video,
  X,
  Zap,
  SlidersHorizontal,
} from "lucide-react";
import { apiFetch, apiFetchFormData, API_URL, getToken } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import type { Lead, LeadActivity, LeadCategory, LeadFollowUp, LeadMeeting, LeadNote, PipelineSummary, Proposal, PulseWorkItem, UserLite } from "@/lib/types";
import {
  Avatar,
  EmptyState,
  FadeIn,
  PageHeader,
  SectionTitle,
  SkeletonBlock,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { SourceBarChart, StageBarChart } from "@/components/charts";
import {
  ChipGroup,
  Collapsible,
  CountBadge,
  Field,
  FieldLabel,
  FormActions,
  FormError,
  FormSection,
  Input,
  Modal,
  PercentSlider,
  ScoreBar,
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";
import { FocusBoard, dueLabel } from "@/components/pulse/focus-board";
import { QuickLogModal } from "@/components/pulse/quick-log";

const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
const ACTIVE_STAGES = STAGES.filter((s) => s !== "WON" && s !== "LOST") as (typeof STAGES)[number][];
// forward pipeline flow (LOST is a separate off-ramp)
const PIPELINE = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON"] as const;

type DetailTab = "overview" | "conversation" | "notes" | "files" | "meetings" | "followups" | "team" | "details";

function fmtSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// stored file URLs are API-relative ("/api/pulse/uploads/…") — resolve to the API origin
function absoluteUrl(url: string) {
  return url.startsWith("/api/") ? `${API_URL.replace(/\/api\/?$/, "")}${url}` : url;
}

// proposal links are pasted from Notion / Google Drive — tolerate missing scheme
function normalizeLink(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
}

function isValidLink(raw: string) {
  const t = raw.trim();
  // browsers leniently parse spaces via new URL — but backend validator
  // rejects them, so fail fast here to keep the Bengali error message
  if (!t || /\s/.test(t)) return false;
  try {
    const u = new URL(normalizeLink(t));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// preferred view target for a proposal: pasted link first, uploaded file fallback
function proposalTarget(p: Proposal) {
  if (p.portalLink?.trim()) return normalizeLink(p.portalLink);
  if (p.fileUrl?.trim()) return absoluteUrl(p.fileUrl.trim());
  return null;
}

const SOURCES = [
  "WEBSITE", "REFERRAL", "LINKEDIN", "GOOGLE_ADS", "FACEBOOK", "WHATSAPP",
  "COLD_CALL", "EMAIL_CAMPAIGN", "EVENT", "PARTNER", "INBOUND_PHONE", "EMAIL", "COLD", "OTHER",
];
const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const TEMPERATURES = ["HOT", "WARM", "COLD"];
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const LOST_REASONS = ["PRICE", "TIMING", "COMPETITOR", "GHOSTED", "NO_BUDGET"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

/** Title-case variant — form dropdowns read better than raw enum values. */
const pretty = (v: string) => label(v).replace(/\b\w/g, (c) => c.toUpperCase());

/** Icons + colours for the conversation timeline. */
function activityVisual(type: string) {
  switch (type) {
    case "CALL":
      return { Icon: Phone, cls: "bg-primary/10 text-primary" };
    case "EMAIL":
      return { Icon: Mail, cls: "bg-sky-500/10 text-sky-500" };
    case "WHATSAPP":
      return { Icon: MessageCircle, cls: "bg-emerald-500/10 text-emerald-500" };
    case "MEETING":
      return { Icon: Video, cls: "bg-violet-500/10 text-violet-500" };
    case "LINKEDIN":
      return { Icon: Link2, cls: "bg-sky-500/10 text-sky-500" };
    case "STAGE_CHANGED":
      return { Icon: RefreshCw, cls: "bg-amber-500/10 text-amber-500" };
    case "CREATED":
      return { Icon: Plus, cls: "bg-emerald-500/10 text-emerald-500" };
    case "UPDATED":
      return { Icon: Pencil, cls: "bg-muted text-muted-foreground" };
    case "ATTACHMENT":
      return { Icon: Paperclip, cls: "bg-muted text-muted-foreground" };
    default:
      return { Icon: StickyNote, cls: "bg-muted text-muted-foreground" };
  }
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

const priorityTone: Record<string, string> = {
  URGENT: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  HIGH: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  MEDIUM: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  LOW: "border-border bg-muted/60 text-muted-foreground",
};

const temperatureTone: Record<string, string> = {
  HOT: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  WARM: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  COLD: "border-sky-500/30 bg-sky-500/10 text-sky-400",
};

const CATEGORY_COLORS = [
  { border: "border-primary/30", bg: "bg-primary/10", text: "text-primary" },
  { border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  { border: "border-pink-500/30", bg: "bg-pink-500/10", text: "text-pink-400" },
  { border: "border-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-400" },
  { border: "border-sky-500/30", bg: "bg-sky-500/10", text: "text-sky-400" },
  { border: "border-teal-500/30", bg: "bg-teal-500/10", text: "text-teal-300" },
  { border: "border-orange-500/30", bg: "bg-orange-500/10", text: "text-orange-400" },
  { border: "border-rose-500/30", bg: "bg-rose-500/10", text: "text-rose-400" },
];

function categoryToneOf(cat: { color: string | null } | null | undefined, index: number) {
  const c = CATEGORY_COLORS[Math.abs(index) % CATEGORY_COLORS.length];
  return `${c.border} ${c.bg} ${c.text}`;
}

function isStale(l: Lead) {
  return (
    l.stage !== "WON" &&
    l.stage !== "LOST" &&
    !l.lastContactedAt &&
    Date.now() - new Date(l.createdAt).getTime() > 7 * 86400000
  );
}

// ── Professional lead form (create / edit) ───────────────────────────────
interface LeadFormState {
  name: string;
  company: string;
  contactEmail: string;
  contactPhone: string;
  source: string;
  vertical: string;
  temperature: string;
  categoryId: string;
  probability: string;
  starred: boolean;
  tags: string;
  website: string;
  pageLink: string;
  priority: string;
  estimatedDealSize: string;
  currency: string;
  nextFollowUpAt: string;
  assignedToId: string;
  description: string;
  notes: string;
}

const emptyForm: LeadFormState = {
  name: "",
  company: "",
  contactEmail: "",
  contactPhone: "",
  source: "OTHER",
  vertical: "OTHER",
  temperature: "WARM",
  categoryId: "",
  probability: "50",
  starred: false,
  tags: "",
  website: "",
  pageLink: "",
  priority: "MEDIUM",
  estimatedDealSize: "",
  currency: "BDT",
  nextFollowUpAt: "",
  assignedToId: "",
  description: "",
  notes: "",
};

function LeadFormModal({
  open,
  onClose,
  users,
  categories,
  initial,
  defaultOwnerId,
  onSaved,
  onCategoryCreated,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  categories: LeadCategory[];
  initial?: Lead | null;
  defaultOwnerId?: string;
  onSaved: (warnings?: { name: string }[]) => void;
  onCategoryCreated: (c: LeadCategory) => void;
}) {
  const [f, setF] = useState<LeadFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [rules, setRules] = useState<any | null>(null);
  const [dup, setDup] = useState<{ hard: any[]; soft: any[] } | null>(null);
  const editing = !!initial;

  // Live rule set: tells the form which fields are mandatory and where the
  // lead will be routed.
  useEffect(() => {
    if (!open) return;
    apiFetch<any>("/pulse/rules")
      .then((r) => {
        setRules(r);
        // The form used to pre-select "me" as owner, which silently defeated
        // vertical/round-robin routing. Clear it so the engine can decide,
        // unless the rep explicitly picks someone afterwards.
        if (!editing && r?.enabled && r?.routing?.mode !== "MANUAL") {
          setF((prev) => ({ ...prev, assignedToId: "" }));
        }
      })
      .catch(() => setRules(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Duplicate pre-check while typing — the same logic the API enforces on save.
  useEffect(() => {
    if (!open) return;
    const phone = f.contactPhone.trim();
    const email = f.contactEmail.trim();
    const company = f.company.trim();
    if (!phone && !email && !company) {
      setDup(null);
      return;
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (phone) p.set("phone", phone);
      if (email) p.set("email", email);
      if (company) p.set("company", company);
      if (initial?.id) p.set("excludeId", initial.id);
      apiFetch<any>(`/pulse/duplicates?${p.toString()}`)
        .then((r) => setDup(r.hard?.length || r.soft?.length ? r : null))
        .catch(() => setDup(null));
    }, 450);
    return () => clearTimeout(t);
  }, [open, f.contactPhone, f.contactEmail, f.company, initial?.id]);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setNameErr(null);
    setNewCatOpen(false);
    setNewCatName("");
    setF(
      initial
        ? {
            name: initial.name,
            company: initial.company ?? "",
            contactEmail: initial.contactEmail ?? "",
            contactPhone: initial.contactPhone ?? "",
            source: initial.source,
            vertical: initial.vertical,
            temperature: initial.temperature,
            categoryId: initial.leadCategory?.id ?? "",
            probability: initial.probability != null ? String(initial.probability) : "50",
            starred: initial.starred,
            tags: (initial.tags ?? []).join(", "),
            website: initial.website ?? "",
            pageLink: initial.pageLink ?? "",
            priority: initial.priority,
            estimatedDealSize: initial.estimatedDealSize != null ? String(initial.estimatedDealSize) : "",
            currency: initial.currency ?? "BDT",
            nextFollowUpAt: localInput(initial.nextFollowUpAt),
            assignedToId: initial.assignedTo?.id ?? "",
            description: initial.description ?? "",
            notes: initial.notes ?? "",
          }
        : { ...emptyForm, assignedToId: defaultOwnerId ?? "" }
    );
  }, [open, initial, defaultOwnerId]);

  const addNewCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    try {
      const cat = await apiFetch<LeadCategory>("/pulse/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setF((p) => ({ ...p, categoryId: cat.id }));
      setNewCatName("");
      setNewCatOpen(false);
      onCategoryCreated(cat);
    } catch (e2: any) {
      setErr(e2.message ?? "Failed to add category");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      setNameErr("Contact name is required");
      return;
    }
    setNameErr(null);
    if (!editing && dup?.hard?.length) {
      setErr(`This contact already exists — ${dup.hard.map((d: any) => d.name).join(", ")}. Open that lead instead of creating a duplicate.`);
      return;
    }
    if (!editing && rules?.intake?.requirePhone?.enabled && !f.contactPhone.trim()) {
      setErr("Phone number is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: f.name.trim(),
        company: f.company.trim() || undefined,
        contactEmail: f.contactEmail.trim() || undefined,
        contactPhone: f.contactPhone.trim() || undefined,
        source: f.source,
        vertical: f.vertical,
        temperature: f.temperature,
        categoryId: f.categoryId || undefined,
        probability:
          f.probability.trim() === ""
            ? 50
            : Math.max(0, Math.min(100, Number(f.probability) || 0)),
        starred: f.starred,
        tags: f.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        website: f.website.trim() || undefined,
        pageLink: f.pageLink.trim() || undefined,
        priority: f.priority,
        estimatedDealSize: f.estimatedDealSize ? Number(f.estimatedDealSize) : undefined,
        currency: f.currency,
        nextFollowUpAt: f.nextFollowUpAt || null,
        assignedToId: f.assignedToId || undefined,
        description: f.description.trim() || undefined,
        notes: f.notes.trim() || undefined,
      };
      const res = await apiFetch<Lead>(
        editing ? `/pulse/leads/${initial!.id}` : "/pulse/leads",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) }
      );
      onSaved((res as any).duplicateWarnings);
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const extraFilled = [
    f.vertical !== "OTHER",
    !!f.tags.trim(),
    !!f.website.trim(),
    !!f.pageLink.trim(),
    !!f.notes.trim(),
  ].filter(Boolean).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<UserRound className="size-4" />}
      title={editing ? "Edit lead" : "Add new lead"}
      subtitle={
        editing
          ? "Changes recalculate the score and keep the routing history intact."
          : "A name is enough to start — phone, email and the rest can follow later."
      }
      size="lg"
      footer={
        <FormActions
          formId="lead-form"
          busy={busy}
          cancel={onClose}
          submitLabel={editing ? "Save changes" : "Add lead"}
          submitIcon={<Check className="size-4" />}
          hint={
            !editing && rules?.enabled && rules?.routing?.mode !== "MANUAL" && !f.assignedToId
              ? `Auto-assigned by rules${rules?.routing?.autoFollowUpHours ? ` · first follow-up in ${rules.routing.autoFollowUpHours}h` : ""}${rules?.scoring?.autoTemperature ? " · temperature from score" : ""}`
              : "Fields marked * are required"
          }
        />
      }
    >
      <form id="lead-form" onSubmit={save} className="flex flex-col gap-5">
        <FormError>{err}</FormError>
        {/* ── 1. Who is this? The only block you must fill in. ── */}
        <FormSection
          icon={<UserRound className="size-4" />}
          title="The person"
          hint="Who you are talking to, and the fastest way to reach them."
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Contact name" required error={nameErr}>
              <Input
                value={f.name}
                onChange={(e) => {
                  setF({ ...f, name: e.target.value });
                  if (nameErr) setNameErr(null);
                }}
                placeholder="Rahim Ahmed"
                autoFocus
                className="!py-2.5 !text-body-lg font-medium"
              />
            </Field>
            <Field label="Company">
              <Input
                value={f.company}
                onChange={(e) => setF({ ...f, company: e.target.value })}
                placeholder="Acme Ltd."
                className="!py-2.5 !text-body-lg"
              />
            </Field>
            <Field
              label="Phone"
              required={!!rules?.intake?.requirePhone?.enabled}
              hint={rules?.intake?.requirePhone?.enabled ? "Required by your intake rules" : undefined}
            >
              <Input
                value={f.contactPhone}
                onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
                placeholder="+8801…"
                inputMode="tel"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={f.contactEmail}
                onChange={(e) => setF({ ...f, contactEmail: e.target.value })}
                placeholder="rahim@acme.com"
              />
            </Field>
          </div>

          {dup && (
            <div
              className={cn(
                "mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5",
                dup.hard.length
                  ? "border-rose-500/30 bg-rose-500/10"
                  : "border-amber-500/30 bg-amber-500/10"
              )}
            >
              <AlertTriangle
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  dup.hard.length ? "text-rose-500" : "text-amber-600 dark:text-amber-400"
                )}
              />
              <div className="min-w-0 flex-1 text-meta">
                <p className={cn("font-semibold", dup.hard.length ? "text-rose-500" : "text-amber-700 dark:text-amber-300")}>
                  {dup.hard.length ? "This contact already exists — saving is blocked" : "Similar contact already on file"}
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {[...dup.hard, ...dup.soft].slice(0, 3).map((d: any) => (
                    <li key={d.id} className="truncate">
                      <span className="font-medium text-foreground">{d.name}</span>
                      {d.company ? ` · ${d.company}` : ""}{" "}
                      <span className="opacity-70">
                        ({d.matchedOn} match · {d.stage.toLowerCase().replace(/_/g, " ")})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </FormSection>

        {/* ── 1b. What they need — the context a rep reads before calling. ── */}
        <FormSection
          icon={<FileText className="size-4" />}
          title="What they need"
          hint="Sector, requirement, budget, timeline — a short brief so anyone can pick this lead up."
        >
          <Field label="Requirement / description">
            <Textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="e.g. School admission campaign 2026 — needs Meta ads + landing page, budget ৳2–3L, decision by 20 Nov."
              className="min-h-20"
            />
          </Field>
        </FormSection>

        {/* ── 2. Signals that drive scoring and routing. ── */}
        <FormSection
          icon={<Gauge className="size-4" />}
          title="Signals"
          hint="These set the lead score, the owner it routes to and where it lands in Today."
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Temperature</FieldLabel>
              <ChipGroup
                value={f.temperature}
                onChange={(v) => setF({ ...f, temperature: v })}
                options={[
                  { value: "HOT", label: "Hot", tone: "border-rose-500/30 bg-rose-500/10 text-rose-500", icon: <Flame className="size-4" /> },
                  { value: "WARM", label: "Warm", tone: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: <Zap className="size-4" /> },
                  { value: "COLD", label: "Cold", tone: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400", icon: <span className="size-1.5 rounded-full bg-current" /> },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Priority</FieldLabel>
              <ChipGroup
                value={f.priority}
                onChange={(v) => setF({ ...f, priority: v })}
                options={PRIORITIES.map((p) => ({
                  value: p,
                  label: pretty(p),
                  tone:
                    p === "URGENT"
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                      : p === "HIGH"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : p === "MEDIUM"
                          ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                          : "border-border bg-muted/60 text-muted-foreground",
                }))}
              />
            </div>
            <Field label="Source">
              <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{pretty(s)}</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Category</FieldLabel>
              <div className="flex gap-2">
                <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className="min-w-0 flex-1">
                  <option value="">None</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => setNewCatOpen((v) => !v)}
                  className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-2.5 text-meta font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  title="Add new category"
                >
                  <Plus className="size-3.5" /> New
                </button>
              </div>
              {newCatOpen && (
                <div className="mt-0.5 flex gap-2">
                  <Input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNewCategory())}
                    placeholder="e.g. School Category 2026"
                    autoFocus
                  />
                  <Btn type="button" variant="primary" onClick={addNewCategory} className="!px-3">
                    <Check className="size-3.5" />
                  </Btn>
                </div>
              )}
            </div>
          </div>
        </FormSection>

        {/* ── 3. Money and the next action. ── */}
        <FormSection
          icon={<CalendarClock className="size-4" />}
          title="Deal & follow-up"
          hint="Optional, but a follow-up date is what puts this lead on someone's plate."
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Win probability</FieldLabel>
              <PercentSlider
                label="Win probability"
                value={Number(f.probability) || 0}
                onChange={(n) => setF({ ...f, probability: String(n) })}
              />
            </div>
            <Field label="Estimated deal size">
              <div className="flex">
                <Input
                  type="number"
                  min={0}
                  value={f.estimatedDealSize}
                  onChange={(e) => setF({ ...f, estimatedDealSize: e.target.value })}
                  placeholder="250000"
                  className="rounded-r-none"
                />
                <Select
                  value={f.currency}
                  onChange={(e) => setF({ ...f, currency: e.target.value })}
                  className="!w-[88px] shrink-0 rounded-l-none border-l-0"
                  aria-label="Currency"
                >
                  <option value="BDT">BDT</option>
                  <option value="USD">USD</option>
                  <option value="SAR">SAR</option>
                  <option value="AED">AED</option>
                </Select>
              </div>
            </Field>
            <Field label="Next follow-up" hint="Goes straight into Today">
              <Input
                type="datetime-local"
                value={f.nextFollowUpAt}
                onChange={(e) => setF({ ...f, nextFollowUpAt: e.target.value })}
              />
            </Field>
            <Field
              label="Assigned to"
              hint={
                !editing && rules?.enabled && rules?.routing?.mode !== "MANUAL"
                  ? "Leave empty to let routing decide"
                  : "Owner of the follow-up"
              }
            >
              <Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}>
                <option value="">
                  {!editing && rules?.enabled && rules?.routing?.mode !== "MANUAL" ? "Auto — assigned by rules" : "Unassigned"}
                </option>
                {(users ?? []).map((u: UserLite) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        {/* ── 4. Everything else, out of the way until asked for. ── */}
        <Collapsible
          icon={<SlidersHorizontal className="size-4" />}
          title="More details"
          hint="Vertical, links, tags and notes"
          badge={extraFilled > 0 ? <CountBadge>{extraFilled}</CountBadge> : undefined}
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Vertical">
              <Select value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value })}>
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>{pretty(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tags" hint="Comma separated">
              <Input
                value={f.tags}
                onChange={(e) => setF({ ...f, tags: e.target.value })}
                placeholder="campaign, follow-up, budget…"
              />
            </Field>
            <Field label="Website">
              <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://acme.com" />
            </Field>
            <Field label="Social / page link">
              <Input value={f.pageLink} onChange={(e) => setF({ ...f, pageLink: e.target.value })} placeholder="https://facebook.com/acme" />
            </Field>
          </div>
          <Field label="Notes" className="mt-3.5">
            <Textarea
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Context, commitments, objections…"
            />
          </Field>
        </Collapsible>
      </form>
    </Modal>
  );
}

// ── Inline conversation composer (lead detail) ───────────────────────────
const CONVERSATION_CHANNELS = [
  { value: "CALL", label: "Call", icon: Phone },
  { value: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
  { value: "EMAIL", label: "Email", icon: Mail },
  { value: "MEETING", label: "Meeting", icon: Video },
  { value: "NOTE", label: "Note", icon: StickyNote },
] as const;

const CONVERSATION_OUTCOMES = [
  { value: "CONNECTED", label: "Connected", tone: "positive" },
  { value: "INTERESTED", label: "Interested", tone: "positive" },
  { value: "NEEDS_INFO", label: "Needs info", tone: "neutral" },
  { value: "CALLBACK_REQUESTED", label: "Call back", tone: "neutral" },
  { value: "MEETING_BOOKED", label: "Booked", tone: "positive" },
  { value: "NO_ANSWER", label: "No answer", tone: "negative" },
  { value: "LEFT_MESSAGE", label: "Left msg", tone: "neutral" },
  { value: "NOT_INTERESTED", label: "Not interested", tone: "negative" },
] as const;

function nextStepDate(mode: "none" | "tomorrow" | "3d" | "week") {
  if (mode === "none") return null;
  const days = mode === "tomorrow" ? 1 : mode === "3d" ? 3 : 7;
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}

/**
 * The primary conversation tool inside a lead. One save records the touch,
 * the outcome and the next step — which is what keeps the follow-up honest.
 */
function ConversationComposer({
  leadId,
  onSaved,
}: {
  leadId: string;
  onSaved: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<string>("CALL");
  const [outcome, setOutcome] = useState<string>("");
  const [text, setText] = useState("");
  const [step, setStep] = useState<"none" | "tomorrow" | "3d" | "week">("tomorrow");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim() && !outcome) {
      setErr("Add a note or pick what happened");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const when = nextStepDate(step);
      await apiFetch(`/pulse/leads/${leadId}/quick-log`, {
        method: "POST",
        body: JSON.stringify({
          type: channel,
          outcome: channel === "NOTE" ? undefined : outcome || undefined,
          content: text.trim() || undefined,
          nextFollowUpAt: when ? when.toISOString() : undefined,
          clearNextStep: step === "none" ? true : undefined,
        }),
      });
      setText("");
      setOutcome("");
      qc.invalidateQueries({ queryKey: ["pulse"] });
      qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
      onSaved(when ? "Logged — next step scheduled" : "Logged to the conversation");
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const tone = (t: string) =>
    t === "positive"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : t === "negative"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
        : "border-border bg-card text-muted-foreground";

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.05] to-transparent p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {CONVERSATION_CHANNELS.map((c) => {
          const Icon = c.icon;
          const on = channel === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setChannel(c.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-body font-bold transition-colors",
                on
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {c.label}
            </button>
          );
        })}
        <span className="ml-auto text-meta font-semibold text-muted-foreground">
          Logged as {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {channel !== "NOTE" && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CONVERSATION_OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOutcome((v) => (v === o.value ? "" : o.value))}
              className={cn(
                "rounded-full border px-2 py-0.5 text-meta font-semibold transition-colors",
                outcome === o.value ? tone(o.tone) : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
        }}
        placeholder={
          channel === "WHATSAPP"
            ? "What did you send or get back…"
            : channel === "NOTE"
              ? "Context, commitment, objection…"
              : "What was said? Price, timeline, decision maker…"
        }
        className="mt-2.5 min-h-16 bg-card"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-meta font-bold tracking-wide text-muted-foreground uppercase">Next step</span>
        {([
          { key: "tomorrow", label: "Tomorrow" },
          { key: "3d", label: "In 3 days" },
          { key: "week", label: "Next week" },
          { key: "none", label: "None" },
        ] as const).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setStep(o.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-meta font-bold transition-colors",
              step === o.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        ))}
        <Btn variant="primary" className="ml-auto !py-1.5 text-body" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save to timeline"}
        </Btn>
      </div>
      {err && <p className="mt-2 text-body font-medium text-rose-400">{err}</p>}
    </div>
  );
}

// ── Schedule / reschedule meeting modal ──────────────────────────────────
function localInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MeetingModal({
  open,
  onClose,
  leadId,
  employees,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  employees: { id: string; name: string; department?: string | null }[];
  initial?: LeadMeeting | null;
  onSaved: (msg?: string) => void;
}) {
  const editing = !!initial;
  const [f, setF] = useState({ title: "", mode: "online" as "online" | "offline", scheduledAt: "", durationMins: "30", meetingLink: "", location: "", notes: "", attendeeIds: [] as string[], assignToId: "", taskTitle: "" });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setQ("");
    if (initial) {
      const attendeeIds =
        initial.attendeeLinks?.map((a) => a.employeeId) ??
        (initial.attendees ?? []).map((a) => a.id);
      const online = ["VIDEO_CALL", "CALL"].includes(initial.type);
      setF({
        title: initial.title,
        mode: online ? "online" : "offline",
        scheduledAt: localInput(initial.scheduledAt),
        durationMins: String(initial.durationMins ?? 30),
        meetingLink: initial.meetingLink ?? "",
        location: initial.location ?? "",
        notes: initial.notes ?? "",
        attendeeIds,
        assignToId: "",
        taskTitle: "",
      });
    } else {
      setF({ title: "", mode: "online", scheduledAt: "", durationMins: "30", meetingLink: "", location: "", notes: "", attendeeIds: [], assignToId: "", taskTitle: "" });
    }
  }, [open, initial]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId) return;
    if (!f.title.trim() || !f.scheduledAt) {
      setErr("Title and scheduled time are required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        title: f.title.trim(),
        type: f.mode === "online" ? "VIDEO_CALL" : "IN_PERSON",
        scheduledAt: new Date(f.scheduledAt).toISOString(),
        durationMins: Number(f.durationMins) || 30,
        meetingLink: f.mode === "online" ? f.meetingLink.trim() || undefined : undefined,
        location: f.mode === "offline" ? f.location.trim() || undefined : undefined,
        attendees: f.attendeeIds.length
          ? employees.filter((e) => f.attendeeIds.includes(e.id)).map((e) => ({ id: e.id, name: e.name }))
          : undefined,
        notes: f.notes.trim() || undefined,
        ...(editing ? {} : { assignToId: f.assignToId || undefined, taskTitle: f.taskTitle.trim() || undefined }),
      };
      const res = await apiFetch<any>(
        editing ? `/pulse/leads/${leadId}/meetings/${initial!.id}` : `/pulse/leads/${leadId}/meetings`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) }
      );
      onSaved(
        editing
          ? "Meeting updated"
          : res?.createdTask
            ? `Meeting scheduled — task created for ${res.createdTask.assigneeName ?? ""}`.trim()
            : "Meeting scheduled"
      );
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const roster = [...employees].sort(
    (a, b) => Number(f.attendeeIds.includes(b.id)) - Number(f.attendeeIds.includes(a.id))
  );
  const visible = q.trim()
    ? roster.filter((e) => `${e.name} ${e.department ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : roster;

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Reschedule meeting" : "Schedule meeting"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Discovery call" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meeting mode">
            <Segmented
              value={f.mode}
              onChange={(v) => setF((p) => ({ ...p, mode: v as "online" | "offline" }))}
              options={[
                { value: "online", label: "Online" },
                { value: "offline", label: "In person" },
              ]}
            />
          </Field>
          <Field label="Duration">
            <Select value={f.durationMins} onChange={(e) => setF({ ...f, durationMins: e.target.value })}>
              {["15", "30", "45", "60", "90", "120"].map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="When *">
          <Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} />
        </Field>
        {f.mode === "online" ? (
          <Field label="Meeting link" hint="Google Meet / Zoom — client gets this in the invite">
            <Input value={f.meetingLink} onChange={(e) => setF({ ...f, meetingLink: e.target.value })} placeholder="https://meet.google.com/…" />
          </Field>
        ) : (
          <Field label="Location" hint="Where will the meeting happen?">
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Client office, cafe…" className="!pl-9" />
            </div>
          </Field>
        )}
        <Field label="Agenda / notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What needs to be covered…" />
        </Field>

        {!editing && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="mb-2 text-meta font-bold tracking-[0.08em] text-primary uppercase">Action → task</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Assign action to" hint="Task auto-created for this member">
                <Select value={f.assignToId} onChange={(e) => setF({ ...f, assignToId: e.target.value })}>
                  <option value="">No task</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Task title" hint="Defaults to meeting title">
                <Input value={f.taskTitle} onChange={(e) => setF({ ...f, taskTitle: e.target.value })} placeholder="Meeting: Discovery call…" />
              </Field>
            </div>
          </div>
        )}

        <Field
          label={`Who is coming? ${f.attendeeIds.length ? `· ${f.attendeeIds.length} selected` : ""}`}
          hint="Anyone on the roster — a login is not required"
        >
          <div className="rounded-xl border border-border bg-muted/20">
            <div className="relative border-b border-border/60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search teammates…"
                className="w-full bg-transparent py-2 pl-8 pr-3 text-body-lg outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto p-2">
              {visible.map((e) => {
                const on = f.attendeeIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      setF((p) => ({
                        ...p,
                        attendeeIds: on ? p.attendeeIds.filter((x) => x !== e.id) : [...p.attendeeIds, e.id],
                      }))
                    }
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2 py-1 text-body font-semibold transition-colors",
                      on ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Avatar name={e.name} size="xs" />
                    {e.name}
                    {e.department && <span className="text-micro font-medium text-muted-foreground">· {e.department}</span>}
                    {on && <Check className="size-3.5" />}
                  </button>
                );
              })}
              {visible.length === 0 && <p className="p-1 text-body-lg text-muted-foreground">No teammates match.</p>}
            </div>
          </div>
        </Field>

        {err && <p className="text-body-lg font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Schedule"} />
      </form>
    </Modal>
  );
}

function nextScheduled<T>(items: T[] | undefined, dateKey: keyof T, statusKey: keyof T): T | undefined {
  return (items ?? [])
    .filter((i) => String(i[statusKey]) === "SCHEDULED")
    .sort((a, b) => new Date(String(a[dateKey])).getTime() - new Date(String(b[dateKey])).getTime())[0];
}

// ── Convert modal ────────────────────────────────────────────────────────
function ConvertModal({
  open,
  onClose,
  lead,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  users: UserLite[];
  onSaved: () => void;
}) {
  const [f, setF] = useState({ companyName: "", projectName: "", contactName: "", contactEmail: "", contactPhone: "", accountOwnerId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && lead) {
      setErr(null);
      setF({
        companyName: lead.company ?? lead.name,
        projectName: "",
        contactName: lead.name,
        contactEmail: lead.contactEmail ?? "",
        contactPhone: lead.contactPhone ?? "",
        accountOwnerId: lead.assignedTo?.id ?? "",
      });
    }
  }, [open, lead]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/pulse/leads/${lead.id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          companyName: f.companyName.trim() || lead.company || lead.name,
          projectName: f.projectName.trim() || undefined,
          contactName: f.contactName.trim() || undefined,
          contactEmail: f.contactEmail.trim() || undefined,
          contactPhone: f.contactPhone.trim() || undefined,
          accountOwnerId: f.accountOwnerId || undefined,
        }),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Convert failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Convert to client">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-body-lg font-medium text-emerald-400">
          On convert: client record তৈরি হবে + PLANNING project auto-create হবে এবং proposal ও activity history project-এ ক্যারি হবে (Flow মডিউলে দেখা যাবে)।
        </div>
        <Field label="Company name *">
          <Input value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} autoFocus />
        </Field>
        <Field label="Project name" hint="খালি রাখলে auto: {company} — Onboarding">
          <Input value={f.projectName} onChange={(e) => setF({ ...f, projectName: e.target.value })} placeholder="Website Revamp 2026" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary contact">
            <Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
          </Field>
          <Field label="Account owner">
            <Select value={f.accountOwnerId} onChange={(e) => setF({ ...f, accountOwnerId: e.target.value })}>
              <option value="">Keep lead owner</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        {err && <p className="text-body-lg font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Convert & onboard" />
      </form>
    </Modal>
  );
}

// ── Lost modal ───────────────────────────────────────────────────────────
function LostModal({
  open,
  onClose,
  lead,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("PRICE");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("PRICE");
      setNotes("");
      setErr(null);
    }
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/pulse/leads/${lead.id}/lost`, {
        method: "POST",
        body: JSON.stringify({ reasonCategory: reason, notes: notes.trim() || undefined }),
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
    <Modal open={open} onClose={onClose} title="Mark lead lost">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Why did we lose this lead?">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>{label(r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened, competitor, timing…" />
        </Field>
        {err && <p className="text-body-lg font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Mark lost" />
      </form>
    </Modal>
  );
}

// ── Category manager modal ───────────────────────────────────────────────
function CategoryModal({
  open,
  onClose,
  categories,
  onChanged,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  categories: LeadCategory[];
  onChanged: () => void;
  notify: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setErr(null);
    }
  }, [open]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/pulse/categories", { method: "POST", body: JSON.stringify({ name: n }) });
      setName("");
      notify(`Category "${n}" added`);
      onChanged();
    } catch (e2: any) {
      setErr(e2.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: LeadCategory) => {
    if (!confirm(`Delete category "${c.name}"? Leads will become uncategorized.`)) return;
    try {
      await apiFetch(`/pulse/categories/${c.id}`, { method: "DELETE" });
      notify(`Category "${c.name}" deleted`);
      onChanged();
    } catch (e2: any) {
      setErr(e2.message ?? "Failed");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage categories">
      <div className="flex flex-col gap-4">
        <form onSubmit={create} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "School Category 2026", "E-commerce Growth"…'
            autoFocus
          />
          <Btn type="submit" variant="primary" className={busy ? "opacity-60" : ""}>
            <Plus className="size-3.5" /> Add
          </Btn>
        </form>
        {err && <p className="text-body-lg font-medium text-rose-400">{err}</p>}
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {categories.length === 0 && <p className="text-body-lg text-muted-foreground">No categories yet.</p>}
          {categories.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
              {c.color && <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />}
              <span className="flex-1 truncate text-body-lg font-semibold">{c.name}</span>
              <button onClick={() => remove(c)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete category">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function PulsePage() {
  const qc = useQueryClient();
  const { user: sessionUser } = useAuth();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [source, setSource] = useState("");
  const [vertical, setVertical] = useState("");
  const [temperature, setTemperature] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [priority, setPriority] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [minScore, setMinScore] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  type PulseTab = "today" | "pipeline" | "insights";
  // Old deep links used ?tab=overview|leads — keep them working.
  const readTab = (raw: string | null): PulseTab =>
    raw === "leads" ? "pipeline" : raw === "overview" ? "insights" : raw === "today" || raw === "pipeline" || raw === "insights" ? raw : "today";
  const [pulseTab, setPulseTab] = useState<PulseTab>(readTab(searchParams.get("tab")));
  const [view, setView] = useState<"board" | "table" | "grid">("board");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // sync tab -> URL (?tab=...) for redirect/deep-link + back-button
  const setPulseTabWithUrl = useCallback(
    (v: PulseTab) => {
      setPulseTab(v);
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", v);
      router.push(`/pulse?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  // keep state in sync if user navigates via back/forward or direct link
  useEffect(() => {
    setPulseTab(readTab(searchParams.get("tab")));
  }, [searchParams]);
  const [followUpDue, setFollowUpDue] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const [quickLogLead, setQuickLogLead] = useState<PulseWorkItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragStage, setDragStage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");

  const { data: summary } = useApi<PipelineSummary>("/pulse/summary");
  const { data: users } = useApi<UserLite[]>("/users");
  const { data: employees } = useApi<{ id: string; name: string; department?: string | null }[]>("/people/employees");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Deep links from notifications (?lead=<id>) ───────────────────────
  // Declared cleanup-first so the first render does not strip a fresh ?lead=
  // before the opener effect has run (effects execute in declaration order).
  const leadParam = searchParams.get("lead");
  const leadOpened = useRef(false);
  useEffect(() => {
    if (selectedId) {
      leadOpened.current = true;
      return;
    }
    if (!leadOpened.current) return;
    leadOpened.current = false;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("lead")) return;
    sp.delete("lead");
    router.replace(`/pulse${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }, [selectedId, router]);
  useEffect(() => {
    if (leadParam) setSelectedId(leadParam);
  }, [leadParam]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<LeadMeeting | null>(null);
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [deleteLead, setDeleteLead] = useState<Lead | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<{ name: string }[] | null>(null);

  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [followUpAssignee, setFollowUpAssignee] = useState("");
  const [followUpTaskTitle, setFollowUpTaskTitle] = useState("");
  const [proposalModal, setProposalModal] = useState(false);
  const [proposalUrl, setProposalUrl] = useState("");
  const [proposalPortal, setProposalPortal] = useState("");
  const [proposalSendNow, setProposalSendNow] = useState(false);
  const [editProposal, setEditProposal] = useState<Proposal | null>(null);
  const [editLink, setEditLink] = useState("");
  const [editFileUrl, setEditFileUrl] = useState("");
  const [editStatus, setEditStatus] = useState("DRAFT");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);

  // lead-detail view state
  const [detailTab, setDetailTab] = useState<DetailTab>("conversation");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [attDrag, setAttDrag] = useState(false);
  const attRef = useRef<HTMLInputElement>(null);

  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_URL}/pulse/export${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify("Export downloaded");
    } catch (e: any) {
      notify(e.message ?? "Export failed");
    }
  };

  const importCsv = async (file: File) => {
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/pulse/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Import failed");
      notify(
        `Imported ${data.imported} of ${data.total} rows` +
          (Array.isArray(data.skipped) && data.skipped.length ? ` · ${data.skipped.length} skipped` : "")
      );
      reload();
    } catch (e: any) {
      notify(e.message ?? "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["pulse"] });
    qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
    qc.invalidateQueries({ queryKey: ["api", "/pulse/categories"] });
  }, [qc]);
  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const leadPatch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<Lead>(`/pulse/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["pulse"] });
      const prevList = qc.getQueryData<InfiniteData<{ items: Lead[]; total: number; page: number; pageSize: number }>>(["pulse", "leads", query]);
      const prevDetail = qc.getQueryData<Lead>(["pulse", "lead", id]);
      qc.setQueryData<InfiniteData<{ items: Lead[]; total: number; page: number; pageSize: number }>>(["pulse", "leads", query], (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((l) => (l.id === id ? { ...l, ...(patch as Partial<Lead>) } : l)),
              })),
            }
          : old
      );
      qc.setQueryData<Lead>(["pulse", "lead", id], (old) => (old ? { ...old, ...(patch as Partial<Lead>) } : old));
      return { prevList, prevDetail, id };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prevList) qc.setQueryData(["pulse", "leads", query], ctx.prevList);
      if (ctx?.prevDetail) qc.setQueryData(["pulse", "lead", ctx.id], ctx.prevDetail);
      notify(e.message ?? "Update failed");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pulse"] });
      qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
    },
  });

  const detailNotesMutation = useMutation({
    mutationFn: ({ action, noteId, content }: { action: "add" | "edit" | "delete"; noteId?: string; content?: string }) => {
      const base = `/pulse/leads/${selectedId}/notes`;
      if (action === "add") return apiFetch<LeadNote>(base, { method: "POST", body: JSON.stringify({ content }) });
      if (action === "delete") return apiFetch(`${base}/${noteId}`, { method: "DELETE" });
      return apiFetch<LeadNote>(`${base}/${noteId}`, { method: "PATCH", body: JSON.stringify({ content }) });
    },
    onMutate: async ({ action, noteId, content }) => {
      await qc.cancelQueries({ queryKey: ["pulse", "lead", selectedId] });
      const prev = qc.getQueryData<Lead>(["pulse", "lead", selectedId]);
      qc.setQueryData<Lead>(["pulse", "lead", selectedId], (old) => {
        if (!old) return old;
        if (action === "add") {
          const temp: LeadNote = { id: `temp-${Date.now()}`, content: content ?? "", createdBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          return { ...old, notesList: [temp, ...(old.notesList ?? [])] };
        }
        if (action === "delete") return { ...old, notesList: (old.notesList ?? []).filter((n) => n.id !== noteId) };
        return { ...old, notesList: (old.notesList ?? []).map((n) => (n.id === noteId ? { ...n, content: content ?? n.content } : n)) };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["pulse", "lead", selectedId], ctx.prev);
      notify(e.message ?? "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] }),
  });

  const followUpMutation = useMutation({
    mutationFn: ({ action, id, status, date, notes, assignToId, taskTitle }: { action: "add" | "delete" | "status"; id?: string; status?: string; date?: string; notes?: string; assignToId?: string; taskTitle?: string }) => {
      const base = `/pulse/leads/${selectedId}/follow-ups`;
      if (action === "add") return apiFetch<LeadFollowUp & { createdTask?: { id: string; assigneeName?: string } }>(base, { method: "POST", body: JSON.stringify({ date: new Date(date!).toISOString(), notes, assignToId: assignToId || undefined, taskTitle: taskTitle?.trim() || undefined }) });
      if (action === "delete") return apiFetch(`${base}/${id}`, { method: "DELETE" });
      return apiFetch(`${base}/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    },
    onMutate: async ({ action, id, status, date, notes }) => {
      await qc.cancelQueries({ queryKey: ["pulse"] });
      const prevList = qc.getQueryData<InfiniteData<{ items: Lead[]; total: number; page: number; pageSize: number }>>(["pulse", "leads", query]);
      const prevDetail = qc.getQueryData<Lead>(["pulse", "lead", selectedId]);
      qc.setQueryData<Lead>(["pulse", "lead", selectedId], (old) => {
        if (!old) return old;
        if (action === "add") {
          const temp: LeadFollowUp = { id: `temp-${Date.now()}`, date: new Date(date!).toISOString(), notes: notes ?? "", status: "SCHEDULED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          return { ...old, followUps: [...(old.followUps ?? []), temp] };
        }
        if (action === "delete") return { ...old, followUps: (old.followUps ?? []).filter((f) => f.id !== id) };
        return { ...old, followUps: (old.followUps ?? []).map((f) => (f.id === id ? { ...f, status: (status as LeadFollowUp["status"]) ?? f.status } : f)) };
      });
      return { prevList, prevDetail };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prevList) qc.setQueryData(["pulse", "leads", query], ctx.prevList);
      if (ctx?.prevDetail) qc.setQueryData(["pulse", "lead", selectedId], ctx.prevDetail);
      notify(e.message ?? "Failed");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pulse"] });
      qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
    },
  });

  const meetingMutation = useMutation({
    mutationFn: ({ action, id, status }: { action: "status" | "delete"; id: string; status?: string }) => {
      if (action === "delete") return apiFetch(`/pulse/leads/${selectedId}/meetings/${id}`, { method: "DELETE" });
      return apiFetch(`/pulse/leads/${selectedId}/meetings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    },
    onMutate: async ({ action, id, status }) => {
      await qc.cancelQueries({ queryKey: ["pulse", "lead", selectedId] });
      const prev = qc.getQueryData<Lead>(["pulse", "lead", selectedId]);
      qc.setQueryData<Lead>(["pulse", "lead", selectedId], (old) => {
        if (!old) return old;
        if (action === "delete") return { ...old, meetings: (old.meetings ?? []).filter((m) => m.id !== id) };
        return { ...old, meetings: (old.meetings ?? []).map((m) => (m.id === id ? { ...m, status: status ?? m.status } : m)) };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["pulse", "lead", selectedId], ctx.prev);
      notify(e.message ?? "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] }),
  });

  useEffect(() => {
    setDetailTab("conversation");
    setEditingMeeting(null);
  }, [selectedId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (source) p.set("source", source);
    if (vertical) p.set("vertical", vertical);
    if (temperature) p.set("temperature", temperature);
    if (categoryId) p.set("categoryId", categoryId);
    if (starredOnly) p.set("starred", "true");
    if (priority) p.set("priority", priority);
    if (ownerId) p.set("assignedToId", ownerId);
    if (minScore) p.set("minScore", minScore);
    if (followUpDue) p.set("followUpDue", followUpDue);
    if (createdAfter) p.set("createdAfter", createdAfter);
    return p.toString();
  }, [debouncedQ, source, vertical, temperature, categoryId, starredOnly, priority, ownerId, minScore, followUpDue, createdAfter]);

  const PAGE_SIZE = 100;
  const {
    data: leadPages,
    error: leadsErr,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["pulse", "leads", query],
    queryFn: ({ pageParam }) =>
      apiFetch<{ items: Lead[]; total: number; page: number; pageSize: number }>(
        `/pulse/leads${query ? `?${query}&` : "?"}page=${pageParam}&pageSize=${PAGE_SIZE}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const leads = leadPages ? leadPages.pages.flatMap((p) => p.items) : null;
  const leadsTotal = leadPages?.pages[0]?.total ?? 0;
  const { data: categories = [] } = useQuery({
    queryKey: ["api", "/pulse/categories"],
    queryFn: () => apiFetch<LeadCategory[]>("/pulse/categories"),
  });
  const leadsErrMsg = leadsErr ? (leadsErr as Error).message : null;

  const detailQ = useQuery({
    queryKey: ["pulse", "lead", selectedId],
    queryFn: () => apiFetch<Lead>(`/pulse/leads/${selectedId as string}`),
    enabled: selectedId !== null,
    placeholderData: keepPreviousData,
  });
  const detail = detailQ.data ?? null;
  const detailLoading = detailQ.isPending;
  useEffect(() => {
    if (selectedId && detailQ.isError) setSelectedId(null);
  }, [selectedId, detailQ.isError]);

  /** Everyone pulled into this lead's meetings, with their attendance record. */
  const teamPeople = useMemo(() => {
    const map = new Map<string, { id: string; name: string; meetings: number; attended: number }>();
    for (const m of detail?.meetings ?? []) {
      for (const a of m.attendeeLinks ?? []) {
        const name = a.employee?.name ?? "Teammate";
        const row = map.get(a.employeeId) ?? { id: a.employeeId, name, meetings: 0, attended: 0 };
        row.meetings += 1;
        if (a.status === "ATTENDED") row.attended += 1;
        map.set(a.employeeId, row);
      }
    }
    return [...map.values()].sort((a, b) => b.meetings - a.meetings);
  }, [detail]);

  const currentProposal = useMemo(() => {
    const list = detail?.proposals ?? [];
    return list.find((p) => p.status === "SENT") ?? list.find((p) => p.status === "ACCEPTED") ?? list[0] ?? null;
  }, [detail]);

  // ── mutations ──────────────────────────────────────────────────────────
  const patchLead = (patch: Record<string, unknown>, msg?: string) => {
    if (!selectedId) return;
    leadPatch.mutate(
      { id: selectedId as string, patch },
      msg ? { onSuccess: () => notify(msg) } : undefined
    );
  };

  const addNote = async () => {
    if (!selectedId || !noteText.trim()) return;
    setNoteBusy(true);
    detailNotesMutation.mutate({ action: "add", content: noteText.trim() }, {
      onSuccess: () => {
        setNoteText("");
        notify("Note added");
      },
      onSettled: () => setNoteBusy(false),
    });
  };

  const saveNoteEdit = async (noteId: string) => {
    if (!selectedId || !editNoteText.trim()) return;
    detailNotesMutation.mutate({ action: "edit", noteId, content: editNoteText.trim() }, {
      onSuccess: () => {
        setEditingNoteId(null);
        notify("Note updated");
      },
    });
  };

  const deleteNote = (note: LeadNote) => {
    if (!selectedId) return;
    detailNotesMutation.mutate({ action: "delete", noteId: note.id }, {
      onSuccess: () => notify("Note deleted"),
    });
  };

  // ── lead-detail: contact copy + attachments ────────────────────────────
  const copyContact = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      notify("Copy failed");
    }
  };

  const uploadAttachment = async (files: FileList | File[]) => {
    if (!selectedId || attBusy) return;
    const list = Array.from(files);
    if (!list.length) return;
    setAttBusy(true);
    try {
      for (const f of list) {
        const fd = new FormData();
        fd.append("file", f);
        await apiFetchFormData(`/pulse/leads/${selectedId}/attachments`, fd);
      }
      notify(list.length > 1 ? `${list.length} attachments uploaded` : "Attachment uploaded");
      qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] });
      qc.invalidateQueries({ queryKey: ["pulse", "leads", query] });
    } catch (e: any) {
      notify(e.message ?? "Upload failed");
    } finally {
      setAttBusy(false);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/pulse/leads/${selectedId}/attachments/${attachmentId}`, { method: "DELETE" });
      notify("Attachment removed");
      qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] });
    } catch (e: any) {
      notify(e.message ?? "Failed");
    }
  };

  const moveStage = (lead: Lead, dir: -1 | 1) => {
    const idx = STAGES.indexOf(lead.stage as (typeof STAGES)[number]);
    const next = STAGES[idx + dir];
    if (!next) return;
    leadPatch.mutate({ id: lead.id, patch: { stage: next } }, { onSuccess: () => notify(`Moved to ${label(next)}`) });
  };

  const stageChanged = (lead: Lead, stage: string) => {
    leadPatch.mutate({ id: lead.id, patch: { stage } }, { onSuccess: () => notify(`Moved to ${label(stage)}`) });
  };

  const toggleStar = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    leadPatch.mutate({ id: lead.id, patch: { starred: !lead.starred } }, {
      onSuccess: () => notify(lead.starred ? "Removed from starred" : "Starred"),
    });
  };

  /** Lets the detail sheet reuse the Today composer without a second form. */
  const asWorkItem = (l: Lead): PulseWorkItem => {
    const fu = l.followUps?.find((f) => f.status === "SCHEDULED");
    const mt = l.meetings?.find((m) => m.status === "SCHEDULED");
    const kind = fu && mt ? (new Date(fu.date) <= new Date(mt.scheduledAt) ? "follow-up" : "meeting") : fu ? "follow-up" : mt ? "meeting" : null;
    return {
      id: l.id,
      uid: l.uid,
      name: l.name,
      company: l.company,
      stage: l.stage,
      priority: l.priority,
      temperature: l.temperature,
      leadScore: l.leadScore,
      probability: l.probability ?? 0,
      estimatedDealSize: l.estimatedDealSize,
      currency: l.currency,
      contactEmail: l.contactEmail,
      contactPhone: l.contactPhone,
      lastContactedAt: l.lastContactedAt,
      nextFollowUpAt: l.nextFollowUpAt ?? null,
      nextActionKind: kind,
      nextActionNote: kind === "follow-up" ? fu?.notes ?? null : kind === "meeting" ? mt?.title ?? null : null,
      followUpId: fu?.id ?? null,
      meetingId: mt?.id ?? null,
      assignedTo: l.assignedTo,
      daysSinceContact: l.lastContactedAt ? Math.floor((Date.now() - new Date(l.lastContactedAt).getTime()) / 86400000) : null,
      stale: l.lastContactedAt ? Date.now() - new Date(l.lastContactedAt).getTime() > 7 * 86400000 : Date.now() - new Date(l.createdAt).getTime() > 7 * 86400000,
    };
  };

  const followUpStatusFn = (fu: LeadFollowUp) => {
    const diff = new Date(fu.date).getTime() - Date.now();
    if (fu.status === "SCHEDULED" && diff < 0) return "overdue";
    return null;
  };

  const addFollowUp = (date: string, notes: string, assignToId: string, taskTitle: string) => {
    if (!selectedId || !date) return;
    followUpMutation.mutate({ action: "add", date, notes: notes.trim() || undefined, assignToId, taskTitle }, {
      onSuccess: (res) => {
        setFollowUpDate("");
        setFollowUpNotes("");
        setFollowUpAssignee("");
        setFollowUpTaskTitle("");
        notify(res?.createdTask ? "Follow-up scheduled — task created" : "Follow-up scheduled");
      },
    });
  };

  const followUpStatusChange = (fu: LeadFollowUp, status: string) => {
    followUpMutation.mutate({ action: "status", id: fu.id, status }, {
      onSuccess: () => notify(`Follow-up marked ${label(status)}`),
    });
  };

  const deleteFollowUp = (fu: LeadFollowUp) => {
    followUpMutation.mutate({ action: "delete", id: fu.id }, {
      onSuccess: () => notify("Follow-up removed"),
    });
  };

  const meetingStatus = (m: LeadMeeting, status: string) => {
    meetingMutation.mutate({ action: "status", id: m.id, status }, {
      onSuccess: () => notify(status === "COMPLETED" ? "Meeting completed — activity logged" : `Meeting ${label(status)}`),
    });
  };

  const deleteMeeting = (m: LeadMeeting) => {
    meetingMutation.mutate({ action: "delete", id: m.id }, {
      onSuccess: () => notify("Meeting removed"),
    });
  };

  /** Invited → attended → no-show → invited. One tap per attendee. */
  const cycleAttendeeStatus = async (meetingId: string, employeeId: string, current: string) => {
    const next = current === "INVITED" ? "ATTENDED" : current === "ATTENDED" ? "NO_SHOW" : "INVITED";
    try {
      await apiFetch(`/pulse/meetings/${meetingId}/attendees/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] });
      notify(`Attendance → ${next.toLowerCase().replace(/_/g, " ")}`);
    } catch (e: any) {
      notify(e.message ?? "Could not update attendance");
    }
  };

  const proposalStatus = (p: Proposal, status: string) => {
    apiFetch(`/pulse/leads/${selectedId}/proposals/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).then(() => {
      notify(`Proposal marked ${label(status)}`);
      reload();
    });
  };

  const addProposal = async () => {
    if (!selectedId) return;
    const link = proposalPortal.trim();
    if (!proposalUrl.trim() && !link) {
      notify("একটা file upload করো অথবা proposal link paste করো");
      return;
    }
    if (link && !isValidLink(link)) {
      notify("Link টা valid URL না — https:// সহ paste করো");
      return;
    }
    try {
      await apiFetch(`/pulse/leads/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          fileUrl: proposalUrl.trim() || undefined,
          portalLink: link ? normalizeLink(link) : undefined,
          status: proposalSendNow ? "SENT" : "DRAFT",
        }),
      });
      setProposalModal(false);
      setProposalUrl("");
      setProposalPortal("");
      setProposalSendNow(false);
      notify(proposalSendNow ? "Proposal sent — stage updated" : "Proposal added as draft");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Failed");
    }
  };

  // open the proposal for viewing (tracks "seen" for internal views)
  const openProposal = (p: Proposal) => {
    const target = proposalTarget(p);
    if (!target) {
      notify("এই proposal-এ কোনো link বা file নেই");
      return;
    }
    if (selectedId && !p.viewed) {
      apiFetch(`/pulse/leads/${selectedId}/proposals/${p.id}/viewed`, { method: "POST" })
        .then(() => reload())
        .catch(() => {});
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const copyProposalLink = async (p: Proposal) => {
    const target = proposalTarget(p);
    if (!target) {
      notify("Copy করার মতো link নেই");
      return;
    }
    try {
      await navigator.clipboard.writeText(target);
      setCopiedField(`proposal-${p.id}`);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      notify("Copy failed");
    }
  };

  const openEditProposal = (p: Proposal) => {
    setEditProposal(p);
    setEditLink(p.portalLink ?? "");
    setEditFileUrl(p.fileUrl ?? "");
    setEditStatus(p.status);
  };

  const saveEditProposal = async () => {
    if (!selectedId || !editProposal) return;
    const link = editLink.trim();
    if (link && !isValidLink(link)) {
      notify("Link টা valid URL না — https:// সহ paste করো");
      return;
    }
    try {
      await apiFetch(`/pulse/leads/${selectedId}/proposals/${editProposal.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          portalLink: link ? normalizeLink(link) : undefined,
          fileUrl: editFileUrl.trim() || undefined,
          status: editStatus,
        }),
      });
      setEditProposal(null);
      notify("Proposal updated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Failed");
    }
  };

  const uploadFile = async (file: File, onDone?: (url: string) => void) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/pulse/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Upload failed");
      (onDone ?? setProposalUrl)(data.fileUrl);
      notify("File uploaded");
    } catch (e: any) {
      notify(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const bulkMutation = useMutation({
    mutationFn: (body: { ids: string[]; stage?: string; assignedToId?: string }) =>
      apiFetch<{ updated: number }>("/pulse/leads/bulk", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res) => {
      notify(`${res.updated} lead${res.updated === 1 ? "" : "s"} updated`);
      setSelectedIds([]);
      setBulkStage("");
      setBulkOwner("");
      reload();
    },
    onError: (e: Error) => notify(e.message ?? "Bulk update failed"),
  });

  const applyBulk = () => {
    if (!selectedIds.length || (!bulkStage && !bulkOwner)) return;
    bulkMutation.mutate({
      ids: selectedIds,
      stage: bulkStage || undefined,
      assignedToId: bulkOwner || undefined,
    });
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const deleteLeadFn = async () => {
    if (!deleteLead) return;
    try {
      await apiFetch(`/pulse/leads/${deleteLead.id}`, { method: "DELETE" });
      notify("Lead deleted");
      setDeleteLead(null);
      if (selectedId === deleteLead.id) setSelectedId(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };

  const filteredByStage = (stage: string) => (leads ?? []).filter((l) => l.stage === stage);
  const tableLeads = stageFilter ? (leads ?? []).filter((l) => l.stage === stageFilter) : leads ?? [];

  const activeFilters = [
    source && { key: "source", label: label(source), clear: () => setSource("") },
    vertical && { key: "vertical", label: label(vertical), clear: () => setVertical("") },
    temperature && { key: "temperature", label: label(temperature), clear: () => setTemperature("") },
    categoryId && {
      key: "category",
      label: categories.find((c) => c.id === categoryId)?.name ?? "category",
      clear: () => setCategoryId(""),
    },
    priority && { key: "priority", label: label(priority), clear: () => setPriority("") },
    ownerId && { key: "owner", label: users?.find((u) => u.id === ownerId)?.name ?? "owner", clear: () => setOwnerId("") },
    minScore && { key: "score", label: `score ≥ ${minScore}`, clear: () => setMinScore("") },
    stageFilter && { key: "stage", label: label(stageFilter), clear: () => setStageFilter("") },
    starredOnly && { key: "starred", label: "starred", clear: () => setStarredOnly(false) },
    followUpDue && { key: "due", label: `due by ${followUpDue}`, clear: () => setFollowUpDue("") },
    createdAfter && { key: "created", label: `created after ${createdAfter}`, clear: () => setCreatedAfter("") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearFilters = () => {
    setSource("");
    setVertical("");
    setTemperature("");
    setCategoryId("");
    setPriority("");
    setOwnerId("");
    setMinScore("");
    setStageFilter("");
    setStarredOnly(false);
    setFollowUpDue("");
    setCreatedAfter("");
  };

  const followUpStatus = (l: Lead) => {
    if (!l.nextFollowUpAt || l.stage === "WON" || l.stage === "LOST") return null;
    const diff = new Date(l.nextFollowUpAt).getTime() - Date.now();
    if (diff < 0) return "overdue";
    if (diff < 86400000) return "today";
    return null;
  };

  return (
    <div>
      {flash && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-body-lg font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Pulse — Lead Pipeline"
        subtitle="Who to contact next, what was said, and when you promised to follow up."
        actions={
          <>
            <Btn variant="ghost" onClick={exportCsv}>
              <Download className="size-3.5" /> Export CSV
            </Btn>
            <Btn variant="ghost" onClick={() => importRef.current?.click()}>
              <Upload className="size-3.5" /> {importBusy ? "Importing…" : "Import CSV"}
            </Btn>
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.target.value = "";
              }}
            />
            <Btn variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> Add Lead
            </Btn>
          </>
        }
      />

      <div className="mb-4">
        <Segmented
          value={pulseTab}
          onChange={(v) => setPulseTabWithUrl(v as PulseTab)}
          options={[
            {
              value: "today",
              label:
                (summary?.followUpsDue ?? 0) + (summary?.followUpsToday ?? 0) > 0
                  ? `Today · ${(summary?.followUpsDue ?? 0) + (summary?.followUpsToday ?? 0)}`
                  : "Today",
            },
            { value: "pipeline", label: "Pipeline" },
            { value: "insights", label: "Insights" },
          ]}
        />
      </div>

      {/* ── TODAY: the follow-up cockpit ─────────────────────────────── */}
      {pulseTab === "today" && (
        <motion.div
          key="today"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <FocusBoard
            employees={employees ?? []}
            onOpenLead={(id) => setSelectedId(id)}
            notify={notify}
          />
        </motion.div>
      )}

      <AnimatePresence mode="wait">
      {pulseTab === "insights" && (
        <motion.div key="insights" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard index={0} label="Pipeline Value" value={formatBDT(summary?.pipelineValue)} sub={`weighted ${formatBDT(summary?.weightedForecast)}`} icon={<Zap className="size-4" />} />
          <StatCard index={1} label="Hot Leads" value={summary?.hotLeads ?? "—"} sub={`${summary?.temperatureCounts?.WARM ?? 0} warm · ${summary?.temperatureCounts?.COLD ?? 0} cold`} icon={<Flame className="size-4" />} />
          <StatCard index={2} label="Win Rate" value={summary?.winRate != null ? `${summary.winRate}%` : "—"} sub={`${summary?.won ?? 0} won · ${summary?.lost ?? 0} lost`} icon={<Trophy className="size-4" />} />
          <StatCard index={3} label="Follow-ups Overdue" value={summary?.followUpsDue ?? "—"} sub={`${summary?.followUpsToday ?? 0} due today`} icon={<CalendarClock className="size-4" />} />
          <StatCard index={4} label="Stale / Rotten" value={summary?.staleLeads ?? "-"} sub={`${summary?.slaBreached ?? 0} past first-response SLA`} icon={<AlertTriangle className="size-4" />} />
          <StatCard
            index={5}
            label="Closed Value"
            value={formatBDT(summary?.byStage?.find((s) => s.name.replace(/\s+/g, "_").toUpperCase() === "WON")?.value)}
            sub={summary?.avgResponseHours != null ? `avg response ${summary.avgResponseHours}h` : "—"}
            icon={<Gauge className="size-4" />}
          />
        </div>

        {((summary?.followUpsDue ?? 0) > 0 || (summary?.noNextAction ?? 0) > 0) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <div>
                <p className="text-body-lg font-semibold">
                  {summary?.followUpsDue ?? 0} follow-up{(summary?.followUpsDue ?? 0) === 1 ? "" : "s"} overdue
                  {(summary?.noNextAction ?? 0) > 0 ? ` · ${summary?.noNextAction} active leads with no next step` : ""}
                </p>
                <p className="text-body text-muted-foreground">
                  Clearing these today is the cheapest win in the pipeline — the leads are already warm.
                </p>
              </div>
            </div>
            <Btn variant="primary" className="!py-1.5" onClick={() => setPulseTabWithUrl("today")}>
              Open Today <ArrowRight className="size-3.5" />
            </Btn>
          </div>
        )}

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -2 }} className="group rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-lg hover:shadow-primary/10">
            <SectionTitle title="Pipeline adoption" subtitle="Leads and deal value at every stage" />
            <StageBarChart
              height={250}
              data={(summary?.byStage ?? []).map((s) => ({ stage: label(s.name), count: s.count, value: s.value }))}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -2 }} className="group rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-lg hover:shadow-primary/10">
            <SectionTitle title="Campaign performance" subtitle="Which source brings leads — and converts" />
            <SourceBarChart
              height={250}
              data={(summary?.bySource ?? []).map((s) => ({ name: s.source, count: s.count, won: s.won, conversionRate: s.conversionRate, value: s.value }))}
            />
          </motion.div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, duration: 0.45, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -2 }} className="group rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-lg hover:shadow-primary/10">
            <SectionTitle title="Salesperson performance" subtitle="Leads handled, deals won, conversion per owner" />
            <SourceBarChart
              height={250}
              data={(summary?.byOwner ?? []).map((o) => ({ name: o.ownerName, count: o.count, won: o.won, conversionRate: o.conversionRate, value: o.value }))}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.30, duration: 0.45, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -2 }} className="group rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-lg hover:shadow-primary/10">
            <SectionTitle title="Lead temperature & categories" subtitle="Active leads by intent, then by category" />
            <div className="flex flex-col gap-3">
              {(["HOT", "WARM", "COLD"] as const).map((t) => {
                const n = summary?.temperatureCounts?.[t] ?? 0;
                const total = (summary?.temperatureCounts?.HOT ?? 0) + (summary?.temperatureCounts?.WARM ?? 0) + (summary?.temperatureCounts?.COLD ?? 0);
                const pct = total ? Math.round((n / total) * 100) : 0;
                const tone = t === "HOT" ? "bg-rose-500" : t === "WARM" ? "bg-amber-400" : "bg-sky-400";
                return (
                  <motion.div key={t} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.32 + ["HOT","WARM","COLD"].indexOf(t)*0.07, duration: 0.4, ease: [0.22,1,0.36,1] }} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-body-lg font-bold text-muted-foreground">{label(t)}</span>
                    <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-muted/50">
                      <motion.div className={`absolute inset-y-0 left-0 rounded-lg ${tone}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.4 + ["HOT","WARM","COLD"].indexOf(t)*0.07, duration: 0.65, ease: [0.22,1,0.36,1] }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-body-lg font-bold tabular-nums">{n}</span>
                    <span className="w-10 shrink-0 text-right text-body-lg font-semibold tabular-nums text-muted-foreground">{pct}%</span>
                  </motion.div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(summary?.categoryCounts ?? {}).map(([name, count]) => (
                <span key={name} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-body-lg font-semibold text-muted-foreground">
                  {name} <span className="rounded-full bg-muted px-1.5 text-body font-bold tabular-nums text-foreground">{count}</span>
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>
      )}
      </AnimatePresence>

      {pulseTab === "pipeline" && (
        <motion.div key="pipeline" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="mt-1">
          {/* command bar — search, filters, view */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, company, phone, email or LD number…"
                className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body-lg outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-body-lg font-bold transition-colors",
                  filtersOpen || activeFilters.length
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <SlidersHorizontal className="size-3.5" />
                Filters
                {activeFilters.length > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-meta font-bold text-primary-foreground">
                    {activeFilters.length}
                  </span>
                )}
              </button>

              {filtersOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setFiltersOpen(false)} />
                  <div className="absolute left-0 top-full z-30 mt-2 w-[min(92vw,640px)] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl shadow-black/25">
                    <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                      <p className="flex items-center gap-1.5 text-body font-bold tracking-[0.08em] text-foreground uppercase">
                        <SlidersHorizontal className="size-3.5" /> Filters
                      </p>
                      <div className="flex items-center gap-2">
                        {activeFilters.length > 0 && (
                          <button onClick={clearFilters} className="text-body font-bold text-rose-500 transition-colors hover:text-rose-400">
                            Clear all
                          </button>
                        )}
                        <button
                          onClick={() => setFiltersOpen(false)}
                          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Close"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-4 sm:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Source</span>
                        <Select value={source} onChange={(e) => setSource(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All sources</option>
                          {SOURCES.map((s) => (
                            <option key={s} value={s}>{label(s)}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Vertical</span>
                        <Select value={vertical} onChange={(e) => setVertical(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All verticals</option>
                          {VERTICALS.map((v) => (
                            <option key={v} value={v}>{label(v)}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Temperature</span>
                        <Select value={temperature} onChange={(e) => setTemperature(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All temperatures</option>
                          {TEMPERATURES.map((t) => (
                            <option key={t} value={t}>{label(t)}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Category</span>
                        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All categories</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Priority</span>
                        <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All priorities</option>
                          {PRIORITIES.map((p) => (
                            <option key={p} value={p}>{label(p)}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Owner</span>
                        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All owners</option>
                          {(users ?? []).map((u: UserLite) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Stage</span>
                        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">All stages</option>
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{label(s)}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Score</span>
                        <Select value={minScore} onChange={(e) => setMinScore(e.target.value)} className="!w-full !py-1.5 text-body">
                          <option value="">Any score</option>
                          <option value="70">Hot ≥ 70</option>
                          <option value="50">Warm ≥ 50</option>
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Follow-up due by</span>
                        <input
                          type="date"
                          value={followUpDue}
                          onChange={(e) => setFollowUpDue(e.target.value)}
                          className="h-8 rounded-xl border border-border bg-card px-2 text-body font-medium text-foreground outline-none focus:border-primary/40"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Created after</span>
                        <input
                          type="date"
                          value={createdAfter}
                          onChange={(e) => setCreatedAfter(e.target.value)}
                          className="h-8 rounded-xl border border-border bg-card px-2 text-body font-medium text-foreground outline-none focus:border-primary/40"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          onClick={() => setStarredOnly((s) => !s)}
                          className={cn(
                            "flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border px-2 text-body font-bold transition-colors",
                            starredOnly
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                              : "border-border bg-card text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Star className={cn("size-3.5", starredOnly && "fill-amber-400 text-amber-400")} />
                          Starred only
                        </button>
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => { setFiltersOpen(false); setCatOpen(true); }}
                          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 text-body font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title="Manage categories"
                        >
                          <Tag className="size-3.5" /> Categories
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-4 py-2">
                      <span className="text-meta font-medium text-muted-foreground">
                        {activeFilters.length ? `${activeFilters.length} filter${activeFilters.length === 1 ? "" : "s"} active` : "No filters applied"}
                      </span>
                      <button
                        onClick={() => setFiltersOpen(false)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-body font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "board", label: "Board" },
                  { value: "table", label: "Table" },
                  { value: "grid", label: "Grid" },
                ]}
              />
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-meta font-bold tracking-wide text-muted-foreground uppercase">Active</span>
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={f.clear}
                  className="group flex items-center gap-1 rounded-full border border-primary/25 bg-primary/[0.07] px-2 py-1 text-body font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  {f.label}
                  <X className="size-3.5 opacity-60 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

        {!leads && !leadsErrMsg ? (
          <div className="flex flex-col gap-2">
            {[...Array(4)].map((_, i) => (
              <SkeletonBlock key={i} className="h-14" />
            ))}
          </div>
        ) : leadsErr ? (
          <EmptyState title={leadsErrMsg ?? "Failed to load leads"} />
        ) : view === "board" ? (
          <FadeIn>
            <div className="flex gap-3 overflow-x-auto pb-3">
                {STAGES.map((stage) => {
                  const items = filteredByStage(stage);
                  const value = items.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0);
                  const active = ACTIVE_STAGES.includes(stage);
                  const isDragTarget = dragStage === stage;
                  return (
                    <div
                      key={stage}
                      onDragOver={(e) => {
                        if (!active) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragStage !== stage) setDragStage(stage);
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        setDragStage((s) => (s === stage ? null : s));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = draggingId || e.dataTransfer.getData("text/plain");
                        setDragStage(null);
                        setDraggingId(null);
                        if (!active || !id) return;
                        const lead = (leads ?? []).find((l) => l.id === id);
                        if (lead && lead.stage !== stage) {
                          leadPatch.mutate(
                            { id: lead.id, patch: { stage } },
                            { onSuccess: () => notify(`${lead.name} → ${label(stage)}`) }
                          );
                        }
                      }}
                      className={cn(
                        "flex w-[268px] shrink-0 flex-col rounded-2xl border transition-colors",
                        isDragTarget
                          ? "border-primary/60 bg-primary/[0.05]"
                          : stage === "WON"
                            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                            : stage === "LOST"
                              ? "border-rose-500/20 bg-rose-500/[0.03]"
                              : "border-border/50 bg-muted/20"
                      )}
                    >
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border-b border-border/50 bg-card/95 px-3 py-2 backdrop-blur">
                        <span className="flex items-center gap-1.5 text-body font-bold">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              stage === "WON" ? "bg-emerald-500" : stage === "LOST" ? "bg-rose-500" : "bg-primary/60"
                            )}
                          />
                          {label(stage)}
                        </span>
                        <span className="text-meta font-semibold tabular-nums text-muted-foreground">
                          {items.length}
                          {value > 0 && <> · {formatBDT(value)}</>}
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-2">
                        {items.length === 0 && (
                          <p className="rounded-xl border border-dashed border-border/60 px-2 py-5 text-center text-body text-muted-foreground/70">
                            {active ? "Drop a lead here" : "No leads"}
                          </p>
                        )}
                        {items.map((l, li) => {
                          return (
                            <div
                              key={l.id}
                              draggable
                              onDragStart={(e) => {
                                setDraggingId(l.id);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", l.id);
                              }}
                              onDragEnd={() => {
                                setDraggingId(null);
                                setDragStage(null);
                              }}
                              onClick={() => setSelectedId(l.id)}
                              className={cn(
                                "group cursor-pointer rounded-xl border bg-card p-2.5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md hover:shadow-primary/10",
                                isStale(l) ? "border-amber-500/40" : "border-border/60",
                                draggingId === l.id && "opacity-40"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-body-lg font-bold">{l.name}</p>
                                  <p className="truncate text-meta text-muted-foreground">
                                    {l.company ?? l.contactEmail ?? "—"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <span className={cn("size-1.5 rounded-full", l.priority === "URGENT" ? "bg-rose-500" : l.priority === "HIGH" ? "bg-amber-400" : l.priority === "MEDIUM" ? "bg-sky-400" : "bg-muted-foreground/30")} title={`${l.priority} priority`} />
                                  <button
                                    onClick={(e) => toggleStar(l, e)}
                                    className={cn(
                                      "rounded-lg p-0.5 transition-colors",
                                      l.starred
                                        ? "text-amber-400"
                                        : "text-muted-foreground/40 opacity-0 hover:text-amber-400 group-hover:opacity-100"
                                    )}
                                    title={l.starred ? "Unstar" : "Star"}
                                  >
                                    <Star className={cn("size-3.5", l.starred && "fill-amber-400")} />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <ScoreBar score={l.leadScore} />
                                </div>
                                <span className="shrink-0 text-body font-bold tabular-nums">{formatBDT(l.estimatedDealSize)}</span>
                              </div>

                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className={cn("rounded-full border px-1.5 py-0.5 text-micro font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                                  {l.temperature}
                                </span>
                                {l.leadCategory && (
                                  <span className={cn("flex max-w-28 items-center gap-1 truncate rounded-full border px-1.5 py-0.5 text-micro font-bold", categoryToneOf(l.leadCategory, li))}>
                                    {l.leadCategory.color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: l.leadCategory.color }} />}
                                    <span className="truncate">{l.leadCategory.name}</span>
                                  </span>
                                )}
                                {(l.qualityFlags?.length ?? 0) > 0 && (
                                  <span
                                    title={`Rule flags: ${(l.qualityFlags ?? []).join(", ").replace(/_/g, " ").toLowerCase()}`}
                                    className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-400"
                                  >
                                    <AlertTriangle className="mr-0.5 inline size-3" /> {l.qualityFlags!.length}
                                  </span>
                                )}
                                {l.nextFollowUpAt && !["WON", "LOST"].includes(l.stage) && (
                                  <span
                                    className={cn(
                                      "rounded-full px-1.5 py-0.5 text-micro font-bold",
                                      new Date(l.nextFollowUpAt).getTime() < Date.now()
                                        ? "bg-rose-500/15 text-rose-500"
                                        : "bg-primary/15 text-primary"
                                    )}
                                  >
                                    {dueLabel(l.nextFollowUpAt)}
                                  </span>
                                )}
                                {!l.nextFollowUpAt && l.nextMeeting && (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-micro font-bold text-primary">
                                    meeting {formatDate(l.nextMeeting.scheduledAt)}
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-1.5">
                                <span className="truncate text-meta text-muted-foreground/80">
                                  {l.assignedTo?.name ?? "unassigned"}
                                </span>
                                <div className="flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                                  {l.contactPhone && (
                                    <a
                                      href={`tel:${l.contactPhone.replace(/[^+\d]/g, "")}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                      title="Call"
                                    >
                                      <Phone className="size-3.5" />
                                    </a>
                                  )}
                                  {l.contactPhone && (
                                    <a
                                      href={`https://wa.me/${l.contactPhone.replace(/[^\d]/g, "")}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded-md p-1 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
                                      title="WhatsApp"
                                    >
                                      <MessageCircle className="size-3.5" />
                                    </a>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setQuickLogLead(asWorkItem(l));
                                    }}
                                    className="rounded-md bg-primary/10 px-1.5 py-0.5 text-micro font-bold text-primary transition-colors hover:bg-primary/20"
                                    title="Log a touch"
                                  >
                                    Log
                                  </button>
                                  {active && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        moveStage(l, 1);
                                      }}
                                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                      title="Move forward"
                                    >
                                      <ArrowRight className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
          </FadeIn>
        ) : view === "grid" ? (
          <FadeIn>
            {tableLeads.length === 0 ? (
              <EmptyState title="No leads match" />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {tableLeads.map((l, gi) => {
                  const fu = followUpStatus(l);
                  return (
                    <div
                      key={l.id}
                      onClick={() => setSelectedId(l.id)}
                      className="group cursor-pointer rounded-2xl border border-border/60 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={l.name} />
                          <div className="min-w-0">
                            <p className="truncate text-body-lg font-bold">{l.name}</p>
                            <p className="truncate text-body text-muted-foreground">
                              {l.company ?? l.contactEmail ?? "—"}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => toggleStar(l, e)}
                          className={cn(
                            "rounded-lg p-0.5 transition-colors",
                            l.starred
                              ? "text-amber-400"
                              : "text-muted-foreground/50 opacity-0 hover:text-amber-400 group-hover:opacity-100"
                          )}
                        >
                          <Star className={cn("size-3.5", l.starred && "fill-amber-400")} />
                        </button>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {l.uid && (
                          <span className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-meta font-semibold text-muted-foreground">
                            <Hash className="size-3.5" /> {l.uid}
                          </span>
                        )}
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-meta font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                          {l.temperature}
                        </span>
                        {l.leadCategory && (
                          <span className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-meta font-bold", categoryToneOf(l.leadCategory, gi))}>
                            {l.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: l.leadCategory.color }} />}
                            {l.leadCategory.name}
                          </span>
                        )}
                        <StatusBadge status={l.stage} />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <ScoreBar score={l.leadScore} />
                        <span className="text-body-lg font-bold tabular-nums">{formatBDT(l.estimatedDealSize)}</span>
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-meta font-semibold text-muted-foreground">
                          <span>Win probability</span>
                          <span className="tabular-nums">{l.probability ?? 0}%</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              (l.probability ?? 0) >= 70 ? "bg-emerald-500" : (l.probability ?? 0) >= 40 ? "bg-amber-400" : "bg-sky-400"
                            )}
                            style={{ width: `${l.probability ?? 0}%` }}
                          />
                        </div>
                      </div>
                      {l.tags && l.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {l.tags.slice(0, 4).map((t) => (
                            <span key={t} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-meta font-semibold text-primary">
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between border-t border-border/50 pt-2 text-body text-muted-foreground">
                        <span className="flex items-center gap-1">
                          {fu && (
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-meta font-bold",
                              fu === "overdue" ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
                            )}>
                              {fu === "overdue" ? "overdue" : "today"}
                            </span>
                          )}
                          {l.nextMeeting && <span><CalendarDays className="mr-0.5 inline size-3" /> {formatDate(l.nextMeeting.scheduledAt)}</span>}
                        </span>
                        <span>{l.assignedTo?.name ?? "unassigned"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </FadeIn>
        ) : (
          <FadeIn>
            <TableShell noScroll footer={<span className="text-body-lg text-muted-foreground">{tableLeads.length} leads</span>}>
              <table className="w-full">
                <THead>
                  <Th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible leads"
                      checked={tableLeads.length > 0 && tableLeads.every((l) => selectedIds.includes(l.id))}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? tableLeads.map((l) => l.id) : [])
                      }
                      className="size-3.5 accent-primary"
                    />
                  </Th>
                  <Th>Lead</Th>
                  <Th className="hidden lg:table-cell">Source</Th>
                  <Th className="hidden xl:table-cell">Category</Th>
                  <Th className="hidden md:table-cell">Temperature</Th>
                  <Th className="hidden md:table-cell">Priority</Th>
                  <Th>Score</Th>
                  <Th>Deal</Th>
                  <Th>Next action</Th>
                  <Th>Owner</Th>
                  <Th>Stage</Th>
                </THead>
                <tbody>
                  {tableLeads.map((l, ti) => {
                    const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() < Date.now() && l.stage !== "WON" && l.stage !== "LOST";
                    return (
                    <Tr key={l.id} index={ti} onClick={() => setSelectedId(l.id)} className={cn("cursor-pointer", overdue && "bg-rose-500/[0.03]", selectedIds.includes(l.id) && "bg-primary/[0.04]")}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.name}`}
                          checked={selectedIds.includes(l.id)}
                          onChange={() => toggleSelected(l.id)}
                          className="size-3.5 accent-primary"
                        />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.name} />
                          <div>
                            <p className="font-medium">{l.name}</p>
                            <p className="text-body-lg text-muted-foreground">{l.company ?? l.contactEmail ?? "—"}</p>
                          </div>
                          {l.starred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                          {(l.qualityFlags?.length ?? 0) > 0 && (
                            <span
                              title={`Rule flags: ${(l.qualityFlags ?? []).join(", ").replace(/_/g, " ").toLowerCase()}`}
                              className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-400"
                            >
                              {l.qualityFlags!.length} flag{l.qualityFlags!.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="hidden lg:table-cell text-muted-foreground">{label(l.source)}</Td>
                      <Td className="hidden xl:table-cell">
                        {l.leadCategory ? (
                          <span className={cn("flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-body font-bold", categoryToneOf(l.leadCategory, ti))}>
                            {l.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: l.leadCategory.color }} />}
                            {l.leadCategory.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </Td>
                      <Td className="hidden md:table-cell">
                        <span className={cn("rounded-full border px-2 py-0.5 text-body font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                          {l.temperature}
                        </span>
                      </Td>
                      <Td className="hidden md:table-cell">
                        <span className={cn("rounded-full border px-2 py-0.5 text-body font-bold", priorityTone[l.priority] ?? priorityTone.MEDIUM)}>
                          {l.priority}
                        </span>
                      </Td>
                      <Td><ScoreBar score={l.leadScore} /></Td>
                      <Td className="font-semibold tabular-nums">{formatBDT(l.estimatedDealSize)}</Td>
                      <Td>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold",
                            overdue
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                              : l.nextFollowUpAt
                                ? "bg-muted text-foreground"
                                : "text-amber-600 dark:text-amber-300"
                          )}
                        >
                          {dueLabel(l.nextFollowUpAt)}
                        </span>
                      </Td>
                      <Td className="text-muted-foreground">{l.assignedTo?.name ?? "—"}</Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <Select value={l.stage} onChange={(e) => leadPatch.mutate({ id: l.id, patch: { stage: e.target.value } }, { onSuccess: () => notify(`Moved to ${label(e.target.value)}`) })} className="!w-28 !py-1 text-body-lg">
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{label(s)}</option>
                          ))}
                        </Select>
                      </Td>
                    </Tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </FadeIn>
        )}

        {leads && leadsTotal > leads.length && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <span className="text-body-lg text-muted-foreground">
              Showing {leads.length} of {leadsTotal} leads
            </span>
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="rounded-xl border border-border bg-card px-3.5 py-1.5 text-body-lg font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </motion.div>
      )}

      {/* ── CENTER LEAD PANEL (মিডল কভার) ─────────────────────────────── */}
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={
          detailLoading ? "Loading…" : detail ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Avatar name={detail.name} />
              <div>
                <p className="font-heading text-section font-semibold">{detail.name}</p>
                <p className="text-body text-muted-foreground">
                  {detail.company ?? detail.contactEmail ?? "—"}
                  {detail.lastContactedAt ? ` · last touch ${timeAgo(detail.lastContactedAt)}` : " · never contacted"}
                </p>
              </div>
              <button
                onClick={() => leadPatch.mutate({ id: selectedId as string, patch: { starred: !detail.starred } }, { onSuccess: () => notify(detail.starred ? "Removed from starred" : "Starred") })}
                className={cn(
                  "rounded-lg p-1 transition-colors",
                  detail.starred ? "text-amber-400" : "text-muted-foreground/50 hover:text-amber-400"
                )}
                title={detail.starred ? "Unstar" : "Star"}
              >
                <Star className={cn("size-3.5", detail.starred && "fill-amber-400")} />
              </button>
              {detail.uid && (
                <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-body font-semibold text-muted-foreground">
                  <Hash className="size-3.5" /> {detail.uid}
                </span>
              )}
              <StatusBadge status={detail.stage} />
              <span className={cn("rounded-full border px-2 py-0.5 text-body font-bold", temperatureTone[detail.temperature] ?? temperatureTone.WARM)}>
                {detail.temperature}
              </span>
              {detail.leadCategory && (
                <span className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-body font-bold", categoryToneOf(detail.leadCategory, detail.leadCategory.name.length))}>
                  {detail.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: detail.leadCategory.color }} />}
                  {detail.leadCategory.name}
                </span>
              )}
            </div>
          ) : null
        }
        size="3xl"
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {detail.stage !== "WON" && detail.stage !== "LOST" && (
                  <Btn variant="primary" onClick={() => setQuickLogLead(asWorkItem(detail))}>
                    <Zap className="size-3.5" /> Log touch
                  </Btn>
                )}
                {detail.stage !== "WON" && detail.stage !== "LOST" && (
                  <Btn variant="outline" onClick={() => setConvertLead(detail)}>
                    <Building2 className="size-3.5" /> Convert
                  </Btn>
                )}
                {(detail.stage === "WON" || detail.stage === "LOST") && (
                  <Btn variant="outline" onClick={() => apiFetch(`/pulse/leads/${detail.id}/reopen`, { method: "POST" }).then(() => { notify("Lead reopened"); reload(); })}>
                    <RefreshCw className="size-3.5" /> Reopen
                  </Btn>
                )}
                <Btn variant="ghost" onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }}>
                  <Video className="size-3.5" /> Meeting
                </Btn>
                <Btn variant="ghost" onClick={() => setProposalModal(true)}>
                  <FileText className="size-3.5" /> Proposal
                </Btn>
                {detail.stage !== "WON" && detail.stage !== "LOST" && (
                  <Btn variant="ghost" className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-500" onClick={() => setLostLead(detail)}>
                    <X className="size-3.5" /> Lost
                  </Btn>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Btn variant="ghost" onClick={() => setEditLead(detail)}>
                  <Pencil className="size-3.5" /> Edit
                </Btn>
                <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteLead(detail)} title="Delete lead">
                  <Trash2 className="size-3.5" />
                </Btn>
              </div>
            </div>
          ) : undefined
        }
      >
        {detailLoading ? (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <SkeletonBlock key={i} className="h-12" />
            ))}
          </div>
        ) : !detail ? null : (
          <div className="flex flex-col gap-6">
            {/* converted banner */}
            {detail.client && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <p className="flex items-center gap-2 text-body-lg font-semibold text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Converted — client: {detail.client.companyName}
                </p>
                {detail.projects && detail.projects.length > 0 && (
                  <p className="text-body-lg text-emerald-400/80">
                    project: {detail.projects.map((p) => p.name).join(", ")} ({detail.projects[0].status})
                  </p>
                )}
              </div>
            )}
            {detail.duplicateWarnings && detail.duplicateWarnings.length > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-body-lg font-medium text-amber-400">
                <AlertTriangle className="mr-1 inline size-3.5" /> Duplicate alert — same contact already exists: {detail.duplicateWarnings.map((w) => w.name).join(", ")}
              </div>
            )}

            {/* ── what they need + how to reach them (always visible) ── */}
            <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-primary uppercase">
                  <FileText className="size-3.5" /> What they need
                </p>
                <span className="text-micro font-semibold text-muted-foreground">Saved automatically</span>
              </div>
              <Textarea
                key={detail.id}
                defaultValue={detail.description ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (detail.description ?? "")) patchLead({ description: v || null }, "Description saved");
                }}
                placeholder="Sector, requirement, budget, timeline — a short brief so anyone can pick this lead up…"
                className="mt-2 min-h-16 bg-card text-body-lg"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail.contactPhone ? (
                  <>
                    <a
                      href={`tel:${detail.contactPhone.replace(/[^+\d]/g, "")}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-body font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <Phone className="size-3.5" /> Call
                    </a>
                    <a
                      href={`https://wa.me/${detail.contactPhone.replace(/[^\d]/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-body font-bold text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
                    >
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </a>
                    <span className="font-mono text-body font-semibold text-muted-foreground">{detail.contactPhone}</span>
                  </>
                ) : (
                  <span className="text-body font-medium text-amber-600 dark:text-amber-400">No phone on file</span>
                )}
                {detail.contactEmail && (
                  <a
                    href={`mailto:${detail.contactEmail}`}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-body font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Mail className="size-3.5 shrink-0" /> <span className="truncate">{detail.contactEmail}</span>
                  </a>
                )}
              </div>
            </section>

            {/* ── pipeline — click a stage to move ── */}
            <section className="rounded-2xl border border-border/60 bg-muted/10 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Pipeline — click to move</p>
                {detail.stage !== "LOST" && detail.stageEnteredAt && (
                  <span className="text-body-lg font-semibold text-muted-foreground">
                    in {label(detail.stage)} · {timeAgo(detail.stageEnteredAt)}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex items-center gap-1 overflow-x-auto pb-0.5">
                {PIPELINE.map((s, i) => {
                  const curIdx = (PIPELINE as readonly string[]).indexOf(detail.stage);
                  const isCurrent = detail.stage === s;
                  const isDone = curIdx >= 0 && i < curIdx;
                  const isWon = detail.stage === "WON";
                  return (
                    <div key={s} className="flex items-center gap-1">
                      {i > 0 && (
                        <div className={cn("h-0.5 w-4 shrink-0 rounded-full sm:w-6", isWon || isDone ? "bg-primary/50" : "bg-border")} />
                      )}
                      <button
                        onClick={() => stageChanged(detail, s)}
                        className={cn(
                          "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-body-lg font-bold transition-colors",
                          isCurrent && s === "WON" && "border-emerald-500/40 bg-emerald-500 text-white shadow-sm",
                          isCurrent && s !== "WON" && "border-primary bg-primary text-primary-foreground shadow-sm",
                          !isCurrent && (isDone || isWon) && "border-primary/30 bg-primary/10 text-primary",
                          !isCurrent && !(isDone || isWon) && "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          detail.stage === "LOST" && "border-border/60 bg-card text-muted-foreground/40"
                        )}
                      >
                        {(isDone || isWon) && !isCurrent && <Check className="size-3.5" />}
                        {label(s)}
                      </button>
                    </div>
                  );
                })}
              </div>
              {detail.stage === "WON" || detail.stage === "LOST" ? (
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                  <p className={cn("truncate text-body-lg font-semibold", detail.stage === "WON" ? "text-emerald-400" : "text-rose-400")}>
                    {detail.stage === "WON"
                      ? "Won — deal closed"
                      : `Lost${detail.lostReason ? ` — ${label(detail.lostReason.reasonCategory)}` : ""}`}
                  </p>
                  <button
                    onClick={() => apiFetch(`/pulse/leads/${detail.id}/reopen`, { method: "POST" }).then(() => { notify("Lead reopened"); reload(); })}
                    className="flex shrink-0 items-center gap-1 text-body-lg font-bold text-primary transition-colors hover:underline"
                  >
                    <RefreshCw className="size-3.5" /> Reopen
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-end">
                  <button
                    onClick={() => setLostLead(detail)}
                    className="flex items-center gap-1 text-body-lg font-bold text-rose-400/70 transition-colors hover:text-rose-400"
                  >
                    <X className="size-3.5" /> mark lost
                  </button>
                </div>
              )}
            </section>

            {/* ── KPI strip ── */}
            <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/40 lg:grid-cols-6">
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Deal size</p>
                <p className="mt-0.5 truncate font-heading text-body-lg font-bold tabular-nums">
                  {detail.estimatedDealSize ? `${detail.currency ?? "৳"}${Number(detail.estimatedDealSize).toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Win probability</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${detail.probability ?? 0}%` }} />
                  </div>
                  <span className="text-body-lg font-bold tabular-nums">{detail.probability ?? 0}%</span>
                </div>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Lead score</p>
                <div className="mt-1"><ScoreBar score={detail.leadScore} /></div>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Priority</p>
                <Select
                  value={detail.priority}
                  onChange={(e) => patchLead({ priority: e.target.value }, `Priority → ${e.target.value}`)}
                  className="!w-full !border-0 !bg-transparent !px-0 !py-0.5 text-body-lg font-bold"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{label(p)}</option>
                  ))}
                </Select>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Owner</p>
                <Select
                  value={detail.assignedTo?.id ?? ""}
                  onChange={(e) => patchLead({ assignedToId: e.target.value || null }, e.target.value ? `Assigned to ${users?.find((u) => u.id === e.target.value)?.name ?? ""}` : "Unassigned")}
                  className="!w-full !border-0 !bg-transparent !px-0 !py-0.5 text-body-lg font-bold"
                >
                  <option value="">Unassigned</option>
                  {(users ?? []).map((u: UserLite) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </div>
              <div className="bg-card px-3.5 py-2.5">
                <p className="truncate text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">Next action</p>
                {(() => {
                  if (detail.stage === "WON" || detail.stage === "LOST") return <p className="mt-0.5 text-body-lg font-semibold text-muted-foreground/60">—</p>;
                  const nf = nextScheduled(detail.followUps, "date", "status");
                  const nm = nextScheduled(detail.meetings, "scheduledAt", "status");
                  const items = [
                    nf ? { at: nf.date, kind: "follow-up" } : null,
                    nm ? { at: nm.scheduledAt, kind: "meeting" } : null,
                  ]
                    .filter((x): x is { at: string; kind: string } => !!x)
                    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
                  if (!items.length) return <p className="mt-0.5 text-body-lg font-semibold text-muted-foreground/60">nothing scheduled</p>;
                  const overdue = new Date(items[0].at).getTime() < Date.now();
                  return (
                    <p className={cn("mt-0.5 truncate text-body-lg font-bold", overdue ? "text-rose-400" : "text-foreground")}>
                      {overdue ? "overdue · " : ""}{items[0].kind} · {formatDate(items[0].at)}
                    </p>
                  );
                })()}
              </div>
            </section>


            {/* ── quick actions ── */}
            <div className="flex flex-wrap items-center gap-1.5">
              {detail.stage !== "WON" && detail.stage !== "LOST" && (
                <Btn variant="primary" onClick={() => setQuickLogLead(asWorkItem(detail))}>
                  <MessageCircle className="size-3.5" /> Log conversation
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setProposalModal(true)}>
                <FileText className="size-3.5" /> {detail.proposals?.length ? "New proposal version" : "Send proposal"}
              </Btn>
              <Btn variant="outline" onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }}>
                <Video className="size-3.5" /> Schedule meeting
              </Btn>
              <span className="ml-auto flex items-center gap-1.5 text-meta text-muted-foreground">
                <UserRound className="size-3.5" />
                {detail.assignedTo?.name ?? "Unassigned"}
              </span>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_284px]">
              <div className="min-w-0">
            {/* ── tabs ── */}
            <div className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-border/60 px-1">
              {([
                { id: "overview", name: "Overview", icon: LayoutDashboard },
                { id: "notes", name: "Notes", icon: StickyNote, count: detail.notesList?.length ?? 0 },
                { id: "conversation", name: "Conversation", icon: History, count: detail.activities?.length ?? 0 },
                { id: "files", name: "Files", icon: Paperclip, count: (detail.proposals?.length ?? 0) + (detail.attachments?.length ?? 0) },
                { id: "meetings", name: "Meetings", icon: Video, count: detail.meetings?.length ?? 0 },
                { id: "followups", name: "Follow-ups", icon: CalendarClock, count: detail.followUps?.length ?? 0 },
                { id: "team", name: "Team", icon: Users, count: teamPeople.length || undefined },
                { id: "details", name: "Details", icon: Settings2 },
              ] as { id: DetailTab; name: string; icon: typeof LayoutDashboard; count?: number }[]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDetailTab(t.id)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-body-lg font-semibold transition-colors",
                    detailTab === t.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <t.icon className="size-3.5" />
                  {t.name}
                  {!!t.count && (
                    <span className="rounded-full bg-muted px-1.5 py-px text-micro font-bold tabular-nums text-muted-foreground">{t.count}</span>
                  )}
                  {detailTab === t.id && (
                    <motion.span layoutId="lead-detail-tab" className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            {/* ── tab: overview ── */}
            {detailTab === "overview" && (
              <div className="flex flex-col gap-4">

            {/* up next — what happens next */}
            {detail.stage !== "WON" && detail.stage !== "LOST" && (
              (() => {
                const nf = nextScheduled(detail.followUps, "date", "status");
                const nm = nextScheduled(detail.meetings, "scheduledAt", "status");
                const nfOverdue = nf ? new Date(nf.date).getTime() < Date.now() : false;
                const nmOverdue = nm ? new Date(nm.scheduledAt).getTime() < Date.now() : false;
                return (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* next follow-up */}
                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-body font-bold tracking-wide text-muted-foreground uppercase">
                          <CalendarClock className="size-3.5" /> Next follow-up
                        </p>
                        {nf && (
                          <span className={cn("rounded-full px-2 py-0.5 text-meta font-bold", nfOverdue ? "bg-amber-500/15 text-amber-400" : "bg-primary/15 text-primary")}>
                            {nfOverdue ? "OVERDUE" : "SCHEDULED"}
                          </span>
                        )}
                      </div>
                      {nf ? (
                        <>
                          <p className="mt-1.5 text-body-lg font-bold">{formatDate(nf.date)}</p>
                          {nf.notes && <p className="mt-0.5 text-body-lg text-muted-foreground">{nf.notes}</p>}
                          <div className="mt-2.5 flex items-center gap-1.5">
                            <Btn variant="primary" className="!px-3 !py-1.5 text-body-lg" onClick={() => followUpStatusChange(nf, "COMPLETED")}>
                              <CheckCircle2 className="size-3.5" /> Complete
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-body-lg" onClick={() => followUpStatusChange(nf, "MISSED")}>
                              <X className="size-3.5" /> Missed
                            </Btn>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-body-lg text-muted-foreground">No follow-up scheduled</p>
                          <button
                            onClick={() => setDetailTab("followups")}
                            className="flex items-center gap-1 text-body-lg font-bold text-primary transition-colors hover:text-primary"
                          >
                            <Plus className="size-3.5" /> Schedule
                          </button>
                        </div>
                      )}
                    </div>
                    {/* next meeting */}
                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-body font-bold tracking-wide text-muted-foreground uppercase">
                          <Video className="size-3.5" /> Next meeting
                        </p>
                        {nm && (
                          <span className={cn("rounded-full px-2 py-0.5 text-meta font-bold", nmOverdue ? "bg-amber-500/15 text-amber-400" : "bg-primary/15 text-primary")}>
                            {nmOverdue ? "OVERDUE" : "SCHEDULED"}
                          </span>
                        )}
                      </div>
                      {nm ? (
                        <>
                          <p className="mt-1.5 text-body-lg font-bold">
                            {formatDate(nm.scheduledAt)} · {nm.title}
                          </p>
                          <div className="mt-2.5 flex items-center gap-1.5">
                            <Btn variant="primary" className="!px-3 !py-1.5 text-body-lg" onClick={() => meetingStatus(nm, "COMPLETED")}>
                              <CheckCircle2 className="size-3.5" /> Complete
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-body-lg" onClick={() => meetingStatus(nm, "CANCELLED")}>
                              <X className="size-3.5" /> Cancel
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-body-lg" onClick={() => { setEditingMeeting(nm); setMeetingOpen(true); }}>
                              <RefreshCw className="size-3.5" /> Reschedule
                            </Btn>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-body-lg text-muted-foreground">No meeting scheduled</p>
                          <button
                            onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }}
                            className="flex items-center gap-1 text-body-lg font-bold text-primary transition-colors hover:text-primary"
                          >
                            <Plus className="size-3.5" /> Schedule
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

                <div className="grid gap-3 lg:grid-cols-2">
                  {/* lead health */}
                  <section className="rounded-2xl border border-border/60 p-4">
                    <h4 className="mb-3 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <Gauge className="size-3.5" /> Lead health
                    </h4>
                    <ScoreBar score={detail.leadScore} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-body-lg">
                      <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                        <p className="text-micro font-bold tracking-[0.08em] text-muted-foreground uppercase">Last contact</p>
                        <p className="mt-0.5 font-semibold">{detail.lastContactedAt ? timeAgo(detail.lastContactedAt) : "never"}</p>
                      </div>
                      <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                        <p className="text-micro font-bold tracking-[0.08em] text-muted-foreground uppercase">First response</p>
                        <p className="mt-0.5 font-semibold">{detail.firstResponseAt ? timeAgo(detail.firstResponseAt) : "—"}</p>
                      </div>
                      <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                        <p className="text-micro font-bold tracking-[0.08em] text-muted-foreground uppercase">In stage since</p>
                        <p className="mt-0.5 font-semibold">{detail.stageEnteredAt ? timeAgo(detail.stageEnteredAt) : "—"}</p>
                      </div>
                      <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                        <p className="text-micro font-bold tracking-[0.08em] text-muted-foreground uppercase">Created</p>
                        <p className="mt-0.5 font-semibold">{formatDate(detail.createdAt)}</p>
                      </div>
                    </div>
                    {isStale(detail) && (
                      <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-body-lg font-semibold text-amber-400">
                        <AlertTriangle className="size-3.5" /> Rotten — no touch in 7+ days
                      </p>
                    )}
                    {detail.nextFollowUpAt && detail.stage !== "WON" && detail.stage !== "LOST" && (
                      <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-body-lg font-semibold text-sky-400">
                        <CalendarClock className="size-3.5" />
                        Next follow-up {new Date(detail.nextFollowUpAt).getTime() < Date.now() ? "overdue — " : ""}{formatDate(detail.nextFollowUpAt)}
                      </p>
                    )}
                  </section>

                  {/* recent activity preview */}
                  <section className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                        <History className="size-3.5" /> Recent activity
                      </h4>
                      <button onClick={() => setDetailTab("conversation")} className="text-body-lg font-bold text-primary transition-colors hover:underline">
                        View all →
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(detail.activities ?? []).slice(0, 4).map((a) => {
                        const { Icon, cls } = activityVisual(a.type);
                        return (
                          <div key={a.id} className="flex items-start gap-2.5 rounded-xl bg-muted/30 px-2.5 py-2">
                            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", cls)}>
                              <Icon className="size-3" />
                            </span>
                            <p className="min-w-0 flex-1 truncate text-body" title={a.content}>{a.content}</p>
                            <span className="shrink-0 text-meta text-muted-foreground/60">{timeAgo(a.loggedAt)}</span>
                          </div>
                        );
                      })}
                      {!detail.activities?.length && (
                        <p className="text-body-lg text-muted-foreground">No activity yet — log the first touch.</p>
                      )}
                    </div>
                  </section>
                </div>

                {detail.lostReason && (
                  <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                    <h4 className="mb-1 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-rose-400 uppercase">
                      <AlertTriangle className="size-3.5" /> Lost — {label(detail.lostReason.reasonCategory)}
                    </h4>
                    {detail.lostReason.notes && <p className="text-body-lg text-muted-foreground">{detail.lostReason.notes}</p>}
                  </section>
                )}
              </div>
            )}

            {/* ── tab: notes (reference messages) ── */}
            {detailTab === "notes" && (
              <div className="flex flex-col">
                {/* notes — v0-crm note history */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <StickyNote className="size-3.5" /> Notes ({detail.notesList?.length ?? 0})
                  </h4>
                  <div className="mb-2 flex gap-2">
                    <Textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addNote();
                      }}
                      placeholder="Write a note — each note is kept separately, nothing gets overwritten…"
                    />
                    <Btn variant="primary" onClick={addNote} className={noteBusy ? "opacity-60" : ""}>
                      <Plus className="size-3.5" /> Add note
                    </Btn>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.notesList?.length === 0 && (
                      <p className="text-body-lg text-muted-foreground">No notes yet — capture the first one above.</p>
                    )}
                    {detail.notesList?.map((n, ni) => (
                      <div key={n.id} className="group rounded-xl border border-border/60 px-3 py-2">
                        {editingNoteId === n.id ? (
                          <div className="flex flex-col gap-1.5">
                            <Textarea
                              value={editNoteText}
                              onChange={(e) => setEditNoteText(e.target.value)}
                              autoFocus
                            />
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => setEditingNoteId(null)} className="rounded-lg px-2 py-1 text-body-lg font-bold text-muted-foreground transition-colors hover:bg-muted">
                                Cancel
                              </button>
                              <button onClick={() => saveNoteEdit(n.id)} className="rounded-lg bg-brand-gradient px-2.5 py-1 text-body-lg font-bold text-white">
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer"
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditNoteText(n.content);
                            }}
                            title="Click to edit"
                          >
                            <p className="text-body-lg leading-relaxed whitespace-pre-wrap">{n.content}</p>
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-meta text-muted-foreground/60">
                                {timeAgo(n.createdAt)} · {n.createdBy?.name ?? "system"}
                              </span>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingNoteId(n.id);
                                    setEditNoteText(n.content);
                                  }}
                                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  title="Edit note"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteNote(n);
                                  }}
                                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                                  title="Delete note"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

              </div>
            )}

            {/* ── tab: activity (timeline) ── */}
            {detailTab === "conversation" && (
              <div className="flex flex-col gap-4">
                {detail.stage !== "WON" && detail.stage !== "LOST" ? (
                  <ConversationComposer
                    leadId={detail.id}
                    onSaved={(msg) => {
                      notify(msg);
                      reload();
                    }}
                  />
                ) : (
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3.5 py-3 text-body-lg text-muted-foreground">
                    This lead is {detail.stage === "WON" ? "won" : "closed"}. Reopen it to log more conversations.
                  </div>
                )}

                <section>
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <History className="size-3.5" /> Conversation history
                      <span className="rounded-full bg-muted px-1.5 py-px text-micro font-bold tabular-nums text-muted-foreground">
                        {detail.activities?.length ?? 0}
                      </span>
                    </h4>
                    <span className="text-meta text-muted-foreground">calls · messages · notes · status changes</span>
                  </div>

                  {detail.activities?.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                      <p className="text-body-lg font-semibold">No conversations yet</p>
                      <p className="mt-0.5 text-body text-muted-foreground">
                        Log the first call above — it becomes the lead's memory.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col">
                    {detail.activities?.map((a, i) => {
                      const { Icon, cls } = activityVisual(a.type);
                      const day = dayLabel(a.loggedAt);
                      const prevDay = i > 0 ? dayLabel(detail.activities![i - 1].loggedAt) : null;
                      const last = i === (detail.activities?.length ?? 0) - 1;
                      return (
                        <div key={a.id}>
                          {day !== prevDay && (
                            <p className="mb-1.5 mt-2 text-micro font-bold tracking-[0.08em] text-muted-foreground uppercase">
                              {day}
                            </p>
                          )}
                          <div className="flex gap-2.5">
                            <div className="flex flex-col items-center">
                              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", cls)}>
                                <Icon className="size-3.5" />
                              </span>
                              {!last && <span className="mt-1 w-px flex-1 bg-border/60" />}
                            </div>
                            <div className="mb-2 min-w-0 flex-1 rounded-xl border border-border/60 bg-card px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-micro font-bold tracking-wide text-muted-foreground uppercase">
                                  {a.type.replace(/_/g, " ")}
                                </span>
                                <span className="shrink-0 text-meta text-muted-foreground/70">
                                  {timeAgo(a.loggedAt)} · {a.loggedBy?.name ?? "system"}
                                </span>
                              </div>
                              <p className="mt-0.5 text-body-lg leading-relaxed whitespace-pre-wrap">{a.content}</p>
                              {a.changes && Object.keys(a.changes).length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {Object.entries(a.changes).map(([field, ch]) => (
                                    <span key={field} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground">
                                      <span className="font-bold uppercase">{label(field)}</span>{" "}
                                      <span className="text-rose-400 line-through">{ch.old == null ? "—" : String(ch.old)}</span>
                                      {" → "}
                                      <span className="font-semibold text-emerald-500">{ch.new == null ? "—" : String(ch.new)}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}

            {/* ── tab: files (attachments + proposals) ── */}
            {detailTab === "files" && (
              <div className="flex flex-col gap-5">
                {/* attachments — reference files */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <Paperclip className="size-3.5" /> Attachments ({detail.attachments?.length ?? 0})
                  </h4>
                  <input
                    ref={attRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) uploadAttachment(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => attRef.current?.click()}
                    disabled={attBusy}
                    onDragOver={(e) => { e.preventDefault(); setAttDrag(true); }}
                    onDragLeave={() => setAttDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setAttDrag(false);
                      if (e.dataTransfer.files?.length) uploadAttachment(e.dataTransfer.files);
                    }}
                    className={cn(
                      "flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-body-lg font-semibold transition-colors disabled:opacity-60",
                      attDrag ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    <Upload className="size-3.5" />
                    {attBusy ? "Uploading…" : "Drop reference files or click to browse — PDF, images, docs (max 15MB)"}
                  </button>
                  {!!detail.attachments?.length && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {detail.attachments.map((a) => (
                        <div key={a.id} className="group flex items-center gap-2.5 rounded-xl border border-border/60 p-2">
                          {a.mimeType?.startsWith("image/") ? (
                            <img src={absoluteUrl(a.fileUrl)} alt={a.filename} className="size-10 shrink-0 rounded-lg border border-border/60 object-cover" />
                          ) : (
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
                              <FileText className="size-4 text-muted-foreground" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body-lg font-semibold" title={a.filename}>{a.title || a.filename}</p>
                            <p className="truncate text-body text-muted-foreground">
                              {fmtSize(a.sizeBytes)} · {timeAgo(a.createdAt)} · {a.uploadedBy?.name ?? "system"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <a
                              href={absoluteUrl(a.fileUrl)}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              title="Open / download"
                            >
                              <Download className="size-3.5" />
                            </a>
                            <button
                              onClick={() => deleteAttachment(a.id)}
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"
                              title="Delete attachment"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* proposals */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <FileText className="size-3.5" /> Proposals ({detail.proposals?.length ?? 0})
                    </h4>
                    <button onClick={() => setProposalModal(true)} className="flex items-center gap-1 text-body-lg font-bold text-primary transition-colors hover:text-primary">
                      <Plus className="size-3.5" /> New version
                    </button>
                  </div>
                  {(() => {
                    const list = detail.proposals ?? [];
                    const current = list.find((p) => p.status === "SENT") ?? list[0] ?? null;
                    const target = current ? proposalTarget(current) : null;
                    return (
                      <>
                        {current && target && (
                          <div className="mb-2 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3">
                            <p className="flex items-center gap-1 text-meta font-bold tracking-wide text-primary uppercase">
                              <Link2 className="size-3.5" /> Current proposal · v{current.versionNumber}
                              {current.sentDate && <span className="ml-1 font-medium normal-case">sent {formatDate(current.sentDate)}</span>}
                              {current.viewed && <span className="ml-auto flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-meta font-bold text-emerald-400 normal-case"><Check className="size-3.5" /> Seen</span>}
                            </p>
                            <p className="mt-1 truncate text-body-lg text-muted-foreground">{target}</p>
                            <div className="mt-2 flex items-center gap-1.5">
                              <button onClick={() => openProposal(current)} className="flex items-center gap-1 rounded-lg bg-brand-gradient px-3 py-1.5 text-body-lg font-bold text-white transition-transform hover:scale-[1.02]">
                                <ExternalLink className="size-3.5" /> View proposal
                              </button>
                              <button onClick={() => copyProposalLink(current)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-body-lg font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                {copiedField === `proposal-${current.id}` ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                                {copiedField === `proposal-${current.id}` ? "Copied" : "Copy link"}
                              </button>
                              <button onClick={() => openEditProposal(current)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-body-lg font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                <Pencil className="size-3.5" /> Edit
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5">
                          {list.length === 0 && (
                            <p className="text-body-lg text-muted-foreground">No proposals yet — add the first version above.</p>
                          )}
                          {list.map((p) => {
                            const t = proposalTarget(p);
                            return (
                              <div key={p.id} className="rounded-xl border border-border/60 px-3 py-2">
                                <div className="flex items-center gap-2.5">
                                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-1.5 text-body-lg font-semibold">
                                      v{p.versionNumber}
                                      {p.sentDate && <span className="text-body font-medium text-muted-foreground">sent {formatDate(p.sentDate)}</span>}
                                      {p.viewed && <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-px text-meta font-bold text-emerald-400"><Check className="size-3.5" /> Seen</span>}
                                    </p>
                                    <p className="truncate text-body text-muted-foreground">
                                      {t ?? "no link or file yet"}
                                    </p>
                                  </div>
                                  <Select
                                    value={p.status}
                                    onChange={(e) => proposalStatus(p, e.target.value)}
                                    className={cn("!w-28 shrink-0 !py-1.5 text-body-lg", p.status === "ACCEPTED" && "!border-emerald-500/40 !text-emerald-400", p.status === "REJECTED" && "!border-rose-500/40 !text-rose-400")}
                                  >
                                    {["DRAFT", "SENT", "ACCEPTED", "REJECTED"].map((s) => (
                                      <option key={s} value={s}>{label(s)}</option>
                                    ))}
                                  </Select>
                                </div>
                                <div className="mt-1.5 flex items-center gap-1.5 pl-[26px]">
                                  <button onClick={() => openProposal(p)} disabled={!t} className="flex items-center gap-1 rounded-lg px-2 py-1 text-body font-bold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40">
                                    <ExternalLink className="size-3.5" /> View
                                  </button>
                                  <button onClick={() => copyProposalLink(p)} disabled={!t} className="flex items-center gap-1 rounded-lg px-2 py-1 text-body font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                                    {copiedField === `proposal-${p.id}` ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                                    {copiedField === `proposal-${p.id}` ? "Copied" : "Copy"}
                                  </button>
                                  <button onClick={() => openEditProposal(p)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-body font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                    <Pencil className="size-3.5" /> Edit link
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </section>
              </div>
            )}

            {/* ── tab: meetings ── */}
            {detailTab === "meetings" && (
              <div className="flex flex-col">
                {/* meetings */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <Video className="size-3.5" /> Meetings ({detail.meetings?.length ?? 0})
                    </h4>
                    <button onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }} className="flex items-center gap-1 text-body-lg font-bold text-primary transition-colors hover:text-primary">
                      <Plus className="size-3.5" /> Schedule
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.meetings?.length === 0 && (
                      <p className="text-body-lg text-muted-foreground">No meetings scheduled.</p>
                    )}
                    {detail.meetings?.map((m) => {
                      const past = new Date(m.scheduledAt).getTime() < Date.now();
                      const when = new Date(m.scheduledAt);
                      const time = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                      const links = m.attendeeLinks ?? [];
                      return (
                        <div key={m.id} className="rounded-2xl border border-border/60 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    m.status === "COMPLETED" ? "bg-emerald-500"
                                      : m.status === "CANCELLED" ? "bg-muted-foreground/40"
                                        : m.status === "NO_SHOW" ? "bg-rose-500"
                                          : past ? "bg-amber-400" : "bg-primary"
                                  )}
                                />
                                <p className="text-body-lg font-semibold">{m.title}</p>
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-micro font-bold",
                                    m.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-500"
                                      : m.status === "CANCELLED" ? "bg-muted text-muted-foreground"
                                        : m.status === "NO_SHOW" ? "bg-rose-500/15 text-rose-500"
                                          : "bg-primary/15 text-primary"
                                  )}
                                >
                                  {m.status.replace(/_/g, " ").toLowerCase()}
                                </span>
                              </div>
                              <p className="mt-0.5 text-meta text-muted-foreground">
                                {formatDate(m.scheduledAt)} · {time} · {m.durationMins} min ·{" "}
                                {m.type === "VIDEO_CALL" || m.type === "CALL" ? "Online" : "In person"}
                                {m.location ? ` · ${m.location}` : ""}
                              </p>
                              {m.meetingLink && (
                                <a href={m.meetingLink} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-meta font-semibold text-primary hover:underline">
                                  <ExternalLink className="size-3.5" /> Join link
                                </a>
                              )}
                              {m.notes && <p className="mt-1 text-meta text-muted-foreground">{m.notes}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {m.status === "SCHEDULED" && (
                                <>
                                  <button onClick={() => { setEditingMeeting(m); setMeetingOpen(true); }} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Edit / reschedule">
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button onClick={() => meetingStatus(m, "COMPLETED")} className="rounded-lg p-1 text-emerald-500 transition-colors hover:bg-emerald-500/10" title="Complete">
                                    <CheckCircle2 className="size-3.5" />
                                  </button>
                                  <button onClick={() => meetingStatus(m, "NO_SHOW")} className="rounded-lg p-1 text-rose-500 transition-colors hover:bg-rose-500/10" title="No-show">
                                    <UserRound className="size-3.5" />
                                  </button>
                                  <button onClick={() => meetingStatus(m, "CANCELLED")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted" title="Cancel">
                                    <X className="size-3.5" />
                                  </button>
                                  <button onClick={() => deleteMeeting(m)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {links.length > 0 ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
                              <span className="mr-0.5 flex items-center gap-1 text-micro font-bold tracking-wide text-muted-foreground uppercase">
                                <Users className="size-3.5" /> Attendees
                              </span>
                              {links.map((a) => (
                                <button
                                  key={a.id}
                                  onClick={() => cycleAttendeeStatus(m.id, a.employeeId, a.status)}
                                  title="Click to cycle: invited → attended → no-show"
                                  className={cn(
                                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold transition-colors",
                                    a.status === "ATTENDED"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                                      : a.status === "NO_SHOW"
                                        ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  <Avatar name={a.employee?.name ?? "?"} size="size-4" />
                                  {a.employee?.name ?? "Teammate"}
                                  <span className="opacity-70">· {a.status.replace(/_/g, " ").toLowerCase()}</span>
                                </button>
                              ))}
                            </div>
                          ) : m.attendees && m.attendees.length > 0 ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
                              <span className="mr-0.5 flex items-center gap-1 text-micro font-bold tracking-wide text-muted-foreground uppercase">
                                <Users className="size-3.5" /> Attendees
                              </span>
                              {m.attendees.map((at) => (
                                <span key={at.id} className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro font-semibold">
                                  <Avatar name={at.name} size="size-4" /> {at.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

              </div>
            )}

            {/* ── tab: follow-ups ── */}
            {detailTab === "followups" && (
              <div className="flex flex-col">
                {/* follow-ups (v0-crm subsystem) */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <CalendarClock className="size-3.5" /> Follow-ups ({detail.followUps?.length ?? 0})
                  </h4>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {[
                      { label: "Tomorrow", days: 1 },
                      { label: "In 3 days", days: 3 },
                      { label: "Next week", days: 7 },
                    ].map((o) => {
                      const d = new Date();
                      d.setDate(d.getDate() + o.days);
                      d.setHours(10, 0, 0, 0);
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                      return (
                        <button
                          key={o.days}
                          type="button"
                          onClick={() => setFollowUpDate(value)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-body font-bold transition-colors",
                            followUpDate === value
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                    <span className="self-center text-meta text-muted-foreground">or pick a date →</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Input
                      type="datetime-local"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="!w-48"
                    />
                    <Input
                      value={followUpNotes}
                      onChange={(e) => setFollowUpNotes(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addFollowUp(followUpDate, followUpNotes, followUpAssignee, followUpTaskTitle)}
                      placeholder="Follow-up note…"
                      className="min-w-40 flex-1"
                    />
                    <Btn variant="primary" onClick={() => addFollowUp(followUpDate, followUpNotes, followUpAssignee, followUpTaskTitle)}>
                      <Plus className="size-3.5" /> Schedule
                    </Btn>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-2 py-1.5">
                    <Zap className="size-3.5 text-primary" />
                    <span className="text-body font-bold tracking-wide text-primary uppercase">Action → task</span>
                    <Select value={followUpAssignee} onChange={(e) => setFollowUpAssignee(e.target.value)} className="!w-40">
                      <option value="">No task</option>
                      {(employees ?? []).map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </Select>
                    <Input
                      value={followUpTaskTitle}
                      onChange={(e) => setFollowUpTaskTitle(e.target.value)}
                      placeholder="Task title (auto)"
                      className="!w-52 !py-1.5"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.followUps?.length === 0 && (
                      <p className="text-body-lg text-muted-foreground">No follow-ups scheduled.</p>
                    )}
                    {detail.followUps?.map((fu) => {
                      const overdue = followUpStatusFn(fu);
                      return (
                        <div key={fu.id} className="flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                          <span className={cn(
                            "mt-0.5 size-2 shrink-0 rounded-full",
                            fu.status === "COMPLETED" ? "bg-emerald-500"
                              : fu.status === "MISSED" ? "bg-rose-500"
                                : overdue ? "bg-amber-400" : "bg-primary"
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className="text-body-lg font-semibold">
                              {formatDate(fu.date)}
                              {overdue && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-meta font-bold text-amber-400">overdue</span>}
                            </p>
                            {fu.notes && <p className="text-body-lg text-muted-foreground">{fu.notes}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-meta font-bold",
                              fu.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-400"
                                : fu.status === "MISSED" ? "bg-rose-500/15 text-rose-400"
                                  : "bg-primary/15 text-primary"
                            )}>
                              {fu.status}
                            </span>
                            {fu.status === "SCHEDULED" && (
                              <>
                                <button onClick={() => followUpStatusChange(fu, "COMPLETED")} className="rounded-lg p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10" title="Mark completed">
                                  <CheckCircle2 className="size-3.5" />
                                </button>
                                <button onClick={() => followUpStatusChange(fu, "MISSED")} className="rounded-lg p-1 text-rose-400 transition-colors hover:bg-rose-500/10" title="Mark missed">
                                  <X className="size-3.5" />
                                </button>
                              </>
                            )}
                            {fu.status !== "SCHEDULED" && (
                              <button onClick={() => followUpStatusChange(fu, "SCHEDULED")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted" title="Reopen">
                                <RefreshCw className="size-3.5" />
                              </button>
                            )}
                            <button onClick={() => deleteFollowUp(fu)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Delete">
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

              </div>
            )}

            {/* ── tab: team & capabilities ── */}
            {detailTab === "team" && (
              <div className="flex flex-col gap-4">
                <section className="rounded-2xl border border-border/60 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <UserRound className="size-3.5" /> Lead owner
                    </h4>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold text-primary">
                      owns the follow-up
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Avatar name={detail.assignedTo?.name ?? "Unassigned"} size="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-lg font-semibold">{detail.assignedTo?.name ?? "No owner yet"}</p>
                      <p className="text-body text-muted-foreground">
                        Gets the follow-up digest and every meeting notification for this lead.
                      </p>
                    </div>
                    <Select
                      value={detail.assignedTo?.id ?? ""}
                      onChange={(e) => patchLead({ assignedToId: e.target.value || null }, e.target.value ? `Assigned to ${users?.find((u) => u.id === e.target.value)?.name ?? ""}` : "Unassigned")}
                      className="!w-52"
                    >
                      <option value="">Assign an owner…</option>
                      {(users ?? []).map((u: UserLite) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </Select>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <Users className="size-3.5" /> People on this lead ({teamPeople.length})
                    </h4>
                    <Btn variant="outline" className="!py-1.5 text-body" onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }}>
                      <Plus className="size-3.5" /> Add people
                    </Btn>
                  </div>
                  <p className="mt-1 text-body text-muted-foreground">
                    The owner can invite anyone on the roster to a meeting — no login required.
                  </p>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {teamPeople.length === 0 && (
                      <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-body text-muted-foreground">
                        Nobody else is on this lead yet. Schedule a meeting to bring in a colleague.
                      </p>
                    )}
                    {teamPeople.map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <Avatar name={p.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-lg font-semibold">{p.name}</p>
                          <p className="text-meta text-muted-foreground">
                            {p.meetings} meeting{p.meetings === 1 ? "" : "s"} · {p.attended} attended
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
                          teammate
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {detail.projects && detail.projects.length > 0 && (
                  <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-emerald-600 uppercase dark:text-emerald-400">
                      <Building2 className="size-3.5" /> Project delivery team
                    </h4>
                    {detail.projects.map((p) => (
                      <div key={p.id} className="mt-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-body-lg font-semibold">{p.name}</p>
                          <StatusBadge status={p.status} />
                        </div>
                        <p className="mt-0.5 text-meta text-muted-foreground">
                          PM: {p.assignedPm?.name ?? "not assigned"}
                        </p>
                        {p.team && p.team.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {p.team.map((n) => (
                              <span key={n} className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-micro font-semibold">
                                <Avatar name={n} size="size-4" /> {n}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-meta text-muted-foreground">No project members assigned in Flow.</p>
                        )}
                      </div>
                    ))}
                  </section>
                )}

                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <Zap className="size-3.5" /> Who can do what
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      {
                        title: "Owner",
                        tone: "border-primary/25 bg-primary/[0.04]",
                        items: ["Log calls, messages and notes", "Move the stage and update fields", "Send proposals and schedule meetings", "Invite anyone from the roster"],
                      },
                      {
                        title: "Teammate (attendee)",
                        tone: "border-border/60",
                        items: ["Added to meetings with an invite", "Marked attended / no-show", "Can be assigned the meeting task", "No access to the lead owner's queue"],
                      },
                      {
                        title: "Project member",
                        tone: "border-border/60",
                        items: ["Works the converted project in Flow", "Owns tasks, time and deliverables", "Does not change the lead pipeline", "Visible here for context"],
                      },
                    ].map((c) => (
                      <div key={c.title} className={cn("rounded-2xl border p-3", c.tone)}>
                        <p className="text-body font-bold">{c.title}</p>
                        <ul className="mt-1.5 flex flex-col gap-1">
                          {c.items.map((i) => (
                            <li key={i} className="flex items-start gap-1.5 text-meta text-muted-foreground">
                              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                              {i}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}


            {detailTab === "details" && (
              <div className="flex flex-col">
                <section>
                  <h4 className="mb-1 flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <Settings2 className="size-3.5" /> Edit lead
                  </h4>
                  <p className="mb-3 text-meta text-muted-foreground">
                    Changes save automatically when you leave a field. Stage and priority are also editable from the strip above.
                  </p>
                  <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
                    <EditField label="Email">
                      <Input
                        defaultValue={detail.contactEmail ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.contactEmail ?? "")) patchLead({ contactEmail: v || null }, "Email updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Phone">
                      <Input
                        defaultValue={detail.contactPhone ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.contactPhone ?? "")) patchLead({ contactPhone: v || null }, "Phone updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Website">
                      <Input
                        defaultValue={detail.website ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.website ?? "")) patchLead({ website: v || null }, "Website updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Social / page link">
                      <Input
                        defaultValue={detail.pageLink ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.pageLink ?? "")) patchLead({ pageLink: v || null }, "Page link updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Source">
                      <Select value={detail.source} onChange={(e) => patchLead({ source: e.target.value }, `Source → ${label(e.target.value)}`)}>
                        {SOURCES.map((s) => (
                          <option key={s} value={s}>{label(s)}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Vertical">
                      <Select value={detail.vertical} onChange={(e) => patchLead({ vertical: e.target.value })}>
                        {VERTICALS.map((v) => (
                          <option key={v} value={v}>{label(v)}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Temperature">
                      <Select value={detail.temperature} onChange={(e) => patchLead({ temperature: e.target.value }, `Temperature → ${label(e.target.value)}`)}>
                        {TEMPERATURES.map((t) => (
                          <option key={t} value={t}>{label(t)}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Category">
                      <div className="flex gap-2">
                        <Select
                          value={detail.leadCategoryId ?? ""}
                          onChange={(e) => patchLead({ categoryId: e.target.value || null }, e.target.value ? `Category → ${categories.find((c) => c.id === e.target.value)?.name ?? ""}` : "Category cleared")}
                          className="flex-1"
                        >
                          <option value="">None</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                        <button
                          onClick={() => setCatOpen(true)}
                          className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-2.5 text-body-lg font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title="Manage categories"
                        >
                          <Tag className="size-3.5" /> New
                        </button>
                      </div>
                    </EditField>
                    <EditField label="Deal size">
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          defaultValue={detail.estimatedDealSize ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== String(detail.estimatedDealSize ?? "")) patchLead({ estimatedDealSize: v ? Number(v) : null }, "Deal size updated");
                          }}
                        />
                        <Select
                          defaultValue={detail.currency ?? "BDT"}
                          onChange={(e) => patchLead({ currency: e.target.value })}
                          className="!w-24"
                        >
                          <option value="BDT">BDT</option>
                          <option value="USD">USD</option>
                          <option value="SAR">SAR</option>
                          <option value="AED">AED</option>
                        </Select>
                      </div>
                    </EditField>
                    <EditField label="Win probability">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={detail.probability ?? 50}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v >= 0 && v <= 100 && v !== Number(detail.probability ?? 50)) {
                            patchLead({ probability: v }, `Probability → ${v}%`);
                          }
                        }}
                      />
                    </EditField>
                    <EditField label="Tags">
                      <Input
                        defaultValue={(detail.tags ?? []).join(", ")}
                        onBlur={(e) => {
                          const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
                          if (JSON.stringify(tags) !== JSON.stringify(detail.tags ?? [])) {
                            patchLead({ tags }, "Tags updated");
                          }
                        }}
                      />
                    </EditField>
                    <EditField label="Next follow-up">
                      <Input
                        type="datetime-local"
                        value={localInput(detail.nextFollowUpAt)}
                        onChange={(e) => patchLead({ nextFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null }, "Follow-up updated")}
                      />
                    </EditField>
                  </div>
                </section>
              </div>
            )}

              </div>

              {/* ── context rail ── */}
              <aside className="order-first flex flex-col gap-3 lg:order-none lg:sticky lg:top-0">
                {/* team */}
                <div className="rounded-2xl border border-border/60 bg-card p-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <UserRound className="size-3.5" /> Team
                    </h4>
                    <button
                      onClick={() => { setEditingMeeting(null); setMeetingOpen(true); }}
                      className="text-meta font-bold text-primary hover:underline"
                    >
                      + Invite
                    </button>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Avatar name={detail.assignedTo?.name ?? "Unassigned"} size="size-9" />
                    <div className="min-w-0">
                      <p className="truncate text-body-lg font-semibold">{detail.assignedTo?.name ?? "Unassigned"}</p>
                      <p className="text-meta text-muted-foreground">Owner · owns the follow-up</p>
                    </div>
                  </div>
                  <Select
                    value={detail.assignedTo?.id ?? ""}
                    onChange={(e) => patchLead({ assignedToId: e.target.value || null }, e.target.value ? `Assigned to ${users?.find((u) => u.id === e.target.value)?.name ?? ""}` : "Unassigned")}
                    className="mt-2 !w-full !py-1.5 text-body"
                  >
                    <option value="">Assign an owner…</option>
                    {(users ?? []).map((u: UserLite) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>

                  {teamPeople.length > 0 && (
                    <div className="mt-3">
                      <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">
                        In this lead's meetings ({teamPeople.length})
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {teamPeople.slice(0, 6).map((p) => (
                          <span key={p.id} className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-1.5 py-0.5 text-micro font-semibold" title={`${p.meetings} meeting(s) · ${p.attended} attended`}>
                            <Avatar name={p.name} size="size-4" />
                            {p.name}
                          </span>
                        ))}
                        {teamPeople.length > 6 && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold text-muted-foreground">
                            +{teamPeople.length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {detail.projects && detail.projects.length > 0 && (
                    <div className="mt-3 rounded-xl bg-muted/40 px-2.5 py-2">
                      <p className="text-micro font-bold tracking-wide text-muted-foreground uppercase">Project</p>
                      <p className="mt-0.5 truncate text-body font-semibold">{detail.projects[0].name}</p>
                      <p className="text-meta text-muted-foreground">
                        {detail.projects[0].assignedPm?.name ? `PM: ${detail.projects[0].assignedPm.name}` : "No PM assigned"}
                        {detail.projects[0].team?.length ? ` · ${detail.projects[0].team.length} members` : ""}
                      </p>
                    </div>
                  )}

                  <p className="mt-2.5 text-micro leading-relaxed text-muted-foreground">
                    Owner can log conversations, move the stage, send proposals and invite anyone
                    on the roster to meetings.
                  </p>
                </div>

                {/* proposal */}
                <div className="rounded-2xl border border-border/60 bg-card p-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                      <FileText className="size-3.5" /> Proposal
                    </h4>
                    {detail.proposals?.length ? (
                      <button onClick={() => setProposalModal(true)} className="text-meta font-bold text-primary hover:underline">
                        + New
                      </button>
                    ) : null}
                  </div>
                  {currentProposal ? (
                    <>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-body-lg font-bold">v{currentProposal.versionNumber}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-micro font-bold",
                            currentProposal.status === "ACCEPTED"
                              ? "bg-emerald-500/15 text-emerald-500"
                              : currentProposal.status === "REJECTED"
                                ? "bg-rose-500/15 text-rose-500"
                                : currentProposal.status === "SENT"
                                  ? "bg-sky-500/15 text-sky-500"
                                  : "bg-muted text-muted-foreground"
                          )}
                        >
                          {currentProposal.status}
                        </span>
                        {currentProposal.viewed && (
                          <span className="ml-auto text-micro font-bold text-emerald-500">Seen</span>
                        )}
                      </div>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {currentProposal.sentDate ? `Sent ${formatDate(currentProposal.sentDate)}` : "Not sent yet"}
                      </p>
                      <Select
                        value={currentProposal.status}
                        onChange={(e) => proposalStatus(currentProposal, e.target.value)}
                        className="mt-2 !w-full !py-1.5 text-meta"
                        title="Proposal status"
                      >
                        {["DRAFT", "SENT", "ACCEPTED", "REJECTED"].map((s) => (
                          <option key={s} value={s}>{label(s)}</option>
                        ))}
                      </Select>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => openProposal(currentProposal)}
                          disabled={!proposalTarget(currentProposal)}
                          className="flex items-center gap-1 rounded-lg bg-brand-gradient px-2.5 py-1 text-meta font-bold text-white disabled:opacity-40"
                        >
                          <ExternalLink className="size-3.5" /> View
                        </button>
                        <button
                          onClick={() => copyProposalLink(currentProposal)}
                          disabled={!proposalTarget(currentProposal)}
                          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-meta font-bold text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          {copiedField === `proposal-${currentProposal.id}` ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                          {copiedField === `proposal-${currentProposal.id}` ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-body text-muted-foreground">
                        No proposal sent yet. Most leads get version 1 after qualification.
                      </p>
                      <Btn variant="outline" className="mt-2 !w-full !py-1.5 text-body" onClick={() => setProposalModal(true)}>
                        <Plus className="size-3.5" /> Send version 1
                      </Btn>
                    </>
                  )}
                </div>

                {/* contact */}
                <div className="rounded-2xl border border-border/60 bg-card p-3.5">
                  <h4 className="flex items-center gap-1.5 text-meta font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    <Phone className="size-3.5" /> Contact
                  </h4>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.contactEmail && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5">
                        <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                        <a href={`mailto:${detail.contactEmail}`} className="min-w-0 flex-1 truncate text-body font-medium hover:text-primary">
                          {detail.contactEmail}
                        </a>
                        <button onClick={() => copyContact(detail.contactEmail!, "email")} title="Copy email" className="text-muted-foreground hover:text-foreground">
                          {copiedField === "email" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        </button>
                      </div>
                    )}
                    {detail.contactPhone && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5">
                        <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                        <a href={`tel:${detail.contactPhone.replace(/[^+\d]/g, "")}`} className="min-w-0 flex-1 truncate text-body font-medium hover:text-primary">
                          {detail.contactPhone}
                        </a>
                        <a
                          href={`https://wa.me/${detail.contactPhone.replace(/[^\d]/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-500 hover:text-emerald-400"
                          title="WhatsApp"
                        >
                          <MessageCircle className="size-3.5" />
                        </a>
                        <button onClick={() => copyContact(detail.contactPhone!, "phone")} title="Copy phone" className="text-muted-foreground hover:text-foreground">
                          {copiedField === "phone" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        </button>
                      </div>
                    )}
                    {(detail.website || detail.pageLink) && (
                      <a
                        href={detail.website || detail.pageLink!}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5 text-body font-medium hover:text-primary"
                      >
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{(detail.website || detail.pageLink || "").replace(/^https?:\/\//, "")}</span>
                      </a>
                    )}
                    {!detail.contactEmail && !detail.contactPhone && !detail.website && !detail.pageLink && (
                      <p className="text-body text-muted-foreground">No contact details yet — add them in Details.</p>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* footer actions moved to the sticky modal footer */}
          </div>
        )}
      </Modal>

      <QuickLogModal
        lead={quickLogLead}
        open={!!quickLogLead}
        onClose={() => setQuickLogLead(null)}
        employees={employees ?? []}
        onSaved={(msg) => {
          notify(msg);
          reload();
          qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] });
        }}
      />

      {/* ── modals ─────────────────────────────────────────────────────── */}
      <LeadFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users ?? []}
        categories={categories}
        defaultOwnerId={sessionUser?.id}
        onCategoryCreated={(c) => qc.setQueryData<LeadCategory[]>(["api", "/pulse/categories"], (old) => (old ? [...old, c] : [c]))}
        onSaved={(warnings) => {
          if (warnings && warnings.length) setDupWarn(warnings);
          reload();
          notify(warnings && warnings.length ? "Lead added — possible duplicate!" : "Lead added");
        }}
      />
      <LeadFormModal
        open={!!editLead}
        onClose={() => setEditLead(null)}
        users={users ?? []}
        categories={categories}
        initial={editLead}
        onCategoryCreated={(c) => qc.setQueryData<LeadCategory[]>(["api", "/pulse/categories"], (old) => (old ? [...old, c] : [c]))}
        onSaved={() => {
          setEditLead(null);
          reload();
          notify("Lead updated");
        }}
      />
      <MeetingModal
        open={meetingOpen}
        onClose={() => { setMeetingOpen(false); setEditingMeeting(null); }}
        leadId={detail?.id ?? selectedId}
        employees={employees ?? []}
        initial={editingMeeting}
        onSaved={(msg?: string) => {
          reload();
          qc.invalidateQueries({ queryKey: ["pulse", "lead", selectedId] });
          notify(msg ?? "Meeting saved");
        }}
      />
      <CategoryModal open={catOpen} onClose={() => setCatOpen(false)} categories={categories} onChanged={() => reload()} notify={notify} />
      <ConvertModal open={!!convertLead} onClose={() => setConvertLead(null)} lead={convertLead} users={users ?? []} onSaved={() => { reload(); notify("Converted — client + project onboarded"); }} />
      <LostModal open={!!lostLead} onClose={() => setLostLead(null)} lead={lostLead} onSaved={() => { reload(); notify("Lead marked lost"); }} />

      {/* proposal modal */}
      <Modal open={proposalModal} onClose={() => setProposalModal(false)} title="New proposal">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addProposal();
          }}
          className="flex flex-col gap-4"
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-body-lg font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
          >
            <Upload className="size-3.5" />
            {uploading ? "Uploading…" : proposalUrl ? "Uploaded — file attached" : "Upload proposal file (PDF)"}
          </button>
          {proposalUrl && (
            <p className="truncate rounded-xl bg-emerald-500/10 px-3 py-2 text-body-lg font-medium text-emerald-400">
              <Check className="mr-1 inline size-3.5" /> {proposalUrl}
            </p>
          )}
          <Field label="Proposal link" hint="Notion / Google Drive / PDF লিংক paste করো — client এই link-এই proposal দেখবে">
            <Input value={proposalPortal} onChange={(e) => setProposalPortal(e.target.value)} placeholder="https://notion.so/… বা https://drive.google.com/…" />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2.5 text-body-lg font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground">
            <input
              type="checkbox"
              checked={proposalSendNow}
              onChange={(e) => setProposalSendNow(e.target.checked)}
              className="size-4 accent-primary"
            />
            Send now — SENT হিসেবে mark হবে, lead stage PROPOSAL SENT-এ যাবে
          </label>
          <FormActions
            busy={false}
            cancel={() => {
              setProposalModal(false);
              setProposalUrl("");
              setProposalPortal("");
              setProposalSendNow(false);
            }}
            submitLabel={proposalSendNow ? "Send proposal" : "Save as draft"}
          />
        </form>
      </Modal>

      {/* edit proposal modal */}
      <Modal open={!!editProposal} onClose={() => setEditProposal(null)} title={`Edit proposal v${editProposal?.versionNumber ?? ""}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveEditProposal();
          }}
          className="flex flex-col gap-4"
        >
          <input
            ref={editFileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) uploadFile(e.target.files[0], setEditFileUrl);
              e.target.value = "";
            }}
          />
          <Field label="Proposal link" hint="নতুন version-এর link এখানে বসাও — banner + সব জায়গায় আপডেট হয়ে যাবে">
            <Input value={editLink} onChange={(e) => setEditLink(e.target.value)} placeholder="https://notion.so/… বা https://drive.google.com/…" />
          </Field>
          <div>
            <p className="mb-1 text-meta font-bold tracking-wide text-muted-foreground uppercase">Attached file</p>
            {editFileUrl ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-body-lg font-medium text-emerald-400">
                <FileText className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{editFileUrl}</span>
                <button type="button" onClick={() => setEditFileUrl("")} className="shrink-0 font-bold text-rose-400 hover:underline">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => editFileRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-4 py-4 text-body-lg font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
              >
                <Upload className="size-3.5" />
                {uploading ? "Uploading…" : "Replace / attach file (PDF)"}
              </button>
            )}
          </div>
          <Field label="Status">
            <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
              {["DRAFT", "SENT", "ACCEPTED", "REJECTED"].map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
          </Field>
          <FormActions
            busy={false}
            cancel={() => setEditProposal(null)}
            submitLabel="Save changes"
          />
        </form>
      </Modal>

      {/* dup warning */}
      <Modal open={!!dupWarn} onClose={() => setDupWarn(null)} title="Possible duplicate">
        <p className="text-body-lg leading-relaxed text-muted-foreground">
          নিম্নোক্ত সক্রিয় lead-এর সাথে contact মিলে গেছে:
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {dupWarn?.map((w) => (
            <li key={w.name} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-body-lg font-semibold text-amber-400">
              <AlertTriangle className="mr-1 inline size-3.5" /> {w.name}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <button onClick={() => setDupWarn(null)} className="rounded-xl bg-brand-gradient px-4 py-2 text-body-lg font-bold text-white">
            Understood
          </button>
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal open={!!deleteLead} onClose={() => setDeleteLead(null)} title="Delete lead?">
        <p className="text-body-lg leading-relaxed text-muted-foreground">
          {deleteLead?.name} চিরতরে মুছে যাবে — activities, proposals, meetings সহ। এটা undo করা যাবে না।
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteLead(null)} className="rounded-xl border border-border px-4 py-2 text-body-lg font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button onClick={deleteLeadFn} className="rounded-xl bg-rose-500 px-4 py-2 text-body-lg font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02]">
            Delete
          </button>
        </div>
      </Modal>

      {/* bulk actions */}
      {pulseTab === "pipeline" && selectedIds.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-2xl shadow-black/20 backdrop-blur">
            <span className="rounded-full bg-primary px-2 py-0.5 text-body font-bold text-primary-foreground">
              {selectedIds.length}
            </span>
            <span className="text-body-lg font-semibold">selected</span>
            <span className="mx-1 h-5 w-px bg-border" />
            <Select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} className="!w-36 !py-1.5 text-body-lg">
              <option value="">Move to stage…</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
            <Select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className="!w-40 !py-1.5 text-body-lg">
              <option value="">Assign owner…</option>
              {(users ?? []).map((u: UserLite) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
            <Btn
              variant="primary"
              className="!py-1.5 text-body"
              disabled={bulkMutation.isPending || (!bulkStage && !bulkOwner)}
              onClick={applyBulk}
            >
              {bulkMutation.isPending ? "Applying…" : "Apply"}
            </Btn>
            <Btn variant="ghost" className="!py-1.5 text-body" onClick={() => setSelectedIds([])}>
              <X className="size-3.5" /> Clear
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-body font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}