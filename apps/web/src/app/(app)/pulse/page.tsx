"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Flame,
  Gauge,
  Globe,
  Hash,
  Link2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  Star,
  StickyNote,
  Tag,
  Thermometer,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  Video,
  X,
  Zap,
} from "lucide-react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import type { Lead, LeadActivity, LeadCategory, LeadFollowUp, LeadMeeting, LeadNote, PipelineSummary, Proposal, UserLite } from "@/lib/types";
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
  Field,
  FormActions,
  Input,
  Modal,
  ScoreBar,
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";

const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
const ACTIVE_STAGES = STAGES.filter((s) => s !== "WON" && s !== "LOST") as (typeof STAGES)[number][];

const SOURCES = [
  "WEBSITE", "REFERRAL", "LINKEDIN", "GOOGLE_ADS", "FACEBOOK", "WHATSAPP",
  "COLD_CALL", "EMAIL_CAMPAIGN", "EVENT", "PARTNER", "INBOUND_PHONE", "EMAIL", "COLD", "OTHER",
];
const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const TEMPERATURES = ["HOT", "WARM", "COLD"];
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "WHATSAPP", "LINKEDIN", "NOTE"];
const MEETING_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"];
const LOST_REASONS = ["PRICE", "TIMING", "COMPETITOR", "GHOSTED", "NO_BUDGET"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

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
  notes: "",
};

function LeadFormModal({
  open,
  onClose,
  users,
  categories,
  initial,
  onSaved,
  onCategoryCreated,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  categories: LeadCategory[];
  initial?: Lead | null;
  onSaved: (warnings?: { name: string }[]) => void;
  onCategoryCreated: (c: LeadCategory) => void;
}) {
  const [f, setF] = useState<LeadFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const editing = !!initial;

  useEffect(() => {
    if (!open) return;
    setErr(null);
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
            nextFollowUpAt: initial.nextFollowUpAt?.slice(0, 16) ?? "",
            assignedToId: initial.assignedTo?.id ?? "",
            notes: initial.notes ?? "",
          }
        : emptyForm
    );
  }, [open, initial]);

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
      setErr("Name is required");
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
        probability: Number(f.probability) || 50,
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

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit lead" : "Add new lead"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contact name *">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rahim Ahmed" autoFocus />
          </Field>
          <Field label="Company">
            <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Acme Ltd." />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="rahim@acme.com" />
          </Field>
          <Field label="Phone">
            <Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="+8801…" />
          </Field>
          <Field label="Source">
            <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Vertical">
            <Select value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value })}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{label(v)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Temperature">
            <Select value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })}>
              {TEMPERATURES.map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Category" hint="Pick or add your own">
            <div className="flex gap-2">
              <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className="flex-1">
                <option value="">None</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setNewCatOpen((v) => !v)}
                className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-2.5 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                title="Add new category"
              >
                <Plus className="size-3.5" /> New
              </button>
            </div>
            {newCatOpen && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addNewCategory()}
                  placeholder="e.g. School Category 2026"
                  autoFocus
                />
                <Btn type="button" variant="primary" onClick={addNewCategory} className="!py-2">
                  <Check className="size-3.5" />
                </Btn>
              </div>
            )}
          </Field>
          <Field label="Probability (%)">
            <Input type="number" min={0} max={100} value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="campaign, follow-up, budget…" />
          </Field>
          <Field label="Website">
            <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://acme.com" />
          </Field>
          <Field label="Social / page link">
            <Input value={f.pageLink} onChange={(e) => setF({ ...f, pageLink: e.target.value })} placeholder="https://facebook.com/acme" />
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{label(p)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated deal size (BDT)">
            <Input type="number" min={0} value={f.estimatedDealSize} onChange={(e) => setF({ ...f, estimatedDealSize: e.target.value })} placeholder="250000" />
          </Field>
          <Field label="Currency">
            <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              <option value="BDT">BDT</option>
              <option value="USD">USD</option>
              <option value="SAR">SAR</option>
              <option value="AED">AED</option>
            </Select>
          </Field>
          <Field label="Next follow-up">
            <Input type="datetime-local" value={f.nextFollowUpAt} onChange={(e) => setF({ ...f, nextFollowUpAt: e.target.value })} />
          </Field>
          <Field label="Assigned to">
            <Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}>
              <option value="">Unassigned</option>
              {(users ?? []).map((u: UserLite) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Context, commitments, objections…" />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add lead"} />
      </form>
    </Modal>
  );
}

