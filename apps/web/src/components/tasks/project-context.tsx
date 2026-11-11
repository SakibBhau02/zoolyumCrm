"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, ExternalLink, FileText, FolderKanban, Link2, Loader2,
  RefreshCw, Target, Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { EmptyState, cn } from "@/components/shared";
import { Btn } from "@/components/table";

export interface ProjectContext {
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
    client?: { id: string; companyName: string } | null;
    assignedPm?: { id: string; name: string } | null;
    _count?: { tasks: number };
  } | null;
  briefLinks: { label: string; url: string }[];
  references: {
    id: string;
    title: string;
    url?: string | null;
    type: string;
    fileUrl?: string | null;
    uploadedBy?: { id: string; name: string } | null;
    createdAt: string;
  }[];
  files: {
    id: string;
    fileUrl: string;
    versionNumber: number;
    approvalStatus: string;
    uploadedBy?: { id: string; name: string } | null;
    uploadedAt: string;
  }[];
  deliverables: { id: string; title: string; status: string; description?: string | null }[];
  reports: { id: string; title: string; status: string; periodStart: string; periodEnd: string }[];
  focusedDeliverableId?: string | null;
}

const REF_TONES: Record<string, string> = {
  DRIVE: "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20",
  NOTION: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  FIGMA: "bg-fuchsia-500/10 text-fuchsia-500 ring-1 ring-fuchsia-500/20",
  OTHER: "bg-muted text-muted-foreground ring-1 ring-border",
};

const fileName = (url: string) => {
  const raw = url.split("?")[0].split("/").pop() ?? "file";
  // uploaded names are stored as "<uuid>--<original>"; show the original
  const parts = raw.split("--");
  return decodeURIComponent(parts.length > 1 ? parts.slice(1).join("--") : raw);
};

/**
 * Project brief + research + files behind the task being assigned.
 * Rendered inline in the task form so the person handing over work can point at
 * the material, and in the detail drawer so the assignee can find it later.
 */
export function ProjectContextPanel({
  projectId,
  taskId,
  compact,
  collapsible = true,
}: {
  /** either a project id directly (task form) or a task id to resolve it from */
  projectId?: string | null;
  taskId?: string | null;
  compact?: boolean;
  collapsible?: boolean;
}) {
  const [data, setData] = useState<ProjectContext | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!collapsible);

  const load = useCallback(() => {
    if (!projectId && !taskId) { setData(null); return; }
    setLoading(true);
    setErr(null);
    // task-scoped route is permission-checked; project-scoped is used in the form
    const req = taskId
      ? apiFetch<ProjectContext>(`/tasks/${taskId}/project-context`)
      : apiFetch<any>(`/flow/projects/${projectId}`).then((p) => apiFetch<ProjectContext>(`/flow/projects/${projectId}/references`).then((refs: any) => ({
          project: p,
          briefLinks: [
            { label: "Brief", url: p.briefLink },
            { label: "Drive", url: p.driveLink },
            { label: "Research", url: p.researchLink },
            { label: "Project link", url: p.projectLink },
            { label: "Website", url: p.websiteUrl },
          ].filter((l: any) => !!l.url),
          references: Array.isArray(refs) ? refs : [],
          files: [],
          deliverables: [],
          reports: [],
        })));
    req.then(setData).catch((e) => setErr(e.message ?? "Failed to load project")).finally(() => setLoading(false));
  }, [projectId, taskId]);

  useEffect(() => { load(); }, [load]);

  if (!projectId && !taskId) return null;

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-3 text-meta text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading project context…
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
        <span className="text-meta font-semibold text-amber-500">Project context unavailable — {err}</span>
        <Btn variant="outline" onClick={load} className="!py-1"><RefreshCw className="size-3.5" /></Btn>
      </div>
    );
  }

  if (!data?.project) {
    return (
      <EmptyState
        title="No project attached"
        hint="Every task belongs to a project — pick one to see its brief, research links and files here."
      />
    );
  }

  const { project } = data;
  const refCount = data.references.length;
  const fileCount = data.files.length;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left", collapsible && "cursor-pointer")}
      >
        <FolderKanban className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-bold">{project.name}</p>
          <p className="truncate text-micro text-muted-foreground">
            {project.client?.companyName ? `${project.client.companyName}` : ""}
            {/* _count only comes from the task-scoped endpoint; the form-mode
                project fetch doesn't include it, so don't print a wrong "0". */}
            {project._count ? ` · ${project._count.tasks} tasks` : ""}
            {refCount ? ` · ${refCount} research` : ""}
            {fileCount ? ` · ${fileCount} files` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold text-primary">{project.progress}%</span>
        {collapsible && (
          <span className="shrink-0 text-micro font-bold text-muted-foreground">{open ? "Hide" : "View"}</span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
          {project.description && (
            <p className="text-meta leading-relaxed text-muted-foreground">{project.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">{project.status}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold",
              project.healthStatus === "ON_TRACK" ? "bg-emerald-500/10 text-emerald-500"
                : project.healthStatus === "AT_RISK" ? "bg-amber-500/10 text-amber-500"
                  : "bg-rose-500/10 text-rose-500")}>{project.healthStatus}</span>
            {project.assignedPm && (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
                <Users className="size-3.5" /> PM {project.assignedPm.name}
              </span>
            )}
            {project.targetEndDate && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
                due {new Date(project.targetEndDate).toLocaleDateString()}
              </span>
            )}
          </div>

          {data.briefLinks.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
                <Link2 className="size-3.5" /> Project brief links
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.briefLinks.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-micro font-semibold transition-colors hover:border-primary/40 hover:text-primary">
                    {l.label} <ExternalLink className="size-3.5" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
              <FileText className="size-3.5" /> Research & references ({refCount})
            </p>
            {refCount === 0 ? (
              <p className="text-meta text-muted-foreground/70">No research material uploaded to this project yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {data.references.slice(0, compact ? 4 : 12).map((r) => {
                  const href = r.fileUrl || r.url || undefined;
                  const Inner = (
                    <>
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-micro font-bold", REF_TONES[r.type] ?? REF_TONES.OTHER)}>{r.type}</span>
                      <span className="min-w-0 flex-1 truncate text-meta font-semibold">{r.title}</span>
                      {href && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
                    </>
                  );
                  return href ? (
                    <a key={r.id} href={href} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 transition-colors hover:border-primary/40">
                      {Inner}
                    </a>
                  ) : (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5">{Inner}</div>
                  );
                })}
                {compact && refCount > 4 && (
                  <p className="text-micro text-muted-foreground">+{refCount - 4} more in the project</p>
                )}
              </div>
            )}
          </div>

          {fileCount > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
                <FileText className="size-3.5" /> Files ({fileCount})
              </p>
              <div className="flex flex-col gap-1">
                {data.files.slice(0, compact ? 3 : 10).map((file) => (
                  <a key={file.id} href={file.fileUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 transition-colors hover:border-primary/40">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-meta font-semibold">{fileName(file.fileUrl)}</span>
                    <span className="shrink-0 text-micro text-muted-foreground">v{file.versionNumber}</span>
                    {file.approvalStatus === "APPROVED" && <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />}
                  </a>
                ))}
              </div>
            </div>
          )}

          {data.deliverables.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
                <Target className="size-3.5" /> Deliverables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.deliverables.map((d) => (
                  <span key={d.id}
                    className={cn("rounded-full border px-2.5 py-1 text-micro font-semibold",
                      d.id === data.focusedDeliverableId ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground")}>
                    {d.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
