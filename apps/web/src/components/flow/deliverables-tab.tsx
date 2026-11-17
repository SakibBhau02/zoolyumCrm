"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ClipboardPaste,
  Link2,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDate } from "@/lib/format";
import { Btn } from "@/components/table";
import { ChipGroup, Field, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, cn } from "@/components/shared";
import type {
  DeliverableCampaignRef,
  DeliverableKind,
  ProjectDeliverable,
} from "@/lib/types";
import { AssignTasksModal } from "./assign-tasks-modal";
import { BulkDeliverablesModal } from "./bulk-deliverables-modal";

const KINDS: { value: DeliverableKind; label: string }[] = [
  { value: "GRAPHIC", label: "Graphic" },
  { value: "VIDEO", label: "Video" },
  { value: "PHOTO", label: "Photo" },
  { value: "COPY", label: "Copy" },
  { value: "OTHER", label: "Other" },
];

export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label])
);

export const KIND_STYLE: Record<string, string> = {
  GRAPHIC: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  VIDEO: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  PHOTO: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  COPY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  OTHER: "border-border bg-muted/60 text-muted-foreground",
};

const STATUS_STYLE: Record<string, string> = {
  DELIVERED: "bg-emerald-500",
  IN_PROGRESS: "bg-amber-400",
  PENDING: "bg-muted-foreground/30",
};

const dateInput = (value?: string | null) => (value ? String(value).slice(0, 10) : "");

type Draft = {
  title: string;
  kind: DeliverableKind | "";
  topic: string;
  objective: string;
  campaignId: string;
  ownerId: string;
  startDate: string;
  dueDate: string;
  clientVisible: boolean;
  description: string;
};

const draftFrom = (d: ProjectDeliverable): Draft => ({
  title: d.title,
  kind: d.kind ?? "",
  topic: d.topic ?? "",
  objective: d.objective ?? "",
  campaignId: d.campaignId ?? "",
  ownerId: d.ownerId ?? "",
  startDate: dateInput(d.startDate),
  dueDate: dateInput(d.dueDate),
  clientVisible: d.clientVisible,
  description: d.description ?? "",
});

