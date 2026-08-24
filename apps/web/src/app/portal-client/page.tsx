"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  ExternalLink,
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
  Zap,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { formatBDT, formatDate, timeAgo } from "@/lib/format";
import { buildInvoicePdf, buildInvoicePdfAsync } from "@/lib/invoice-pdf";
import { Btn, TableShell, Td, Th, THead, Tr } from "@/components/table";
import { Avatar, CardShell, cn, EmptyState, PageHeader, SkeletonBlock, StatCard, StatusBadge } from "@/components/shared";
import { Field, Input, Modal } from "@/components/ui";

type Tab = "dashboard" | "projects" | "invoices" | "messages";
type Me = { id: string; name: string; email: string; clientId: string; clientName: string };
type Milestone = { id: string; name: string; dueDate: string; status: string };
type FileItem = { id: string; name: string; fileName: string; fileUrl: string; uploadedAt: string; approvalStatus: string };
type TeamMember = { id: string; name: string; email: string; phone: string | null; role: "Account Manager" | "Project Manager" | "Account & Project Manager" };
type DashProject = { id: string; name: string; status: string; billingType: string; progress: number; nextMilestone: { name: string; dueDate: string } | null };
type DashInvoice = { id: string; invoiceNumber: string; amount: number; paid: number; status: string; issueDate: string; dueDate: string };
type Dashboard = {
  clientName: string;
  activeProjectCount: number;
  pendingInvoiceCount: number;
  pendingInvoiceValue: number;
  billingSummary: { totalInvoiced: number; totalCollected: number; totalOutstanding: number };
  taskStats: { total: number; done: number; inProgress: number; todo: number };
  team: TeamMember[];
  nextMilestone: { name: string; dueDate: string; projectName: string } | null;
  projects: DashProject[];
  invoices: DashInvoice[];
};
type PortalTask = { id: string; title: string; status: string; priority: string; dueDate: string | null; assignedTo: { id: string; name: string } | null };
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
  assignedPm: { id: string; name: string; email: string; employee: { phone: string | null } | null } | null;
  client: { accountOwner: { id: string; name: string; email: string; employee: { phone: string | null } | null } | null } | null;
  _count: { tasks: number; comments: number };
};
type InvoiceLine = { id: string; description: string; quantity: number; unitPrice: number; amount: number };
type InvoicePayment = { id: string; amount: number; paymentMethod: string; referenceId: string | null; paymentDate: string };
type Invoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  amount: number;
  paid: number;
  currency: string;
  taxApplicable: boolean;
  taxRate: number;
  notes: string | null;
  project: { id: string; name: string } | null;
  client: { companyName: string; contacts: { name: string; email: string | null; phone: string | null; roleTitle: string | null }[] };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
};
type InvoiceSummary = { totalInvoiced: number; totalCollected: number; totalOutstanding: number };
type ActivityItem = { id: string; action: string; relatedEntityType: string | null; relatedEntityId: string | null; timestamp: string };
type Message = {
  id: string;
  content: string;
  createdAt: string;
  author: { name: string } | null;
  portalUser: { clientContact: { name: string } } | null;
  project: { id: string; name: string };
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
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
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
          : "bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 dark:text-violet-300"
      )}
    >
      {recurring ? <RefreshCw className="size-3" /> : <Zap className="size-3" />}
      {BILLING_LABELS[billingType] ?? label(billingType)}
    </span>
  );
}

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { value: "projects", label: "Projects", icon: <FolderOpen className="size-4" /> },
  { value: "invoices", label: "Invoices", icon: <ReceiptText className="size-4" /> },
  { value: "messages", label: "Messages", icon: <MessageSquare className="size-4" /> },
];

