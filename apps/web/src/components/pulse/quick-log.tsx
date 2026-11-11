"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  MessageCircle,
  Phone,
  Sparkles,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PulseWorkItem } from "@/lib/types";
import { Btn } from "@/components/table";
import { Avatar, cn } from "@/components/shared";
import { Field, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";

const CHANNELS = [
  { value: "CALL", label: "Call" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
  { value: "NOTE", label: "Note" },
] as const;

const OUTCOMES = [
  { value: "CONNECTED", label: "Connected", tone: "positive" },
  { value: "INTERESTED", label: "Interested", tone: "positive" },
  { value: "NEEDS_INFO", label: "Needs info", tone: "neutral" },
  { value: "CALLBACK_REQUESTED", label: "Call back", tone: "neutral" },
  { value: "MEETING_BOOKED", label: "Meeting booked", tone: "positive" },
  { value: "NO_ANSWER", label: "No answer", tone: "negative" },
  { value: "LEFT_MESSAGE", label: "Left message", tone: "neutral" },
  { value: "NOT_INTERESTED", label: "Not interested", tone: "negative" },
] as const;

const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON"] as const;

/** 10:00 local on a day offset — a human hour to call someone back. */
function atTenInDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The single place a rep records what just happened and what happens next.
 * Keeping both in one save is what stops leads from going dark: a logged call
 * without a next step is how a pipeline quietly dies.
 */
export function QuickLogModal({
  lead,
  open,
  onClose,
  employees,
  onSaved,
}: {
  lead: PulseWorkItem | null;
  open: boolean;
  onClose: () => void;
  employees: { id: string; name: string; department?: string | null }[];
  onSaved: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<string>("CALL");
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [nextMode, setNextMode] = useState<"tomorrow" | "3d" | "week" | "custom" | "none">("tomorrow");
  const [customDate, setCustomDate] = useState("");
  const [stage, setStage] = useState("");
  const [assignToId, setAssignToId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !lead) return;
    setChannel("CALL");
    setOutcome("");
    setNote("");
    setNextMode("tomorrow");
    setCustomDate(toLocalInput(atTenInDays(1)));
    setStage("");
    setAssignToId("");
    setErr(null);
  }, [open, lead]);

  const nextDate = useMemo(() => {
    if (nextMode === "none") return null;
    if (nextMode === "tomorrow") return atTenInDays(1);
    if (nextMode === "3d") return atTenInDays(3);
    if (nextMode === "week") return atTenInDays(7);
    return customDate ? new Date(customDate) : null;
  }, [nextMode, customDate]);

  const save = useMutation({
    mutationFn: async () => {
      if (!lead) return null;
      const content = note.trim();
      return apiFetch(`/pulse/leads/${lead.id}/quick-log`, {
        method: "POST",
        body: JSON.stringify({
          type: channel,
          outcome: channel === "NOTE" ? undefined : outcome || undefined,
          content: content || undefined,
          nextFollowUpAt: nextDate ? nextDate.toISOString() : undefined,
          clearNextStep: nextMode === "none" ? true : undefined,
          stage: stage || undefined,
          assignToId: nextDate && assignToId ? assignToId : undefined,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pulse"] });
      qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
      onSaved(nextDate ? "Touch logged — next step scheduled" : "Touch logged");
      onClose();
    },
    onError: (e: Error) => setErr(e.message ?? "Could not save"),
  });

  const tone = (t: string) =>
    t === "positive"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : t === "negative"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
        : "border-border bg-card text-muted-foreground";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        lead ? (
          <span className="flex items-center gap-2.5">
            <Avatar name={lead.name} />
            <span className="min-w-0">
              <span className="block truncate">Log a touch</span>
              <span className="block truncate text-body font-normal text-muted-foreground">
                {lead.name}
                {lead.company ? ` · ${lead.company}` : ""}
              </span>
            </span>
          </span>
        ) : (
          "Log a touch"
        )
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Channel">
          <Segmented value={channel} onChange={setChannel} options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))} />
        </Field>

        {channel !== "NOTE" && (
          <Field label="What happened?" hint="Pick the closest — it drives the next-step suggestion">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOutcome(o.value)}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-body font-semibold transition-colors",
                    outcome === o.value ? tone(o.tone) : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Notes" hint="What was said, what they asked for">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              channel === "WHATSAPP"
                ? "Sent pricing, asked for the brochure…"
                : "Budget question answered, wants a demo for the admin team…"
            }
            className="min-h-20"
          />
        </Field>

        <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5">
          <p className="flex items-center gap-1.5 text-meta font-bold tracking-wider text-primary uppercase">
            <CalendarClock className="size-3.5" /> Next step
          </p>
          <p className="mt-1 text-body text-muted-foreground">
            {lead?.nextFollowUpAt
              ? "This replaces the current plan if it is earlier."
              : "No step is planned — pick one so this lead does not go dark."}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {([
              { key: "tomorrow", label: "Tomorrow 10am" },
              { key: "3d", label: "In 3 days" },
              { key: "week", label: "Next week" },
              { key: "custom", label: "Custom" },
              { key: "none", label: "No next step" },
            ] as const).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setNextMode(o.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-body font-bold transition-colors",
                  nextMode === o.key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {nextMode === "custom" && (
            <Input
              type="datetime-local"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="mt-2.5"
            />
          )}
          {nextMode !== "none" && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field label="Move stage" hint="Optional — forward only">
                <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">Keep stage</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ").toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Turn into a team task" hint="Optional">
                <Select value={assignToId} onChange={(e) => setAssignToId(e.target.value)}>
                  <option value="">No task</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>

        {err && <p className="text-body-lg font-medium text-rose-400">{err}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <div className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
            {lead?.contactPhone ? (
              <a href={`tel:${lead.contactPhone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Phone className="size-3.5" /> Call first
              </a>
            ) : null}
            {lead?.contactPhone ? (
              <a
                href={`https://wa.me/${lead.contactPhone.replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-500 hover:text-emerald-400"
              >
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Btn type="button" variant="ghost" onClick={onClose}>
              <X className="size-3.5" /> Cancel
            </Btn>
            <Btn
              type="button"
              variant="primary"
              disabled={save.isPending || (nextMode === "custom" && !customDate)}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save & schedule"}
              <ArrowRight className="size-3.5" />
            </Btn>
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          Saving records the touch, refreshes the lead score and puts the next step in Today.
        </p>
      </div>
    </Modal>
  );
}
