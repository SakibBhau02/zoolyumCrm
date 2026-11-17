"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  FileText,
  History,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate, formatMoney, timeAgo } from "@/lib/format";
import { Btn } from "@/components/table";
import { Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { EmptyState, cn } from "@/components/shared";
import type {
  DeliverableCampaignRef,
  ProjectReport,
  ReportDeliverableItem,
  ReportGrouping,
} from "@/lib/types";
import { KIND_LABEL } from "./deliverables-tab";
import { useBranding } from "@/lib/branding-context";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  FINAL: "bg-sky-500/15 text-sky-500",
  SENT: "bg-emerald-500/15 text-emerald-500",
};

const GROUPINGS: { value: ReportGrouping; label: string }[] = [
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "KIND", label: "Type" },
  { value: "OWNER", label: "Owner" },
  { value: "NONE", label: "Flat list" },
];

const groupOf = (item: ReportDeliverableItem, groupBy: ReportGrouping | null | undefined) => {
  if (groupBy === "KIND") return KIND_LABEL[item.kind ?? "OTHER"] ?? "Other";
  if (groupBy === "OWNER") return item.ownerName ?? "Unassigned";
  if (groupBy === "NONE") return "All deliverables";
  return item.campaignName ?? "No campaign";
};

const groupItems = (
  items: ReportDeliverableItem[],
  groupBy: ReportGrouping | null | undefined
) => {
  const map = new Map<string, ReportDeliverableItem[]>();
  for (const item of items) {
    const key = groupOf(item, groupBy);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return [...map.entries()];
};

const monthBounds = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const last30 = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

function ReportCard({
  report,
  currency,
  onChanged,
  notify,
  project,
  anchored,
}: {
  report: ProjectReport;
  currency: string;
  onChanged: () => void;
  notify: (message: string) => void;
  project: any;
  anchored: boolean;
}) {
  const [notesEdit, setNotesEdit] = useState(false);
  const [notesDraft, setNotesDraft] = useState(report.pmNotes ?? "");
  const [busy, setBusy] = useState(false);
  const { branding } = useBranding();

  const summary = report.summary;
  const groupBy = report.groupBy ?? "CAMPAIGN";
  const deliveredGroups = useMemo(
    () => groupItems(report.completed ?? [], groupBy),
    [report.completed, groupBy]
  );
  const pendingGroups = useMemo(
    () => groupItems(report.pending ?? [], groupBy),
    [report.pending, groupBy]
  );

  const saveNotes = async () => {
    setBusy(true);
    try {
      await apiFetch(`/flow/reports/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pmNotes: notesDraft }),
      });
      setNotesEdit(false);
      notify("Report notes saved");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not save the notes");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: string) => {
    try {
      await apiFetch(`/flow/reports/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      notify(status === "SENT" ? "Report marked sent" : "Report updated");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not update the report");
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this report? The snapshot cannot be recovered.")) return;
    try {
      await apiFetch(`/flow/reports/${report.id}`, { method: "DELETE" });
      notify("Report deleted");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not delete the report");
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      // jsPDF is heavy — load it only when someone actually exports.
      const { buildProjectReportPdf } = await import("@/lib/project-report-pdf");
      const doc = await buildProjectReportPdf(report, {
        name: project?.name ?? "Project",
        clientName: project?.client?.companyName ?? null,
        currency,
        pmName: project?.assignedPm?.name ?? null,
      }, { branding: branding as any });
      const safe = `${project?.name ?? "project"}-${report.title}`
        .replace(/[^\w\s-]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);
      doc.save(`${safe}.pdf`);
      notify("PDF downloaded");
    } catch (e: any) {
      notify(e?.message ?? "Could not build the PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id={`report-${report.id}`}
      className={cn(
        "rounded-2xl border border-border/60 p-3.5",
        anchored && "border-primary/60 ring-2 ring-primary/20"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-body font-bold">{report.title}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-micro font-bold",
            STATUS_STYLE[report.status]
          )}
        >
          {report.status.toLowerCase()}
        </span>
        <Btn variant="outline" onClick={downloadPdf} className={busy ? "opacity-60" : ""}>
          <Download className="size-3.5" /> PDF
        </Btn>
        {report.status !== "SENT" && (
          <button
            type="button"
            onClick={() => setStatus("SENT")}
            className="rounded-lg px-2 py-1 text-micro font-bold text-emerald-500 transition-colors hover:bg-emerald-500/10"
            title="Mark sent to the client"
          >
            <Send className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          title="Delete report"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <p className="mt-0.5 text-micro text-muted-foreground">
        {formatDate(report.periodStart)} – {formatDate(report.periodEnd)} · generated{" "}
        {timeAgo(report.createdAt)}
        {report.generatedBy?.name ? ` by ${report.generatedBy.name}` : ""}
        {report.sentAt ? ` · sent ${timeAgo(report.sentAt)}` : ""}
        {report.campaignLabel ? ` · campaign: ${report.campaignLabel}` : ""}
      </p>

      {/* type breakdown */}
      {summary?.byKind && Object.keys(summary.byKind).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(summary.byKind).map(([kind, bucket]) => {
            const pct = bucket.total ? Math.round((bucket.delivered / bucket.total) * 100) : 0;
            return (
              <div
                key={kind}
                className="min-w-32 flex-1 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[kind] ?? kind}
                  </span>
                  <span className="text-micro font-bold tabular-nums">
                    {bucket.delivered}/{bucket.total}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 100 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-primary"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          <p className="text-micro font-bold uppercase tracking-wide text-emerald-500">
            Delivered ({report.completed.length})
          </p>
          {!deliveredGroups.length ? (
            <p className="mt-1 text-meta text-muted-foreground">Nothing delivered in this period.</p>
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              {deliveredGroups.map(([group, items]) => (
                <div key={group}>
                  <p className="text-micro font-bold text-foreground/70">
                    {group} · {items.length}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((item, index) => (
                      <li
                        key={item.deliverableId ?? `${group}-${item.title}-${index}`}
                        className="flex items-start gap-1 text-meta"
                      >
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                        <span className="min-w-0">
                          <span className="font-semibold">{item.topic || item.title}</span>
                          {item.objective && (
                            <span className="block text-micro text-muted-foreground">{item.objective}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
            Pending ({report.pending.length})
          </p>
          {!pendingGroups.length ? (
            <p className="mt-1 text-meta text-emerald-500">All committed deliverables shipped ✓</p>
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              {pendingGroups.map(([group, items]) => (
                <div key={group}>
                  <p className="text-micro font-bold text-foreground/70">
                    {group} · {items.length}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((item, index) => (
                      <li
                        key={item.deliverableId ?? `${group}-${item.title}-${index}`}
                        className="flex items-start gap-1 text-meta text-muted-foreground"
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                        <span className="min-w-0">
                          <span className="font-semibold text-foreground/80">
                            {item.topic || item.title}
                          </span>
                          <span className="block text-micro">
                            {[
                              KIND_LABEL[item.kind ?? "OTHER"],
                              item.ownerName ? `owner ${item.ownerName}` : null,
                              item.dueDate ? `due ${formatDate(item.dueDate)}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {summary?.shoots && summary.shoots.count > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-1.5">
          <span className="inline-flex items-center gap-1 text-micro font-bold text-muted-foreground">
            <Camera className="size-3.5" /> Shoots
          </span>
          <span className="text-micro text-muted-foreground">
            {summary.shoots.count} · {summary.shoots.fullDays} full day · {summary.shoots.halfDays} half day ·{" "}
            {summary.shoots.crewCount} crew · {summary.shoots.equipmentCount} equipment
          </span>
          <div className="flex flex-wrap gap-1">
            {(report.shoots ?? []).slice(0, 6).map((s) => (
              <span
                key={s.id}
                className="rounded-full border border-border px-2 py-0.5 text-micro font-semibold"
                title={s.location ?? undefined}
              >
                {formatDate(s.date)} · {s.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {report.billing && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-muted/40 px-2.5 py-1.5 text-micro text-muted-foreground">
          <span>
            Invoiced{" "}
            <span className="font-bold text-foreground">
              {formatMoney(report.billing.invoiced, currency)}
            </span>
          </span>
          <span>
            Collected{" "}
            <span className="font-bold text-emerald-500">
              {formatMoney(report.billing.collected, currency)}
            </span>
          </span>
          <span>
            Outstanding{" "}
            <span className="font-bold text-amber-500">
              {formatMoney(report.billing.outstanding, currency)}
            </span>
          </span>
        </div>
      )}

      {notesEdit ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="PM notes / next steps (client-facing)…"
            className="min-h-16"
            maxLength={4000}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setNotesEdit(false);
                setNotesDraft(report.pmNotes ?? "");
              }}
              className="rounded-lg px-2 py-1 text-meta font-bold text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveNotes}
              disabled={busy}
              className="rounded-lg bg-brand-gradient px-2.5 py-1 text-meta font-bold text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {report.pmNotes ? (
            <p
              className="cursor-pointer rounded-xl bg-muted/30 px-2.5 py-1.5 text-meta text-muted-foreground whitespace-pre-wrap"
              title="Click to edit"
              onClick={() => {
                setNotesDraft(report.pmNotes ?? "");
                setNotesEdit(true);
              }}
            >
              <span className="font-bold text-foreground">PM notes: </span>
              {report.pmNotes}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNotesDraft("");
                setNotesEdit(true);
              }}
              className="text-meta font-bold text-primary hover:underline"
            >
              + add PM notes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ReportsTab({
  projectId,
  project,
  reports,
  campaigns,
  focusReportId,
  onChanged,
  notify,
}: {
  projectId: string;
  project: any;
  reports: ProjectReport[];
  campaigns: DeliverableCampaignRef[];
  focusReportId?: string | null;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const currency = project?.currency ?? "BDT";
  const [genOpen, setGenOpen] = useState(false);
  const [genCampaign, setGenCampaign] = useState("");
  const [genGroupBy, setGenGroupBy] = useState<ReportGrouping>("CAMPAIGN");
  const [genStart, setGenStart] = useState(monthBounds().start);
  const [genEnd, setGenEnd] = useState(monthBounds().end);
  const [genPreset, setGenPreset] = useState<"month" | "30d" | "custom">("month");
  const [genNotes, setGenNotes] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const schedule = project?.reportMode === "AUTOMATIC" ? project?.reportFrequency ?? "30-days" : "MANUAL";

  const setSchedule = async (value: string) => {
    try {
      const body =
        value === "MANUAL"
          ? { reportMode: "MANUAL" }
          : { reportMode: "AUTOMATIC", reportFrequency: value };
      await apiFetch(`/flow/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      notify(
        value === "MANUAL"
          ? "Reports are manual now"
          : `Reports will be generated every ${value.replace("-days", "")} days`
      );
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not update the schedule");
    }
  };

  const applyPreset = (preset: "month" | "30d" | "custom") => {
    setGenPreset(preset);
    if (preset === "month") {
      const b = monthBounds();
      setGenStart(b.start);
      setGenEnd(b.end);
    } else if (preset === "30d") {
      const b = last30();
      setGenStart(b.start);
      setGenEnd(b.end);
    }
  };

  const generate = async () => {
    setGenError(null);
    setGenBusy(true);
    try {
      await apiFetch(`/flow/projects/${projectId}/reports/generate`, {
        method: "POST",
        body: JSON.stringify({
          periodStart: genStart,
          periodEnd: genEnd,
          campaignId: genCampaign || undefined,
          groupBy: genGroupBy,
          pmNotes: genNotes.trim() || undefined,
        }),
      });
      setGenOpen(false);
      setGenNotes("");
      notify("Report generated");
      onChanged();
    } catch (e: any) {
      setGenError(e?.message ?? "Could not generate the report");
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 p-3">
        <div className="min-w-0">
          <p className="text-meta font-bold">Progress reports</p>
          <p className="text-micro text-muted-foreground">
            Deliverables, shoots and billing snapshot · type + campaign breakdown
            {project?.reportMode === "AUTOMATIC" && project?.reportFrequency
              ? ` · auto ${project.reportFrequency}`
              : " · manual"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={() => setGenOpen(true)}>
            <Plus className="size-3.5" /> Generate report
          </Btn>
          <Select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="!w-44 !py-1.5 text-meta"
            title="Report cadence"
          >
            <option value="MANUAL">Manual only</option>
            <option value="15-days">Auto · every 15 days</option>
            <option value="30-days">Auto · every 30 days</option>
          </Select>
        </div>
      </div>

      {!reports.length ? (
        <EmptyState
          title="No reports yet"
          hint="Generate a report — delivered and pending deliverables, the period's shoots and the billing snapshot are pulled automatically."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              currency={currency}
              project={project}
              onChanged={onChanged}
              notify={notify}
              anchored={focusReportId === r.id}
            />
          ))}
        </div>
      )}

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        closeOnBackdrop={!genBusy}
        size="lg"
        eyebrow="Report"
        icon={<History className="size-5" />}
        title="Generate a progress report"
        subtitle="A frozen snapshot — later edits never rewrite a report already sent."
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setGenOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={genBusy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-body font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <FileText className="size-3.5" /> {genBusy ? "Generating…" : "Generate"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {genError && (
            <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-meta text-rose-500">
              {genError}
            </p>
          )}

          <Field label="Period">
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "month", label: "This month" },
                { value: "30d", label: "Last 30 days" },
                { value: "custom", label: "Custom" },
              ].map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => applyPreset(p.value as any)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-meta font-semibold transition-colors",
                    genPreset === p.value
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <Input
                type="date"
                value={genStart}
                onChange={(e) => {
                  setGenStart(e.target.value);
                  setGenPreset("custom");
                }}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={genEnd}
                min={genStart || undefined}
                onChange={(e) => {
                  setGenEnd(e.target.value);
                  setGenPreset("custom");
                }}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign" hint="Report only this campaign's work">
              <Select value={genCampaign} onChange={(e) => setGenCampaign(e.target.value)}>
                <option value="">Whole project</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group sections by">
              <Select
                value={genGroupBy}
                onChange={(e) => setGenGroupBy(e.target.value as ReportGrouping)}
              >
                {GROUPINGS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="PM notes" hint="Optional, client-facing">
            <Textarea
              value={genNotes}
              onChange={(e) => setGenNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="What moved, what is next, anything the client should know."
            />
          </Field>

          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-micro text-muted-foreground">
            The report freezes the deliverables, shoot call-sheets (crew + equipment) and billing at this
            moment. PDF export uses that snapshot, not the live project.
          </p>
        </div>
      </Modal>
    </div>
  );
}