const PROJ_SKEL = [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-44" />);
const DASH_STAT_SKEL = [0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-28" />);
const DASH_CARD_SKEL = [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-36" />);
const MSG_SKEL = [0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-16" />);

export default function PortalClientPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);
  const [projFilter, setProjFilter] = useState<"ALL" | "ACTIVE" | "DONE">("ALL");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [approvalFile, setApprovalFile] = useState<FileItem | null>(null);
  const [decision, setDecision] = useState<"APPROVED" | "REVISION_REQUESTED">("APPROVED");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const [replyProject, setReplyProject] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      setDash(await pfetch("/portal-client/dashboard"));
    } catch (err: any) {
      setDashError(err?.message ?? "Failed to load dashboard");
    } finally {
      setDashLoading(false);
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

  const loadMessages = useCallback(async (projectId?: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      setMessages(await pfetch(`/portal-client/messages${q}`));
    } catch (err: any) {
      setMessagesError(err?.message ?? "Failed to load messages");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace("/portal-login");
      return;
    }
    setReady(true);
    loadDashboard();
    loadActivity();
    pfetch("/portal-client/me")
      .then((m: Me) => setMe(m))
      .catch(() => {
        setPortalToken(null);
        router.replace("/portal-login");
      });
  }, [router, loadDashboard, loadActivity]);

  useEffect(() => {
    if (tab === "projects" && projects === null) loadProjects();
    if (tab === "invoices" && invoices === null) loadInvoices();
    if (tab === "messages" && messages === null) loadMessages();
  }, [tab, projects, invoices, messages, loadProjects, loadInvoices, loadMessages]);

  useEffect(() => {
    if (messages && messages.length && !replyProject) {
      const first = messages[0]?.project;
      if (first) setReplyProject(first.id);
    }
  }, [messages, replyProject]);

  useEffect(() => {
    if (openProject && projects) {
      const updated = projects.find((p) => p.id === openProject.id);
      if (updated) setOpenProject(updated);
    }
  }, [projects, openProject]);

  const signOut = () => {
    setPortalToken(null);
    router.push("/portal-login");
  };

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !replyProject || sending) return;
    setSending(true);
    try {
      await pfetch(`/portal-client/projects/${replyProject}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      setReplyText("");
      await loadMessages();
    } catch {
      setMessagesError("Failed to send message");
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
      let pdfBranding: { primaryColor?: string; logoDarkUrl?: string; appName?: string } | undefined;
      try {
        const b = await pfetch("/portal-client/branding").catch(() => null);
        if (b) pdfBranding = { primaryColor: b.primaryColor ?? undefined, logoDarkUrl: b.logoDarkUrl ?? undefined, appName: b.appName ?? undefined };
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
        notes: openInvoice.notes,
        client: openInvoice.client,
        project: openInvoice.project,
        lineItems: openInvoice.lines,
        payments: openInvoice.payments,
      };
      const doc = pdfBranding?.logoDarkUrl ? await buildInvoicePdfAsync(payload, pdfBranding) : buildInvoicePdf(payload, pdfBranding);
      doc.save(`${openInvoice.invoiceNumber}.pdf`);
    } catch {
      setPdfError("Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const openInvoiceById = async (id: string) => {
    try {
      let full = invoices?.find((x) => x.id === id) ?? null;
      if (!full) {
        const data = await pfetch("/portal-client/invoices");
        setInvoices(data.invoices);
        setInvoiceSummary(data.summary);
        full = data.invoices.find((x: Invoice) => x.id === id) ?? null;
      }
      if (full) setOpenInvoice(full);
      else setTab("invoices");
    } catch {
      setTab("invoices");
    }
  };

  const groups = useMemo(() => {
    if (!messages) return [];
    const map = new Map<string, Message[]>();
    for (const m of messages) {
      const list = map.get(m.project.id) ?? [];
      list.push(m);
      map.set(m.project.id, list);
    }
    return Array.from(map.entries())
      .map(([, msgs]) => ({
        project: msgs[0].project,
        messages: msgs.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
      }))
      .sort((a, b) => a.project.name.localeCompare(b.project.name));
  }, [messages]);

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
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-md shadow-violet-500/25">
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
        <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all",
                tab === t.value
                  ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
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

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Active Projects" value={dash.activeProjectCount} icon={<FolderOpen className="size-5" />} index={0} />
                    <StatCard label="Pending Invoices" value={dash.pendingInvoiceCount} icon={<Inbox className="size-5" />} index={1} />
                    <StatCard label="Pending Value" value={formatBDT(dash.pendingInvoiceValue)} icon={<Layers className="size-5" />} index={2} />
                    <StatCard
                      label="Next Milestone"
                      value={dash.nextMilestone ? formatDate(dash.nextMilestone.dueDate) : "—"}
                      sub={dash.nextMilestone ? `${dash.nextMilestone.name} · ${dash.nextMilestone.projectName}` : "No upcoming milestones"}
                      icon={<CalendarClock className="size-5" />}
                      index={3}
                    />
                  </div>

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
                            <a
                              href={`mailto:${m.email}`}
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300"
                              title={`Email ${m.name}`}
                            >
                              <Mail className="size-3.5" />
                            </a>
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
                                  <MessageSquare className="size-3.5 text-violet-500" />
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
                        {dash.projects.map((p) => (
                          <CardShell key={p.id} className="cursor-pointer transition-all hover:border-violet-500/30">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[14px] font-semibold">{p.name}</p>
                              <StatusBadge status={p.status} />
                            </div>
                            <div className="mt-3">
                              <ProgressBar progress={p.progress} />
                            </div>
                            <p className="mt-1.5 text-[11px] text-muted-foreground">{p.progress}% complete</p>
                            <p className="mt-3 text-[11.5px] text-muted-foreground">
                              Next milestone:{" "}
                              {p.nextMilestone ? `${p.nextMilestone.name} · ${formatDate(p.nextMilestone.dueDate)}` : "—"}
                            </p>
                          </CardShell>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-8">
                    <PageHeader
                      title="Recent invoices"
                      subtitle="Your latest invoices at a glance. Click a row to view and download."
                      actions={
                        <button onClick={() => setTab("invoices")} className="text-[12.5px] font-semibold text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
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
                          ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25"
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
                      <CardShell key={p.id} className="cursor-pointer transition-all hover:border-violet-500/30">
                        <div onClick={() => setOpenProject(p)}>
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
                          <p className="mt-3 text-[11.5px] font-medium text-violet-600 dark:text-violet-300">View details →</p>
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
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total invoiced</p>
                    <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums">{formatBDT(invoiceSummary?.totalInvoiced ?? 0)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total collected</p>
                    <p className="mt-0.5 text-[14px] font-heading font-bold tabular-nums text-emerald-500">{formatBDT(invoiceSummary?.totalCollected ?? 0)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Outstanding</p>
                    <p className={cn("mt-0.5 text-[14px] font-heading font-bold tabular-nums", Number(invoiceSummary?.totalOutstanding ?? 0) > 0 ? "text-amber-500" : "text-emerald-500")}>
                      {formatBDT(invoiceSummary?.totalOutstanding ?? 0)}
                    </p>
                  </div>
                </div>
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
            <PageHeader title="Messages" subtitle="Talk directly with your agency team." />
            {messagesLoading ? (
              <div className="flex flex-col gap-3">{MSG_SKEL}</div>
            ) : messagesError && !messages ? (
              <ErrorCard message={messagesError} kind="messages" />
            ) : groups.length === 0 ? (
              <EmptyState title="No messages yet" hint="Say hello to your project team to get started." />
            ) : (
              <div className="flex flex-col gap-5">
                {groups.map((g) => (
                  <CardShell key={g.project.id} className="p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="font-heading text-[13.5px] font-semibold">{g.project.name}</p>
                      <span className="text-[11px] text-muted-foreground">
                        {g.messages.length} message{g.messages.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {g.messages.map((m) => {
                        const isClient = !!m.portalUser;
                        const name = isClient ? m.portalUser?.clientContact?.name ?? "You" : m.author?.name ?? "Team";
                        return (
                          <div key={m.id} className={cn("flex", isClient ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[78%] rounded-2xl px-3.5 py-2.5",
                                isClient ? "rounded-br-md bg-brand-gradient text-white" : "rounded-bl-md bg-muted/70"
                              )}
                            >
                              <p className={cn("text-[10.5px] font-semibold", isClient ? "text-white/80" : "text-muted-foreground")}>
                                {name} · {timeAgo(m.createdAt)}
                              </p>
                              <p className="mt-0.5 text-[13px]">{m.content}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardShell>
                ))}

                <CardShell className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {groups.map((g) => (
                      <button
                        key={g.project.id}
                        onClick={() => setReplyProject(g.project.id)}
                        className={cn(
                          "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                          replyProject === g.project.id
                            ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {g.project.name}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendReply()}
                      placeholder="Write a message…"
                      disabled={!replyProject || sending}
                      className="flex-1"
                    />
                    <Btn variant="primary" onClick={sendReply} className={cn("shrink-0", sending && "pointer-events-none opacity-60")}>
                      <Send className="size-4" />
                      {sending ? "Sending…" : "Send"}
                    </Btn>
                  </div>
                  {messagesError && <p className="mt-2 text-[11.5px] text-rose-500">{messagesError}</p>}
                </CardShell>
              </div>
            )}
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
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300"
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
                      <a
                        href={f.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-300"
                      >
                        View
                        <ExternalLink className="size-3.5" />
                      </a>
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
              <p className="mb-2 text-[12.5px] font-semibold">Payments ({openInvoice.payments.length})</p>
              {openInvoice.payments.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No payments received yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {openInvoice.payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      <p className="flex-1 text-[12.5px] font-medium tabular-nums">{formatBDT(p.amount)}</p>
                      <span className="text-[11px] text-muted-foreground">{label(p.paymentMethod)}</span>
                      {p.referenceId && <span className="text-[11px] text-muted-foreground">{p.referenceId}</span>}
                      <span className="text-[11px] tabular-nums text-muted-foreground">{formatDate(p.paymentDate)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
              <p className="text-[12.5px] font-semibold text-muted-foreground">Balance due</p>
              <p className={cn("font-heading text-[16px] font-bold tabular-nums", openInvoice.amount - openInvoice.paid > 0 ? "text-amber-500" : "text-emerald-500")}>
                {formatBDT(openInvoice.amount - openInvoice.paid)}
              </p>
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