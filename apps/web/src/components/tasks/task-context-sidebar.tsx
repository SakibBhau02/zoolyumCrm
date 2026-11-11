"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Facebook,
  FileText,
  FolderKanban,
  FolderOpen,
  Globe2,
  Instagram,
  Link2,
  Linkedin,
  Loader2,
  Mail,
  Music2,
  Paperclip,
  Phone,
  RefreshCw,
  Target,
  Twitter,
  Users,
  Youtube,
} from "lucide-react";
import { apiFetch, API_URL } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { Avatar, cn } from "@/components/shared";

type Ref = {
  id: string;
  title: string;
  url?: string | null;
  type: string;
  fileUrl?: string | null;
  uploadedBy?: { id: string; name: string } | null;
  createdAt: string;
};

type ProjectFileRow = {
  id: string;
  fileUrl: string;
  versionNumber: number;
  approvalStatus: string;
  uploadedBy?: { id: string; name: string } | null;
  uploadedAt: string;
};

export interface TaskProjectContext {
  project: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    healthStatus: string;
    category?: string | null;
    priority?: string | null;
    progress: number;
    startDate?: string;
    targetEndDate?: string | null;
    briefLink?: string | null;
    driveLink?: string | null;
    researchLink?: string | null;
    projectLink?: string | null;
    websiteUrl?: string | null;
    socialLinks?: Record<string, string> | null;
    client?: {
      id: string;
      companyName: string;
      contacts?: { id: string; name: string; roleTitle?: string | null; email?: string | null; phone?: string | null; isPrimary?: boolean }[] | null;
    } | null;
    assignedPm?: { id: string; name: string } | null;
    _count?: { tasks: number };
  } | null;
  briefLinks: { label: string; url: string }[];
  references: Ref[];
  files: ProjectFileRow[];
  deliverables: { id: string; title: string; status: string }[];
  reports: { id: string; title: string; status: string }[];
}

const REF_TONES: Record<string, string> = {
  FIGMA: "bg-fuchsia-500/10 text-fuchsia-500 ring-1 ring-fuchsia-500/20",
  NOTION: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  DRIVE: "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20",
  OTHER: "bg-muted text-muted-foreground ring-1 ring-border",
};

const HEALTH_TONE: Record<string, string> = {
  ON_TRACK: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  AT_RISK: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  DELAYED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  OFF_TRACK: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

/** uploaded names are stored as "<uuid>--<original>"; show the original */
function fileName(url: string): string {
  const raw = (url ?? "").split("?")[0].split("/").pop() ?? "file";
  const parts = raw.split("--");
  return decodeURIComponent(parts.length > 1 ? parts.slice(1).join("--") : raw);
}

/** API-relative files ("/api/flow/uploads/…") must resolve to the API origin. */
function absoluteUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/api/") ? `${API_URL.replace(/\/api\/?$/, "")}${url}` : url;
}

function hostOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

function Card({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3.5 py-2.5">
        <span className="text-primary">{icon}</span>
        <h4 className="flex-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
        {action}
      </header>
      <div className="px-3.5 py-3">{children}</div>
    </section>
  );
}

