"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, Globe2, KeyRound, MessageSquareText, Power, Send, ThumbsUp, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { timeAgo } from "@/lib/format";
import { Avatar, cn, FadeIn, PageHeader, SkeletonBlock, StatCard, StatusBadge } from "@/components/shared";
import { TableShell, Td, THead, Th, Tr, Btn } from "@/components/table";
import { Field, Input, Modal } from "@/components/ui";

type ClientWithContacts = {
  id: string;
  companyName: string;
  accountOwner: { id: string; name: string } | null;
  contacts: {
    id: string;
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    portalAccessEnabled: boolean;
    lastPortalLogin: string | null;
    portalUser: { id: string; isActive: boolean; lastLoginAt: string | null; createdAt: string } | null;
  }[];
};

export default function PortalPage() {
  const { data: users, loading } = useApi<any[]>("/portal/users");
  const { data: comments, mutate: mutateComments } = useApi<any[]>("/portal/comments");
  const { data: approvals } = useApi<any[]>("/portal/approvals");
  const { data: clients, loading: clientsLoading, mutate } = useApi<ClientWithContacts[]>("/portal/clients");
  const { data: audit, mutate: mutateAudit } = useApi<
    { id: string; name: string; clientName: string; totalTasks: number; visibleTasks: number }[]
  >("/portal/tasks/visibility-audit");

  const setVisibility = async (projectId: string, isClientVisible: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/portal/projects/${projectId}/tasks/visibility`, {
        method: "POST",
        body: JSON.stringify({ isClientVisible }),
      });
      mutateAudit();
    } catch (err: any) {
      setModalError(err?.message ?? "Failed to update visibility");
    } finally {
      setBusy(false);
    }
  };

  const [passwordModal, setPasswordModal] = useState<{ mode: "create" | "reset"; contact: ClientWithContacts["contacts"][number] } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [replyTarget, setReplyTarget] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyMsg, setReplyMsg] = useState<string | null>(null);
  const [replyOk, setReplyOk] = useState(false);

  // Notification deep link: /portal?thread=project:<id> | client:<id>.
  // Preselect the conversation and bring the composer into view.
  const searchParams = useSearchParams();
  const replyRef = useRef<HTMLDivElement>(null);
  const threadParam = searchParams.get("thread");
  useEffect(() => {
    if (!threadParam) return;
    setReplyTarget(threadParam);
    const t = window.setTimeout(() => replyRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(t);
  }, [threadParam]);

  const [preview, setPreview] = useState<any | null>(null);
  const [previewFor, setPreviewFor] = useState<{ name: string; client: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const openPreview = async (portalUserId: string, name: string, client: string) => {
    setPreviewBusy(true);
    setPreviewFor({ name, client });
    setPreview(null);
    try {
      setPreview(await apiFetch(`/portal/preview/${portalUserId}`));
    } catch (err: any) {
      setPreview({ error: err?.message ?? "Failed to load preview" });
    } finally {
      setPreviewBusy(false);
    }
  };

  const sendStaffReply = async () => {
    const body = replyBody.trim();
    if (!replyTarget || !body || replyBusy) return;
    const [kind, id] = replyTarget.split(":");
    setReplyBusy(true);
    setReplyMsg(null);
    try {
      await apiFetch("/portal/comments", {
        method: "POST",
        body: JSON.stringify({
          threadKey: kind === "project" ? id : "general",
          clientId: kind === "client" ? id : undefined,
          content: body,
        }),
      });
      setReplyBody("");
      setReplyOk(true);
      setReplyMsg("Sent — the client can see it in their portal.");
      mutateComments();
    } catch (err: any) {
      setReplyOk(false);
      setReplyMsg(err?.message ?? "Failed to send");
    } finally {
      setReplyBusy(false);
    }
  };

  const refresh = useCallback(() => mutate(), [mutate]);

  const submitPassword = async () => {
    if (!passwordModal || busy) return;
    if (password.length < 6) return setModalError("Password must be at least 6 characters");
    setBusy(true);
    setModalError(null);
    try {
      const path =
        passwordModal.mode === "create"
          ? "/portal/users"
          : `/portal/users/${passwordModal.contact.portalUser!.id}/password`;
      const body =
        passwordModal.mode === "create"
          ? { clientContactId: passwordModal.contact.id, password }
          : { password };
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      setPasswordModal(null);
      setPassword("");
      refresh();
    } catch (err: any) {
      setModalError(err?.message ?? "Failed to save password");
    } finally {
      setBusy(false);
    }
  };

  const toggleAccess = async (contact: ClientWithContacts["contacts"][number]) => {
    if (!contact.portalUser || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/portal/users/${contact.portalUser.id}/access`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !contact.portalUser.isActive }),
      });
      refresh();
    } catch (err: any) {
      setModalError(err?.message ?? "Failed to update access");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Portal — Client Access"
        subtitle="Branded, restricted external view — live status, deliverables and billing."
        actions={
          <span className="rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
            Portal URL: portal.zoolyum.com
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Portal Users" value={users?.length ?? "—"} sub="active client logins" delta="+1" icon={<Globe2 className="size-5" />} />
        <StatCard label="Deliverable Decisions" value={approvals?.length ?? "—"} sub="approve / revision" delta="+3" icon={<ThumbsUp className="size-5" />} />
        <StatCard label="Client Comments" value={comments?.length ?? "—"} sub="searchable thread" delta="+2" icon={<MessageSquareText className="size-5" />} />
        <StatCard label="Sentiment Flagged" value={(comments ?? []).filter((c) => c.sentiment === "NEGATIVE_URGENT").length} sub="needs account-owner check" delta="0" icon={<MessageSquareText className="size-5" />} />
      </div>

      <div className="mt-8">
        <PageHeader
          title="What clients can see"
          subtitle="The portal only shows tasks flagged as client-visible. Share a project's tasks before your client logs in."
        />
        {!audit || audit.length === 0 ? (
          <SkeletonBlock className="h-16" />
        ) : (
          <FadeIn>
            {audit.some((p) => p.visibleTasks === 0) && (
              <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-700 dark:text-amber-300">
                {audit.filter((p) => p.visibleTasks === 0).length} active project
                {audit.filter((p) => p.visibleTasks === 0).length === 1 ? "" : "s"} share no tasks — those clients see an empty Work tab.
              </div>
            )}
            <TableShell>
              <table className="w-full">
                <THead>
                  <Th>Project</Th>
                  <Th>Client</Th>
                  <Th>Visible tasks</Th>
                  <Th>Action</Th>
                </THead>
                <tbody>
                  {audit.map((p, i) => (
                    <Tr key={p.id} index={i}>
                      <Td className="font-medium">{p.name}</Td>
                      <Td className="text-muted-foreground">{p.clientName}</Td>
                      <Td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                            p.visibleTasks === 0
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          )}
                        >
                          {p.visibleTasks}/{p.totalTasks}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <Btn
                            variant="outline"
                            className="px-2.5 py-1 text-[11px]"
                            disabled={busy || p.visibleTasks === p.totalTasks}
                            onClick={() => setVisibility(p.id, true)}
                          >
                            Share all
                          </Btn>
                          <Btn
                            variant="outline"
                            className="px-2.5 py-1 text-[11px]"
                            disabled={busy || p.visibleTasks === 0}
                            onClick={() => setVisibility(p.id, false)}
                          >
                            Hide all
                          </Btn>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </FadeIn>
        )}
      </div>

      <div className="mt-8">
        <PageHeader
          title="Client Access"
          subtitle="Enable portal login for client contacts, reset passwords, and control access."
        />
        {clientsLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(4)].map((_, i) => (
              <SkeletonBlock key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <FadeIn>
            <div className="flex flex-col gap-3">
              {(clients ?? []).map((c) => (
                <div key={c.id} className="card-lift overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
                    <p className="text-[13px] font-heading font-semibold">{c.companyName}</p>
                    <span className="text-[11px] text-muted-foreground">
                      {c.accountOwner ? `Owner: ${c.accountOwner.name}` : "No account owner"} ·{" "}
                      {c.contacts.filter((ct) => ct.portalUser).length}/{c.contacts.length} contacts with access
                    </span>
                  </div>
                  <div className="flex flex-col divide-y divide-border/40">
                    {c.contacts.map((ct) => (
                      <div key={ct.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <Avatar name={ct.name} size="size-8" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold">
                            {ct.name}
                            {ct.isPrimary && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold text-primary dark:text-primary">PRIMARY</span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[ct.roleTitle, ct.email, ct.phone].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {ct.portalUser ? (
                            <>
                              <StatusBadge status={ct.portalUser.isActive ? "CONNECTED" : "DISCONNECTED"} />
                              <span className="hidden text-[10.5px] text-muted-foreground sm:block">
                                last login {timeAgo(ct.portalUser.lastLoginAt)}
                              </span>
                              <Btn variant="outline" className="px-2.5 py-1 text-[11px]" onClick={() => { setPasswordModal({ mode: "reset", contact: ct }); setPassword(""); setModalError(null); }}>
                                <KeyRound className="size-3.5" /> Reset
                              </Btn>
                              <Btn variant="outline" className={cn("px-2.5 py-1 text-[11px]", ct.portalUser.isActive ? "" : "text-emerald-600 dark:text-emerald-300")} onClick={() => toggleAccess(ct)}>
                                <Power className="size-3.5" /> {ct.portalUser.isActive ? "Disable" : "Enable"}
                              </Btn>
                              <Btn
                                variant="outline"
                                className="px-2.5 py-1 text-[11px]"
                                disabled={previewBusy}
                                onClick={() => openPreview(ct.portalUser!.id, ct.name, c.companyName)}
                              >
                                <Eye className="size-3.5" /> Preview
                              </Btn>
                            </>
                          ) : (
                            <Btn variant="primary" className="px-2.5 py-1 text-[11px]" onClick={() => { setPasswordModal({ mode: "create", contact: ct }); setPassword(""); setModalError(null); }}>
                              <UserPlus className="size-3.5" /> Create access
                            </Btn>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {loading ? (
            <div className="flex flex-col gap-2">
              {[...Array(4)].map((_, i) => (
                <SkeletonBlock key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <FadeIn>
              <TableShell>
                <table className="w-full">
                  <THead>
                    <Th>Contact</Th>
                    <Th>Client</Th>
                    <Th>Access</Th>
                    <Th>Last Login</Th>
                    <Th>Status</Th>
                  </THead>
                  <tbody>
                    {(users ?? []).map((u, i) => (
                      <Tr key={u.id} index={i}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={u.clientContact.name} />
                            <p className="font-medium">{u.clientContact.name}</p>
                          </div>
                        </Td>
                        <Td className="text-muted-foreground">{u.clientContact.client.companyName}</Td>
                        <Td className="text-muted-foreground">{u.clientContact.roleTitle ?? "—"}</Td>
                        <Td className="text-muted-foreground">{timeAgo(u.lastLoginAt)}</Td>
                        <Td><StatusBadge status={u.isActive ? "CONNECTED" : "DISCONNECTED"} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          )}

          <div className="mt-4">
            <FadeIn>
              <TableShell>
                <table className="w-full">
                  <THead>
                    <Th>Comment</Th>
                    <Th>Project</Th>
                    <Th>From</Th>
                    <Th>Sentiment</Th>
                    <Th>When</Th>
                  </THead>
                  <tbody>
                    {(comments ?? []).slice(0, 6).map((c, i) => (
                      <Tr key={c.id} index={i}>
                        <Td className="max-w-xs truncate">{c.content}</Td>
                        <Td className="text-muted-foreground">
                          {c.project?.name ?? (c.threadKey === "general" ? `General · ${c.client?.companyName ?? "—"}` : "—")}
                        </Td>
                        <Td className="text-muted-foreground">
                          {c.portalUser?.clientContact?.name ?? c.author?.name ?? "—"}
                        </Td>
                        <Td>
                          <StatusBadge
                            status={
                              c.sentiment === "NEGATIVE_URGENT" ? "RED" : c.sentiment === "POSITIVE" ? "GREEN" : "YELLOW"
                            }
                          />
                        </Td>
                        <Td className="text-muted-foreground">{timeAgo(c.createdAt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>

            <FadeIn delay={0.05}>
              <div
                ref={replyRef}
                className={cn(
                  "mt-4 card-lift rounded-2xl border bg-card p-4 shadow-sm transition-shadow",
                  threadParam ? "border-primary/50 ring-2 ring-primary/15" : "border-border/60"
                )}
              >
                <h3 className="text-[14px] font-heading font-semibold">Reply to a client</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  The message appears instantly in the client portal and notifies their contacts.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-[260px_1fr]">
                  <select
                    value={replyTarget}
                    onChange={(e) => setReplyTarget(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-[12px]"
                  >
                    <option value="">Choose a conversation…</option>
                    <optgroup label="General (client-wide)">
                      {(clients ?? []).map((c) => (
                        <option key={c.id} value={`client:${c.id}`}>
                          {c.companyName}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Project threads">
                      {(audit ?? []).map((p) => (
                        <option key={p.id} value={`project:${p.id}`}>
                          {p.name} — {p.clientName}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <div />
                </div>

                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={3}
                  placeholder="Write a reply to your client…"
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-[12.5px]"
                />

                <div className="mt-2 flex items-center justify-between gap-2">
                  {replyMsg ? (
                    <p className={cn("text-[11.5px]", replyOk ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                      {replyMsg}
                    </p>
                  ) : (
                    <span />
                  )}
                  <Btn variant="primary" className="px-3 py-1.5 text-[12px]" disabled={replyBusy} onClick={sendStaffReply}>
                    <Send className="size-3.5" />
                    {replyBusy ? "Sending…" : "Send to portal"}
                  </Btn>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>

        <FadeIn delay={0.1}>
          <div className="card-lift rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-[15px] font-heading font-semibold">Deliverable Approvals</h3>
            <div className="flex flex-col gap-3">
              {(approvals ?? []).slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 p-2.5">
                  <div>
                    <p className="text-[12px] font-medium">{a.portalUser.clientContact.client.companyName}</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      file v{a.portalUser.clientContact.name.split(" ")[0]} · {timeAgo(a.decidedAt)}
                    </p>
                  </div>
                  <StatusBadge status={a.decision === "APPROVED" ? "APPROVED" : "REJECTED"} />
                </div>
              ))}
              {!approvals?.length && <p className="text-[12px] text-muted-foreground">No decisions yet</p>}
            </div>
          </div>
        </FadeIn>
      </div>

      <Modal open={!!previewFor} onClose={() => { setPreviewFor(null); setPreview(null); }} title={`Preview — ${previewFor?.name ?? ""}`} size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-[11.5px] text-muted-foreground">
            {previewFor?.client} · exactly what this contact sees after signing in. No token is issued.
          </p>

          {previewBusy || !preview ? (
            <SkeletonBlock className="h-32" />
          ) : preview.error ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
              {preview.error}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {(preview.scope.modules ?? []).map((m: string) => (
                  <span key={m} className="rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-bold text-primary dark:text-primary">
                    {m}
                  </span>
                ))}
                <span className={cn("rounded-full px-2.5 py-1 text-[10.5px] font-bold", preview.scope.canSeeAdSpend ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                  {preview.scope.canSeeAdSpend ? "ADS VISIBLE" : "ADS HIDDEN"}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground">
                  {preview.scope.projectIds ? `${preview.scope.projectIds.length} PROJECTS` : "ALL PROJECTS"}
                </span>
              </div>

              {preview.overview?.error ? (
                <p className="text-[12px] text-rose-500">Overview unavailable: {preview.overview.error}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Projects", value: preview.overview?.projectCount ?? 0 },
                    { label: "Shared tasks", value: preview.tasks?.total ?? 0 },
                    { label: "Done", value: preview.overview?.taskStats?.done ?? 0 },
                    { label: "In progress", value: preview.overview?.taskStats?.inProgress ?? 0 },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                      <p className="font-heading text-lg font-bold tabular-nums">{s.value}</p>
                      <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {preview.tasks?.items?.length ? (
                <div>
                  <p className="mb-2 text-[12.5px] font-semibold">First tasks they would see</p>
                  <div className="flex flex-col gap-1.5">
                    {preview.tasks.items.slice(0, 6).map((t: any) => (
                      <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5">
                        <StatusBadge status={t.status} />
                        <span className="min-w-0 flex-1 truncate text-[12px]">{t.title}</span>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">{t.project?.name ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                  This contact would see an empty Work tab — no tasks are shared with them yet.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!passwordModal} onClose={() => setPasswordModal(null)} title={passwordModal?.mode === "create" ? "Create portal access" : "Reset portal password"}>
        {passwordModal && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
              <p className="text-[13px] font-semibold">{passwordModal.contact.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {passwordModal.contact.email ?? passwordModal.contact.roleTitle ?? "—"}
                {passwordModal.mode === "create"
                  ? " — portal login will be enabled with this password."
                  : " — a new password for this portal account."}
              </p>
            </div>
            <Field label="Password">
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </Field>
            {modalError && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
                {modalError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPasswordModal(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={submitPassword} className={cn(busy && "pointer-events-none opacity-60")}>
                {busy ? "Saving…" : passwordModal.mode === "create" ? "Create access" : "Reset password"}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}