// ── Schedule meeting modal ───────────────────────────────────────────────
function MeetingModal({
  open,
  onClose,
  users,
  employees,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  employees: { id: string; name: string }[];
  onSaved: (msg?: string) => void;
}) {
  const [f, setF] = useState({ title: "", mode: "online" as "online" | "offline", scheduledAt: "", durationMins: "30", meetingLink: "", location: "", notes: "", attendeeIds: [] as string[], assignToId: "", taskTitle: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErr(null);
      setF({ title: "", mode: "online", scheduledAt: "", durationMins: "30", meetingLink: "", location: "", notes: "", attendeeIds: [] as string[], assignToId: "", taskTitle: "" });
    }
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim() || !f.scheduledAt) {
      setErr("Title and scheduled time are required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch<any>(`/pulse/leads/${currentLeadIdRef.current}/meetings`, {
        method: "POST",
        body: JSON.stringify({
          title: f.title.trim(),
          type: f.mode === "online" ? "VIDEO_CALL" : "IN_PERSON",
          scheduledAt: new Date(f.scheduledAt).toISOString(),
          durationMins: Number(f.durationMins) || 30,
          meetingLink: f.mode === "online" ? f.meetingLink.trim() || undefined : undefined,
          location: f.mode === "offline" ? f.location.trim() || undefined : undefined,
          attendees: f.attendeeIds.length
            ? users.filter((u) => f.attendeeIds.includes(u.id)).map((u) => ({ id: u.id, name: u.name }))
            : undefined,
          notes: f.notes.trim() || undefined,
          assignToId: f.assignToId || undefined,
          taskTitle: f.taskTitle.trim() || undefined,
        }),
      });
      onSaved(res?.createdTask ? `Meeting scheduled — task created for ${res.createdTask.assigneeName ?? ""}`.trim() : undefined);
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule meeting">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Title *">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Discovery call" autoFocus />
        </Field>
        <Field label="Meeting mode">
          <Segmented
            value={f.mode}
            onChange={(v) => setF((p) => ({ ...p, mode: v as "online" | "offline" }))}
            options={[
              { value: "online", label: "Online" },
              { value: "offline", label: "Offline" },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (mins)">
            <Select value={f.durationMins} onChange={(e) => setF({ ...f, durationMins: e.target.value })}>
              {["15", "30", "45", "60", "90", "120"].map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>
          </Field>
          <Field label="When *">
            <Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} />
          </Field>
        </div>
        {f.mode === "online" ? (
          <Field label="Meeting link" hint="Google Meet / Zoom">
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
        <Field label="Meeting notes / agenda">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Agenda, prep…" />
        </Field>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-primary uppercase">Action → task</p>
          <div className="grid grid-cols-2 gap-3">
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
        <Field label="Attendees" hint="Internal team members">
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border bg-muted/30 p-2">
            {(users ?? []).map((u: UserLite) => (
              <button
                key={u.id}
                type="button"
                onClick={() =>
                  setF((p) => ({
                    ...p,
                    attendeeIds: p.attendeeIds.includes(u.id)
                      ? p.attendeeIds.filter((x) => x !== u.id)
                      : [...p.attendeeIds, u.id],
                  }))
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px] font-semibold transition-colors",
                  f.attendeeIds.includes(u.id)
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <Avatar name={u.name} size="xs" />
                {u.name}
              </button>
            ))}
            {(users ?? []).length === 0 && <p className="p-1 text-[11px] text-muted-foreground">No team members</p>}
          </div>
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Schedule" />
      </form>
    </Modal>
  );
}

let currentLeadIdRef: { current: string | null } = { current: null };

function nextScheduled<T>(items: T[] | undefined, dateKey: keyof T, statusKey: keyof T): T | undefined {
  return (items ?? [])
    .filter((i) => String(i[statusKey]) === "SCHEDULED")
    .sort((a, b) => new Date(String(a[dateKey])).getTime() - new Date(String(b[dateKey])).getTime())[0];
}

function GlanceItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-28">
      <p className="text-[9.5px] font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold">{value}</p>
    </div>
  );
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
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[11.5px] font-medium text-emerald-400">
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
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
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
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
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
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {categories.length === 0 && <p className="text-[11.5px] text-muted-foreground">No categories yet.</p>}
          {categories.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
              {c.color && <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />}
              <span className="flex-1 truncate text-[12px] font-semibold">{c.name}</span>
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
  const initialTab = (searchParams.get("tab") as "overview" | "leads") ?? "overview";
  const [pulseTab, setPulseTab] = useState<"overview" | "leads">(initialTab === "leads" ? "leads" : "overview");
  const [view, setView] = useState<"board" | "table" | "grid">("board");

  // sync tab -> URL (?tab=...) for redirect/deep-link + back-button
  const setPulseTabWithUrl = useCallback(
    (v: "overview" | "leads") => {
      setPulseTab(v);
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", v);
      router.push(`/pulse?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  // keep state in sync if user navigates via back/forward or direct link
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "overview" || t === "leads") setPulseTab(t);
  }, [searchParams]);
  const [calOpen, setCalOpen] = useState(false);
  const [followUpDue, setFollowUpDue] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [catOpen, setCatOpen] = useState(false);

  const { data: summary } = useApi<PipelineSummary>("/pulse/summary");
  const { data: users } = useApi<UserLite[]>("/users");
  const { data: employees } = useApi<{ id: string; name: string }[]>("/people/employees");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [deleteLead, setDeleteLead] = useState<Lead | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<{ name: string }[] | null>(null);

  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [activityText, setActivityText] = useState("");
  const [activityType, setActivityType] = useState("CALL");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [followUpAssignee, setFollowUpAssignee] = useState("");
  const [followUpTaskTitle, setFollowUpTaskTitle] = useState("");
  const [proposalModal, setProposalModal] = useState(false);
  const [proposalUrl, setProposalUrl] = useState("");
  const [proposalPortal, setProposalPortal] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);

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
    currentLeadIdRef.current = selectedId;
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

  const addActivity = async () => {
    if (!selectedId || !activityText.trim()) return;
    try {
      await apiFetch(`/pulse/leads/${selectedId}/activities`, {
        method: "POST",
        body: JSON.stringify({ type: activityType, content: activityText.trim() }),
      });
      setActivityText("");
      notify("Activity logged");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Failed");
    }
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
    if (!selectedId || (!proposalUrl.trim() && !proposalPortal.trim())) {
      notify("Add a file or portal link");
      return;
    }
    try {
      await apiFetch(`/pulse/leads/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          fileUrl: proposalUrl.trim() || undefined,
          portalLink: proposalPortal.trim() || undefined,
        }),
      });
      setProposalModal(false);
      setProposalUrl("");
      setProposalPortal("");
      notify("Proposal added");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Failed");
    }
  };

  const uploadFile = async (file: File) => {
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
      setProposalUrl(data.fileUrl);
      notify("File uploaded");
    } catch (e: any) {
      notify(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

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
          className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Pulse — Lead Pipeline"
        subtitle="Score, qualify and close every opportunity."
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
          onChange={(v) => setPulseTabWithUrl(v as "overview" | "leads")}
          options={[
            { value: "overview", label: "Overview" },
            { value: "leads", label: "Leads" },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
      {pulseTab === "overview" && (
        <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          <StatCard index={0} label="Pipeline Value" value={formatBDT(summary?.pipelineValue)} sub={`weighted ${formatBDT(summary?.weightedForecast)}`} icon={<Zap className="size-5" />} />
          <StatCard index={1} label="Hot Leads" value={summary?.hotLeads ?? "—"} sub={`${summary?.temperatureCounts?.WARM ?? 0} warm · ${summary?.temperatureCounts?.COLD ?? 0} cold`} icon={<Flame className="size-5" />} />
          <StatCard index={2} label="Win Rate" value={summary?.winRate != null ? `${summary.winRate}%` : "—"} sub={`${summary?.won ?? 0} won · ${summary?.lost ?? 0} lost`} icon={<Trophy className="size-5" />} />
          <StatCard
            index={3}
            label="Conversion"
            value={summary?.totalLeads ? `${Math.round((summary.won / summary.totalLeads) * 100)}%` : "—"}
            sub={`of ${summary?.totalLeads ?? 0} total leads`}
            icon={<CheckCircle2 className="size-5" />}
          />
          <StatCard index={4} label="Follow-ups Due" value={summary?.followUpsDue ?? "—"} sub={`${summary?.urgentCount ?? 0} urgent`} icon={<CalendarClock className="size-5" />} />
          <StatCard index={5} label="Stale / Rotten" value={summary?.staleLeads ?? "—"} sub="no touch in 7d+" icon={<AlertTriangle className="size-5" />} />
          <StatCard
            index={6}
            label="Closed Value"
            value={formatBDT(summary?.byStage?.find((s) => s.name === "WON")?.value)}
            sub={summary?.avgResponseHours != null ? `avg response ${summary.avgResponseHours}h` : "—"}
            icon={<Gauge className="size-5" />}
          />
        </div>

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
                    <span className="w-16 shrink-0 text-[11.5px] font-bold text-muted-foreground">{label(t)}</span>
                    <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-muted/50">
                      <motion.div className={`absolute inset-y-0 left-0 rounded-lg ${tone}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.4 + ["HOT","WARM","COLD"].indexOf(t)*0.07, duration: 0.65, ease: [0.22,1,0.36,1] }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12.5px] font-bold tabular-nums">{n}</span>
                    <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{pct}%</span>
                  </motion.div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(summary?.categoryCounts ?? {}).map(([name, count]) => (
                <span key={name} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                  {name} <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums text-foreground">{count}</span>
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>
      )}
      </AnimatePresence>

      {pulseTab === "leads" && (
        <motion.div key="leads" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="mt-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leads…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="!w-36">
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </Select>
          <Select value={vertical} onChange={(e) => setVertical(e.target.value)} className="!w-32">
            <option value="">All verticals</option>
            {VERTICALS.map((v) => (
              <option key={v} value={v}>{label(v)}</option>
            ))}
          </Select>
          <Select value={temperature} onChange={(e) => setTemperature(e.target.value)} className="!w-32">
            <option value="">All temps</option>
            {TEMPERATURES.map((t) => (
              <option key={t} value={t}>{label(t)}</option>
            ))}
          </Select>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="!w-40">
            <option value="">All categories</option>
            {categories.map((c, i) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <button
            onClick={() => setCatOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[11.5px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            title="Manage categories"
          >
            <Tag className="size-3.5" /> New
          </button>
          <button
            onClick={() => setCalOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] font-bold transition-colors",
              calOpen || followUpDue || createdAfter
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
            title="Date filters"
          >
            <Calendar className="size-3.5" />
            Dates
          </button>
          {calOpen && (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2">
              <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                Follow-up due by
                <input
                  type="date"
                  value={followUpDue}
                  onChange={(e) => setFollowUpDue(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2 py-1.5 text-[11.5px] outline-none focus:border-primary/40"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                Created after
                <input
                  type="date"
                  value={createdAfter}
                  onChange={(e) => setCreatedAfter(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2 py-1.5 text-[11.5px] outline-none focus:border-primary/40"
                />
              </label>
              {(followUpDue || createdAfter) && (
                <button
                  onClick={() => {
                    setFollowUpDue("");
                    setCreatedAfter("");
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-rose-400 transition-colors hover:bg-rose-500/10"
                >
                  <X className="size-3" /> Clear dates
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setStarredOnly((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] font-bold transition-colors",
              starredOnly
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <Star className={cn("size-3.5", starredOnly && "fill-amber-400 text-amber-400")} />
            Starred
          </button>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="!w-32">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
          </Select>
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="!w-40">
            <option value="">All owners</option>
            {(users ?? []).map((u: UserLite) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
          <Select value={minScore} onChange={(e) => setMinScore(e.target.value)} className="!w-32">
            <option value="">Any score</option>
            <option value="70">Hot ≥ 70</option>
            <option value="50">Warm ≥ 50</option>
          </Select>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
                {STAGES.map((stage, ci) => {
                  const items = filteredByStage(stage);
                  const value = items.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0);
                  const active = ACTIVE_STAGES.includes(stage);
                  return (
                    <div key={stage} className="flex min-w-0 flex-col">
                      <div
                        className={cn(
                          "mb-2 flex items-center justify-between rounded-xl border px-3 py-2",
                          stage === "WON"
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : stage === "LOST"
                              ? "border-rose-500/30 bg-rose-500/10"
                              : "border-border/60 bg-card"
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-[11.5px] font-bold">
                          <ChevronLeft className="size-3 text-muted-foreground" />
                          {label(stage)}
                          <ChevronRight className="size-3 text-muted-foreground" />
                        </span>
                        <span className="text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                          {items.length} · {formatBDT(value)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.length === 0 && (
                          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/60">No leads</p>
                        )}
                        {items.map((l, li) => {
                          const fu = followUpStatus(l);
                          return (
                            <div
                              key={l.id}
                              onClick={() => setSelectedId(l.id)}
                              className={cn(
                                "group cursor-pointer rounded-xl border bg-card p-2.5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10",
                                isStale(l) ? "border-amber-500/40" : "border-border/60"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-[12.5px] font-bold">{l.name}</p>
                                  <p className="truncate text-[10.5px] text-muted-foreground">
                                    {l.company ?? l.contactEmail ?? "—"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    onClick={(e) => toggleStar(l, e)}
                                    className={cn(
                                      "rounded-lg p-0.5 transition-colors",
                                      l.starred
                                        ? "text-amber-400"
                                        : "text-muted-foreground/50 opacity-0 hover:text-amber-400 group-hover:opacity-100"
                                    )}
                                    title={l.starred ? "Unstar" : "Star"}
                                  >
                                    <Star className={cn("size-3.5", l.starred && "fill-amber-400")} />
                                  </button>
                                  <span className={cn("size-2 shrink-0 rounded-full", l.priority === "URGENT" ? "bg-rose-500" : l.priority === "HIGH" ? "bg-amber-400" : l.priority === "MEDIUM" ? "bg-sky-400" : "bg-muted")} />
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <ScoreBar score={l.leadScore} />
                                <span className="text-[11px] font-bold tabular-nums">{formatBDT(l.estimatedDealSize)}</span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {l.uid && (
                                  <span className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
                                    <Hash className="size-2.5" /> {l.uid}
                                  </span>
                                )}
                                <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                                  {l.temperature}
                                </span>
                                {l.leadCategory && (
                                  <span className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold", categoryToneOf(l.leadCategory, li))}>
                                    {l.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: l.leadCategory.color }} />}
                                    {l.leadCategory.name}
                                  </span>
                                )}
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                                  {label(l.source)}
                                </span>
                              </div>
                              <div className="mt-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={cn(
                                        "h-full rounded-full",
                                        (l.probability ?? 0) >= 70 ? "bg-emerald-500" : (l.probability ?? 0) >= 40 ? "bg-amber-400" : "bg-sky-400"
                                      )}
                                      style={{ width: `${l.probability ?? 0}%` }}
                                    />
                                  </div>
                                  <span className="text-[9px] font-bold tabular-nums text-muted-foreground">{l.probability ?? 0}%</span>
                                </div>
                              </div>
                              {l.tags && l.tags.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {l.tags.slice(0, 3).map((t) => (
                                    <span key={t} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {fu && (
                                  <span className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                    fu === "overdue" ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
                                  )}>
                                    {fu === "overdue" ? "⏰ follow-up overdue" : "⏰ follow-up today"}
                                  </span>
                                )}
                                {l.nextMeeting && (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                    📅 {formatDate(l.nextMeeting.scheduledAt)}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <div className="flex gap-1">
                                  {active && ci > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); moveStage(l, -1); }}
                                      className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                      <ArrowLeft className="size-3.5" />
                                    </button>
                                  )}
                                  {active && ci < STAGES.length - 2 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); moveStage(l, 1); }}
                                      className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                      <ArrowRight className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                                <span className="text-[9.5px] text-muted-foreground/70">
                                  {l.assignedTo?.name ?? "unassigned"}
                                </span>
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-muted-foreground">Stage:</span>
              <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="!w-40">
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </Select>
            </div>
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
                            <p className="truncate text-[12.5px] font-bold">{l.name}</p>
                            <p className="truncate text-[10.5px] text-muted-foreground">
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
                          <span className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
                            <Hash className="size-2.5" /> {l.uid}
                          </span>
                        )}
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                          {l.temperature}
                        </span>
                        {l.leadCategory && (
                          <span className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold", categoryToneOf(l.leadCategory, gi))}>
                            {l.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: l.leadCategory.color }} />}
                            {l.leadCategory.name}
                          </span>
                        )}
                        <StatusBadge status={l.stage} />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <ScoreBar score={l.leadScore} />
                        <span className="text-[11px] font-bold tabular-nums">{formatBDT(l.estimatedDealSize)}</span>
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[9px] font-semibold text-muted-foreground">
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
                            <span key={t} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          {fu && (
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                              fu === "overdue" ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
                            )}>
                              {fu === "overdue" ? "overdue" : "today"}
                            </span>
                          )}
                          {l.nextMeeting && <span>📅 {formatDate(l.nextMeeting.scheduledAt)}</span>}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-muted-foreground">Stage:</span>
              <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="!w-40">
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </Select>
            </div>
            <TableShell noScroll footer={<span className="text-[11.5px] text-muted-foreground">{tableLeads.length} leads</span>}>
              <table className="w-full">
                <THead>
                  <Th>Lead</Th>
                  <Th className="hidden lg:table-cell">Source</Th>
                  <Th className="hidden xl:table-cell">Category</Th>
                  <Th className="hidden md:table-cell">Temperature</Th>
                  <Th className="hidden md:table-cell">Priority</Th>
                  <Th>Score</Th>
                  <Th>Deal</Th>
                  <Th>Follow-up</Th>
                  <Th>Owner</Th>
                  <Th>Stage</Th>
                </THead>
                <tbody>
                  {tableLeads.map((l, ti) => (
                    <Tr key={l.id} index={ti} onClick={() => setSelectedId(l.id)} className="cursor-pointer">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.name} />
                          <div>
                            <p className="font-medium">{l.name}</p>
                            <p className="text-[11px] text-muted-foreground">{l.company ?? l.contactEmail ?? "—"}</p>
                          </div>
                          {l.starred && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                        </div>
                      </Td>
                      <Td className="hidden lg:table-cell text-muted-foreground">{label(l.source)}</Td>
                      <Td className="hidden xl:table-cell">
                        {l.leadCategory ? (
                          <span className={cn("flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", categoryToneOf(l.leadCategory, ti))}>
                            {l.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: l.leadCategory.color }} />}
                            {l.leadCategory.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </Td>
                      <Td className="hidden md:table-cell">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", temperatureTone[l.temperature] ?? temperatureTone.WARM)}>
                          {l.temperature}
                        </span>
                      </Td>
                      <Td className="hidden md:table-cell">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", priorityTone[l.priority] ?? priorityTone.MEDIUM)}>
                          {l.priority}
                        </span>
                      </Td>
                      <Td><ScoreBar score={l.leadScore} /></Td>
                      <Td className="font-semibold tabular-nums">{formatBDT(l.estimatedDealSize)}</Td>
                      <Td className="text-muted-foreground">{formatDate(l.nextFollowUpAt)}</Td>
                      <Td className="text-muted-foreground">{l.assignedTo?.name ?? "—"}</Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <Select value={l.stage} onChange={(e) => leadPatch.mutate({ id: l.id, patch: { stage: e.target.value } }, { onSuccess: () => notify(`Moved to ${label(e.target.value)}`) })} className="!w-28 !py-1 text-[11px]">
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{label(s)}</option>
                          ))}
                        </Select>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </FadeIn>
        )}

        {leads && leadsTotal > leads.length && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <span className="text-[11px] text-muted-foreground">
              Showing {leads.length} of {leadsTotal} leads
            </span>
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="rounded-xl border border-border bg-card px-3.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
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
                <p className="font-heading text-[15px] font-semibold">{detail.name}</p>
                <p className="text-[11px] text-muted-foreground">{detail.company ?? detail.contactEmail ?? "—"}</p>
              </div>
              <button
                onClick={() => leadPatch.mutate({ id: selectedId as string, patch: { starred: !detail.starred } }, { onSuccess: () => notify(detail.starred ? "Removed from starred" : "Starred") })}
                className={cn(
                  "rounded-lg p-1 transition-colors",
                  detail.starred ? "text-amber-400" : "text-muted-foreground/50 hover:text-amber-400"
                )}
                title={detail.starred ? "Unstar" : "Star"}
              >
                <Star className={cn("size-4", detail.starred && "fill-amber-400")} />
              </button>
              {detail.uid && (
                <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                  <Hash className="size-3" /> {detail.uid}
                </span>
              )}
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", temperatureTone[detail.temperature] ?? temperatureTone.WARM)}>
                {detail.temperature}
              </span>
              {detail.leadCategory && (
                <span className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", categoryToneOf(detail.leadCategory, detail.leadCategory.name.length))}>
                  {detail.leadCategory.color && <span className="size-1.5 rounded-full" style={{ background: detail.leadCategory.color }} />}
                  {detail.leadCategory.name}
                </span>
              )}
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", priorityTone[detail.priority] ?? priorityTone.MEDIUM)}>
                {detail.priority}
              </span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", detail.stage === "WON" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : detail.stage === "LOST" ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-primary/30 bg-primary/10 text-primary")}>
                {label(detail.stage)}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                score {detail.leadScore} · {detail.probability ?? 0}% win
              </span>
            </div>
          ) : null
        }
        size="xl"
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
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-400">
                  <CheckCircle2 className="size-4" /> Converted — client: {detail.client.companyName}
                </p>
                {detail.projects && detail.projects.length > 0 && (
                  <p className="text-[11px] text-emerald-400/80">
                    project: {detail.projects.map((p) => p.name).join(", ")} ({detail.projects[0].status})
                  </p>
                )}
              </div>
            )}
            {detail.duplicateWarnings && detail.duplicateWarnings.length > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[11.5px] font-medium text-amber-400">
                ⚠ Duplicate alert — same contact already exists: {detail.duplicateWarnings.map((w) => w.name).join(", ")}
              </div>
            )}

            {/* glance facts */}
            <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3">
              <GlanceItem label="Deal size" value={detail.estimatedDealSize ? `${detail.currency ?? "৳"}${Number(detail.estimatedDealSize).toLocaleString()}` : "—"} />
              <GlanceItem label="Win probability" value={`${detail.probability ?? 0}%`} />
              <GlanceItem label="Owner" value={detail.assignedTo?.name ?? "Unassigned"} />
              <GlanceItem label="Source" value={label(detail.source)} />
              <GlanceItem label="Last contact" value={detail.lastContactedAt ? timeAgo(detail.lastContactedAt) : "never"} />
              <GlanceItem
                label="Website"
                value={detail.website ? (
                  <a href={detail.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">{detail.website.replace(/^https?:\/\//, "")}</a>
                ) : "—"}
              />
            </div>

            {/* pipeline status + handled by */}
            <div className="grid gap-3 lg:grid-cols-[1.6fr_0.9fr]">
              <div className="rounded-2xl border border-border/60 bg-muted/10 p-3">
                <p className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Pipeline status — click to move</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STAGES.map((s) => {
                    const active = detail.stage === s;
                    const isWon = s === "WON";
                    const isLost = s === "LOST";
                    return (
                      <button
                        key={s}
                        onClick={() => stageChanged(detail, s)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10.5px] font-bold transition-colors",
                          active
                            ? isWon
                              ? "border-emerald-500/40 bg-emerald-500 text-white"
                              : isLost
                                ? "border-rose-500/40 bg-rose-500 text-white"
                                : "border-primary bg-primary text-white shadow-sm"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        {label(s)}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">Priority</span>
                  <Select value={detail.priority} onChange={(e) => patchLead({ priority: e.target.value }, `Priority → ${e.target.value}`)} className="!w-32 !py-1.5 text-[11px]">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{label(p)}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-muted/10 p-3">
                <p className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Handled by</p>
                <div className="flex items-center gap-3">
                  <Avatar name={detail.assignedTo?.name ?? "Unassigned"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold">{detail.assignedTo?.name ?? "Unassigned"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{detail.assignedTo ? "Owner" : "No owner yet"}</p>
                  </div>
                </div>
                <Select value={detail.assignedTo?.id ?? ""} onChange={(e) => patchLead({ assignedToId: e.target.value || undefined }, e.target.value ? `Assigned to ${users?.find((u) => u.id === e.target.value)?.name ?? ""}` : "Unassigned")} className="!py-1.5 text-[11px]">
                  <option value="">Unassigned</option>
                  {(users ?? []).map((u: UserLite) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </div>
            </div>

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
                        <p className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
                          <CalendarClock className="size-3.5" /> Next follow-up
                        </p>
                        {nf && (
                          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold", nfOverdue ? "bg-amber-500/15 text-amber-400" : "bg-primary/15 text-primary")}>
                            {nfOverdue ? "OVERDUE" : "SCHEDULED"}
                          </span>
                        )}
                      </div>
                      {nf ? (
                        <>
                          <p className="mt-1.5 text-[13px] font-bold">{formatDate(nf.date)}</p>
                          {nf.notes && <p className="mt-0.5 text-[11px] text-muted-foreground">{nf.notes}</p>}
                          <div className="mt-2.5 flex items-center gap-1.5">
                            <Btn variant="primary" className="!px-3 !py-1.5 text-[11px]" onClick={() => followUpStatusChange(nf, "COMPLETED")}>
                              <CheckCircle2 className="size-3.5" /> Complete
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-[11px]" onClick={() => followUpStatusChange(nf, "MISSED")}>
                              <X className="size-3.5" /> Missed
                            </Btn>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-[12px] text-muted-foreground">No follow-up scheduled</p>
                          <button
                            onClick={() => document.getElementById("fu-section")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                            className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary"
                          >
                            <Plus className="size-3" /> Schedule
                          </button>
                        </div>
                      )}
                    </div>
                    {/* next meeting */}
                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
                          <Video className="size-3.5" /> Next meeting
                        </p>
                        {nm && (
                          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold", nmOverdue ? "bg-amber-500/15 text-amber-400" : "bg-primary/15 text-primary")}>
                            {nmOverdue ? "OVERDUE" : "SCHEDULED"}
                          </span>
                        )}
                      </div>
                      {nm ? (
                        <>
                          <p className="mt-1.5 text-[13px] font-bold">
                            {formatDate(nm.scheduledAt)} · {nm.title}
                          </p>
                          <div className="mt-2.5 flex items-center gap-1.5">
                            <Btn variant="primary" className="!px-3 !py-1.5 text-[11px]" onClick={() => meetingStatus(nm, "COMPLETED")}>
                              <CheckCircle2 className="size-3.5" /> Complete
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-[11px]" onClick={() => meetingStatus(nm, "CANCELLED")}>
                              <X className="size-3.5" /> Cancel
                            </Btn>
                            <Btn variant="outline" className="!px-3 !py-1.5 text-[11px]" onClick={() => setMeetingOpen(true)}>
                              <RefreshCw className="size-3.5" /> Reschedule
                            </Btn>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-[12px] text-muted-foreground">No meeting scheduled</p>
                          <button
                            onClick={() => setMeetingOpen(true)}
                            className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary"
                          >
                            <Plus className="size-3" /> Schedule
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
              {/* left — main work area */}
              <div className="flex flex-col gap-6 lg:col-span-3">
                {/* notes — v0-crm note history */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
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
                      <p className="text-[11.5px] text-muted-foreground">No notes yet — capture the first one above.</p>
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
                              <button onClick={() => setEditingNoteId(null)} className="rounded-lg px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted">
                                Cancel
                              </button>
                              <button onClick={() => saveNoteEdit(n.id)} className="rounded-lg bg-brand-gradient px-2.5 py-1 text-[11px] font-bold text-white">
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
                            <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{n.content}</p>
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-[9.5px] text-muted-foreground/60">
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
                                  <Pencil className="size-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteNote(n);
                                  }}
                                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                                  title="Delete note"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {/* timeline */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                    <RefreshCw className="size-3.5" /> Timeline
                  </h4>
                  <div className="mb-3 flex gap-2">
                    <Select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="!w-32">
                      {ACTIVITY_TYPES.map((t) => (
                        <option key={t} value={t}>{label(t)}</option>
                      ))}
                    </Select>
                    <Input
                      value={activityText}
                      onChange={(e) => setActivityText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addActivity()}
                      placeholder="Log a call, email, meeting, note…"
                    />
                    <Btn variant="primary" onClick={addActivity}>Log</Btn>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.activities?.length === 0 && (
                      <p className="text-[11.5px] text-muted-foreground">No activity yet — log the first touch.</p>
                    )}
                    {detail.activities?.map((a) => (
                      <div key={a.id} className="flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <span
                          className={cn(
                            "mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                            a.type === "NOTE" ? "bg-muted text-muted-foreground"
                              : a.type === "CREATED" ? "bg-emerald-500/15 text-emerald-400"
                                : a.type === "UPDATED" ? "bg-amber-500/15 text-amber-400"
                                  : a.type === "STAGE_CHANGED" ? "bg-primary/15 text-primary"
                                    : a.type === "CALL" || a.type === "MEETING" ? "bg-primary/15 text-primary"
                                      : a.type === "EMAIL" ? "bg-sky-500/15 text-sky-400"
                                        : a.type === "WHATSAPP" ? "bg-emerald-500/15 text-emerald-400"
                                          : "bg-blue-500/15 text-blue-400"
                          )}
                        >
                          {a.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] leading-relaxed">{a.content}</p>
                          {a.changes && Object.keys(a.changes).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(a.changes).map(([field, ch]) => (
                                <span key={field} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                                  <span className="font-bold uppercase">{label(field)}</span>{" "}
                                  <span className="text-rose-400 line-through">{ch.old == null ? "—" : String(ch.old)}</span>
                                  {" → "}
                                  <span className="font-semibold text-emerald-400">{ch.new == null ? "—" : String(ch.new)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {timeAgo(a.loggedAt)} · {a.loggedBy?.name ?? "system"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* meetings */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                      <Video className="size-3.5" /> Meetings ({detail.meetings?.length ?? 0})
                    </h4>
                    <button onClick={() => setMeetingOpen(true)} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                      <Plus className="size-3" /> Schedule
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.meetings?.length === 0 && (
                      <p className="text-[11.5px] text-muted-foreground">No meetings scheduled.</p>
                    )}
                    {detail.meetings?.map((m) => {
                      const past = new Date(m.scheduledAt).getTime() < Date.now();
                      return (
                        <div key={m.id} className="flex items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                          <span className={cn(
                            "mt-0.5 size-2 shrink-0 rounded-full",
                            m.status === "COMPLETED" ? "bg-emerald-500"
                              : m.status === "CANCELLED" ? "bg-muted"
                                : m.status === "NO_SHOW" ? "bg-rose-500"
                                  : past ? "bg-amber-400" : "bg-primary"
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-semibold">
                              {m.title}{" "}
                              <span className="text-[10px] font-medium text-muted-foreground">
                                · {label(m.type)} · {m.durationMins}min
                              </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              <span className={cn(
                                "mr-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                m.type === "VIDEO_CALL" || m.type === "CALL"
                                  ? "bg-sky-500/15 text-sky-400"
                                  : "bg-amber-500/15 text-amber-400"
                              )}>
                                {m.type === "VIDEO_CALL" || m.type === "CALL" ? "Online" : "Offline"}
                              </span>
                              {formatDate(m.scheduledAt)}
                              {m.meetingLink && (
                                <>
                                  {" · "}
                                  <a href={m.meetingLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                    join link
                                  </a>
                                </>
                              )}
                              {m.location && <> · {m.location}</>}
                              {m.notes && <> · {m.notes}</>}
                            </p>
                            {m.attendees && m.attendees.length > 0 && (
                              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                <UserRound className="size-3" />
                                {m.attendees.map((at, ai) => (
                                  <span key={at.id} className="rounded-md bg-muted/60 px-1.5 py-0.5 font-semibold">
                                    {at.name}
                                  </span>
                                ))}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                              m.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-400"
                                : m.status === "CANCELLED" ? "bg-muted text-muted-foreground"
                                  : m.status === "NO_SHOW" ? "bg-rose-500/15 text-rose-400"
                                    : "bg-primary/15 text-primary"
                            )}>
                              {m.status}
                            </span>
                            {m.status === "SCHEDULED" && (
                              <>
                                <button onClick={() => meetingStatus(m, "COMPLETED")} className="rounded-lg p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10" title="Complete">
                                  <CheckCircle2 className="size-3.5" />
                                </button>
                                <button onClick={() => meetingStatus(m, "NO_SHOW")} className="rounded-lg p-1 text-rose-400 transition-colors hover:bg-rose-500/10" title="No-show">
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
                      );
                    })}
                  </div>
                </section>

                {/* follow-ups (v0-crm subsystem) */}
                <section id="fu-section">
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                    <CalendarClock className="size-3.5" /> Follow-ups ({detail.followUps?.length ?? 0})
                  </h4>
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
                    <span className="text-[10.5px] font-bold tracking-wide text-primary uppercase">Action → task</span>
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
                      <p className="text-[11.5px] text-muted-foreground">No follow-ups scheduled.</p>
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
                            <p className="text-[12.5px] font-semibold">
                              {formatDate(fu.date)}
                              {overdue && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">overdue</span>}
                            </p>
                            {fu.notes && <p className="text-[11px] text-muted-foreground">{fu.notes}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
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

                {/* proposals */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                      <FileText className="size-3.5" /> Proposals ({detail.proposals?.length ?? 0})
                    </h4>
                    <button onClick={() => setProposalModal(true)} className="flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary">
                      <Plus className="size-3" /> New version
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.proposals?.length === 0 && (
                      <p className="text-[11.5px] text-muted-foreground">No proposals yet.</p>
                    )}
                    {detail.proposals?.map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-semibold">
                            v{p.versionNumber}
                            {p.sentDate && <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">sent {formatDate(p.sentDate)}</span>}
                          </p>
                          <p className="flex flex-wrap items-center gap-2 truncate text-[10.5px] text-muted-foreground">
                            {p.fileUrl && (
                              <a href={p.fileUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">file ↗</a>
                            )}
                            {p.portalLink && (
                              <a href={p.portalLink} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-primary hover:underline">
                                <Link2 className="size-3" /> portal ↗
                              </a>
                            )}
                            {!p.fileUrl && !p.portalLink && "no attachment"}
                          </p>
                        </div>
                        <Select
                          value={p.status}
                          onChange={(e) => proposalStatus(p, e.target.value)}
                          className={cn("!w-28 shrink-0 !py-1.5 text-[11px]", p.status === "ACCEPTED" && "!border-emerald-500/40 !text-emerald-400", p.status === "REJECTED" && "!border-rose-500/40 !text-rose-400")}
                        >
                          {["DRAFT", "SENT", "ACCEPTED", "REJECTED"].map((s) => (
                            <option key={s} value={s}>{label(s)}</option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* right — properties / edit */}
              <div className="flex flex-col gap-5 lg:col-span-2">
                <section className="rounded-2xl border border-border/60 p-4">
                  <h4 className="mb-3 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                    <Gauge className="size-3.5" /> Lead health
                  </h4>
                  <ScoreBar score={detail.leadScore} />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                      <p className="text-[9.5px] font-bold text-muted-foreground uppercase">Last contact</p>
                      <p className="mt-0.5 font-semibold">{detail.lastContactedAt ? timeAgo(detail.lastContactedAt) : "never"}</p>
                    </div>
                    <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                      <p className="text-[9.5px] font-bold text-muted-foreground uppercase">First response</p>
                      <p className="mt-0.5 font-semibold">{detail.firstResponseAt ? timeAgo(detail.firstResponseAt) : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                      <p className="text-[9.5px] font-bold text-muted-foreground uppercase">In stage since</p>
                      <p className="mt-0.5 font-semibold">{detail.stageEnteredAt ? timeAgo(detail.stageEnteredAt) : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-muted/50 px-2.5 py-2">
                      <p className="text-[9.5px] font-bold text-muted-foreground uppercase">Created</p>
                      <p className="mt-0.5 font-semibold">{formatDate(detail.createdAt)}</p>
                    </div>
                  </div>
                  {isStale(detail) && (
                    <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-400">
                      <AlertTriangle className="size-3.5" /> Rotten — no touch in 7+ days
                    </p>
                  )}
                  {detail.nextFollowUpAt && detail.stage !== "WON" && detail.stage !== "LOST" && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-[11px] font-semibold text-sky-400">
                      <CalendarClock className="size-3.5" />
                      Next follow-up {new Date(detail.nextFollowUpAt).getTime() < Date.now() ? "overdue — " : ""}{formatDate(detail.nextFollowUpAt)}
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-border/60 p-4">
                  <h4 className="mb-3 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground uppercase">
                    <Pencil className="size-3.5" /> Details
                  </h4>
                  <div className="flex flex-col gap-3">
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
                          onChange={(e) => patchLead({ categoryId: e.target.value || undefined }, e.target.value ? `Category → ${categories.find((c) => c.id === e.target.value)?.name ?? ""}` : "Category cleared")}
                          className="flex-1"
                        >
                          <option value="">None</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                        <button
                          onClick={() => setCatOpen(true)}
                          className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-2.5 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title="Manage categories"
                        >
                          <Tag className="size-3.5" /> New
                        </button>
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
                    <EditField label="Website">
                      <Input
                        defaultValue={detail.website ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.website ?? "")) patchLead({ website: v || undefined }, "Website updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Social / page link">
                      <Input
                        defaultValue={detail.pageLink ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.pageLink ?? "")) patchLead({ pageLink: v || undefined }, "Page link updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Priority">
                      <Select value={detail.priority} onChange={(e) => patchLead({ priority: e.target.value }, `Priority → ${e.target.value}`)}>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{label(p)}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Owner">
                      <Select value={detail.assignedTo?.id ?? ""} onChange={(e) => patchLead({ assignedToId: e.target.value || undefined })}>
                        <option value="">Unassigned</option>
                        {(users ?? []).map((u: UserLite) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Stage">
                      <Select value={detail.stage} onChange={(e) => stageChanged(detail, e.target.value)}>
                        {STAGES.map((s) => (
                          <option key={s} value={s}>{label(s)}</option>
                        ))}
                      </Select>
                    </EditField>
                    <EditField label="Next follow-up">
                      <Input
                        type="datetime-local"
                        value={detail.nextFollowUpAt?.slice(0, 16) ?? ""}
                        onChange={(e) => patchLead({ nextFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null }, "Follow-up updated")}
                      />
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
                    <EditField label="Email">
                      <Input
                        defaultValue={detail.contactEmail ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.contactEmail ?? "")) patchLead({ contactEmail: v || undefined }, "Email updated");
                        }}
                      />
                    </EditField>
                    <EditField label="Phone">
                      <Input
                        defaultValue={detail.contactPhone ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (detail.contactPhone ?? "")) patchLead({ contactPhone: v || undefined }, "Phone updated");
                        }}
                      />
                    </EditField>
                  </div>
                </section>

                {detail.lostReason && (
                  <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                    <h4 className="mb-1 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wide text-rose-400 uppercase">
                      <AlertTriangle className="size-3.5" /> Lost — {label(detail.lostReason.reasonCategory)}
                    </h4>
                    {detail.lostReason.notes && <p className="text-[11.5px] text-muted-foreground">{detail.lostReason.notes}</p>}
                  </section>
                )}
              </div>
            </div>

            {/* footer actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {detail.stage !== "WON" && detail.stage !== "LOST" && (
                  <Btn variant="primary" onClick={() => setConvertLead(detail)}>
                    <Building2 className="size-3.5" /> Convert
                  </Btn>
                )}
                {detail.stage !== "WON" && detail.stage !== "LOST" && (
                  <Btn variant="ghost" onClick={() => setLostLead(detail)}>
                    <X className="size-3.5" /> Mark lost
                  </Btn>
                )}
                {(detail.stage === "WON" || detail.stage === "LOST") && (
                  <Btn variant="ghost" onClick={() => apiFetch(`/pulse/leads/${detail.id}/reopen`, { method: "POST" }).then(() => { notify("Lead reopened"); reload(); })}>
                    <RefreshCw className="size-3.5" /> Reopen
                  </Btn>
                )}
                <Btn variant="ghost" onClick={() => setMeetingOpen(true)}>
                  <Video className="size-3.5" /> Schedule meeting
                </Btn>
                <Btn variant="ghost" onClick={() => setProposalModal(true)}>
                  <FileText className="size-3.5" /> New proposal
                </Btn>
              </div>
              <div className="flex items-center gap-2">
                <Btn variant="ghost" onClick={() => setEditLead(detail)}>
                  <Pencil className="size-3.5" /> Edit
                </Btn>
                <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteLead(detail)}>
                  <Trash2 className="size-3.5" />
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── modals ─────────────────────────────────────────────────────── */}
      <LeadFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users ?? []}
        categories={categories}
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
      <MeetingModal open={meetingOpen} onClose={() => setMeetingOpen(false)} users={users ?? []} employees={employees ?? []} onSaved={(msg?: string) => { reload(); notify(msg ?? "Meeting scheduled"); }} />
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
            className="flex flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
          >
            <Upload className="size-5" />
            {uploading ? "Uploading…" : proposalUrl ? "Uploaded — file attached" : "Upload proposal file (PDF)"}
          </button>
          {proposalUrl && (
            <p className="truncate rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-400">
              ✓ {proposalUrl}
            </p>
          )}
          <Field label="Portal link" hint="Client-facing proposal URL">
            <Input value={proposalPortal} onChange={(e) => setProposalPortal(e.target.value)} placeholder="https://portal.zoolyum.com/p/…" />
          </Field>
          <FormActions
            busy={false}
            cancel={() => {
              setProposalModal(false);
              setProposalUrl("");
              setProposalPortal("");
            }}
            submitLabel="Add proposal"
          />
        </form>
      </Modal>

      {/* dup warning */}
      <Modal open={!!dupWarn} onClose={() => setDupWarn(null)} title="Possible duplicate">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          নিম্নোক্ত সক্রিয় lead-এর সাথে contact মিলে গেছে:
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {dupWarn?.map((w) => (
            <li key={w.name} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-400">
              ⚠ {w.name}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <button onClick={() => setDupWarn(null)} className="rounded-xl bg-brand-gradient px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-primary/30">
            Understood
          </button>
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal open={!!deleteLead} onClose={() => setDeleteLead(null)} title="Delete lead?">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {deleteLead?.name} চিরতরে মুছে যাবে — activities, proposals, meetings সহ। এটা undo করা যাবে না।
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteLead(null)} className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button onClick={deleteLeadFn} className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-rose-500/30 transition-all hover:scale-[1.02]">
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}