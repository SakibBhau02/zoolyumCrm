"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ChipGroup, Field, FormError, Input, Modal, Select, Textarea } from "@/components/ui";
import type { DeliverableCampaignRef, DeliverableKind } from "@/lib/types";

const KINDS: { value: DeliverableKind; label: string }[] = [
  { value: "GRAPHIC", label: "Graphic" },
  { value: "VIDEO", label: "Video" },
  { value: "PHOTO", label: "Photo" },
  { value: "COPY", label: "Copy" },
  { value: "OTHER", label: "Other" },
];

export function BulkDeliverablesModal({
  open,
  onClose,
  projectId,
  campaigns,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  campaigns: DeliverableCampaignRef[];
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<DeliverableKind>("GRAPHIC");
  const [campaignId, setCampaignId] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () =>
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 100),
    [text]
  );

  const submit = async () => {
    setError(null);
    if (!lines.length) return setError("Paste at least one line — one deliverable per line");
    setBusy(true);
    try {
      const res = await apiFetch<{ count: number }>(`/flow/projects/${projectId}/deliverables/bulk`, {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((title) => ({
            title: title.slice(0, 200),
            kind,
            objective: objective.trim() || undefined,
            campaignId: campaignId || undefined,
          })),
        }),
      });
      onDone(`${res.count} deliverable${res.count === 1 ? "" : "s"} added`);
      setText("");
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not add the deliverables");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={!busy}
      size="lg"
      eyebrow="Bulk paste"
      icon={<ClipboardPaste className="size-5" />}
      title="Add many deliverables at once"
      subtitle="One line per item — “8 graphics + 4 videos” in two pastes instead of twelve forms."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="hidden text-meta text-muted-foreground sm:block">
            {lines.length} line{lines.length === 1 ? "" : "s"} ready
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
              onClick={submit}
              disabled={busy || lines.length === 0}
              className="rounded-xl bg-primary px-4 py-2 text-body font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Adding…" : `Add ${lines.length || ""}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>

        <Field
          label="Deliverables"
          hint="One per line. The type, campaign and objective below apply to every line."
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Campus hero post\nScience lab post\nLibrary post\n…"}
            rows={8}
            autoFocus
            className="font-normal"
          />
        </Field>

        <Field label="Type for these items">
          <ChipGroup value={kind} onChange={setKind} options={KINDS} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign" hint="Optional">
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Objective" hint="Optional — e.g. Awareness, Launch, Conversion">
            <Input
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Awareness"
              maxLength={200}
            />
          </Field>
        </div>

        <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-micro text-muted-foreground">
          Tip: paste the 8 graphics first, then switch the type to Video and paste the 4 video
          titles. Topic and objective can be refined per item afterwards.
        </p>
      </div>
    </Modal>
  );
}