export function DeliverablesTab({
  projectId,
  clientId,
  deliverables,
  employees,
  onChanged,
  notify,
}: {
  projectId: string;
  clientId?: string | null;
  deliverables: ProjectDeliverable[];
  employees: { id: string; name: string; roleTitle?: string | null; employmentStatus?: string }[];
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const { data: campaignData } = useApi<any[]>(`/calendar/campaigns?clientId=${clientId ?? ""}`);
  const campaigns: DeliverableCampaignRef[] = useMemo(
    () =>
      (campaignData ?? [])
        .filter((c) => !clientId || c.clientId === clientId)
        .map((c) => ({ id: c.id, name: c.name })),
    [campaignData, clientId]
  );

  const [title, setTitle] = useState("");
  const [addKind, setAddKind] = useState<DeliverableKind>("GRAPHIC");
  const [addCampaign, setAddCampaign] = useState("");
  const [busy, setBusy] = useState(false);

  const [kindFilter, setKindFilter] = useState<"" | DeliverableKind>("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignCompleted, setAssignCompleted] = useState(false);

  const ownerName = useMemo(() => {
    const map = new Map(employees.map((e) => [e.id, e.name]));
    return (id: string | null) => (id ? map.get(id) ?? "Unknown" : null);
  }, [employees]);

  const counts = useMemo(() => {
    const out: Record<string, { delivered: number; total: number }> = {};
    for (const d of deliverables) {
      const key = d.kind ?? "OTHER";
      out[key] ??= { delivered: 0, total: 0 };
      out[key].total++;
      if (d.status === "DELIVERED") out[key].delivered++;
    }
    return out;
  }, [deliverables]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deliverables.filter(
      (d) =>
        (!kindFilter || (d.kind ?? "OTHER") === kindFilter) &&
        (!campaignFilter || d.campaignId === campaignFilter) &&
        (!statusFilter || d.status === statusFilter) &&
        (!q ||
          d.title.toLowerCase().includes(q) ||
          (d.topic ?? "").toLowerCase().includes(q) ||
          (d.objective ?? "").toLowerCase().includes(q))
    );
  }, [deliverables, kindFilter, campaignFilter, statusFilter, query]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((d) => next.delete(d.id));
      else visible.forEach((d) => next.add(d.id));
      return next;
    });

  const selectedDeliverables = deliverables.filter((d) => selected.has(d.id));

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/flow/projects/${projectId}/deliverables`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          kind: addKind,
          campaignId: addCampaign || undefined,
        }),
      });
      setTitle("");
      notify("Deliverable added");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not add the deliverable");
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (d: ProjectDeliverable) => {
    if (expanded === d.id) {
      setExpanded(null);
      setDraft(null);
      return;
    }
    setExpanded(d.id);
    setDraft(draftFrom(d));
  };

  const saveDraft = async (d: ProjectDeliverable) => {
    if (!draft) return;
    if (!draft.title.trim()) return notify("Title cannot be empty");
    setSavingId(d.id);
    try {
      await apiFetch(`/flow/deliverables/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: draft.title.trim(),
          kind: draft.kind || undefined,
          topic: draft.topic.trim() || null,
          objective: draft.objective.trim() || null,
          campaignId: draft.campaignId || null,
          ownerId: draft.ownerId || null,
          startDate: draft.startDate || null,
          dueDate: draft.dueDate || null,
          clientVisible: draft.clientVisible,
          description: draft.description.trim() || null,
        }),
      });
      setExpanded(null);
      setDraft(null);
      notify("Deliverable updated");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not save");
    } finally {
      setSavingId(null);
    }
  };

  const setStatus = async (d: ProjectDeliverable, status: string) => {
    try {
      await apiFetch(`/flow/deliverables/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      notify(status === "DELIVERED" ? "Marked delivered" : "Reopened");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not update the status");
    }
  };

  const remove = async (d: ProjectDeliverable) => {
    if (!window.confirm(`Delete "${d.topic ?? d.title}"? Linked tasks stay, but lose the link.`)) return;
    try {
      await apiFetch(`/flow/deliverables/${d.id}`, { method: "DELETE" });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(d.id);
        return next;
      });
      notify("Deliverable removed");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not delete");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── add row ── */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border/60 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Deliverable — e.g. 30-sec brand film, 12 social creatives…"
            className="flex-1"
            maxLength={200}
          />
          <Select
            value={addCampaign}
            onChange={(e) => setAddCampaign(e.target.value)}
            className="!py-2 text-meta sm:!w-44"
            aria-label="Campaign for the new deliverable"
          >
            <option value="">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Btn variant="primary" onClick={add} className={busy ? "opacity-50" : ""}>
            <Plus className="size-3.5" /> Add
          </Btn>
          <Btn variant="outline" onClick={() => setBulkOpen(true)}>
            <ClipboardPaste className="size-3.5" /> Bulk paste
          </Btn>
        </div>
        <ChipGroup value={addKind} onChange={setAddKind} options={KINDS} size="sm" />
      </div>

      {/* ── summary + filters ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setKindFilter("");
            setCampaignFilter("");
            setStatusFilter("");
            setQuery("");
          }}
          className={cn(
            "rounded-full border px-2.5 py-1 text-micro font-bold transition-colors",
            !kindFilter && !campaignFilter && !statusFilter && !query
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          All {deliverables.length}
        </button>
        {KINDS.filter((k) => counts[k.value]).map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKindFilter(kindFilter === k.value ? "" : k.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-micro font-bold transition-colors",
              kindFilter === k.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {k.label} {counts[k.value].delivered}/{counts[k.value].total}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topic or objective…"
            className="max-w-56 !py-1 text-meta"
          />
          {campaigns.length > 0 && (
            <Select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="!w-40 !py-1 text-meta"
              aria-label="Filter by campaign"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="!w-32 !py-1 text-meta"
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="DELIVERED">Delivered</option>
          </Select>
        </div>
      </div>

      {/* ── selection bar ── */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 backdrop-blur">
          <span className="text-meta font-bold text-primary">{selected.size} selected</span>
          <Btn variant="primary" onClick={() => setAssignOpen(true)}>
            <UserRound className="size-3.5" /> Assign as tasks
          </Btn>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-lg px-2 py-1 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted"
          >
            Clear
          </button>
          {selectedDeliverables.some((d) => (d.tasks?.length ?? 0) > 0) && (
            <span className="text-micro text-amber-500">
              {selectedDeliverables.filter((d) => (d.tasks?.length ?? 0) > 0).length} already linked
            </span>
          )}
        </div>
      )}

      {!deliverables.length ? (
        <EmptyState
          title="No deliverables yet"
          hint="Add what was promised in the proposal — bulk paste 8 graphics and 4 videos in one go."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing matches this filter" hint="Clear the search or pick another type." />
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 px-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              className="size-3.5 accent-primary"
            />
            Select all shown ({visible.length})
          </label>

          {visible.map((d) => {
            const isOpen = expanded === d.id;
            const tasks = d.tasks ?? [];
            const tasksDone = tasks.filter((t) => t.status === "DONE").length;
            return (
              <div
                key={d.id}
                className={cn(
                  "rounded-xl border border-border/60 px-3 py-2 transition-colors",
                  isOpen && "border-primary/30 bg-muted/10"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggleSelect(d.id)}
                    className="size-3.5 shrink-0 accent-primary"
                    aria-label={`Select ${d.title}`}
                  />
                  <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLE[d.status])} />
                  <button
                    type="button"
                    onClick={() => openEditor(d)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    title="Open the details"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate text-body font-semibold">{d.title}</span>
                  </button>

                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide",
                      KIND_STYLE[d.kind ?? "OTHER"]
                    )}
                  >
                    {KIND_LABEL[d.kind ?? "OTHER"]}
                  </span>

                  {tasks.length > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-micro font-bold text-muted-foreground">
                      {tasksDone}/{tasks.length} tasks
                    </span>
                  )}

                  {d.status === "DELIVERED" ? (
                    <button
                      type="button"
                      onClick={() => setStatus(d, "PENDING")}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-micro font-bold text-emerald-500 transition-colors hover:bg-emerald-500/25"
                      title="Reopen"
                    >
                      <CheckCircle2 className="size-3" /> delivered
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStatus(d, "DELIVERED")}
                      className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground transition-colors hover:bg-emerald-500/15 hover:text-emerald-500"
                      title="Mark delivered"
                    >
                      mark delivered
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => remove(d)}
                    className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                    title="Delete deliverable"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {(d.topic || d.objective || d.campaign || d.dueDate || d.ownerId) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-micro text-muted-foreground">
                    {d.topic && <span className="font-semibold text-foreground/80">{d.topic}</span>}
                    {d.objective && <span>{d.objective}</span>}
                    {d.campaign && (
                      <span className="rounded-full border border-border px-1.5">{d.campaign.name}</span>
                    )}
                    {d.dueDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3" /> {formatDate(d.dueDate)}
                      </span>
                    )}
                    {d.ownerId && (
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3" /> {ownerName(d.ownerId)}
                      </span>
                    )}
                    {d.clientVisible && <span className="text-primary">client-visible</span>}
                  </div>
                )}

                {isOpen && draft && (
                  <div className="mt-2 rounded-xl border border-border/60 bg-card p-3">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Field label="Title">
                        <Input
                          value={draft.title}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          maxLength={200}
                        />
                      </Field>
                      <Field label="Topic" hint="What the item actually is">
                        <Input
                          value={draft.topic}
                          onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                          placeholder="e.g. Eid greeting post — peacock motif"
                          maxLength={200}
                        />
                      </Field>
                      <Field label="Objective" hint="Why it exists">
                        <Input
                          value={draft.objective}
                          onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
                          placeholder="Awareness / Launch / Conversion…"
                          maxLength={200}
                        />
                      </Field>
                      <Field label="Campaign">
                        <Select
                          value={draft.campaignId}
                          onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}
                        >
                          <option value="">No campaign</option>
                          {campaigns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Owner" hint="Who is responsible">
                        <Select
                          value={draft.ownerId}
                          onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}
                        >
                          <option value="">Unassigned</option>
                          {employees.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Start date">
                          <Input
                            type="date"
                            value={draft.startDate}
                            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Due date">
                          <Input
                            type="date"
                            value={draft.dueDate}
                            min={draft.startDate || undefined}
                            onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <Field label="Type">
                        <ChipGroup
                          size="sm"
                          value={(draft.kind || "OTHER") as DeliverableKind}
                          onChange={(v) => setDraft({ ...draft, kind: v })}
                          options={KINDS}
                        />
                      </Field>
                      <label className="flex cursor-pointer items-center justify-between gap-3 self-end rounded-xl border border-border/70 bg-card px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-body font-semibold leading-tight">Client-visible</span>
                          <span className="mt-0.5 block text-micro text-muted-foreground">
                            Shows in the client portal
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={draft.clientVisible}
                          onChange={(e) => setDraft({ ...draft, clientVisible: e.target.checked })}
                          className="size-4 accent-primary"
                        />
                      </label>
                    </div>

                    <Field label="Description" hint="Optional detail the client never needs to see" className="mt-3">
                      <Textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={2}
                        maxLength={2000}
                      />
                    </Field>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1 text-micro text-muted-foreground">
                        <Link2 className="size-3" />
                        {tasks.length
                          ? `Linked to ${tasks.length} task${tasks.length === 1 ? "" : "s"} — completion updates this deliverable`
                          : "Not linked to a task yet — use “Assign as tasks”"}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(null);
                            setDraft(null);
                          }}
                          className="rounded-lg px-2 py-1 text-meta font-bold text-muted-foreground transition-colors hover:bg-muted"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveDraft(d)}
                          disabled={savingId === d.id}
                          className="rounded-lg bg-brand-gradient px-2.5 py-1 text-meta font-bold text-white disabled:opacity-60"
                        >
                          {savingId === d.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-micro text-muted-foreground">
        <ClipboardList className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Deliverables are the commitments from the proposal. A completed task auto-marks its
          deliverable delivered, and this list feeds the campaign report.
        </span>
      </p>

      <BulkDeliverablesModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        projectId={projectId}
        campaigns={campaigns}
        onDone={(message) => {
          notify(message);
          onChanged();
        }}
      />

      <AssignTasksModal
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          setAssignCompleted(false);
          // Refresh only after the result panel is dismissed: reloading mid-flight
          // remounts the workspace pane and would close this sheet instantly.
          if (assignCompleted) onChanged();
          setSelected(new Set());
        }}
        projectId={projectId}
        deliverables={selectedDeliverables}
        employees={employees}
        onDone={(message) => {
          setAssignCompleted(true);
          notify(message);
        }}
      />
    </div>
  );
}
