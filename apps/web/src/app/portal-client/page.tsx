"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowRightCircle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  Inbox,
  Layers,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageSquare,
  Phone,
  ReceiptText,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { formatBDT, formatDate, formatNumber, timeAgo } from "@/lib/format";
import { buildInvoicePdf, buildInvoicePdfAsync, buildReceiptPdf, resolveBrandingImages } from "@/lib/invoice-pdf";
import { buildPortalReportPdf } from "@/lib/portal-report-pdf";
import { invoiceTotals, numberToWords, paymentSerial } from "@/lib/invoice-utils";
import { AdsTrendChart } from "@/components/portal-charts";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { Avatar, CardShell, cn, EmptyState, PageHeader, SkeletonBlock, StatCard, StatusBadge } from "@/components/shared";
import { Field, Input, Modal } from "@/components/ui";

type Tab = "dashboard" | "work" | "performance" | "projects" | "invoices" | "messages";
type Me = { id: string; name: string; email: string; clientId: string; clientName: string; modules?: string[] };
type Milestone = { id: string; name: string; dueDate: string; status: string };
type FileItem = { id: string; name: string; fileName: string; fileUrl: string; uploadedAt: string; approvalStatus: string };
type TeamMember = { id: string; name: string; email: string | null; phone: string | null; role: string };
type DashProject = {
  id: string;
  name: string;
  status: string;
  billingType: string;
  progress: number;
  healthStatus?: string;
  taskCount?: number;
  tasksDone?: number;
  nextMilestone: { name: string; dueDate: string } | null;
};
type DashInvoice = { id: string; invoiceNumber: string; amount: number; paid: number; status: string; issueDate: string; dueDate: string };
type ProjectBilling = {
  projectId: string;
  projectName: string;
  status: string;
  billingType: string;
  contractValue: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  monthlyRate: number;
  monthlyDue: number;
  nextBillingDate: string | null;
};
type WeekSummary = {
  completed: number;
  inProgress: number;
  inReview: number;
  blocked: number;
  dueSoon: number;
  overdue: number;
};
type LatestUpdate = {
  id: string;
  title: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  sentAt: string | null;
};
type DashboardAds =
  | { available: false }
  | {
      available: true;
      monthSpend: number;
      monthConversions: number;
      monthConversionValue: number;
      lastSyncedAt: string | null;
      connectedAccounts: number;
    };
type Dashboard = {
  clientName: string;
  contactName?: string;
  activeProjectCount: number;
  projectCount?: number;
  pendingInvoiceCount: number;
  pendingInvoiceValue: number;
  billingSummary: { totalInvoiced: number; totalCollected: number; totalOutstanding: number; overdueAmount?: number; totalMonthlyDue?: number; byProject?: ProjectBilling[] };
  taskStats: { total: number; done: number; inProgress: number; todo: number; review?: number; blocked?: number };
  team: TeamMember[];
  nextMilestone: { name: string; dueDate: string; projectName: string } | null;
  projects: DashProject[];
  invoices: DashInvoice[];
  thisWeek?: WeekSummary;
  latestUpdate?: LatestUpdate | null;
  ads?: DashboardAds;
};
type WorkTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
  assignee: { name: string; role: string } | null;
  deliverable: { id: string; title: string } | null;
};
type WorkData = {
  items: WorkTask[];
  total: number;
  page: number;
  pageSize: number;
  stats: { todo: number; inProgress: number; review: number; done: number; blocked: number };
};
type AdsMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  roas: number;
  cpl: number;
};
type AdsSummary =
  | { available: false; reason?: string }
  | {
      available: true;
      hasData: boolean;
      range: { from: string; to: string };
      lastSyncedAt: string | null;
      campaignsRunning: number;
      metrics: AdsMetrics;
      deltas: Record<keyof AdsMetrics, number | null>;
      previous: { spend: number; conversions: number; conversionValue: number };
      platforms: {
        provider: string;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        conversionValue: number;
        ctr: number;
        cpc: number;
        roas: number;
      }[];
    };
type AdsTrendPoint = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number;
  roas: number;
};
type AdsCampaign = {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  provider: string;
  budget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  budgetUsedPct: number | null;
};
type PortalTask = { id: string; title: string; status: string; priority: string; dueDate: string | null; assignedTo: { id: string; name: string } | null };
type PortalReport = {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  completed: any[];
  pending: any[];
  note?: string | null;
  billing?: { invoiced?: number; collected?: number; outstanding?: number } | null;
  sentAt?: string | null;
};
type Project = {
  id: string;
  name: string;
  description?: string;
  status: string;
  progress: number;
  healthStatus: string;
  billingType: string;
  startDate: string;
  targetEndDate: string;
  budgetAmount: string | number | null;
  spentAmount: string | number | null;
  milestones: Milestone[];
  files: FileItem[];
  tasks: PortalTask[];
  updates?: PortalReport[];
  assignedPm: { id: string; name: string; email: string; employee: { phone: string | null } | null } | null;
  client: { accountOwner: { id: string; name: string; email: string; employee: { phone: string | null } | null } | null } | null;
  _count: { tasks: number; comments: number };
};
type InvoiceLine = { id: string; description: string; quantity: number; unitPrice: number; amount: number };
type InvoicePayment = { id: string; amount: number; paymentMethod: string; referenceId: string | null; receiptNo: string; serial?: number; paymentDate: string };
type InvoiceInstallment = { sequence: number; amount: number; paidAmount: number; dueDate: string; status: string };
type Invoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  amount: number;
  paid: number;
  balance: number;
  currency: string;
  taxApplicable: boolean;
  taxRate: number;
  discountRate: number;
  shippingFee: number;
  templateStyle: string;
  terms: string | null;
  notes: string | null;
  project: { id: string; name: string } | null;
  client: { companyName: string; contacts: { name: string; email: string | null; phone: string | null; roleTitle: string | null }[] };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  installments: InvoiceInstallment[];
};
type InvoiceSummary = { totalInvoiced: number; totalCollected: number; totalOutstanding: number; overdueAmount?: number; totalMonthlyDue?: number };
type ActivityItem = { id: string; action: string; relatedEntityType: string | null; relatedEntityId: string | null; timestamp: string };
type Message = {
  id: string;
  content: string;
  createdAt: string;
  threadKey: string;
  parentId: string | null;
  attachmentUrl: string | null;
  projectId: string | null;
  /** Null on the client-level "general" thread. */
  project: { id: string; name: string } | null;
  authorName: string;
  authorType: "client" | "agency";
  author: { id: string; name: string } | null;
  portalUser: { clientContact: { name: string } } | null;
};
type Thread = {
  threadKey: string;
  title: string;
  type: "general" | "project";
  messageCount: number;
  lastMessageAt: string | null;
  unread: boolean;
};

const getPortalToken = () =>
  typeof window !== "undefined" ? localStorage.getItem("zoolyum-portal-token") : null;

const setPortalToken = (token: string | null) => {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("zoolyum-portal-token", token);
  else localStorage.removeItem("zoolyum-portal-token");
};

async function pfetch(path: string, options: RequestInit = {}) {
  const token = getPortalToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      // Portal data changes whenever the agency issues an invoice or sends a
      // report; never let the browser replay a stale 304 body.
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // API restarting / offline — not an auth failure, so keep the session.
    throw Object.assign(new Error("Cannot reach the server. Please retry."), { status: 0 });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw Object.assign(new Error(body?.message ?? `Request failed: ${res.status}`), { status: res.status });
  }
  return res.json();
}

const PAYMENT_LABELS: Record<string, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
};

const label = (value: string | null | undefined) => {
  if (!value) return "—";
  if (PAYMENT_LABELS[value]) return PAYMENT_LABELS[value];
  return String(value)
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const BILLING_LABELS: Record<string, string> = {
  ONE_TIME: "One-time",
  RECURRING: "Monthly recurring",
};

function BillingBadge({ billingType }: { billingType: string }) {
  const recurring = billingType === "RECURRING";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide",
        recurring
          ? "bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20 dark:text-sky-300"
          : "bg-primary/10 text-primary ring-1 ring-primary/20 dark:text-primary"
      )}
    >
      {recurring ? <RefreshCw className="size-3" /> : <Zap className="size-3" />}
      {BILLING_LABELS[billingType] ?? label(billingType)}
    </span>
  );
}

function BillingProjectCard({ row }: { row: ProjectBilling }) {
  const recurring = row.billingType === "RECURRING";
  const base = recurring ? row.monthlyRate : row.contractValue || row.totalInvoiced;
  const paidPct = base > 0 ? Math.min(100, Math.round((row.totalPaid / base) * 100)) : 0;
  return (
    <CardShell className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{row.projectName}</p>
          <div className="mt-1"><BillingBadge billingType={row.billingType} /></div>
        </div>
        <StatusBadge status={row.status} />
      </div>
      {recurring ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/40 px-2.5 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Monthly fee</p>
              <p className="mt-0.5 text-[13px] font-heading font-bold tabular-nums">{formatBDT(row.monthlyRate)}</p>
            </div>
            <div className="rounded-xl bg-primary/5 px-2.5 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-primary">Due this month</p>
              <p className="mt-0.5 text-[13px] font-heading font-bold tabular-nums text-primary">{formatBDT(row.monthlyDue)}</p>
            </div>
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            {row.nextBillingDate ? `Next billing ${formatDate(row.nextBillingDate)}` : "Monthly retainer"}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Paid</span>
            <span className="font-semibold text-foreground">{formatBDT(row.totalPaid)} / {formatBDT(base)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Balance due</span>
            <span className={cn("font-bold tabular-nums", row.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
              {formatBDT(row.outstanding)}
            </span>
          </div>
        </>
      )}
    </CardShell>
  );
}

/** "+4.3%" / "−2.1%" / "—" for a period-over-period delta. */
const deltaText = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** Unit costs (CPC/CPM/CPA) need decimals; larger sums keep the lakh style. */
const money = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.abs(n) >= 1000 ? formatBDT(n) : `৳${n.toFixed(2)}`;
};

/** Unit costs (CPC/CPM/CPA) need decimals; larger sums keep the lakh style. */
const formatMoney = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.abs(n) >= 1000 ? formatBDT(n) : `৳${n.toFixed(2)}`;
};

