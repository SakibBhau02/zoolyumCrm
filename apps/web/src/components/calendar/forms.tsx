"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Field, FormActions, Input, Modal, Select, Textarea } from "@/components/ui";
import { cn } from "@/components/shared";
import {
  CalendarClient,
  CalendarPerson,
  EVENT_TYPES,
  FORMATS,
  PLATFORMS,
  PLATFORM_LABEL,
  PLATFORM_STYLE,
  POST_STATUSES,
  label,
} from "./types";
import { dhakaDay, dhakaTime, addDays, todayISO } from "@/lib/calendar-date";

type Base = {
  clients: CalendarClient[];
  projects: any[];
  people: CalendarPerson[];
  campaigns: any[];
  pillars: any[];
  onSaved: () => void;
  onClose: () => void;
};

function PlatformPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PLATFORMS.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
              on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {PLATFORM_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

export function PostForm({
  open,
  postId,
  defaults,
  clients,
  projects,
  people,
  campaigns,
  pillars,
  onSaved,
  onClose,
}: Base & { open: boolean; postId?: string | null; defaults?: { date?: string; time?: string } }) {
  const [f, setF] = useState<any>({
    title: "",
    clientId: "",
    projectId: "",
    campaignId: "",
    pillarId: "",
    platforms: [] as string[],
    date: defaults?.date ?? todayISO(),
    time: defaults?.time ?? "10:00",
    publishStatus: "DRAFT",
    format: "STATIC",
    assigneeId: "",
    content: "",
    hashtags: "",
    assetUrls: "",
    externalUrl: "",
    notesInternal: "",
    contentType: "",
    repeat: "1",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!postId;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (!postId) {
      setF({
        title: "",
        clientId: "",
        projectId: "",
        campaignId: "",
        pillarId: "",
        platforms: [],
        date: defaults?.date ?? todayISO(),
        time: defaults?.time ?? "10:00",
        publishStatus: "DRAFT",
        format: "STATIC",
        assigneeId: "",
        content: "",
        hashtags: "",
        assetUrls: "",
        externalUrl: "",
        notesInternal: "",
        contentType: "",
        repeat: "1",
      });
      return;
    }
    apiFetch<any>(`/calendar/posts/${postId}`)
      .then((p) =>
        setF({
          title: p.title ?? "",
          clientId: p.clientId ?? "",
          projectId: p.projectId ?? "",
          campaignId: p.campaignId ?? "",
          pillarId: p.pillarId ?? "",
          platforms: Array.isArray(p.platforms) ? p.platforms : [],
          date: dhakaDay(p.scheduledAt ?? p.scheduledDate),
          time: dhakaTime(p.scheduledAt ?? `${p.scheduledDate}T${p.scheduledTime}:00+06:00`),
          publishStatus: p.publishStatus ?? p.status ?? "DRAFT",
          format: p.format ?? "STATIC",
          assigneeId: p.assigneeId ?? "",
          content: p.content ?? "",
          hashtags: (p.hashtags ?? []).join(" "),
          assetUrls: (p.assetUrls ?? []).join("\n"),
          externalUrl: p.externalUrl ?? "",
          notesInternal: p.notesInternal ?? "",
          contentType: p.contentType ?? "",
          repeat: "1",
        })
      )
      .catch((e) => setErr(e.message ?? "Could not load the post"));
  }, [open, postId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErr("Title is required");
    setBusy(true);
    setErr(null);
    try {
      const body = {
        title: f.title.trim(),
        clientId: f.clientId || null,
        projectId: f.projectId || null,
        campaignId: f.campaignId || null,
        pillarId: f.pillarId || null,
        platforms: f.platforms,
        date: f.date,
        time: f.time || "10:00",
        publishStatus: f.publishStatus,
        format: f.format,
        assigneeId: f.assigneeId || null,
        content: f.content,
        hashtags: f.hashtags,
        assetUrls: f.assetUrls.split("\n").map((s: string) => s.trim()).filter(Boolean),
        externalUrl: f.externalUrl || null,
        notesInternal: f.notesInternal || null,
        contentType: f.contentType || null,
        isRecurring: Number(f.repeat) > 1,
        recurrenceRule: Number(f.repeat) > 1 ? `FREQ=WEEKLY;COUNT=${Number(f.repeat)}` : null,
      };
      if (editing) {
        await apiFetch(`/calendar/posts/${postId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const count = Math.min(Math.max(Number(f.repeat) || 1, 1), 12);
        for (let i = 0; i < count; i++) {
          await apiFetch("/calendar/posts", {
            method: "POST",
            body: JSON.stringify({ ...body, date: addDays(f.date, i * 7) }),
          });
        }
      }
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const filteredProjects = f.clientId ? projects.filter((p) => p.clientId === f.clientId) : projects;
  const clientCampaigns = f.clientId ? campaigns.filter((c) => c.clientId === f.clientId) : campaigns;
  const clientPillars = f.clientId ? pillars.filter((p) => p.clientId === f.clientId) : pillars;

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit post" : "New content post"} subtitle="Scheduling, platforms and approval in one place." size="lg">
      <form onSubmit={save} className="flex flex-col gap-3.5">
        <Field label="Title" required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Eid teaser — 15s cut" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select
              value={f.clientId}
              onChange={(e) => setF({ ...f, clientId: e.target.value, projectId: "", campaignId: "", pillarId: "" })}
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">No project</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Campaign">
            <Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
              <option value="">No campaign</option>
              {clientCampaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Content pillar">
            <Select value={f.pillarId} onChange={(e) => setF({ ...f, pillarId: e.target.value })}>
              <option value="">No pillar</option>
              {clientPillars.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Platforms">
          <PlatformPicker value={f.platforms} onChange={(v) => setF({ ...f, platforms: v })} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Date" required>
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Time">
            <Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </Field>
          <Field label="Format">
            <Select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
              {FORMATS.map((x) => (
                <option key={x} value={x}>{label(x)}</option>
              ))}
            </Select>
          </Field>
        </div>

        {!editing && (
          <Field label="Repeat weekly" hint="Creates one post per week for this many weeks (max 12).">
            <Input type="number" min={1} max={12} value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={f.publishStatus} onChange={(e) => setF({ ...f, publishStatus: e.target.value })}>
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Caption / copy">
          <Textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Write the caption the client will approve…" className="min-h-20" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hashtags">
            <Input value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#eid #brand" />
          </Field>
          <Field label="Live post URL" hint="Paste after publishing — reports link straight to it.">
            <Input value={f.externalUrl} onChange={(e) => setF({ ...f, externalUrl: e.target.value })} placeholder="https://instagram.com/p/…" />
          </Field>
        </div>
        <Field label="Asset URLs" hint="One per line (image or video link).">
          <Textarea value={f.assetUrls} onChange={(e) => setF({ ...f, assetUrls: e.target.value })} className="min-h-14" />
        </Field>
        <Field label="Internal notes" hint="Never shown to the client.">
          <Textarea value={f.notesInternal} onChange={(e) => setF({ ...f, notesInternal: e.target.value })} className="min-h-12" />
        </Field>

        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create post"} />
      </form>
    </Modal>
  );
}

export function EventForm({
  open,
  eventId,
  defaults,
  clients,
  projects,
  people,
  onSaved,
  onClose,
}: Omit<Base, "campaigns" | "pillars"> & { open: boolean; eventId?: string | null; defaults?: { date?: string; time?: string } }) {
  const [f, setF] = useState<any>({
    title: "",
    type: "MEETING",
    date: defaults?.date ?? todayISO(),
    endDate: "",
    allDay: false,
    startTime: defaults?.time ?? "10:00",
    endTime: "11:00",
    clientId: "",
    projectId: "",
    location: "",
    meetingUrl: "",
    visibility: "INTERNAL",
    attendeeIds: [] as string[],
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!eventId;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (!eventId) {
      setF({
        title: "",
        type: "MEETING",
        date: defaults?.date ?? todayISO(),
        endDate: "",
        allDay: false,
        startTime: defaults?.time ?? "10:00",
        endTime: "11:00",
        clientId: "",
        projectId: "",
        location: "",
        meetingUrl: "",
        visibility: "INTERNAL",
        attendeeIds: [],
        notes: "",
      });
      return;
    }
    apiFetch<any>(`/calendar/events/${eventId}`)
      .then((e) =>
        setF({
          title: e.title ?? "",
          type: e.type ?? "MEETING",
          date: e.date ?? todayISO(),
          endDate: e.endDate ?? "",
          allDay: !!e.allDay,
          startTime: e.startTime ?? "10:00",
          endTime: e.endTime ?? "11:00",
          clientId: e.clientId ?? "",
          projectId: e.projectId ?? "",
          location: e.location ?? "",
          meetingUrl: e.meetingUrl ?? "",
          visibility: e.visibility ?? "INTERNAL",
          attendeeIds: e.attendeeIds ?? [],
          notes: e.notes ?? "",
        })
      )
      .catch((e) => setErr(e.message ?? "Could not load the event"));
  }, [open, eventId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErr("Title is required");
    setBusy(true);
    setErr(null);
    try {
      const body = {
        ...f,
        title: f.title.trim(),
        clientId: f.clientId || null,
        projectId: f.projectId || null,
      };
      await apiFetch(editing ? `/calendar/events/${eventId}` : "/calendar/events", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleAttendee = (id: string) =>
    setF({ ...f, attendeeIds: f.attendeeIds.includes(id) ? f.attendeeIds.filter((x: string) => x !== id) : [...f.attendeeIds, id] });

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit event" : "New event"} subtitle="Meetings, shoots, deadlines and campaign moments." size="lg">
      <form onSubmit={save} className="flex flex-col gap-3.5">
        <Field label="Title" required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Monthly review — Green Valley" autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="End date">
            <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[11.5px] font-medium">
          <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} />
          All day
        </label>
        {!f.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time">
              <Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
            </Field>
            <Field label="End time">
              <Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, projectId: "" })}>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">No project</option>
              {projects.filter((p) => !f.clientId || p.clientId === f.clientId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location">
            <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Studio 4, Banani" />
          </Field>
          <Field label="Meeting link">
            <Input value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} placeholder="https://meet.google.com/…" />
          </Field>
        </div>
        <Field label="Visibility" hint="Client-visible events appear in the client portal calendar.">
          <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="INTERNAL">Internal only</option>
            <option value="CLIENT">Visible to client</option>
          </Select>
        </Field>
        <Field label="Attendees">
          <div className="flex flex-wrap gap-1">
            {people.map((p) => {
              const on = f.attendeeIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleAttendee(p.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create event"} />
      </form>
    </Modal>
  );
}

export function FlightForm({
  open,
  clients,
  campaigns,
  onSaved,
  onClose,
}: Pick<Base, "clients" | "campaigns" | "onSaved" | "onClose"> & { open: boolean }) {
  const [f, setF] = useState<any>({
    name: "",
    clientId: "",
    campaignId: "",
    platform: "FACEBOOK",
    objective: "leads",
    startDate: todayISO(),
    endDate: todayISO(),
    dailyBudget: "",
    totalBudget: "",
    status: "PLANNED",
    creativeNote: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.clientId) return setErr("Client and name are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/calendar/flights", {
        method: "POST",
        body: JSON.stringify({
          ...f,
          name: f.name.trim(),
          dailyBudget: f.dailyBudget ? Number(f.dailyBudget) : null,
          totalBudget: f.totalBudget ? Number(f.totalBudget) : null,
          campaignId: f.campaignId || null,
        }),
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
    <Modal open={open} onClose={onClose} title="New ad flight" subtitle="Which ad runs, on which days, at what daily budget." size="lg">
      <form onSubmit={save} className="flex flex-col gap-3.5">
        <Field label="Name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Admission retargeting — Meta" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client" required>
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, campaignId: "" })}>
              <option value="">Select a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign">
            <Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
              <option value="">Standalone</option>
              {campaigns.filter((c) => !f.clientId || c.clientId === f.clientId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Platform">
            <Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" required>
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="End date" required>
            <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Daily budget (৳)">
            <Input type="number" min={0} value={f.dailyBudget} onChange={(e) => setF({ ...f, dailyBudget: e.target.value })} placeholder="2500" />
          </Field>
          <Field label="Total budget (৳)">
            <Input type="number" min={0} value={f.totalBudget} onChange={(e) => setF({ ...f, totalBudget: e.target.value })} placeholder="35000" />
          </Field>
          <Field label="Objective">
            <Select value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })}>
              {["awareness", "traffic", "leads", "sales", "engagement"].map((o) => (
                <option key={o} value={o}>{label(o)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Creative note">
          <Textarea value={f.creativeNote} onChange={(e) => setF({ ...f, creativeNote: e.target.value })} className="min-h-14" placeholder="Carousel of campus photos + testimonial video" />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create flight" />
      </form>
    </Modal>
  );
}

export function CampaignForm({
  open,
  clients,
  projects,
  onSaved,
  onClose,
}: Pick<Base, "clients" | "projects" | "onSaved" | "onClose"> & { open: boolean }) {
  const [f, setF] = useState<any>({
    name: "",
    clientId: "",
    projectId: "",
    objective: "leads",
    status: "PLAN",
    startDate: todayISO(),
    endDate: todayISO(),
    totalBudget: "",
    platforms: [] as string[],
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.clientId) return setErr("Client and name are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/calendar/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...f,
          name: f.name.trim(),
          projectId: f.projectId || null,
          totalBudget: f.totalBudget ? Number(f.totalBudget) : null,
        }),
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
    <Modal open={open} onClose={onClose} title="New campaign" subtitle="A campaign groups posts, ad flights and a budget for one client." size="lg">
      <form onSubmit={save} className="flex flex-col gap-3.5">
        <Field label="Name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Admission 2027 — Wave 1" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client" required>
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, projectId: "" })}>
              <option value="">Select a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">No project</option>
              {projects.filter((p) => !f.clientId || p.clientId === f.clientId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start date" required>
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="End date" required>
            <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field label="Total budget (৳)">
            <Input type="number" min={0} value={f.totalBudget} onChange={(e) => setF({ ...f, totalBudget: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Objective">
            <Select value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })}>
              {["awareness", "traffic", "leads", "sales", "engagement"].map((o) => (
                <option key={o} value={o}>{label(o)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {["PLAN", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Platforms">
          <PlatformPicker value={f.platforms} onChange={(v) => setF({ ...f, platforms: v })} />
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-14" />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create campaign" />
      </form>
    </Modal>
  );
}
