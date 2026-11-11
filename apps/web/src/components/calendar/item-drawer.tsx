"use client";

import { useEffect, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle2,
  ExternalLink,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Drawer, Input, Select, Textarea } from "@/components/ui";
import { CalItem, EVENT_OUTCOMES, SOURCE_LABEL, label } from "./types";
import { humanTime } from "@/lib/calendar-date";
import { ApprovalBadge, PlatformBadges, StatusBadge } from "./parts";

export function ItemDrawer({
  item,
  open,
  onClose,
  onRefresh,
  onEditPost,
  onEditEvent,
  onMoved,
  canEdit = true,
  canApprove = true,
}: {
  item: CalItem | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onEditPost: (id: string) => void;
  onEditEvent: (id: string) => void;
  onMoved: () => void;
  canEdit?: boolean;
  canApprove?: boolean;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [comment, setComment] = useState("");
  const [publishUrl, setPublishUrl] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moveTime, setMoveTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    setErr(null);
    setDetail(null);
    setComments([]);
    setAudit([]);
    setPublishUrl("");
    setShowReject(false);
    setMoveDate(item.date);
    setMoveTime(item.startTime ?? "");
    const source = item.source;
    if (source === "CONTENT_POST") {
      apiFetch<any>(`/calendar/posts/${item.sourceId}`).then(setDetail).catch(() => null);
    }
    if (source === "EVENT") {
      apiFetch<any>(`/calendar/events/${item.sourceId}`).then(setDetail).catch(() => null);
    }
    apiFetch<any[]>(`/calendar/comments?source=${source}&sourceId=${item.sourceId}`)
      .then(setComments)
      .catch(() => null);
    apiFetch<any[]>(`/calendar/audit?source=${source}&sourceId=${item.sourceId}`)
      .then(setAudit)
      .catch(() => null);
  }, [open, item]);

  if (!item) return null;

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onRefresh();
    } catch (e: any) {
      setErr(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const postAction = (path: string, body?: any) =>
    run(async () => {
      await apiFetch(`/calendar/posts/${item.sourceId}${path}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      const fresh = await apiFetch<any>(`/calendar/posts/${item.sourceId}`).catch(() => null);
      if (fresh) setDetail(fresh);
    });

  const setTaskStatus = (status: string) =>
    run(async () => {
      await apiFetch(`/tasks/${item.sourceId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    });

  const setEventOutcome = (outcome: string) =>
    run(async () => {
      await apiFetch(`/calendar/events/${item.sourceId}`, { method: "PATCH", body: JSON.stringify({ outcome }) });
      const fresh = await apiFetch<any>(`/calendar/events/${item.sourceId}`).catch(() => null);
      if (fresh) setDetail(fresh);
    });

  const setFlightStatus = (status: string) =>
    run(async () => {
      await apiFetch(`/calendar/flights/${item.sourceId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    });

  const move = () =>
    run(async () => {
      await apiFetch("/calendar/move", {
        method: "PATCH",
        body: JSON.stringify({ source: item.source, id: item.sourceId, date: moveDate, time: moveTime || undefined }),
      });
      onMoved();
    });

  const archive = () =>
    run(async () => {
      await apiFetch(`/calendar/posts/${item.sourceId}`, { method: "DELETE" });
      onClose();
    });

  const deleteEvent = () =>
    run(async () => {
      await apiFetch(`/calendar/events/${item.sourceId}`, { method: "DELETE" });
      onClose();
    });

  const addComment = () =>
    run(async () => {
      if (!comment.trim()) return;
      const c = await apiFetch<any>("/calendar/comments", {
        method: "POST",
        body: JSON.stringify({ source: item.source, sourceId: item.sourceId, content: comment.trim() }),
      });
      setComments((prev) => [...prev, c]);
      setComment("");
    });

  const post = item.source === "CONTENT_POST" ? detail : null;
  const event = item.source === "EVENT" ? detail : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {SOURCE_LABEL[item.source]} · {item.clientName ?? "No client"}
          </p>
          <h3 className="truncate font-heading text-[17px] font-semibold leading-tight">{item.title}</h3>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {item.href && (
              <a href={item.href} className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted">
                <ExternalLink className="size-3.5" /> Open
              </a>
            )}
            {item.source === "CONTENT_POST" && canEdit && (
              <Btn variant="outline" onClick={() => onEditPost(item.sourceId)}>
                Edit post
              </Btn>
            )}
            {item.source === "EVENT" && canEdit && (
              <Btn variant="outline" onClick={() => onEditEvent(item.sourceId)}>
                Edit event
              </Btn>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {item.source === "CONTENT_POST" && canEdit && (
              <Btn variant="ghost" onClick={archive} disabled={busy} className="!text-rose-500">
                <Archive className="size-3.5" /> Archive
              </Btn>
            )}
            {item.source === "EVENT" && canEdit && (
              <Btn variant="ghost" onClick={deleteEvent} disabled={busy} className="!text-rose-500">
                <Trash2 className="size-3.5" /> Delete
              </Btn>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={item.status} tone={item.statusTone} />
          <ApprovalBadge approval={item.approval} />
          {item.platforms.length > 0 && <PlatformBadges platforms={item.platforms} max={9} />}
          {item.overdue && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">Overdue</span>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <Info label="Date" value={`${item.date}${item.endDate ? ` → ${item.endDate}` : ""}`} />
          <Info label="Time" value={item.allDay ? "All day" : `${humanTime(item.startTime)}${item.endTime ? ` – ${humanTime(item.endTime)}` : ""}`} />
          <Info label="Project" value={item.projectName ?? "—"} />
          <Info label="Campaign" value={item.campaignName ?? "—"} />
          <Info label="Owner" value={item.assigneeNames.join(", ") || "—"} />
          <Info label="Visibility" value={item.clientVisible ? "Client can see" : "Internal"} />
        </div>

        {/* ── Source specific body ───────────────────────────────────── */}
        {post && (
          <>
            {post.content && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Caption</p>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{post.content}</p>
                {Array.isArray(post.hashtags) && post.hashtags.length > 0 && (
                  <p className="mt-2 text-[11px] text-primary">{post.hashtags.map((h: string) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
                )}
              </div>
            )}
            {post.rejectionReason && (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-2.5 text-[11.5px] text-rose-500">
                <strong>Changes requested:</strong> {post.rejectionReason}
              </div>
            )}
            {Array.isArray(post.assetUrls) && post.assetUrls.length > 0 && (
              <div>
                <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Assets</p>
                <ul className="flex flex-col gap-0.5">
                  {post.assetUrls.map((u: string) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noreferrer" className="truncate text-[11px] text-primary hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {post.externalUrl && (
              <a href={post.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
                <ExternalLink className="size-3.5" /> View live post
              </a>
            )}

            {canApprove && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {post.approvalStatus === "NONE" || post.approvalStatus === "REJECTED" ? (
                    <Btn variant="outline" onClick={() => postAction("/submit-review")} disabled={busy}>
                      <Send className="size-3.5" /> Send for review
                    </Btn>
                  ) : null}
                  {post.approvalStatus !== "APPROVED" ? (
                    <Btn variant="primary" onClick={() => postAction("/approve")} disabled={busy}>
                      <Check className="size-3.5" /> Approve
                    </Btn>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                      <CheckCircle2 className="size-3.5" /> Approved
                    </span>
                  )}
                  <Btn variant="ghost" onClick={() => setShowReject((v) => !v)} disabled={busy} className="!text-rose-500">
                    <XCircle className="size-3.5" /> Request changes
                  </Btn>
                </div>

                {showReject && (
                  <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 p-2.5">
                    <Textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="What needs to change?"
                      className="min-h-14 text-[12px]"
                    />
                    <Btn
                      variant="primary"
                      disabled={busy || !rejectReason.trim()}
                      onClick={() => postAction("/reject", { reason: rejectReason })}
                    >
                      Send back
                    </Btn>
                  </div>
                )}
              </>
            )}

            {canEdit && post.publishStatus !== "PUBLISHED" && (
              <div className="flex items-end gap-1.5">
                <div className="flex-1">
                  <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Live URL (manual publish)</p>
                  <Input value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} placeholder="https://…" className="!py-1.5 text-[12px]" />
                </div>
                <Btn variant="outline" disabled={busy} onClick={() => postAction("/publish", { url: publishUrl || undefined })}>
                  Mark published
                </Btn>
              </div>
            )}
          </>
        )}

        {event && (
          <>
            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              <Info label="Type" value={label(event.type)} />
              <Info label="Location" value={event.location ?? "—"} />
              <Info label="Meeting link" value={event.meetingUrl ?? "—"} />
              <Info label="Reminders" value={(event.reminderMinutes ?? []).map((m: number) => `${m}m`).join(", ") || "—"} />
            </div>
            {event.notes && <p className="rounded-xl border border-border/60 bg-muted/20 p-2.5 text-[12px] leading-relaxed">{event.notes}</p>}
            <div>
              <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Outcome</p>
              <div className="flex flex-wrap gap-1">
                {EVENT_OUTCOMES.map((o) => (
                  <button
                    key={o}
                    onClick={() => setEventOutcome(o)}
                    disabled={busy}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                      event.outcome === o ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label(o)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {item.source === "TASK" && canEdit && (
          <div>
            <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Task status</p>
            <div className="flex flex-wrap gap-1">
              {["TODO", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"].map((s) => (
                <button
                  key={s}
                  onClick={() => setTaskStatus(s)}
                  disabled={busy}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    item.status === s ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {item.source === "AD_FLIGHT" && canEdit && (
          <div>
            <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Flight status</p>
            <div className="flex flex-wrap gap-1">
              {["PLANNED", "LIVE", "PAUSED", "ENDED", "CANCELLED"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFlightStatus(s)}
                  disabled={busy}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    item.status === s ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label(s)}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
              <Info label="Daily budget" value={`৳${Number(item.meta?.dailyBudget ?? 0).toLocaleString("en-US")}`} />
              <Info label="Objective" value={label(item.meta?.objective ?? "—")} />
            </div>
          </div>
        )}

        {/* ── Move ──────────────────────────────────────────────────── */}
        {item.draggable && canEdit && (
          <div className="rounded-xl border border-border/60 p-2.5">
            <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Reschedule</p>
            <div className="flex items-end gap-1.5">
              <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} className="!py-1.5 text-[12px]" />
              {!item.allDay && <Input type="time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} className="!w-28 !py-1.5 text-[12px]" />}
              <Btn variant="outline" onClick={move} disabled={busy}>
                Move
              </Btn>
            </div>
          </div>
        )}

        {err && <p className="text-[12px] font-medium text-rose-500">{err}</p>}

        {/* ── Comments ──────────────────────────────────────────────── */}
        <div>
          <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Comments</p>
          <div className="flex flex-col gap-1.5">
            {comments.length === 0 && <p className="text-[11px] text-muted-foreground">No comments yet.</p>}
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-muted/40 px-2 py-1.5">
                <p className="text-[11.5px]">{c.content}</p>
                <p className="text-[9.5px] text-muted-foreground">{c.author?.name ?? "—"}</p>
              </div>
            ))}
            <div className="flex items-end gap-1.5">
              {canEdit && (
                <>
                  <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note…" className="!py-1.5 text-[12px]" />
                  <Btn variant="outline" onClick={addComment} disabled={busy || !comment.trim()}>
                    Post
                  </Btn>
                </>
              )}
            </div>
          </div>
        </div>

        {audit.length > 0 && (
          <details className="rounded-xl border border-border/60 p-2.5">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              History ({audit.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {audit.slice(0, 8).map((a) => (
                <li key={a.id} className="text-[10.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{label(a.action)}</span> · {new Date(a.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {a.reason ? ` · ${a.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Drawer>
  );
}

function Info({ label: lbl, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 px-2 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{lbl}</p>
      <p className="truncate text-[11.5px] font-medium">{value}</p>
    </div>
  );
}