/** Compact secondary metric tile used on the Performance tab. */
function MiniMetric({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-[15px] font-bold tabular-nums">{value}</p>
      {delta !== undefined && (
        <p
          className={cn(
            "mt-0.5 text-[10.5px] font-semibold tabular-nums",
            delta == null
              ? "text-muted-foreground"
              : delta > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : delta < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground"
          )}
        >
          {deltaText(delta)} vs prev.
        </p>
      )}
    </div>
  );
}

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { value: "work", label: "Work", icon: <ClipboardList className="size-4" /> },
  { value: "performance", label: "Performance", icon: <TrendingUp className="size-4" /> },
  { value: "projects", label: "Projects", icon: <FolderOpen className="size-4" /> },
  { value: "invoices", label: "Invoices", icon: <ReceiptText className="size-4" /> },
  { value: "messages", label: "Messages", icon: <MessageSquare className="size-4" /> },
];

const PROJ_SKEL = [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-44" />);
const DASH_STAT_SKEL = [0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-28" />);
const DASH_CARD_SKEL = [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-36" />);
const MSG_SKEL = [0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-16" />);

export default function PortalClientPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading portal…
        </div>
      }
    >
      <PortalClientWorkspace />
    </Suspense>
  );
}

function PortalClientWorkspace() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);

  const [work, setWork] = useState<WorkData | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const [workStatus, setWorkStatus] = useState<string>("ALL");

  const [ads, setAds] = useState<AdsSummary | null>(null);
  const [adsTrend, setAdsTrend] = useState<AdsTrendPoint[] | null>(null);
  const [adsCampaigns, setAdsCampaigns] = useState<AdsCampaign[] | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [adsRange, setAdsRange] = useState<7 | 30 | 90>(30);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [invoiceByProject, setInvoiceByProject] = useState<ProjectBilling[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);
  const [projFilter, setProjFilter] = useState<"ALL" | "ACTIVE" | "DONE">("ALL");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [activeThread, setActiveThread] = useState<string>("general");
  // Notification deep link from the agency inbox: /portal-client?thread=<key>
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");
  useEffect(() => {
    if (!threadParam || !me) return;
    setActiveThread(threadParam);
    setTab("messages");
  }, [threadParam, me]);
  const [unread, setUnread] = useState(0);
  const [tg, setTg] = useState<{
    enabled: boolean;
    linked: boolean;
    linkedAt: string | null;
    pendingCode: string | null;
    botName: string | null;
  } | null>(null);
  const [tgBusy, setTgBusy] = useState(false);

  const [approvalFile, setApprovalFile] = useState<FileItem | null>(null);
  const [decision, setDecision] = useState<"APPROVED" | "REVISION_REQUESTED">("APPROVED");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const o: any = await pfetch("/portal-client/overview");
      setDash({
        clientName: o.clientName,
        contactName: o.contactName,
        activeProjectCount: o.activeProjectCount ?? 0,
        projectCount: o.projectCount ?? 0,
        pendingInvoiceCount: o.billing?.pendingInvoiceCount ?? 0,
        pendingInvoiceValue: o.billing?.pendingInvoiceValue ?? 0,
        billingSummary: {
          totalInvoiced: o.billing?.totalInvoiced ?? 0,
          totalCollected: o.billing?.totalCollected ?? 0,
          totalOutstanding: o.billing?.totalOutstanding ?? 0,
          overdueAmount: o.billing?.overdueAmount ?? 0,
          totalMonthlyDue: o.billing?.totalMonthlyDue ?? 0,
          byProject: o.billing?.byProject ?? [],
        },
        taskStats: o.taskStats ?? { total: 0, done: 0, inProgress: 0, todo: 0 },
        team: o.team ?? [],
        nextMilestone: o.nextMilestone ?? null,
        projects: o.projects ?? [],
        invoices: o.recentInvoices ?? [],
        thisWeek: o.thisWeek,
        latestUpdate: o.latestUpdate ?? null,
        ads: o.ads,
      });
    } catch (err: any) {
      setDashError(err?.message ?? "Failed to load dashboard");
    } finally {
      setDashLoading(false);
    }
  }, []);

  const loadWork = useCallback(async (status?: string) => {
    setWorkLoading(true);
    setWorkError(null);
    try {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (status && status !== "ALL") qs.set("status", status);
      setWork(await pfetch(`/portal-client/tasks?${qs.toString()}`));
    } catch (err: any) {
      setWorkError(err?.message ?? "Failed to load tasks");
    } finally {
      setWorkLoading(false);
    }
  }, []);

  const loadAds = useCallback(async (days: number) => {
    setAdsLoading(true);
    setAdsError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - (days - 1) * 86400000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const qs = `from=${iso(from)}&to=${iso(to)}`;
      const [summary, trend, campaigns] = await Promise.all([
        pfetch(`/portal-client/ads/summary?${qs}`),
        pfetch(`/portal-client/ads/trend?${qs}`),
        pfetch(`/portal-client/ads/campaigns?${qs}`),
      ]);
      setAds(summary);
      setAdsTrend(trend?.available ? trend.series : []);
      setAdsCampaigns(campaigns?.available ? campaigns.items : []);
    } catch (err: any) {
      setAdsError(err?.message ?? "Failed to load advertising performance");
    } finally {
      setAdsLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      setProjects(await pfetch("/portal-client/projects"));
    } catch (err: any) {
      setProjectsError(err?.message ?? "Failed to load projects");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const data = await pfetch("/portal-client/invoices");
      setInvoices(data.invoices);
      setInvoiceSummary(data.summary);
      setInvoiceByProject(data.byProject ?? []);
    } catch (err: any) {
      setInvoicesError(err?.message ?? "Failed to load invoices");
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await pfetch("/portal-client/activity"));
    } catch {
      setActivity(null);
    }
  }, []);

  const loadMessages = useCallback(async (threadKey?: string) => {
    const key = threadKey ?? "general";
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      setMessages(await pfetch(`/portal-client/threads/${encodeURIComponent(key)}/messages`));
      // Opening a thread clears its unread badge.
      await pfetch(`/portal-client/threads/${encodeURIComponent(key)}/read`, { method: "POST" }).catch(() => null);
      await pfetch("/portal-client/notifications/read", { method: "POST" }).catch(() => null);
      setUnread(0);
      setThreads((prev) => prev?.map((t) => (t.threadKey === key ? { ...t, unread: false } : t)) ?? prev);
    } catch (err: any) {
      setMessagesError(err?.message ?? "Failed to load messages");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const list: Thread[] = await pfetch("/portal-client/threads");
      setThreads(list);
      return list;
    } catch {
      setThreads([]);
      return [];
    }
  }, []);

  /** Cheap poll for the unread badge on the Messages tab. */
  const loadUnread = useCallback(async () => {
    try {
      const res = await pfetch("/portal-client/notifications?limit=1");
      setUnread(Number(res?.unread ?? 0));
    } catch {
      /* badge is non-critical */
    }
  }, []);

  const loadTelegram = useCallback(async () => {
    try {
      setTg(await pfetch("/portal-client/telegram"));
    } catch {
      setTg(null);
    }
  }, []);

  const connectTelegram = async () => {
    if (tgBusy) return;
    setTgBusy(true);
    try {
      const link = await pfetch("/portal-client/telegram/link", { method: "POST" });
      await loadTelegram();
      if (link?.deepLink) window.open(link.deepLink, "_blank", "noopener");
    } catch {
      /* surfaced by the card state */
    } finally {
      setTgBusy(false);
    }
  };

  const disconnectTelegram = async () => {
    if (tgBusy) return;
    setTgBusy(true);
    try {
      await pfetch("/portal-client/telegram/link", { method: "DELETE" });
      await loadTelegram();
    } finally {
      setTgBusy(false);
    }
  };

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace("/portal-login");
      return;
    }
    setReady(true);
    loadDashboard();
    loadActivity();
    loadUnread();
    loadTelegram();
    pfetch("/portal-client/me")
      .then((m: Me) => setMe(m))
      .catch((err: any) => {
        // A network blip or 5xx must not sign the client out — only 401/403.
        if (err?.status === 401 || err?.status === 403) {
          setPortalToken(null);
          router.replace("/portal-login");
        }
      });
  }, [router, loadDashboard, loadActivity, loadUnread, loadTelegram]);

  // Refresh the unread badge periodically while the portal is open.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => loadUnread(), 60000);
    return () => clearInterval(id);
  }, [ready, loadUnread]);

  useEffect(() => {
    if (tab === "projects" && projects === null) loadProjects();
    if (tab === "work" && work === null) loadWork(workStatus);
    if (tab === "performance" && ads === null) loadAds(adsRange);
    if (tab === "invoices" && invoices === null) loadInvoices();
    if (tab === "messages" && messages === null) {
      loadThreads();
      loadMessages(activeThread);
    }
  }, [tab, projects, work, ads, invoices, messages, threads, workStatus, adsRange, activeThread, loadProjects, loadWork, loadAds, loadInvoices, loadMessages, loadThreads]);

  // (The old effect that copied the list row over `openProject` was removed:
  // the list payload has no reports/files and was wiping the freshly fetched
  // detail — which is exactly where the downloadable reports come from.)

  const signOut = () => {
    setPortalToken(null);
    router.push("/portal-login");
  };

  // A contact may be restricted to a subset of tabs (PortalContactAccess.modules).
  const visibleTabs = useMemo(() => {
    const modules = me?.modules;
    if (!modules || modules.length === 0) return TABS;
    const allowed = new Set(modules);
    return TABS.filter((t) => {
      if (t.value === "dashboard") return true;
      if (t.value === "work" || t.value === "projects") return allowed.has("WORK");
      if (t.value === "performance") return allowed.has("PERFORMANCE");
      if (t.value === "invoices") return allowed.has("BILLING");
      if (t.value === "messages") return allowed.has("MESSAGES");
      return true;
    });
  }, [me]);

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    setMessagesError(null);
    try {
      await pfetch(`/portal-client/threads/${encodeURIComponent(activeThread)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      setReplyText("");
      await loadMessages(activeThread);
      await loadThreads();
    } catch (err: any) {
      setMessagesError(err?.message ?? "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const submitApproval = async () => {
    if (!approvalFile || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      await pfetch(`/portal-client/files/${approvalFile.id}/approval`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...(decision === "REVISION_REQUESTED" && revisionNotes.trim()
            ? { revisionNotes: revisionNotes.trim() }
            : {}),
        }),
      });
      setApprovalFile(null);
      setRevisionNotes("");
      setDecision("APPROVED");
      await loadProjects();
    } catch (err: any) {
      setApprovalError(err?.message ?? "Approval failed");
    } finally {
      setApproving(false);
    }
  };

  const doInvoicePdf = async () => {
    if (!openInvoice || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      let pdfBranding: any = undefined;
      try {
        const b = await pfetch("/portal-client/branding").catch(() => null);
        if (b) {
          pdfBranding = await resolveBrandingImages({
            primaryColor: b.primaryColor ?? undefined,
            logoDarkUrl: b.logoDarkUrl ?? undefined,
            appName: b.appName ?? undefined,
            tagline: b.tagline ?? undefined,
            email: b.email ?? undefined,
            phone: b.phone ?? undefined,
            address: b.address ?? undefined,
            city: b.city ?? undefined,
            country: b.country ?? undefined,
            taxId: b.taxId ?? undefined,
            website: b.website ?? undefined,
            authorizedSignerName: b.authorizedSignerName ?? undefined,
            authorizedSignerTitle: b.authorizedSignerTitle ?? undefined,
            signatureImageUrl: b.signatureImageUrl ?? undefined,
            defaultPaymentDetails: b.defaultPaymentDetails ?? undefined,
            defaultTerms: b.defaultTerms ?? undefined,
            defaultNotes: b.defaultNotes ?? undefined,
          });
        }
      } catch {
        pdfBranding = undefined;
      }
      const payload = {
        invoiceNumber: openInvoice.invoiceNumber,
        issueDate: openInvoice.issueDate,
        dueDate: openInvoice.dueDate,
        status: openInvoice.status,
        currency: openInvoice.currency,
        taxApplicable: openInvoice.taxApplicable,
        taxRate: openInvoice.taxRate,
        discountRate: openInvoice.discountRate,
        shippingFee: openInvoice.shippingFee,
        templateStyle: openInvoice.templateStyle,
        terms: openInvoice.terms,
        notes: openInvoice.notes,
        client: openInvoice.client,
        project: openInvoice.project,
        lineItems: openInvoice.lines,
        payments: openInvoice.payments,
      };
      const doc = await buildInvoicePdfAsync(payload, pdfBranding);
      doc.save(`${openInvoice.invoiceNumber}.pdf`);
    } catch {
      setPdfError("Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const doReceiptPdf = async (p: InvoicePayment, idx: number) => {
    if (!openInvoice || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      let pdfBranding: any = undefined;
      try {
        const b = await pfetch("/portal-client/branding").catch(() => null);
        if (b) pdfBranding = await resolveBrandingImages({ ...b });
      } catch {
        pdfBranding = undefined;
      }
      const { ensurePdfFonts } = await import("@/lib/invoice-pdf");
      await ensurePdfFonts();
      const payload = {
        invoiceNumber: openInvoice.invoiceNumber,
        issueDate: openInvoice.issueDate,
        dueDate: openInvoice.dueDate,
        status: openInvoice.status,
        currency: openInvoice.currency,
        taxApplicable: openInvoice.taxApplicable,
        taxRate: openInvoice.taxRate,
        discountRate: openInvoice.discountRate,
        shippingFee: openInvoice.shippingFee,
        templateStyle: openInvoice.templateStyle,
        notes: openInvoice.notes,
        client: openInvoice.client,
        project: openInvoice.project,
        lineItems: openInvoice.lines,
        payments: openInvoice.payments,
      };
      const doc = buildReceiptPdf(payload, { ...p, index: (p.serial ?? paymentSerial(openInvoice.payments, p.id) ?? 1) - 1 }, pdfBranding);
      doc.save(`${p.receiptNo}.pdf`);
    } catch {
      setPdfError("Could not generate the receipt. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  /** Download a project report / update as a branded A4 PDF. */
  const downloadReport = async (r: { id: string; title: string }, projectName?: string) => {
    setReportBusy(r.id);
    setReportError(null);
    try {
      const full: any = await pfetch(`/portal-client/updates/${r.id}`);
      let pdfBranding: any = undefined;
      try {
        const b = await pfetch("/portal-client/branding").catch(() => null);
        if (b) pdfBranding = await resolveBrandingImages({ ...b });
      } catch {
        pdfBranding = undefined;
      }
      const doc = await buildPortalReportPdf(
        {
          id: full.id,
          title: full.title,
          projectName: full.project?.name ?? projectName ?? openProject?.name ?? "",
          clientName: me?.clientName ?? dash?.clientName ?? null,
          periodStart: full.periodStart,
          periodEnd: full.periodEnd,
          completed: Array.isArray(full.completed) ? full.completed : [],
          pending: Array.isArray(full.pending) ? full.pending : [],
          note: full.note,
          billing: full.billing,
          sentAt: full.sentAt,
        },
        pdfBranding
      );
      const safe = String(full.title ?? "project-report")
        .replace(/[^\w\-]+/g, "-")
        .replace(/^-|-$/g, "");
      doc.save(`${safe || "project-report"}.pdf`);
    } catch (e: any) {
      setReportError(e?.message ?? "Could not download this report. Please try again.");
    } finally {
      setReportBusy(null);
    }
  };

  /**
   * Files are served through an authenticated portal route, so the browser has
   * to fetch them with the token and hand back a blob instead of following a
   * plain <a href>.
   */
  const downloadPortalFile = async (fileId: string, filename: string) => {
    const token = getPortalToken();
    try {
      const res = await fetch(`${API_URL}/portal-client/files/${fileId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setPdfError("Could not download the file. Please try again.");
    }
  };

  const openInvoiceById = async (id: string) => {    try {
      let full = invoices?.find((x) => x.id === id) ?? null;
      if (!full) {
        const data = await pfetch("/portal-client/invoices");
        setInvoices(data.invoices);
        setInvoiceSummary(data.summary);
        setInvoiceByProject(data.byProject ?? []);
        full = data.invoices.find((x: Invoice) => x.id === id) ?? null;
      }
      if (full) setOpenInvoice(full);
      else setTab("invoices");
    } catch {
      setTab("invoices");
    }
  };

  /** Open a project from any list — always fetch the detail so reports/files load. */
  const openProjectById = async (id: string) => {
    try {
      const detail = await pfetch(`/portal-client/projects/${id}`);
      setOpenProject(detail);
    } catch {
      setTab("projects");
    }
  };

  // Messages arrive already ordered oldest→newest for the active thread.
  const threadMessages = messages ?? [];

  const retry = (kind: "dashboard" | "projects" | "invoices" | "messages") => {
    if (kind === "dashboard") loadDashboard();
    if (kind === "projects") loadProjects();
    if (kind === "invoices") loadInvoices();
    if (kind === "messages") loadMessages();
  };

  const ErrorCard = ({ message, kind }: { message: string; kind: "dashboard" | "projects" | "invoices" | "messages" }) => (
    <CardShell className="text-center">
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      <Btn variant="outline" className="mt-4" onClick={() => retry(kind)}>
        Retry
      </Btn>
    </CardShell>
  );

  const ProgressBar = ({ progress }: { progress: number }) => (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
    </div>
  );

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh">
        <SkeletonBlock className="h-24 w-64" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient">
              <Sparkles className="size-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-heading text-[13px] font-bold leading-tight">Zoolyum Client Portal</p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">{me?.clientName ?? "Loading…"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {me && <Avatar name={me.name} size="size-8" />}
            <Btn variant="outline" onClick={signOut} className="px-3 py-1.5 text-[12px]">
              <LogOut className="size-4" />
              Sign out
            </Btn>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="mb-6 inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          {visibleTabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all",
                tab === t.value
                  ? "bg-brand-gradient text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
              {t.value === "messages" && unread > 0 && (
                <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9.5px] font-bold leading-4 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "dashboard" && (
          <div>
            {dashLoading ? (
              <div>
                <SkeletonBlock className="h-10 w-72" />
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{DASH_STAT_SKEL}</div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{DASH_CARD_SKEL}</div>
              </div>
            ) : dashError ? (
              <ErrorCard message={dashError} kind="dashboard" />
            ) : (
              dash && (
                <>
                  <div className="mb-6">
                    <h1 className="font-heading text-2xl font-semibold tracking-tight">
                      Hello, {me?.name.split(" ")[0] ?? "there"}
                    </h1>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Welcome to your Zoolyum portal — {dash.clientName}.
                    </p>
                  </div>

                  {(() => {
                    const b = dash.billingSummary;
                    const paidPct = b.totalInvoiced > 0 ? Math.min(100, Math.round((b.totalCollected / b.totalInvoiced) * 100)) : 0;
                    const recurring = (b.byProject ?? []).filter((p) => p.billingType === "RECURRING");
                    return (
                      <div className="mb-6 grid gap-4 lg:grid-cols-[1.7fr_1fr]">
                        <CardShell className="relative overflow-hidden">
                          <div className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Billing overview</p>
                              <p className="mt-1 font-heading text-[26px] font-bold leading-none tabular-nums">
                                {formatBDT(b.totalOutstanding)}
                                <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">pending</span>
                              </p>
                              <p className="mt-1 text-[11.5px] text-muted-foreground">
                                {formatBDT(b.totalCollected)} paid of {formatBDT(b.totalInvoiced)} invoiced
                              </p>
                            </div>
                            <button
                              onClick={() => setTab("invoices")}
                              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-[11.5px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                            >
                              Invoices <ArrowRightCircle className="size-3.5" />
                            </button>
                          </div>
                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${paidPct}%` }} />
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-2">
                            <div className="rounded-xl border border-border/60 px-3 py-2">
                              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Paid</p>
                              <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatBDT(b.totalCollected)}</p>
                            </div>
                            <div className="rounded-xl border border-border/60 px-3 py-2">
                              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Pending</p>
                              <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatBDT(b.totalOutstanding)}</p>
                            </div>
                            <div className="rounded-xl border border-border/60 px-3 py-2">
                              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Overdue</p>
                              <p className={cn("mt-0.5 text-[14px] font-heading font-bold tabular-nums", (b.overdueAmount ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                                {formatBDT(b.overdueAmount ?? 0)}
                              </p>
                            </div>
                          </div>
                        </CardShell>

                        <CardShell className="flex flex-col justify-between">
                          <div>
                            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Due this month</p>
                            <p className="mt-1 font-heading text-[26px] font-bold leading-none tabular-nums text-primary">
                              {formatBDT(b.totalMonthlyDue ?? 0)}
                            </p>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                              {recurring.length > 0
                                ? `${recurring.length} monthly project${recurring.length > 1 ? "s" : ""}. Only the amount due this month is shown.`
                                : "No monthly projects — one-time billing is shown in full."}
                            </p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(b.byProject ?? []).slice(0, 3).map((p) => (
                              <span key={p.projectId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {p.projectName}
                              </span>
                            ))}
                          </div>
                        </CardShell>
                      </div>
                    );
                  })()}

                  {(dash.billingSummary.byProject?.length ?? 0) > 0 && (
                    <div className="mb-6">
                      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="font-heading text-[15px] font-semibold">Billing by project</p>
                          <p className="text-[11.5px] text-muted-foreground">
                            One-time projects show full billing · monthly projects show this month&apos;s due.
                          </p>
                        </div>
                        <button onClick={() => setTab("invoices")} className="text-[11.5px] font-semibold text-primary hover:underline">
                          View invoices →
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(dash.billingSummary.byProject ?? []).map((row) => {
                          const recurring = row.billingType === "RECURRING";
                          const base = recurring ? row.monthlyRate : row.contractValue || row.totalInvoiced;
                          const paidPct = base > 0 ? Math.min(100, Math.round((row.totalPaid / base) * 100)) : 0;
                          return (
                            <CardShell key={row.projectId} className="flex flex-col gap-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] font-semibold">{row.projectName}</p>
                                  <div className="mt-1"><BillingBadge billingType={row.billingType} /></div>
                                </div>
                                <StatusBadge status={row.status} />
                              </div>
                              {recurring ? (
                                <>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="rounded-xl bg-muted/40 px-2.5 py-2">
                                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Monthly fee</p>
                                      <p className="mt-0.5 text-[13px] font-heading font-bold tabular-nums">{formatBDT(row.monthlyRate)}</p>
                                    </div>
                                    <div className="rounded-xl bg-primary/5 px-2.5 py-2">
                                      <p className="text-[9px] font-bold uppercase tracking-wider text-primary">Due this month</p>
                                      <p className="mt-0.5 text-[13px] font-heading font-bold tabular-nums text-primary">{formatBDT(row.monthlyDue)}</p>
                                    </div>
                                  </div>
                                  <p className="text-[10.5px] text-muted-foreground">
                                    {row.nextBillingDate ? `Next billing ${formatDate(row.nextBillingDate)}` : "Monthly retainer"}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                    <span>Paid</span>
                                    <span className="font-semibold text-foreground">{formatBDT(row.totalPaid)} / {formatBDT(base)}</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                                  </div>
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-muted-foreground">Balance due</span>
                                    <span className={cn("font-bold tabular-nums", row.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                                      {formatBDT(row.outstanding)}
                                    </span>
                                  </div>
                                </>
                              )}
                            </CardShell>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Active Projects" value={dash.activeProjectCount} icon={<FolderOpen className="size-5" />} index={0} />
                    <StatCard label="Pending Invoices" value={dash.pendingInvoiceCount} icon={<Inbox className="size-5" />} index={1} />
                    <StatCard label="Paid to date" value={formatBDT(dash.billingSummary.totalCollected)} icon={<Wallet className="size-5" />} index={2} />
                    <StatCard
                      label="Next Milestone"
                      value={dash.nextMilestone ? formatDate(dash.nextMilestone.dueDate) : "—"}
                      sub={dash.nextMilestone ? `${dash.nextMilestone.name} · ${dash.nextMilestone.projectName}` : "No upcoming milestones"}
                      icon={<CalendarClock className="size-5" />}
                      index={3}
                    />
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-3">
                    <CardShell className="lg:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold">This week</p>
                        <button
                          onClick={() => setTab("work")}
                          className="text-[11.5px] font-semibold text-primary underline-offset-2 hover:underline dark:text-primary"
                        >
                          See all work →
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { label: "Completed", value: dash.thisWeek?.completed ?? 0, tone: "text-emerald-600 dark:text-emerald-400" },
                          { label: "In progress", value: dash.thisWeek?.inProgress ?? 0, tone: "text-sky-600 dark:text-sky-400" },
                          { label: "Due soon", value: dash.thisWeek?.dueSoon ?? 0, tone: "text-amber-600 dark:text-amber-400" },
                          { label: "Overdue", value: dash.thisWeek?.overdue ?? 0, tone: "text-rose-600 dark:text-rose-400" },
                        ].map((s) => (
                          <div key={s.label} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                            <p className={cn("font-heading text-xl font-bold tabular-nums", s.tone)}>{s.value}</p>
                            <p className="text-[11px] text-muted-foreground">{s.label}</p>
                          </div>
                        ))}
                      </div>
                      {dash.thisWeek && dash.thisWeek.blocked > 0 && (
                        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-600 dark:text-rose-300">
                          {dash.thisWeek.blocked} item{dash.thisWeek.blocked === 1 ? "" : "s"} blocked — your project manager is on it.
                        </p>
                      )}
                    </CardShell>

                    <CardShell>
                      <p className="text-[13px] font-semibold">Latest update</p>
                      {dash.latestUpdate ? (
                        <div className="mt-2">
                          <p className="text-[12px] font-semibold">{dash.latestUpdate.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {dash.latestUpdate.projectName} · {formatDate(dash.latestUpdate.periodEnd)}
                          </p>
                          {dash.latestUpdate.note && (
                            <p className="mt-2 line-clamp-4 text-[11.5px] leading-relaxed text-muted-foreground">
                              {dash.latestUpdate.note}
                            </p>
                          )}
                          <button
                            onClick={() => downloadReport(dash.latestUpdate!, dash.latestUpdate!.projectName)}
                            disabled={reportBusy === dash.latestUpdate.id}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                          >
                            <FileDown className="size-3.5" />
                            {reportBusy === dash.latestUpdate.id ? "Preparing…" : "Download PDF"}
                          </button>
                          {reportError && <p className="mt-1.5 text-[10.5px] text-rose-500">{reportError}</p>}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11.5px] text-muted-foreground">
                          No update shared yet — your project manager will post one soon.
                        </p>
                      )}
                    </CardShell>
                  </div>

                  {dash.ads?.available && (
                    <div className="mt-4">
                      <CardShell className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-[13px] font-semibold">Advertising this month</p>
                          <p className="text-[11px] text-muted-foreground">
                            {dash.ads.lastSyncedAt ? `Synced ${timeAgo(dash.ads.lastSyncedAt)}` : "Not synced yet"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-6">
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Spend</p>
                            <p className="font-heading text-[15px] font-bold tabular-nums">{formatBDT(dash.ads.monthSpend)}</p>
                          </div>
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Conversions</p>
                            <p className="font-heading text-[15px] font-bold tabular-nums">{formatNumber(dash.ads.monthConversions)}</p>
                          </div>
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">ROAS</p>
                            <p className="font-heading text-[15px] font-bold tabular-nums">
                              {dash.ads.monthSpend ? `${(dash.ads.monthConversionValue / dash.ads.monthSpend).toFixed(2)}x` : "—"}
                            </p>
                          </div>
                          <button
                            onClick={() => setTab("performance")}
                            className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline dark:text-primary"
                          >
                            View performance →
                          </button>
                        </div>
                      </CardShell>
                    </div>
                  )}

                  <div className="mt-8">
                    <PageHeader title="Your team" subtitle="The people managing your projects at Zoolyum." />
                    {dash.team.length === 0 ? (
                      <EmptyState title="No team assigned yet" hint="Your account manager will appear here once assigned." />
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {dash.team.map((m) => (
                          <CardShell key={`${m.role}-${m.id}`} className="flex items-center gap-3">
                            <Avatar name={m.name} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold">{m.name}</p>
                              <p className="text-[11px] text-muted-foreground">{m.role}</p>
                            </div>
                            {m.phone && (
                              <a
                                href={`tel:${m.phone}`}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300"
                                title={`Call ${m.name} · ${m.phone}`}
                              >
                                <Phone className="size-3.5" />
                              </a>
                            )}
                            {m.email && (
                              <a
                                href={`mailto:${m.email}`}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary dark:hover:text-primary"
                                title={`Email ${m.name}`}
                              >
                                <Mail className="size-3.5" />
                              </a>
                            )}
                          </CardShell>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-8">
                    <PageHeader title="Recent activity" subtitle="Your latest portal actions and updates." />
                    {!activity || activity.length === 0 ? (
                      <EmptyState title="No activity yet" hint="Logins, comments and approvals will appear here." />
                    ) : (
                      <CardShell>
                        <div className="flex flex-col divide-y divide-border/60">
                          {activity.slice(0, 8).map((a) => (
                            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                                {a.action === "LOGGED_IN" ? (
                                  <LogOut className="size-3.5 text-muted-foreground" />
                                ) : a.action === "APPROVED_DELIVERABLE" ? (
                                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                                ) : (
                                  <MessageSquare className="size-3.5 text-primary" />
                                )}
                              </div>
                              <p className="flex-1 text-[12.5px]">
                                {a.action === "LOGGED_IN" ? "You signed in to the portal" : a.action === "APPROVED_DELIVERABLE" ? "You reviewed a deliverable" : "You left a comment"}
                              </p>
                              <span className="text-[11px] text-muted-foreground">{timeAgo(a.timestamp)}</span>
                            </div>
                          ))}
                        </div>
                      </CardShell>
                    )}
                  </div>

                  <div className="mt-8">
                    <PageHeader
                      title="Projects"
                      subtitle="Live progress across your active projects."
                      actions={
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
                          <ClipboardList className="size-3.5" />
                          {dash.taskStats.total} visible tasks · {dash.taskStats.done} done
                        </span>
                      }
                    />
                    {dash.projects.length === 0 ? (
                      <EmptyState title="No projects yet" hint="Projects will appear here once your agency starts one." />
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {dash.projects.map((p) => {
                          const bill = (dash.billingSummary.byProject ?? []).find((b) => b.projectId === p.id);
                          return (
                            <div key={p.id} onClick={() => openProjectById(p.id)} className="cursor-pointer">
                              <CardShell className="h-full transition-all hover:border-primary/30">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[14px] font-semibold">{p.name}</p>
                                <StatusBadge status={p.status} />
                              </div>
                              <div className="mt-2"><BillingBadge billingType={p.billingType} /></div>
                              <div className="mt-3">
                                <ProgressBar progress={p.progress} />
                              </div>
                              <p className="mt-1.5 text-[11px] text-muted-foreground">{p.progress}% complete</p>
                              {bill && (
                                <p className="mt-2 text-[11px] font-medium">
                                  {bill.billingType === "RECURRING" ? (
                                    <span className="text-primary">Monthly due {formatBDT(bill.monthlyDue)}</span>
                                  ) : (
                                    <span className={bill.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                                      Due {formatBDT(bill.outstanding)}
                                    </span>
                                  )}
                                </p>
                              )}
                              <p className="mt-2 text-[11.5px] text-muted-foreground">
                                Next milestone:{" "}
                                {p.nextMilestone ? `${p.nextMilestone.name} · ${formatDate(p.nextMilestone.dueDate)}` : "—"}
                              </p>
                              </CardShell>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-8">
                    <PageHeader
                      title="Recent invoices"
                      subtitle="Your latest invoices at a glance. Click a row to view and download."
                      actions={
                        <button onClick={() => setTab("invoices")} className="text-[12.5px] font-semibold text-primary underline-offset-2 hover:underline dark:text-primary">
                          View all →
                        </button>
                      }
                    />
                    {dash.invoices.length === 0 ? (
                      <EmptyState title="No invoices yet" hint="Invoices will appear here once issued." />
                    ) : (
                      <TableShell>
                        <table className="w-full">
                          <THead>
                            <Th>Invoice</Th>
                            <Th>Amount</Th>
                            <Th>Paid</Th>
                            <Th>Status</Th>
                          </THead>
                          <tbody>
                            {dash.invoices.slice(0, 5).map((inv, i) => (
                              <Tr
                                key={inv.id}
                                index={i}
                                onClick={() => openInvoiceById(inv.id)}
                                className="cursor-pointer transition-colors hover:bg-muted/40"
                              >
                                <Td>
                                  <p className="font-semibold">{inv.invoiceNumber}</p>
                                  <p className="text-[11px] text-muted-foreground">Due {formatDate(inv.dueDate)}</p>
                                </Td>
                                <Td className="tabular-nums">{formatBDT(inv.amount)}</Td>
                                <Td className="tabular-nums">{formatBDT(inv.paid)}</Td>
                                <Td>
                                  <StatusBadge status={inv.status} />
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </table>
                      </TableShell>
                    )}
                  </div>
                </>
              )
            )}
          </div>
        )}

        {tab === "work" && (
          <div>
            <PageHeader
              title="Work"
              subtitle="Every task your agency has shared with you, with live status."
              actions={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
                  <ClipboardList className="size-3.5" />
                  {work?.total ?? 0} shared tasks
                </span>
              }
            />

            <div className="mb-4 flex flex-wrap gap-1.5">
              {[
                { key: "ALL", label: "All", count: work?.total ?? 0 },
                { key: "TODO", label: "To do", count: work?.stats.todo ?? 0 },
                { key: "IN_PROGRESS", label: "In progress", count: work?.stats.inProgress ?? 0 },
                { key: "REVIEW", label: "In review", count: work?.stats.review ?? 0 },
                { key: "DONE", label: "Done", count: work?.stats.done ?? 0 },
                { key: "BLOCKED", label: "Blocked", count: work?.stats.blocked ?? 0 },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setWorkStatus(f.key);
                    setWork(null);
                    loadWork(f.key);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors",
                    workStatus === f.key
                      ? "border-primary/40 bg-primary/10 text-primary dark:text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                  <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>

            {workLoading ? (
              <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-14" />)}</div>
            ) : workError ? (
              <ErrorCard message={workError} kind="projects" />
            ) : !work || work.items.length === 0 ? (
              <EmptyState
                title="No tasks shared yet"
                hint="Your agency controls what appears here. Ask your project manager to share task progress with you."
              />
            ) : (
              <TableShell>
                <table className="w-full">
                  <THead>
                    <Th>Task</Th>
                    <Th>Project</Th>
                    <Th>Status</Th>
                    <Th>Due</Th>
                    <Th>Owner</Th>
                  </THead>
                  <tbody>
                    {work.items.map((t, i) => (
                      <Tr key={t.id} index={i}>
                        <Td>
                          <p className="font-medium">{t.title}</p>
                          {t.deliverable && (
                            <p className="text-[11px] text-muted-foreground">Deliverable: {t.deliverable.title}</p>
                          )}
                        </Td>
                        <Td className="text-muted-foreground">{t.project?.name ?? "—"}</Td>
                        <Td>
                          <StatusBadge status={t.status} />
                        </Td>
                        <Td className="tabular-nums">{t.dueDate ? formatDate(t.dueDate) : "—"}</Td>
                        <Td className="text-muted-foreground">{t.assignee?.name ?? "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
          </div>
        )}

        {tab === "performance" && (
          <div>
            <PageHeader
              title="Performance"
              subtitle="Where your advertising budget went and what it returned."
              actions={
                <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
                  {([7, 30, 90] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setAdsRange(d);
                        setAds(null);
                        loadAds(d);
                      }}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                        adsRange === d
                          ? "bg-brand-gradient text-white"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              }
            />

            {adsLoading ? (
              <div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{DASH_STAT_SKEL}</div>
                <div className="mt-4">
                  <SkeletonBlock className="h-64" />
                </div>
              </div>
            ) : adsError ? (
              <ErrorCard message={adsError} kind="projects" />
            ) : !ads || !ads.available ? (
              <EmptyState
                title="No advertising data yet"
                hint="Once your ad accounts are connected, spend and results will appear here automatically."
              />
            ) : !ads.hasData ? (
              <EmptyState
                title="No activity in this period"
                hint="There was no ad spend in the selected date range. Try a longer window."
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Ad spend"
                    value={formatBDT(ads.metrics.spend)}
                    delta={deltaText(ads.deltas.spend)}
                    deltaGood={(ads.deltas.spend ?? 0) <= 0}
                    sub="vs previous period"
                    icon={<Wallet className="size-5" />}
                    index={0}
                  />
                  <StatCard
                    label="ROAS"
                    value={`${ads.metrics.roas.toFixed(2)}x`}
                    delta={deltaText(ads.deltas.roas)}
                    deltaGood={(ads.deltas.roas ?? 0) >= 0}
                    sub="vs previous period"
                    icon={<TrendingUp className="size-5" />}
                    index={1}
                  />
                  <StatCard
                    label="Conversions"
                    value={formatNumber(ads.metrics.conversions)}
                    delta={deltaText(ads.deltas.conversions)}
                    deltaGood={(ads.deltas.conversions ?? 0) >= 0}
                    sub="vs previous period"
                    icon={<Target className="size-5" />}
                    index={2}
                  />
                  <StatCard
                    label="Revenue"
                    value={formatBDT(ads.metrics.conversionValue)}
                    delta={deltaText(ads.deltas.conversionValue)}
                    deltaGood={(ads.deltas.conversionValue ?? 0) >= 0}
                    sub="vs previous period"
                    icon={<Layers className="size-5" />}
                    index={3}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniMetric label="Impressions" value={formatNumber(ads.metrics.impressions)} delta={ads.deltas.impressions} />
                  <MiniMetric label="Clicks" value={formatNumber(ads.metrics.clicks)} delta={ads.deltas.clicks} />
                  <MiniMetric label="CTR" value={`${ads.metrics.ctr.toFixed(2)}%`} delta={ads.deltas.ctr} />
                  <MiniMetric label="CPC" value={money(ads.metrics.cpc)} delta={ads.deltas.cpc} />
                  <MiniMetric label="CPM" value={money(ads.metrics.cpm)} delta={ads.deltas.cpm} />
                  <MiniMetric label="Cost per conversion" value={money(ads.metrics.cpa)} delta={ads.deltas.cpa} />
                  <MiniMetric label="Campaigns running" value={String(ads.campaignsRunning)} />
                  <MiniMetric label="Data synced" value={ads.lastSyncedAt ? timeAgo(ads.lastSyncedAt) : "—"} />
                </div>

                <div className="mt-6">
                  <CardShell>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold">Spend & ROAS trend</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(ads.range.from)} → {formatDate(ads.range.to)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: "var(--chart-1)" }} /> Spend
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: "var(--chart-3)" }} /> ROAS
                        </span>
                      </div>
                    </div>
                    {adsTrend && adsTrend.length > 0 ? (
                      <AdsTrendChart data={adsTrend} />
                    ) : (
                      <p className="py-10 text-center text-[12px] text-muted-foreground">No trend data</p>
                    )}
                  </CardShell>
                </div>

                {ads.platforms.length > 0 && (
                  <div className="mt-6">
                    <PageHeader title="Platform split" subtitle="How each ad platform performed." />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {ads.platforms.map((p) => (
                        <CardShell key={p.provider}>
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-semibold">{p.provider === "META" ? "Meta" : p.provider === "GOOGLE" ? "Google Ads" : p.provider}</p>
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold text-primary dark:text-primary">
                              {p.roas.toFixed(2)}x ROAS
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                            <div>
                              <p className="text-muted-foreground">Spend</p>
                              <p className="font-semibold tabular-nums">{formatBDT(p.spend)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Revenue</p>
                              <p className="font-semibold tabular-nums">{formatBDT(p.conversionValue)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Clicks</p>
                              <p className="font-semibold tabular-nums">{formatNumber(p.clicks)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">CTR</p>
                              <p className="font-semibold tabular-nums">{p.ctr.toFixed(2)}%</p>
                            </div>
                          </div>
                        </CardShell>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <PageHeader title="Campaigns" subtitle="Every campaign that ran in this period, by spend." />
                  {!adsCampaigns || adsCampaigns.length === 0 ? (
                    <EmptyState title="No campaigns" hint="Campaigns will appear once they deliver impressions." />
                  ) : (
                    <TableShell>
                      <table className="w-full">
                        <THead>
                          <Th>Campaign</Th>
                          <Th>Spend</Th>
                          <Th>Conv.</Th>
                          <Th>CPA</Th>
                          <Th>ROAS</Th>
                          <Th>CTR</Th>
                        </THead>
                        <tbody>
                          {adsCampaigns.map((c, i) => (
                            <Tr key={c.id} index={i}>
                              <Td>
                                <p className="font-medium">{c.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {c.provider === "META" ? "Meta" : c.provider === "GOOGLE" ? "Google" : c.provider}
                                  {c.status ? ` · ${c.status.toLowerCase()}` : ""}
                                </p>
                              </Td>
                              <Td className="tabular-nums">{formatBDT(c.spend)}</Td>
                              <Td className="tabular-nums">{formatNumber(c.conversions)}</Td>
                              <Td className="tabular-nums">{money(c.cpa)}</Td>
                              <Td className="tabular-nums">{c.roas.toFixed(2)}x</Td>
                              <Td className="tabular-nums">{c.ctr.toFixed(2)}%</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </table>
                    </TableShell>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "projects" && (
          <div>
            <PageHeader title="Projects" subtitle="Track milestones, tasks and review deliverables." />
            {projectsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{PROJ_SKEL}</div>
            ) : projectsError ? (
              <ErrorCard message={projectsError} kind="projects" />
            ) : projects && projects.length === 0 ? (
              <EmptyState title="No projects yet" hint="Projects will appear here once your agency starts one." />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {[
                    { key: "ALL" as const, label: `All (${projects?.length ?? 0})` },
                    { key: "ACTIVE" as const, label: `In progress (${projects?.filter((x) => ["ACTIVE", "PLANNING"].includes(x.status)).length ?? 0})` },
                    { key: "DONE" as const, label: `Completed (${projects?.filter((x) => ["COMPLETED", "ARCHIVED"].includes(x.status)).length ?? 0})` },
                  ].map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setProjFilter(f.key)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                        projFilter === f.key
                          ? "bg-brand-gradient text-white"
                          : "border border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(projects ?? [])
                    .filter((p) =>
                      projFilter === "ACTIVE"
                        ? ["ACTIVE", "PLANNING"].includes(p.status)
                        : projFilter === "DONE"
                          ? ["COMPLETED", "ARCHIVED"].includes(p.status)
                          : true
                    )
                    .map((p) => (
                      <CardShell key={p.id} className="cursor-pointer transition-all hover:border-primary/30">
                        <div onClick={() => openProjectById(p.id)}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[14px] font-semibold">{p.name}</p>
                            <StatusBadge status={p.status} />
                          </div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <BillingBadge billingType={p.billingType} />
                            {p.healthStatus && <StatusBadge status={p.healthStatus} />}
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {formatDate(p.startDate)} → {formatDate(p.targetEndDate)}
                          </p>
                          <div className="mt-3">
                            <ProgressBar progress={p.progress} />
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {p.progress}% complete · {p.milestones.length} milestones · {p.tasks.length} tasks
                          </p>
                          <p className="mt-3 text-[11.5px] font-medium text-primary dark:text-primary">View details →</p>
                        </div>
                      </CardShell>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "invoices" && (
          <div>
            <PageHeader title="Invoices" subtitle="All invoices issued to you — click a row for line items and payments." />
            {invoicesLoading ? (
              <SkeletonBlock className="h-64" />
            ) : invoicesError ? (
              <ErrorCard message={invoicesError} kind="invoices" />
            ) : invoices && invoices.length === 0 ? (
              <EmptyState title="No invoices yet" hint="Invoices will appear here once issued." />
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total paid</p>
                    <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-emerald-500">{formatBDT(invoiceSummary?.totalCollected ?? 0)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pending</p>
                    <p className={cn("mt-0.5 text-[14px] font-heading font-bold tabular-nums", Number(invoiceSummary?.totalOutstanding ?? 0) > 0 ? "text-amber-500" : "text-emerald-500")}>
                      {formatBDT(invoiceSummary?.totalOutstanding ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Overdue</p>
                    <p className={cn("mt-0.5 text-[14px] font-heading font-bold tabular-nums", Number(invoiceSummary?.overdueAmount ?? 0) > 0 ? "text-rose-500" : "text-emerald-500")}>
                      {formatBDT(invoiceSummary?.overdueAmount ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Due this month</p>
                    <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-primary">{formatBDT(invoiceSummary?.totalMonthlyDue ?? 0)}</p>
                  </div>
                </div>

                {invoiceByProject.length > 0 && (
                  <div className="mb-5">
                    <p className="mb-2 font-heading text-[14px] font-semibold">Billing by project</p>
                    <p className="mb-3 text-[11.5px] text-muted-foreground">
                      One-time projects show full billing · monthly projects show only this month&apos;s amount due.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {invoiceByProject.map((row) => <BillingProjectCard key={row.projectId} row={row} />)}
                    </div>
                  </div>
                )}

                <TableShell>
                  <table className="w-full">
                    <THead>
                      <Th>Invoice #</Th>
                      <Th>Project</Th>
                      <Th>Issue</Th>
                      <Th>Due</Th>
                      <Th className="text-right">Amount</Th>
                      <Th className="text-right">Paid</Th>
                      <Th className="text-right">Balance</Th>
                      <Th>Status</Th>
                    </THead>
                    <tbody>
                      {invoices?.map((inv, i) => (
                        <Tr
                          key={inv.id}
                          index={i}
                          onClick={() => setOpenInvoice(inv)}
                          className="cursor-pointer transition-colors hover:bg-muted/40"
                        >
                          <Td>
                            <p className="font-semibold">{inv.invoiceNumber}</p>
                          </Td>
                          <Td className="text-muted-foreground">{inv.project?.name ?? "—"}</Td>
                          <Td>{formatDate(inv.issueDate)}</Td>
                          <Td>{formatDate(inv.dueDate)}</Td>
                          <Td className="text-right tabular-nums">{formatBDT(inv.amount)}</Td>
                          <Td className="text-right tabular-nums text-emerald-500">{formatBDT(inv.paid)}</Td>
                          <Td className="text-right tabular-nums">{formatBDT(inv.amount - inv.paid)}</Td>
                          <Td>
                            <StatusBadge status={inv.status} />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              </>
            )}
          </div>
        )}

        {tab === "messages" && (
          <div>
            <PageHeader
              title="Messages"
              subtitle="Talk directly with your agency team — everything stays in one place."
              actions={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                  {threadMessages.length} message{threadMessages.length === 1 ? "" : "s"}
                </span>
              }
            />

            <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
              <CardShell className="h-fit p-2">
                <div className="flex flex-col gap-1">
                  {(threads ?? []).map((t) => (
                    <button
                      key={t.threadKey}
                      onClick={() => {
                        if (t.threadKey === activeThread) return;
                        setActiveThread(t.threadKey);
                        setMessages(null);
                        loadMessages(t.threadKey);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                        activeThread === t.threadKey
                          ? "bg-primary/10 text-primary dark:text-primary"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span className="shrink-0">
                        {t.type === "general" ? <Inbox className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold">{t.title}</span>
                        <span className="block truncate text-[10.5px] opacity-70">
                          {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      {t.unread && <span className="size-2 shrink-0 rounded-full bg-rose-500" />}
                    </button>
                  ))}
                  {(threads ?? []).length === 0 && (
                    <p className="px-3 py-4 text-[11.5px] text-muted-foreground">No conversations yet.</p>
                  )}
                </div>
              </CardShell>

              <CardShell className="flex min-h-[420px] flex-col p-0">
                <div className="border-b border-border/60 px-4 py-3">
                  <p className="font-heading text-[13.5px] font-semibold">
                    {(threads ?? []).find((t) => t.threadKey === activeThread)?.title ?? "Conversation"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Your agency replies here — you will be notified when a new message arrives.
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4" style={{ maxHeight: 460 }}>
                  {messagesLoading && messages === null ? (
                    <div className="flex flex-col gap-3">{MSG_SKEL}</div>
                  ) : messagesError && !messages ? (
                    <ErrorCard message={messagesError} kind="messages" />
                  ) : threadMessages.length === 0 ? (
                    <div className="flex h-full items-center justify-center py-10">
                      <EmptyState
                        title="No messages yet"
                        hint="Say hello to your agency team — they will see it right away."
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {threadMessages.map((m) => {
                        const isClient = m.authorType === "client";
                        return (
                          <div key={m.id} className={cn("flex", isClient ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[78%] rounded-2xl px-3.5 py-2.5",
                                isClient ? "rounded-br-md bg-brand-gradient text-white" : "rounded-bl-md bg-muted/70"
                              )}
                            >
                              <p
                                className={cn(
                                  "text-[10.5px] font-semibold",
                                  isClient ? "text-white/80" : "text-muted-foreground"
                                )}
                              >
                                {isClient ? "You" : m.authorName || "Agency"} · {timeAgo(m.createdAt)}
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-[13px]">{m.content}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-border/60 px-4 py-3">
                  <div className="flex gap-2">
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      placeholder="Write a message…"
                      disabled={sending}
                      className="flex-1"
                    />
                    <Btn
                      variant="primary"
                      onClick={sendReply}
                      className={cn("shrink-0", (sending || !replyText.trim()) && "pointer-events-none opacity-60")}
                    >
                      <Send className="size-4" />
                      {sending ? "Sending…" : "Send"}
                    </Btn>
                  </div>
                  {messagesError && messages && (
                    <p className="mt-2 text-[11.5px] text-rose-500">{messagesError}</p>
                  )}
                </div>
              </CardShell>
            </div>

            {/* Telegram: an extra channel so clients hear about replies quickly. */}
            <div className="mt-4">
              <CardShell className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">Telegram alerts</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {!tg
                      ? "Checking…"
                      : !tg.enabled
                        ? "Not available yet — your agency has not connected a Telegram bot."
                        : tg.linked
                          ? `Connected${tg.linkedAt ? ` · ${timeAgo(tg.linkedAt)}` : ""}. New messages and updates arrive in Telegram.`
                          : tg.pendingCode
                            ? `Open Telegram and send /start ${tg.pendingCode} to @${tg.botName ?? "the bot"}.`
                            : "Get a short ping in Telegram whenever your agency replies."}
                  </p>
                </div>
                {tg?.enabled && (
                  <div className="flex shrink-0 gap-2">
                    {tg.linked ? (
                      <Btn variant="outline" className="px-3 py-1.5 text-[12px]" disabled={tgBusy} onClick={disconnectTelegram}>
                        {tgBusy ? "Working…" : "Disconnect"}
                      </Btn>
                    ) : (
                      <Btn variant="primary" className="px-3 py-1.5 text-[12px]" disabled={tgBusy} onClick={connectTelegram}>
                        <Send className="size-3.5" />
                        {tgBusy ? "Working…" : tg.pendingCode ? "Open Telegram" : "Connect Telegram"}
                      </Btn>
                    )}
                  </div>
                )}
              </CardShell>
            </div>
          </div>
        )}
      </main>

      <Modal open={!!openProject} onClose={() => setOpenProject(null)} title={openProject?.name ?? ""} size="lg">
        {openProject && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={openProject.status} />
              <BillingBadge billingType={openProject.billingType} />
              {openProject.healthStatus && <StatusBadge status={openProject.healthStatus} />}
              <span className="text-[11.5px] text-muted-foreground">
                {formatDate(openProject.startDate)} → {formatDate(openProject.targetEndDate)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {openProject.tasks.length} visible tasks
              </span>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] font-semibold text-muted-foreground">Overall progress</p>
                <p className="text-[12px] font-bold tabular-nums">{openProject.progress}%</p>
              </div>
              <ProgressBar progress={openProject.progress} />
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Your team</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ...(openProject.assignedPm
                    ? [{ name: openProject.assignedPm.name, email: openProject.assignedPm.email, phone: openProject.assignedPm.employee?.phone ?? null, role: "Project Manager" }]
                    : []),
                  ...(openProject.client?.accountOwner
                    ? [{ name: openProject.client.accountOwner.name, email: openProject.client.accountOwner.email, phone: openProject.client.accountOwner.employee?.phone ?? null, role: "Account Manager" }]
                    : []),
                ].map((m) => (
                  <div key={m.role} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                    <Avatar name={m.name} size="size-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold">{m.name}</p>
                      <p className="text-[10.5px] text-muted-foreground">{m.role}</p>
                      {m.phone && <p className="truncate text-[10.5px] tabular-nums text-muted-foreground">{m.phone}</p>}
                    </div>
                    {m.phone && (
                      <a
                        href={`tel:${m.phone}`}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300"
                        title={`Call ${m.name} · ${m.phone}`}
                      >
                        <Phone className="size-3.5" />
                      </a>
                    )}
                    <a
                      href={`mailto:${m.email}`}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary dark:hover:text-primary"
                      title={`Email ${m.name}`}
                    >
                      <Mail className="size-3.5" />
                    </a>
                  </div>
                ))}
                {!openProject.assignedPm && !openProject.client?.accountOwner && (
                  <p className="text-[12px] text-muted-foreground">No team assigned yet.</p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Tasks ({openProject.tasks.length})</p>
              {openProject.tasks.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No tasks shared with you yet.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {[
                    { label: "Completed", list: openProject.tasks.filter((t) => ["DONE", "COMPLETED"].includes(t.status)) },
                    { label: "Pending", list: openProject.tasks.filter((t) => !["DONE", "COMPLETED"].includes(t.status)) },
                  ]
                    .filter((g) => g.list.length > 0)
                    .map((g) => (
                      <div key={g.label}>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          {g.label} ({g.list.length})
                        </p>
                        <div className="flex flex-col gap-2">
                          {g.list.map((t) => {
                            const done = t.status === "DONE" || t.status === "COMPLETED";
                            const overdue = t.dueDate && !done && new Date(t.dueDate) < new Date();
                            return (
                              <div key={t.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                                {done ? (
                                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                ) : t.status === "IN_PROGRESS" ? (
                                  <Circle className="size-4 shrink-0 fill-amber-400/30 text-amber-500" />
                                ) : (
                                  <Circle className="size-4 shrink-0 text-muted-foreground/60" />
                                )}
                                <p className={cn("flex-1 text-[12.5px]", done && "text-muted-foreground line-through")}>{t.title}</p>
                                {t.assignedTo && (
                                  <span className="hidden text-[10.5px] text-muted-foreground sm:block">{t.assignedTo.name}</span>
                                )}
                                {t.dueDate && (
                                  <span className={cn("text-[11px] tabular-nums", overdue ? "font-semibold text-rose-500" : "text-muted-foreground")}>
                                    {overdue ? `Overdue ${formatDate(t.dueDate)}` : formatDate(t.dueDate)}
                                  </span>
                                )}
                                <StatusBadge status={t.status} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Description</p>
              <p className="text-[12.5px] text-muted-foreground">
                {openProject.description || "No description provided."}
              </p>
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">
                Reports &amp; updates ({openProject.updates?.length ?? 0})
              </p>
              {reportError && <p className="mb-1.5 text-[11px] text-rose-500">{reportError}</p>}
              {!openProject.updates || openProject.updates.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No reports shared with you yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {openProject.updates.map((r) => (
                    <div key={r.id} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium">{r.title}</p>
                          <p className="text-[10.5px] text-muted-foreground">
                            {formatDate(r.periodStart)} → {formatDate(r.periodEnd)} ·{" "}
                            {Array.isArray(r.completed) ? r.completed.length : 0} completed ·{" "}
                            {Array.isArray(r.pending) ? r.pending.length : 0} pending
                          </p>
                        </div>
                        <button
                          onClick={() => downloadReport(r, openProject.name)}
                          disabled={reportBusy === r.id}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                        >
                          <Download className="size-3.5" />
                          {reportBusy === r.id ? "…" : "PDF"}
                        </button>
                      </div>
                      {r.note && <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{r.note}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Milestones ({openProject.milestones.length})</p>
              {openProject.milestones.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No milestones yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {openProject.milestones.map((ms) => {
                    const done = ms.status === "DONE" || ms.status === "COMPLETED";
                    return (
                      <div key={ms.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                        {done ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="size-4 shrink-0 text-muted-foreground/60" />
                        )}
                        <p className={cn("flex-1 text-[12.5px]", done && "text-muted-foreground line-through")}>{ms.name}</p>
                        <span className="text-[11px] text-muted-foreground">{formatDate(ms.dueDate)}</span>
                        <StatusBadge status={ms.status} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Files ({openProject.files.length})</p>
              {openProject.files.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No files uploaded yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {openProject.files.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium">{f.fileName}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDate(f.uploadedAt)}</p>
                      </div>
                      <StatusBadge status={f.approvalStatus} />
                      <button
                        onClick={() => downloadPortalFile(f.id, f.fileName)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/10 dark:text-primary"
                      >
                        Download
                        <Download className="size-3.5" />
                      </button>
                      {f.approvalStatus !== "APPROVED" && (
                        <>
                          <button
                            onClick={() => {
                              setApprovalFile(f);
                              setDecision("APPROVED");
                              setRevisionNotes("");
                              setApprovalError(null);
                            }}
                            className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setApprovalFile(f);
                              setDecision("REVISION_REQUESTED");
                              setRevisionNotes("");
                              setApprovalError(null);
                            }}
                            className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
                          >
                            Request revision
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!openInvoice} onClose={() => setOpenInvoice(null)} title={openInvoice?.invoiceNumber ?? ""} size="lg">
        {openInvoice && (
          <div className="flex flex-col gap-5">
            {openInvoice.status === "PAID" && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
                <BadgeCheck className="size-4 shrink-0 text-emerald-500" />
                <p className="text-[12.5px] font-bold text-emerald-600 dark:text-emerald-300">PAID IN FULL — thank you! Receipts for every payment are listed below.</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={openInvoice.status} />
              {openInvoice.project && (
                <span className="text-[11.5px] text-muted-foreground">{openInvoice.project.name}</span>
              )}
              <span className="text-[11.5px] text-muted-foreground">
                Issued {formatDate(openInvoice.issueDate)} · Due {formatDate(openInvoice.dueDate)}
              </span>
              <div className="ml-auto">
                <Btn variant="outline" onClick={doInvoicePdf} className={cn("px-2.5 py-1.5 text-[11.5px]", pdfBusy && "pointer-events-none opacity-60")}>
                  <FileDown className="size-3.5" /> {pdfBusy ? "Exporting…" : "Download PDF"}
                </Btn>
                {pdfError && <p className="mt-1 text-right text-[11px] text-rose-500">{pdfError}</p>}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Line items</p>
              <TableShell>
                <table className="w-full">
                  <THead>
                    <Th>Description</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Amount</Th>
                  </THead>
                  <tbody>
                    {openInvoice.lines.map((l, i) => (
                      <Tr key={l.id} index={i}>
                        <Td className="text-[12.5px]">{l.description}</Td>
                        <Td className="text-right text-[12.5px] tabular-nums">{l.quantity}</Td>
                        <Td className="text-right text-[12.5px] tabular-nums">{formatBDT(l.unitPrice)}</Td>
                        <Td className="text-right text-[12.5px] font-semibold tabular-nums">{formatBDT(l.amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-semibold">Payments & receipts ({openInvoice.payments.length})</p>
              {openInvoice.payments.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No payments received yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {openInvoice.payments.map((p, idx) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium tabular-nums">
                          {formatBDT(p.amount)} <span className="font-mono text-[10.5px] font-normal text-muted-foreground">#{p.receiptNo}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">{label(p.paymentMethod)} · {formatDate(p.paymentDate)}</p>
                      </div>
                      <button
                        onClick={() => void doReceiptPdf(p, idx)}
                        disabled={pdfBusy}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                        title="Download payment receipt"
                      >
                        <Download className="size-3.5" /> Receipt
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {openInvoice.installments.length > 0 && (
              <div>
                <p className="mb-2 text-[12.5px] font-semibold">Payment plan ({openInvoice.installments.length})</p>
                <div className="flex flex-col gap-2">
                  {openInvoice.installments.map((s) => (
                    <div key={s.sequence} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2", s.status === "PAID" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60")}>
                      <div className="flex items-center gap-2.5">
                        <span className={cn("flex size-6 items-center justify-center rounded-full text-[10px] font-bold", s.status === "PAID" ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>{s.sequence}</span>
                        <p className="text-[12px] font-medium">Due {formatDate(s.dueDate)} <span className="text-[10.5px] font-normal text-muted-foreground">· {s.status} · {formatBDT(s.paidAmount)} paid</span></p>
                      </div>
                      <p className="text-[12.5px] font-bold tabular-nums">{formatBDT(s.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-4 py-3 text-[12.5px]">
              {(() => {
                const t = invoiceTotals({
                  lineItems: openInvoice.lines,
                  taxApplicable: openInvoice.taxApplicable,
                  taxRate: openInvoice.taxRate,
                  discountRate: openInvoice.discountRate,
                  shippingFee: openInvoice.shippingFee,
                  payments: openInvoice.payments,
                });
                return (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium tabular-nums">{formatBDT(t.subtotal)}</span></div>
                    {t.tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({openInvoice.taxRate}%)</span><span className="font-medium tabular-nums">{formatBDT(t.tax)}</span></div>}
                    {t.discount > 0 && <div className="flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">Discount ({openInvoice.discountRate}%)</span><span className="font-medium tabular-nums">− {formatBDT(t.discount)}</span></div>}
                    {t.shipping > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span className="font-medium tabular-nums">{formatBDT(t.shipping)}</span></div>}
                    <div className="flex justify-between border-t border-border/60 pt-1.5"><span className="font-semibold">Total</span><span className="font-semibold tabular-nums">{formatBDT(t.grand)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-medium tabular-nums text-emerald-500">{formatBDT(t.paid)}</span></div>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-muted-foreground">Balance due</p>
                      <p className={cn("font-heading text-[16px] font-bold tabular-nums", t.balance > 0 ? "text-amber-500" : "text-emerald-500")}>
                        {formatBDT(t.balance)}
                      </p>
                    </div>
                    <p className="text-[11px] italic leading-relaxed text-muted-foreground">In words: {numberToWords(t.grand, openInvoice.currency)}</p>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!approvalFile} onClose={() => setApprovalFile(null)} title="Review deliverable">
        {approvalFile && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-[13px] font-medium">{approvalFile.fileName}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDecision("APPROVED")}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition-all",
                  decision === "APPROVED"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                Approve
              </button>
              <button
                onClick={() => setDecision("REVISION_REQUESTED")}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition-all",
                  decision === "REVISION_REQUESTED"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                Request revision
              </button>
            </div>
            {decision === "REVISION_REQUESTED" && (
              <Field label="Revision notes">
                <Input
                  value={revisionNotes}
                  onChange={(e) => setRevisionNotes(e.target.value)}
                  placeholder="What should be revised?"
                />
              </Field>
            )}
            {approvalError && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
                {approvalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setApprovalFile(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={submitApproval} className={cn(approving && "pointer-events-none opacity-60")}>
                {approving ? "Saving…" : decision === "APPROVED" ? "Approve" : "Request revision"}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}