"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Check, Copy, MapPin, Plus, Trash2, UserRound, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Btn } from "@/components/table";
import {
  ChipGroup,
  Field,
  FormError,
  FormSection,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { cn } from "@/components/shared";
import type {
  DeliverableCampaignRef,
  Shoot,
  ShootCrewRole,
  ShootCrewSource,
  ShootDuration,
  ShootStatus,
} from "@/lib/types";

export const SHOOT_ROLES: { value: ShootCrewRole; label: string }[] = [
  { value: "DOP", label: "DoP" },
  { value: "CAMERAMAN", label: "Cameraman" },
  { value: "ASSISTANT_CAMERA", label: "Assistant camera" },
  { value: "GAFFER", label: "Gaffer" },
  { value: "GRIP", label: "Grip" },
  { value: "SOUND", label: "Sound" },
  { value: "ART_DIRECTOR", label: "Art director" },
  { value: "STYLIST", label: "Stylist" },
  { value: "MAKEUP", label: "Makeup" },
  { value: "PRODUCER", label: "Producer" },
  { value: "LINE_PRODUCER", label: "Line producer" },
  { value: "PHOTOGRAPHER", label: "Photographer" },
  { value: "DRONE_OPERATOR", label: "Drone operator" },
  { value: "DRIVER", label: "Driver" },
  { value: "TALENT", label: "Talent / model" },
  { value: "TEAM_MEMBER", label: "Team member" },
  { value: "OTHER", label: "Other" },
];

export const SHOOT_STATUSES: { value: ShootStatus; label: string }[] = [
  { value: "PLANNED", label: "Planned" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WRAPPED", label: "Wrapped" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const roleLabel = (role: string) =>
  SHOOT_ROLES.find((r) => r.value === role)?.label ?? role;

export const SHOOT_STATUS_STYLE: Record<string, string> = {
  PLANNED: "border-border bg-muted/60 text-muted-foreground",
  CONFIRMED: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  IN_PROGRESS: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  WRAPPED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  CANCELLED: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};

/** `2026-11-18T00:00:00.000Z` → `2026-11-18` for a date input. */
const dateInput = (value?: string | null) => (value ? String(value).slice(0, 10) : "");
const todayInput = () => new Date().toISOString().slice(0, 10);

type CrewDraft = {
  key: string;
  id?: string;
  role: ShootCrewRole;
  source: ShootCrewSource;
  employeeId: string;
  vendorId: string;
  name: string;
  phone: string;
  callTime: string;
  fee: string;
  isConfirmed: boolean;
  removed?: boolean;
};

const newCrewRow = (partial?: Partial<CrewDraft>): CrewDraft => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  role: "CAMERAMAN",
  source: "EMPLOYEE",
  employeeId: "",
  vendorId: "",
  name: "",
  phone: "",
  callTime: "",
  fee: "",
  isConfirmed: false,
  ...partial,
});

const crewToDraft = (c: {
  id: string;
  role: ShootCrewRole;
  source: ShootCrewSource;
  employeeId: string | null;
  vendorId: string | null;
  name: string;
  phone: string | null;
  callTime: string | null;
  fee: number | string | null;
  isConfirmed: boolean;
}): CrewDraft => ({
  key: c.id,
  id: c.id,
  role: c.role,
  source: c.source,
  employeeId: c.employeeId ?? "",
  vendorId: c.vendorId ?? "",
  name: c.name,
  phone: c.phone ?? "",
  callTime: c.callTime ?? "",
  fee: c.fee == null ? "" : String(c.fee),
  isConfirmed: c.isConfirmed,
});

export function ShootEditorModal({
  open,
  projectId,
  shoot,
  employees,
  vendors,
  campaigns,
  previousShoots,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  shoot: Shoot | null;
  employees: { id: string; name: string; roleTitle?: string | null }[];
  vendors: { id: string; name: string }[];
  campaigns: DeliverableCampaignRef[];
  previousShoots: Shoot[];
  onClose: () => void;
  onSaved: (shoot: Shoot) => void;
}) {
  const [title, setTitle] = useState("");
  const [shootDate, setShootDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [duration, setDuration] = useState<ShootDuration>("FULL_DAY");
  const [status, setStatus] = useState<ShootStatus>("PLANNED");
  const [campaignId, setCampaignId] = useState("");
  const [callTime, setCallTime] = useState("");
  const [wrapTime, setWrapTime] = useState("");
  const [dateLocked, setDateLocked] = useState(false);
  const [location, setLocation] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [equipmentDraft, setEquipmentDraft] = useState("");
  const [crew, setCrew] = useState<CrewDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form every time the sheet opens on a different record.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setEquipmentDraft("");
    if (shoot) {
      setTitle(shoot.title);
      setShootDate(dateInput(shoot.shootDate));
      setEndDate(dateInput(shoot.endDate));
      setDuration(shoot.durationType);
      setStatus(shoot.status);
      setCampaignId(shoot.campaignId ?? "");
      setCallTime(shoot.callTime ?? "");
      setWrapTime(shoot.wrapTime ?? "");
      setDateLocked(shoot.isDateLocked);
      setLocation(shoot.location ?? "");
      setLocationUrl(shoot.locationUrl ?? "");
      setLocationNote(shoot.locationNote ?? "");
      setDescription(shoot.description ?? "");
      setNotes(shoot.notes ?? "");
      setEquipment(shoot.equipment ?? []);
      setCrew((shoot.crew ?? []).map(crewToDraft));
    } else {
      setTitle("");
      setShootDate(todayInput());
      setEndDate("");
      setDuration("FULL_DAY");
      setStatus("PLANNED");
      setCampaignId("");
      setCallTime("09:30");
      setWrapTime("18:00");
      setDateLocked(false);
      setLocation("");
      setLocationUrl("");
      setLocationNote("");
      setDescription("");
      setNotes("");
      setEquipment([]);
      setCrew([]);
    }
  }, [open, shoot]);

  const suggestions = useMemo(() => {
    const seen = new Set(equipment.map((e) => e.toLowerCase()));
    const out: string[] = [];
    for (const s of previousShoots) {
      for (const item of s.equipment ?? []) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out.slice(0, 12);
  }, [previousShoots, equipment]);

  const addEquipment = (raw?: string) => {
    const value = (raw ?? equipmentDraft).trim().replace(/\s+/g, " ");
    if (!value) return;
    setEquipment((prev) =>
      prev.some((e) => e.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]
    );
    setEquipmentDraft("");
  };

  const copyCrewFromLastShoot = () => {
    const last = previousShoots[previousShoots.length - 1];
    if (!last) return;
    setCrew((prev) => [
      ...prev,
      ...last.crew.map((c) =>
        newCrewRow({
          role: c.role,
          source: c.employeeId ? "EMPLOYEE" : c.vendorId ? "VENDOR" : "EXTERNAL",
          employeeId: c.employeeId ?? "",
          vendorId: c.vendorId ?? "",
          name: c.source === "EXTERNAL" ? c.name : "",
          phone: c.phone ?? "",
          callTime: c.callTime ?? "",
          fee: c.fee == null ? "" : String(c.fee),
        })
      ),
    ]);
  };

  const crewInvalid = crew.some(
    (c) =>
      !c.removed &&
      ((c.source === "EMPLOYEE" && !c.employeeId) ||
        (c.source === "VENDOR" && !c.vendorId) ||
        (c.source === "EXTERNAL" && !c.name.trim()))
  );

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError("Give the shoot a title");
    if (!shootDate) return setError("Shoot date is required");
    if (endDate && endDate < shootDate) return setError("End date cannot be before the shoot date");
    if (crewInvalid) return setError("Pick a person for every crew row (or remove the empty row)");

    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        shootDate,
        endDate: endDate || undefined,
        durationType: duration,
        status,
        campaignId: campaignId || undefined,
        callTime: callTime || undefined,
        wrapTime: wrapTime || undefined,
        isDateLocked: dateLocked,
        location: location.trim() || undefined,
        locationUrl: locationUrl.trim() || undefined,
        locationNote: locationNote.trim() || undefined,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        equipment,
      };
      const saved = shoot
        ? await apiFetch<Shoot>(`/flow/shoots/${shoot.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...body, endDate: endDate || null }),
          })
        : await apiFetch<Shoot>(`/flow/projects/${projectId}/shoots`, {
            method: "POST",
            body: JSON.stringify(body),
          });

      // Crew is synced after the shoot exists: delete, patch, then add.
      for (const c of crew.filter((x) => x.removed && x.id)) {
        await apiFetch(`/flow/shoots/${saved.id}/crew/${c.id}`, { method: "DELETE" }).catch(() => null);
      }
      for (const c of crew.filter((x) => !x.removed && x.id)) {
        await apiFetch(`/flow/shoots/${saved.id}/crew/${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            role: c.role,
            source: c.source,
            employeeId: c.source === "EMPLOYEE" ? c.employeeId : undefined,
            vendorId: c.source === "VENDOR" ? c.vendorId : undefined,
            name: c.source === "EXTERNAL" ? c.name.trim() : undefined,
            phone: c.phone.trim() || undefined,
            callTime: c.callTime || undefined,
            fee: c.fee ? Number(c.fee) : undefined,
            isConfirmed: c.isConfirmed,
          }),
        });
      }
      for (const c of crew.filter((x) => !x.removed && !x.id)) {
        await apiFetch(`/flow/shoots/${saved.id}/crew`, {
          method: "POST",
          body: JSON.stringify({
            role: c.role,
            source: c.source,
            employeeId: c.source === "EMPLOYEE" ? c.employeeId : undefined,
            vendorId: c.source === "VENDOR" ? c.vendorId : undefined,
            name: c.source === "EXTERNAL" ? c.name.trim() : undefined,
            phone: c.phone.trim() || undefined,
            callTime: c.callTime || undefined,
            fee: c.fee ? Number(c.fee) : undefined,
            isConfirmed: c.isConfirmed,
          }),
        });
      }

      const fresh = await apiFetch<Shoot>(`/flow/shoots/${saved.id}`);
      onSaved(fresh);
    } catch (e: any) {
      setError(e?.message ?? "Could not save the shoot");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      size="3xl"
      eyebrow="Production"
      icon={<Camera className="size-5" />}
      title={shoot ? "Edit shoot" : "New shoot"}
      subtitle="The call-sheet: when you shoot, how long, who travels and what gear goes."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="hidden text-meta text-muted-foreground sm:block">
            {shoot?.calendarEventId
              ? "Calendar event stays linked — edits update it."
              : "Saving also puts this shoot on the calendar."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-body font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Saving…" : shoot ? "Save changes" : "Create shoot"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <FormError>{error}</FormError>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Field label="Title" hint="What this shoot day is for">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. TVC Day 1 — Banani Studio"
                maxLength={160}
                autoFocus
              />
            </Field>

            <Field label="Duration">
              <ChipGroup
                value={duration}
                onChange={(v) => setDuration(v)}
                options={[
                  { value: "HALF_DAY", label: "Half day" },
                  { value: "FULL_DAY", label: "Full day" },
                ]}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Call time">
                <Input type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} />
              </Field>
              <Field label="Wrap time">
                <Input type="time" value={wrapTime} onChange={(e) => setWrapTime(e.target.value)} />
              </Field>
            </div>

            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as ShootStatus)}>
                {SHOOT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Campaign" hint="Optional — groups the shoot in reports">
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Shoot date">
              <Input type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} />
            </Field>
            <Field label="End date" hint="Leave empty for a single day">
              <Input type="date" value={endDate} min={shootDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Toggle
              checked={dateLocked}
              onChange={setDateLocked}
              label="Lock the date"
              hint="Crew is booked — the calendar event must not move the shoot."
            />

            <Field label="Location">
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Studio 4, Banani"
                maxLength={300}
              />
            </Field>
            <Field label="Maps link">
              <Input
                value={locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="https://maps.google.com/…"
                maxLength={500}
              />
            </Field>
            <Field label="Location note" hint="Gate, floor, who to ask for">
              <Input
                value={locationNote}
                onChange={(e) => setLocationNote(e.target.value)}
                placeholder="e.g. Service lift on the left"
                maxLength={300}
              />
            </Field>
          </div>
        </div>

        <Field label="What we are shooting" hint="Concept, setups, shot list summary">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Main film: classroom, library and principal soundbite. Three setups."
            className="min-h-16"
            maxLength={2000}
          />
        </Field>

        {/* ── equipment ── */}
        <FormSection
          title="Equipment"
          hint="Free-text list — one item per line. Press Enter to add."
          action={
            <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold tabular-nums text-muted-foreground">
              {equipment.length} item{equipment.length === 1 ? "" : "s"}
            </span>
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={equipmentDraft}
                onChange={(e) => setEquipmentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEquipment();
                  }
                }}
                placeholder="e.g. Sony FX3 ×2, Aputure 300D"
                maxLength={120}
              />
              <Btn variant="outline" onClick={() => addEquipment()}>
                <Plus className="size-3.5" /> Add
              </Btn>
            </div>
            {equipment.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {equipment.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-meta font-semibold"
                  >
                    {item}
                    <button
                      type="button"
                      onClick={() => setEquipment((prev) => prev.filter((e) => e !== item))}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      title={`Remove ${item}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
                  From earlier shoots
                </span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addEquipment(s)}
                    className="rounded-full border border-dashed border-border px-2 py-0.5 text-micro font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </FormSection>

        {/* ── crew ── */}
        <FormSection
          title="Crew"
          hint="Who is travelling — DoP, cameraman, gaffer, talent, vendor…"
          action={
            <div className="flex items-center gap-1.5">
              {previousShoots.length > 0 && (
                <Btn variant="ghost" onClick={copyCrewFromLastShoot}>
                  <Copy className="size-3.5" /> Copy last shoot
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setCrew((prev) => [...prev, newCrewRow()])}>
                <Plus className="size-3.5" /> Add crew
              </Btn>
            </div>
          }
        >
          {crew.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center">
              <UserRound className="mx-auto size-5 text-muted-foreground/60" />
              <p className="mt-1.5 text-meta font-semibold">No crew yet</p>
              <p className="text-micro text-muted-foreground">
                Add the DoP, cameraman and everyone else travelling.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {crew.map((row, index) => {
                const disabled = !!row.removed;
                return (
                  <div
                    key={row.key}
                    className={cn(
                      "rounded-xl border border-border/60 p-2.5",
                      disabled && "opacity-40 line-through"
                    )}
                  >
                    <div className="grid gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-3">
                        <Select
                          value={row.role}
                          onChange={(e) =>
                            setCrew((prev) =>
                              prev.map((c, i) =>
                                i === index ? { ...c, role: e.target.value as ShootCrewRole } : c
                              )
                            )
                          }
                          className="!py-1.5 text-meta"
                          aria-label="Crew role"
                        >
                          {SHOOT_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="sm:col-span-2">
                        <Select
                          value={row.source}
                          onChange={(e) => {
                            const source = e.target.value as ShootCrewSource;
                            setCrew((prev) =>
                              prev.map((c, i) =>
                                i === index
                                  ? {
                                      ...c,
                                      source,
                                      employeeId: source === "EMPLOYEE" ? c.employeeId : "",
                                      vendorId: source === "VENDOR" ? c.vendorId : "",
                                    }
                                  : c
                              )
                            );
                          }}
                          className="!py-1.5 text-meta"
                          aria-label="Crew source"
                        >
                          <option value="EMPLOYEE">Team</option>
                          <option value="VENDOR">Vendor</option>
                          <option value="EXTERNAL">External</option>
                        </Select>
                      </div>
                      <div className="sm:col-span-4">
                        {row.source === "EMPLOYEE" ? (
                          <Select
                            value={row.employeeId}
                            onChange={(e) =>
                              setCrew((prev) =>
                                prev.map((c, i) =>
                                  i === index ? { ...c, employeeId: e.target.value } : c
                                )
                              )
                            }
                            className="!py-1.5 text-meta"
                            aria-label="Team member"
                          >
                            <option value="">Select person…</option>
                            {employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                                {e.roleTitle ? ` — ${e.roleTitle}` : ""}
                              </option>
                            ))}
                          </Select>
                        ) : row.source === "VENDOR" ? (
                          <Select
                            value={row.vendorId}
                            onChange={(e) =>
                              setCrew((prev) =>
                                prev.map((c, i) =>
                                  i === index ? { ...c, vendorId: e.target.value } : c
                                )
                              )
                            }
                            className="!py-1.5 text-meta"
                            aria-label="Vendor"
                          >
                            <option value="">Select vendor…</option>
                            {vendors.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            value={row.name}
                            onChange={(e) =>
                              setCrew((prev) =>
                                prev.map((c, i) =>
                                  i === index ? { ...c, name: e.target.value } : c
                                )
                              )
                            }
                            placeholder="Name"
                            maxLength={160}
                            className="!py-1.5 text-meta"
                            aria-label="External name"
                          />
                        )}
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          type="time"
                          value={row.callTime}
                          onChange={(e) =>
                            setCrew((prev) =>
                              prev.map((c, i) =>
                                i === index ? { ...c, callTime: e.target.value } : c
                              )
                            )
                          }
                          className="!py-1.5 text-meta"
                          aria-label="Crew call time"
                          title="Call time"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setCrew((prev) =>
                              prev.map((c, i) =>
                                i === index ? { ...c, isConfirmed: !c.isConfirmed } : c
                              )
                            )
                          }
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-lg border transition-colors",
                            row.isConfirmed
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                          title={row.isConfirmed ? "Confirmed" : "Mark confirmed"}
                        >
                          <Check className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCrew((prev) =>
                              row.id
                                ? prev.map((c, i) =>
                                    i === index ? { ...c, removed: !c.removed } : c
                                  )
                                : prev.filter((_, i) => i !== index)
                            )
                          }
                          className="inline-flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                          title="Remove from call-sheet"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Production notes" hint="Internal — timings, permits, backups">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Generator backup booked; second camera arrives 11:00"
              className="min-h-16"
              maxLength={4000}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
            <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Call-sheet summary</p>
            <p className="text-meta text-muted-foreground">
              {shootDate ? `Shoot on ${shootDate}` : "Set a date"} ·{" "}
              {duration === "FULL_DAY" ? "Full day" : "Half day"}
              {callTime ? ` · call ${callTime}` : ""}
              {wrapTime ? ` → wrap ${wrapTime}` : ""}
            </p>
            <p className="flex items-center gap-1 text-meta text-muted-foreground">
              <MapPin className="size-3.5" /> {location || "Location not set"}
            </p>
            <p className="text-meta text-muted-foreground">
              {crew.filter((c) => !c.removed).length} crew · {equipment.length} equipment
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