function LinkRow({
  href,
  icon,
  title,
  meta,
  trailing,
}: {
  href?: string | null;
  icon: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const inner = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta font-semibold leading-snug">{title}</span>
        {meta ? <span className="block truncate text-micro text-muted-foreground">{meta}</span> : null}
      </span>
      {trailing ?? (href ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/70" /> : null)}
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      {inner}
    </a>
  ) : (
    <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-2 py-1.5">{inner}</div>
  );
}

const SOCIALS = [
  { key: "facebook", label: "Facebook", Icon: Facebook, tone: "text-blue-500 border-blue-500/25 bg-blue-500/10 hover:bg-blue-500/20" },
  { key: "instagram", label: "Instagram", Icon: Instagram, tone: "text-pink-500 border-pink-500/25 bg-pink-500/10 hover:bg-pink-500/20" },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin, tone: "text-sky-600 border-sky-600/25 bg-sky-600/10 hover:bg-sky-600/20" },
  { key: "youtube", label: "YouTube", Icon: Youtube, tone: "text-red-500 border-red-500/25 bg-red-500/10 hover:bg-red-500/20" },
  { key: "tiktok", label: "TikTok", Icon: Music2, tone: "text-teal-400 border-teal-500/25 bg-teal-500/10 hover:bg-teal-500/20" },
  { key: "x", label: "X", Icon: Twitter, tone: "text-foreground border-border bg-muted/60 hover:bg-muted" },
] as const;

/**
 * Right-hand context rail for the task detail sheet.
 *
 * A task is never just its title — the assignee needs the client, the project
 * brief, the social accounts, the raw files and the research behind it without
 * leaving the sheet. This component owns that fetch (`/tasks/:id/project-context`
 * is permission-checked) and renders it as compact, clickable cards.
 */
export function TaskContextSidebar({
  taskId,
  detail,
  onOpenProject,
}: {
  taskId: string;
  detail: any;
  onOpenProject?: (projectId: string) => void;
}) {
  const [data, setData] = useState<TaskProjectContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const projectId = detail?.projectId ?? null;

  const load = useCallback(() => {
    if (!taskId) return;
    setLoading(true);
    setErr(null);
    apiFetch<TaskProjectContext>(`/tasks/${taskId}/project-context`)
      .then(setData)
      .catch((e) => setErr(e?.message ?? "Project context unavailable"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load, projectId]);

  const project = data?.project ?? null;
  const primaryContact = project?.client?.contacts?.find((c) => c.isPrimary) ?? project?.client?.contacts?.[0] ?? null;
  const socials = SOCIALS.filter((s) => Boolean((project?.socialLinks as any)?.[s.key]));
  const briefLinks = data?.briefLinks ?? [];
  const references = data?.references ?? [];
  const files = data?.files ?? [];
  const attachments: any[] = detail?.attachments ?? [];
  const taskLinks: any[] = detail?.referenceLinks ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* People & schedule — the assignee's first three questions */}
      <Card icon={<Users className="size-4" />} title="Workflow">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={detail?.assignedTo?.name ?? "?"} size="size-8" />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Assignee</p>
              <p className="truncate text-body font-semibold">{detail?.assignedTo?.name ?? "Unassigned"}</p>
              {detail?.assignedTo?.roleTitle && <p className="truncate text-micro text-muted-foreground">{detail.assignedTo.roleTitle}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-2">
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Reporter</p>
              <p className="truncate text-meta font-medium">{detail?.reporter?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Due</p>
              <p className="flex items-center gap-1 truncate text-meta font-medium">
                <CalendarDays className="size-3.5 text-muted-foreground" />
                {detail?.dueDate ? formatDate(detail.dueDate) : "No date"}
              </p>
            </div>
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Estimate</p>
              <p className="flex items-center gap-1 text-meta font-medium tabular-nums">
                <Clock className="size-3.5 text-muted-foreground" />
                {detail?.estimatedHours != null ? `${detail.estimatedHours}h` : "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Logged</p>
              <p className="flex items-center gap-1 text-meta font-medium tabular-nums">
                <Target className="size-3.5 text-muted-foreground" />
                {Number(detail?.actualHours ?? 0).toFixed(1)}h
              </p>
            </div>
          </div>
          {(detail?.assignees ?? []).length > 0 && (
            <div className="border-t border-border/50 pt-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Also on this task</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {(detail.assignees as any[]).map((a) => (
                  <span key={a.id} className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold">{a.name}</span>
                ))}
              </div>
            </div>
          )}
          {detail?.sprint && (
            <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-meta">
              <span className="text-muted-foreground">Sprint</span>
              <span className="truncate font-semibold">{detail.sprint.name}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Client / project */}
      {loading && !data ? (
        <Card icon={<Building2 className="size-4" />} title="Client & project">
          <div className="flex items-center gap-2 py-2 text-meta text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading project context…
          </div>
        </Card>
      ) : err ? (
        <Card
          icon={<Building2 className="size-4" />}
          title="Client & project"
          action={<button onClick={load} title="Retry" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><RefreshCw className="size-3.5" /></button>}
        >
          <p className="text-meta text-amber-600 dark:text-amber-400">{err}</p>
        </Card>
      ) : project ? (
        <Card
          icon={<Building2 className="size-4" />}
          title="Client & project"
          action={
            <button
              onClick={() => onOpenProject?.(project.id)}
              title="Open project workspace"
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-micro font-bold text-primary hover:bg-primary/10"
            >
              Open <ArrowUpRight className="size-3.5" />
            </button>
          }
        >
          <div className="flex flex-col gap-2.5">
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Client</p>
              <p className="truncate text-body-lg font-bold">{project.client?.companyName ?? "Internal"}</p>
              {primaryContact && (
                <div className="mt-1 text-micro text-muted-foreground">
                  <p className="truncate font-medium text-foreground/80">
                    {primaryContact.name}{primaryContact.roleTitle ? ` · ${primaryContact.roleTitle}` : ""}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    {primaryContact.email && (
                      <a href={`mailto:${primaryContact.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-primary">
                        <Mail className="size-3.5 shrink-0" /><span className="truncate">{primaryContact.email}</span>
                      </a>
                    )}
                    {primaryContact.phone && (
                      <a href={`tel:${primaryContact.phone}`} className="inline-flex items-center gap-1 hover:text-primary">
                        <Phone className="size-3.5 shrink-0" />{primaryContact.phone}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Project</p>
              <p className="truncate text-body font-semibold">{project.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold text-muted-foreground">{project.status}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold", HEALTH_TONE[project.healthStatus] ?? "bg-muted text-muted-foreground")}>
                  {project.healthStatus.replace(/_/g, " ")}
                </span>
                {project.assignedPm && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold text-muted-foreground">
                    <Users className="size-3.5" /> {project.assignedPm.name}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-micro font-semibold text-muted-foreground">
                <span>Progress</span>
                <span className="tabular-nums">{project.progress}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }} />
              </div>
            </div>
            {project.targetEndDate && (
              <p className="flex items-center gap-1 text-micro text-muted-foreground">
                <CalendarDays className="size-3.5" /> Target {formatDate(project.targetEndDate)}
              </p>
            )}
          </div>
        </Card>
      ) : (
        <Card icon={<Building2 className="size-4" />} title="Client & project">
          <p className="text-meta text-muted-foreground">No project attached — set one in Task settings to see the client brief, files and research.</p>
        </Card>
      )}

      {/* Project hub links + social accounts */}
      {(briefLinks.length > 0 || socials.length > 0) && (
        <Card icon={<Link2 className="size-4" />} title="Project hub">
          {briefLinks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {briefLinks.map((l) => (
                <a
                  key={l.label}
                  href={absoluteUrl(l.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-micro font-semibold transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {l.label === "Research" ? <BookOpen className="size-3.5" /> : l.label === "Website" ? <Globe2 className="size-3.5" /> : <Link2 className="size-3.5" />}
                  {l.label}
                  <ExternalLink className="size-3.5 opacity-60" />
                </a>
              ))}
            </div>
          )}
          {socials.length > 0 && (
            <div className={cn(briefLinks.length > 0 && "mt-2.5 border-t border-border/50 pt-2.5")}>
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Social accounts</p>
              <div className="flex flex-wrap gap-1.5">
                {socials.map(({ key, label, Icon, tone }) => {
                  const href = (project?.socialLinks as any)?.[key] as string;
                  return (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      title={`${label} · ${hostOf(href)}`}
                      aria-label={label}
                      className={cn("flex size-8 items-center justify-center rounded-xl border transition-colors", tone)}
                    >
                      <Icon className="size-4" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Project files */}
      {files.length > 0 && (
        <Card icon={<FolderOpen className="size-4" />} title={`Project files · ${files.length}`}>
          <div className="flex flex-col gap-1.5">
            {files.slice(0, 6).map((f) => (
              <LinkRow
                key={f.id}
                href={absoluteUrl(f.fileUrl)}
                icon={<FileText className="size-4" />}
                title={fileName(f.fileUrl)}
                meta={`v${f.versionNumber}${f.uploadedBy?.name ? ` · ${f.uploadedBy.name}` : ""}`}
                trailing={
                  f.approvalStatus === "APPROVED" ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                  ) : f.approvalStatus === "REVISION_REQUESTED" ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-micro font-bold text-amber-500">revise</span>
                  ) : null
                }
              />
            ))}
            {files.length > 6 && (
              <button onClick={() => onOpenProject?.(project!.id)} className="mt-0.5 text-left text-micro font-semibold text-primary hover:underline">
                +{files.length - 6} more in the project
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Research & references */}
      {data && project && (
        <Card icon={<BookOpen className="size-4" />} title={`Research & references · ${references.length}`}>
          {references.length === 0 ? (
            <p className="text-meta text-muted-foreground">No research material on this project yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {references.slice(0, 8).map((r) => {
                const href = absoluteUrl(r.fileUrl || r.url);
                return (
                  <LinkRow
                    key={r.id}
                    href={href}
                    icon={<BookOpen className="size-4" />}
                    title={r.title}
                    meta={
                      <span className="flex items-center gap-1">
                        <span className={cn("rounded px-1 py-px text-micro font-bold", REF_TONES[r.type] ?? REF_TONES.OTHER)}>{r.type}</span>
                        {href ? hostOf(href) : "no link"}
                        {r.uploadedBy?.name ? ` · ${r.uploadedBy.name}` : ""}
                      </span>
                    }
                  />
                );
              })}
              {references.length > 8 && (
                <button onClick={() => onOpenProject?.(project!.id)} className="mt-0.5 text-left text-micro font-semibold text-primary hover:underline">
                  +{references.length - 8} more references
                </button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Task attachments + links */}
      {(attachments.length > 0 || taskLinks.length > 0) && (
        <Card icon={<Paperclip className="size-4" />} title={`Task files & links · ${attachments.length + taskLinks.length}`}>
          <div className="flex flex-col gap-1.5">
            {attachments.map((a) => (
              <LinkRow
                key={a.id}
                href={absoluteUrl(a.url)}
                icon={<FileText className="size-4" />}
                title={a.name}
                meta={[a.size, a.uploadedByName, a.uploadedAt ? timeAgo(a.uploadedAt) : null].filter(Boolean).join(" · ")}
              />
            ))}
            {taskLinks.map((l) => (
              <LinkRow
                key={l.id}
                href={absoluteUrl(l.url)}
                icon={<Link2 className="size-4" />}
                title={l.title || hostOf(l.url)}
                meta={hostOf(l.url)}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Deliverables tied to this task */}
      {(data?.deliverables ?? []).length > 0 && (
        <Card icon={<Target className="size-4" />} title="Deliverables">
          <div className="flex flex-wrap gap-1.5">
            {(data?.deliverables ?? []).map((d) => (
              <span
                key={d.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-micro font-semibold",
                  d.id === (data as any)?.focusedDeliverableId
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground"
                )}
              >
                {d.title}
              </span>
            ))}
          </div>
        </Card>
      )}

      {project && (
        <button
          onClick={() => onOpenProject?.(project.id)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-meta font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <FolderKanban className="size-3.5" /> Open full project workspace
          <ArrowUpRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}
