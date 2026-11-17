"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Package,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDate } from "@/lib/format";
import { Btn } from "@/components/table";
import { EmptyState, cn } from "@/components/shared";
import { Input } from "@/components/ui";
import type { DeliverableCampaignRef, Shoot, ShootStatus } from "@/lib/types";
import { SHOOT_STATUSES, SHOOT_STATUS_STYLE, roleLabel, ShootEditorModal } from "./shoot-editor";

const dayOf = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "2-digit" });
const monthOf = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKeyOf = (value: string) => String(value).slice(0, 10);

function relativeDays(dateKey: string) {
  const diff = Math.round(
    (new Date(`${dateKey}T00:00:00Z`).getTime() - new Date(`${todayKey()}T00:00:00Z`).getTime()) /
      86400000
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1) return `in ${diff} days`;
  if (diff === -1) return "yesterday";
  return `${Math.abs(diff)} days ago`;
}

function ShootCard({
  shoot,
  busy,
  onEdit,
  onDelete,
}: {
  shoot: Shoot;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const past = dayKeyOf(shoot.shootDate) < todayKey();
  const crew = shoot.crew ?? [];
  const confirmed = crew.filter((c) => c.isConfirmed).length;

  return (
    <div
      className={cn(
        "group rounded-2xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/25",
        past && shoot.status !== "WRAPPED" && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-muted/60 py-1.5">
          <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
            {monthOf(shoot.shootDate)}
          </span>
          <span className="font-heading text-body-lg font-bold tabular-nums leading-tight">
            {dayOf(shoot.shootDate)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-body font-bold">{shoot.title}</p>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wide",
                SHOOT_STATUS_STYLE[shoot.status]
              )}
            >
              {SHOOT_STATUSES.find((s) => s.value === shoot.status)?.label ?? shoot.status}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
              {shoot.durationType === "FULL_DAY" ? "Full day" : "Half day"}
            </span>
            {shoot.isDateLocked && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold text-primary">
                Date locked
              </span>
            )}
            {shoot.campaign && (
              <span className="truncate rounded-full border border-border px-2 py-0.5 text-micro font-semibold text-muted-foreground">
                {shoot.campaign.name}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
            <span className={cn("font-semibold", !past && "text-foreground")}>
              {formatDate(shoot.shootDate)}
              {shoot.endDate ? ` → ${formatDate(shoot.endDate)}` : ""}
              {!past && ` · ${relativeDays(dayKeyOf(shoot.shootDate))}`}
            </span>
            {(shoot.callTime || shoot.wrapTime) && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" />
                {shoot.callTime ?? "—"}
                {shoot.wrapTime ? ` → ${shoot.wrapTime}` : ""}
              </span>
            )}
            {shoot.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{shoot.location}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {crew.length} crew{crew.length ? ` · ${confirmed} confirmed` : ""}
            </span>
            {(shoot.equipment?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Package className="size-3.5" />
                {shoot.equipment.length} equipment
              </span>
            )}
          </div>

          {crew.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {crew.slice(0, 5).map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-semibold",
                    c.isConfirmed
                      ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-muted/40 text-muted-foreground"
                  )}
                  title={`${roleLabel(c.role)} — ${c.source.toLowerCase()}`}
                >
                  {roleLabel(c.role)}: {c.name}
                </span>
              ))}
              {crew.length > 5 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
                  +{crew.length - 5}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Edit shoot"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
            title="Delete shoot"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShootTab({
  projectId,
  clientId,
  shoots,
  employees,
  onChanged,
  notify,
}: {
  projectId: string;
  clientId?: string | null;
  shoots: Shoot[];
  employees: { id: string; name: string; roleTitle?: string | null }[];
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const { data: campaignData } = useApi<any[]>(`/calendar/campaigns?clientId=${clientId ?? ""}`);
  const { data: vendorData } = useApi<any[]>("/capital/vendors");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Shoot | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | ShootStatus>("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const campaigns: DeliverableCampaignRef[] = useMemo(
    () =>
      (campaignData ?? [])
        .filter((c) => !clientId || c.clientId === clientId)
        .map((c) => ({ id: c.id, name: c.name })),
    [campaignData, clientId]
  );
  const vendors = useMemo(
    () => (vendorData ?? []).map((v) => ({ id: v.id, name: v.name })),
    [vendorData]
  );

  const summary = useMemo(() => {
    const fullDays = shoots.filter((s) => s.durationType === "FULL_DAY").length;
    const halfDays = shoots.filter((s) => s.durationType === "HALF_DAY").length;
    const upcoming = shoots.filter(
      (s) => dayKeyOf(s.shootDate) >= todayKey() && s.status !== "CANCELLED"
    );
    return { fullDays, halfDays, next: upcoming[0] ?? null, upcoming: upcoming.length };
  }, [shoots]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shoots.filter(
      (s) =>
        (!statusFilter || s.status === statusFilter) &&
        (!q ||
          s.title.toLowerCase().includes(q) ||
          (s.location ?? "").toLowerCase().includes(q) ||
          s.crew.some((c) => c.name.toLowerCase().includes(q)) ||
          s.equipment.some((e) => e.toLowerCase().includes(q)))
    );
  }, [shoots, statusFilter, query]);

  const sorted = useMemo(() => {
    const order = [...visible].sort(
      (a, b) => new Date(a.shootDate).getTime() - new Date(b.shootDate).getTime()
    );
    return order;
  }, [visible]);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (shoot: Shoot) => {
    setEditing(shoot);
    setEditorOpen(true);
  };

  const remove = async (shoot: Shoot) => {
    if (!window.confirm(`Delete "${shoot.title}"? Its calendar event is removed too.`)) return;
    setBusyId(shoot.id);
    try {
      await apiFetch(`/flow/shoots/${shoot.id}`, { method: "DELETE" });
      notify("Shoot removed");
      onChanged();
    } catch (e: any) {
      notify(e?.message ?? "Could not delete the shoot");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-2xl border border-border/60 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-body font-bold">Production days</p>
          <p className="text-meta text-muted-foreground">
            {shoots.length
              ? `${shoots.length} shoot${shoots.length === 1 ? "" : "s"} · ${summary.fullDays} full day · ${summary.halfDays} half day${
                  summary.next ? ` · next ${formatDate(summary.next.shootDate)}` : ""
                }`
              : "No production days planned yet"}
          </p>
        </div>
        <Btn variant="primary" onClick={openNew}>
          <Plus className="size-3.5" /> New shoot
        </Btn>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, crew, location or equipment…"
          className="max-w-64 !py-1.5 text-meta"
        />
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-micro font-bold transition-colors",
              statusFilter === ""
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {SHOOT_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-micro font-bold transition-colors",
                statusFilter === s.value
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={shoots.length ? "No shoots match this filter" : "No shoot yet"}
          hint={
            shoots.length
              ? "Clear the search or pick another status."
              : "Plan the production day: date, half or full day, who travels and what gear goes."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((shoot) => (
            <ShootCard
              key={shoot.id}
              shoot={shoot}
              busy={busyId === shoot.id}
              onEdit={() => openEdit(shoot)}
              onDelete={() => remove(shoot)}
            />
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-micro text-muted-foreground">
        <CalendarDays className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Every shoot is mirrored onto the Calendar as a <span className="font-bold text-foreground">Shoot</span> event
          with the call time, location and team crew. Edit it here — the calendar follows.
        </p>
      </div>

      <ShootEditorModal
        open={editorOpen}
        projectId={projectId}
        shoot={editing}
        employees={employees}
        vendors={vendors}
        campaigns={campaigns}
        previousShoots={shoots.filter((s) => s.id !== editing?.id)}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          notify(editing ? "Shoot updated" : "Shoot created");
          onChanged();
        }}
      />
    </div>
  );
}
