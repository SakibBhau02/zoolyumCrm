"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Bell, Download, FileDown, HandCoins, Mail, MessageCircle, Pencil, Plus, Printer, Trash2, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { useBranding } from "@/lib/branding-context";
import { REMINDER_TYPES, invoiceTotals, numberToWords, paymentSerial, receiptLabel } from "@/lib/invoice-utils";
import { buildReceiptMessage, buildReminderMessage, mailtoLink, whatsappLink } from "@/lib/share";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn, Td, THead, Th } from "@/components/table";
import { Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { INVOICE_STATUSES, label } from "./constants";
import { useCapitalOptional } from "./capital-context";
import { CreditNoteModal, InstallmentModal, PaymentModal } from "./modals";

/**
 * jsPDF (~350 KB) and the `qrcode` encoder only matter once someone downloads
 * or prints an invoice, but both used to sit in the statically imported module
 * graph of every capital tab. `invoice-pdf` is now imported inside the click
 * handlers; the print preview — the only consumer of `qrcode` — is its own
 * chunk that downloads when the preview opens.
 */
const fromPdf = () => import("@/lib/invoice-pdf");

const InvoicePrintView = dynamic(
  () => import("./invoice-print-view").then((m) => m.InvoicePrintView),
  { ssr: false }
);

/**
 * Centered invoice detail popup (replaces the old right-side Drawer).
 * Rendered in the middle of the screen via the shared `Modal` component.
 */
export function InvoiceDetailModal({
  selectedId,
  onClose,
  onEdit,
}: {
  selectedId: string | null;
  onClose: () => void;
  onEdit: (inv: any) => void;
}) {
  const { branding } = useBranding();
  // Works standalone (Flow module) as well as inside CapitalProvider:
  // outside the provider, notify/reload/bank lists gracefully degrade.
  const cap = useCapitalOptional();
  const refreshKey = cap?.refreshKey ?? 0;
  const reload = cap?.reload ?? (() => {});
  const notify = cap?.notify ?? (() => {});
  const bankAccounts = cap?.bankAccounts ?? [];
  const openBalanceInvoice = cap?.openBalanceInvoice ?? ((_p: any) => {});
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [projBalance, setProjBalance] = useState<any | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [instOpen, setInstOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [payDeleteBusy, setPayDeleteBusy] = useState<string | null>(null);
  const [payConfirmId, setPayConfirmId] = useState<string | null>(null);
  const [remOpen, setRemOpen] = useState(false);
  const [remBusy, setRemBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [remForm, setRemForm] = useState({ type: "due_today", channel: "system", subject: "", notes: "" });
  // share link + WhatsApp API sends for this invoice
  const [share, setShare] = useState<{ hasToken: boolean; token: string | null } | null>(null);
  const [waLogs, setWaLogs] = useState<any[] | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waTpl, setWaTpl] = useState("invoice_ready");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setProjBalance(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<any>(`/capital/invoices/${selectedId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        if (d?.projectId) {
          apiFetch<any>(`/capital/invoices/${selectedId}/project-balance`)
            .then((b) => !cancelled && setProjBalance(b?.project ? b : null))
            .catch(() => !cancelled && setProjBalance(null));
        } else {
          setProjBalance(null);
        }
      })
      .catch(() => !cancelled && setDetail(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  useEffect(() => {
    if (!detail?.id) {
      setShare(null);
      setWaLogs(null);
      return;
    }
    let cancelled = false;
    apiFetch<any>(`/capital/invoices/${detail.id}/share`)
      .then((s) => !cancelled && setShare(s))
      .catch(() => !cancelled && setShare(null));
    apiFetch<any[]>(`/capital/invoices/${detail.id}/whatsapp`)
      .then((l) => !cancelled && setWaLogs(l))
      .catch(() => !cancelled && setWaLogs(null));
    return () => {
      cancelled = true;
    };
  }, [detail?.id]);

  const t = invoiceTotals({
    lineItems: detail?.lineItems,
    taxApplicable: detail?.taxApplicable,
    taxRate: detail?.taxRate,
    discountRate: detail?.discountRate,
    shippingFee: detail?.shippingFee,
    payments: detail?.payments,
  });
  const total = t.subtotal;
  const tax = t.tax;
  const discount = t.discount;
  const shipping = t.shipping;
  const grand = t.grand;
  const paid = t.paid;
  const balance = t.balance;
  const payments = detail?.payments ?? [];
  // chronological serials (server sends `serial`; fallback computes the same way)
  const receiptNo = (p: any) => receiptLabel(detail?.invoiceNumber ?? "", payments, p);
  const receiptIndex = (p: any) => (p.serial ?? paymentSerial(payments, p.id) ?? 1) - 1;

  const shareLink = share?.token && typeof window !== "undefined" ? `${window.location.origin}/p/inv/${share.token}` : null;

  const refreshShare = async () => {
    if (!detail?.id) return;
    try {
      setShare(await apiFetch<any>(`/capital/invoices/${detail.id}/share`));
      setWaLogs(await apiFetch<any[]>(`/capital/invoices/${detail.id}/whatsapp`));
    } catch {}
  };

  /** Two-step delete for a single payment (no native confirm dialog). */
  const deletePaymentEntry = async (p: any) => {
    if (!detail?.id) return;
    if (payConfirmId !== p.id) {
      setPayConfirmId(p.id);
      return;
    }
    setPayConfirmId(null);
    setPayDeleteBusy(p.id);
    try {
      await apiFetch(`/capital/invoices/${detail.id}/payments/${p.id}`, { method: "DELETE" });
      notify("Payment removed");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Could not delete the payment");
    } finally {
      setPayDeleteBusy(null);
    }
  };

  const rotateLink = async () => {
    if (!detail?.id) return;
    try {
      await apiFetch(`/capital/invoices/${detail.id}/share`, { method: "POST" });
      notify("Share link created");
      await refreshShare();
    } catch (e: any) {
      notify(e.message ?? "Link failed");
    }
  };

  const revokeLink = async () => {
    if (!detail?.id) return;
    try {
      await apiFetch(`/capital/invoices/${detail.id}/share`, { method: "DELETE" });
      notify("Share link revoked");
      await refreshShare();
    } catch (e: any) {
      notify(e.message ?? "Revoke failed");
    }
  };

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Copy failed");
    }
  };

  const sendWaApi = async () => {
    if (!detail?.id || waBusy) return;
    setWaBusy(true);
    try {
      const r = await apiFetch<any>(`/capital/invoices/${detail.id}/whatsapp`, {
        method: "POST",
        body: JSON.stringify({ template: waTpl, force: true }),
      });
      notify(r.ok ? (r.mocked ? `Mock WhatsApp sent (${r.wamid ?? "logged"})` : r.skipped ? "Already sent — skipped duplicate" : `WhatsApp sent (${r.wamid ?? ""})`) : `Send failed — ${r.error ?? r.skipped ?? "error"}`);
      await refreshShare();
    } catch (e: any) {
      notify(e.message ?? "Send failed");
    } finally {
      setWaBusy(false);
    }
  };

  const openWaManual = () => {
    const contact = detail?.client?.contacts?.[0];
    if (!contact?.phone) return notify("No client phone on file");
    const text = `Hello ${contact?.name ?? detail?.client?.companyName ?? "there"}, invoice ${detail?.invoiceNumber} of ${formatBDT(grand)}${balance > 0 ? ` — balance ${formatBDT(balance)}` : " — fully paid"}.${shareLink ? `\nView it here: ${shareLink}` : ""}`;
    const link = whatsappLink(contact.phone, text);
    if (link) window.open(link, "_blank", "noopener");
    else notify("No client phone on file");
  };

  const setStatus = async (status: string) => {    if (!detail) return;
    setStatusBusy(true);
    try {
      await apiFetch(`/capital/invoices/${detail.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify("Status updated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    } finally {
      setStatusBusy(false);
    }
  };

  const doPdf = async () => {
    if (!detail || pdfBusy) return;
    setPdfBusy(true);
    try {
      // Full company profile flows into the PDF (logo, signature, payment instructions, terms).
      // Always async: embedded Bengali font (৳) must load before drawing.
      const pdfBranding = branding ? { ...branding } : undefined;
      const invForPdf = projBalance?.project && !projBalance?.reason ? { ...detail, projectBalance: projBalance } : detail;
      // QR encodes the public invoice link — reuse the token, create only when missing.
      let shareUrl: string | undefined;
      try {
        let token = detail.shareToken as string | undefined;
        if (!token) {
          const s = await apiFetch<any>(`/capital/invoices/${detail.id}/share/ensure`, { method: "POST" });
          token = s?.token;
        }
        if (token && typeof window !== "undefined") shareUrl = `${window.location.origin}/p/inv/${token}`;
      } catch {
        shareUrl = undefined;
      }
      const { buildInvoicePdfAsync } = await fromPdf();
      const doc = await buildInvoicePdfAsync({ ...invForPdf, shareUrl }, pdfBranding);
      doc.save(`${detail.invoiceNumber}.pdf`);
    } catch {
      notify("PDF generation failed");
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadReceipt = async (p: any, idx: number) => {
    if (!detail || receiptBusy) return;
    setReceiptBusy(true);
    try {
      const { buildReceiptPdf: receiptBuilder, resolveBrandingImages, ensurePdfFonts } = await fromPdf();
      await ensurePdfFonts();
      const fullBranding = await resolveBrandingImages(branding ? { ...branding } : undefined);
      const rdoc = receiptBuilder(detail, { ...p, index: receiptIndex(p) }, fullBranding);
      rdoc.save(`${receiptNo(p)}.pdf`);
    } catch {
      notify("Receipt generation failed");
    } finally {
      setReceiptBusy(false);
    }
  };

  /** After recording a payment: close, refresh, then auto-download the newest receipt. */
  const handlePaySaved = async () => {
    setPayOpen(false);
    reload();
    notify("Payment recorded");
    try {
      const fresh = await apiFetch<any>(`/capital/invoices/${selectedId}`);
      setDetail(fresh);
      const newest = (fresh?.payments ?? [])[0];
      if (newest) {
        const { buildReceiptPdf: receiptBuilder, resolveBrandingImages, ensurePdfFonts } = await fromPdf();
        await ensurePdfFonts();
        const fullBranding = await resolveBrandingImages(branding ? { ...branding } : undefined);
        const serial = newest.serial ?? paymentSerial(fresh.payments, newest.id);
        const rdoc = receiptBuilder(fresh, { ...newest, index: Math.max(serial - 1, 0) }, fullBranding);
        rdoc.save(`${receiptLabel(fresh.invoiceNumber, fresh.payments, newest)}.pdf`);
      }
    } catch { /* receipt is best-effort */ }
  };

  /** Share a paid receipt via the client's own Email / WhatsApp app (logged as a reminder). */
  const shareReceipt = async (p: any, idx: number, channel: "email" | "whatsapp") => {
    if (!detail) return;
    const contact = detail.client?.contacts?.[0];
    const msg = buildReceiptMessage({
      invoiceNumber: detail.invoiceNumber,
      receiptNo: receiptNo(p),
      currency: detail.currency,
      paidAmount: Number(p.amount),
      balance,
      method: p.paymentMethod,
      date: p.paymentDate,
      clientName: contact?.name ?? detail.client?.companyName,
      companyName: branding?.appName ?? "Zoolyum",
    });
    if (channel === "email" && !contact?.email) return notify("No client email on file");
    if (channel === "whatsapp" && !contact?.phone) return notify("No client phone on file");
    try {
      await apiFetch(`/capital/invoices/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({ type: "paid_receipt", channel, subject: msg.subject, notes: msg.body }),
      });
      const fresh = await apiFetch<any>(`/capital/invoices/${detail.id}`);
      setDetail(fresh);
      notify(channel === "email" ? "Receipt email ready" : "WhatsApp share ready");
    } catch (err: any) {
      notify(err.message ?? "Share failed");
      return;
    }
    const link = channel === "email"
      ? mailtoLink(contact.email, msg.subject, msg.body)
      : whatsappLink(contact.phone, `${msg.subject}\n\n${msg.body}`);
    if (link) window.open(link, "_blank");
  };

  const sendReminder = async (e: React.FormEvent) => {    e.preventDefault();
    if (!detail || remBusy) return;
    setRemBusy(true);
    try {
      await apiFetch(`/capital/invoices/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          type: remForm.type,
          channel: remForm.channel,
          subject: remForm.subject.trim() || undefined,
          notes: remForm.notes.trim() || undefined,
        }),
      });
      notify("Reminder logged");
      setRemOpen(false);
      setRemForm({ type: "due_today", channel: "system", subject: "", notes: "" });
      const fresh = await apiFetch<any>(`/capital/invoices/${detail.id}`);
      setDetail(fresh);
      reload();
      // Email / WhatsApp channels open the client's own app with prefilled text
      if (remForm.channel === "email" || remForm.channel === "whatsapp") {
        const contact = fresh?.client?.contacts?.[0] ?? detail.client?.contacts?.[0];
        const msg = buildReminderMessage({
          invoiceNumber: detail.invoiceNumber,
          currency: detail.currency,
          grand,
          balance,
          dueDate: detail.dueDate,
          clientName: contact?.name ?? detail.client?.companyName,
          companyName: branding?.appName ?? "Zoolyum",
        });
        const link = remForm.channel === "email"
          ? (contact?.email ? mailtoLink(contact.email, remForm.subject.trim() || msg.subject, msg.body) : null)
          : whatsappLink(contact?.phone, `${remForm.subject.trim() || msg.subject}\n\n${msg.body}`);
        if (link) window.open(link, "_blank");
        else notify(remForm.channel === "email" ? "No client email on file" : "No client phone on file");
      }
    } catch (err: any) {
      notify(err.message ?? "Reminder failed");
    } finally {
      setRemBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={!!selectedId}
        onClose={onClose}
        size="2xl"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-section font-semibold tabular-nums">{detail?.invoiceNumber ?? "Invoice"}</p>
            {detail && <StatusBadge status={detail.status} />}
          </div>
        }
        footer={
          detail && !loading ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="invoice-actions">
              <Btn variant="outline" onClick={doPdf} disabled={pdfBusy}>
                <FileDown className="size-3.5" /> {pdfBusy ? "Exporting…" : "Download PDF"}
              </Btn>
              <Btn variant="outline" onClick={() => detail && setPrintOpen(true)}>
                <Printer className="size-3.5" /> Print view
              </Btn>
              <Btn variant="outline" onClick={() => detail && onEdit(detail)}>
                <Pencil className="size-3.5" /> Edit
              </Btn>
              <Btn variant="outline" onClick={() => detail && setInstOpen(true)}>
                <Wallet className="size-3.5" /> Installments
              </Btn>
              <Btn
                variant="outline"
                onClick={() => detail && detail.status !== "DRAFT" && setCnOpen(true)}
                disabled={detail?.status === "DRAFT"}
                title={detail?.status === "DRAFT" ? "Issue the invoice before crediting or refunding it" : undefined}
              >
                <HandCoins className="size-3.5" /> Credit / Refund
              </Btn>
              <Btn variant="outline" onClick={() => detail && setRemOpen((v) => !v)}>
                <Bell className="size-3.5" /> Remind
              </Btn>
              <div className="ml-auto">
                <Btn
                  variant="primary"
                  onClick={() => balance > 0 && detail?.status !== "DRAFT" && setPayOpen(true)}
                  disabled={balance <= 0 || detail?.status === "DRAFT"}
                  title={detail?.status === "DRAFT" ? "Issue the invoice before recording a payment" : undefined}
                >
                  <Plus className="size-3.5" /> Record Payment
                </Btn>
              </div>
            </div>
          ) : undefined
        }
      >
        {loading ? (
          <div className="flex flex-col gap-3">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : !detail ? (
          <EmptyState title="Invoice not found" hint="It may have been deleted." />
        ) : (
            <div className="flex flex-col gap-5 pb-1">
            <div className="flex flex-wrap items-center gap-3">
              <Field label="Status">
                <Select value={detail.status} onChange={(e) => setStatus(e.target.value)} disabled={statusBusy} className="!w-44">
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="ml-auto text-right">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Grand total</p>
                <p className="font-heading text-stat font-bold tabular-nums">{formatBDT(grand)}</p>
                {balance > 0 ? (
                  <p className="text-meta font-semibold tabular-nums text-amber-500">{formatBDT(balance)} due</p>
                ) : (
                  <p className="text-meta font-semibold text-emerald-500">Fully paid</p>
                )}
              </div>
            </div>

            <CardShell className="!p-4">
              <div className="flex items-center gap-3">
                <Avatar name={detail.client?.companyName ?? "?"} size="size-10" />
                <div className="min-w-0">
                  <p className="text-body-lg font-semibold">{detail.client?.companyName}</p>
                  <p className="text-meta text-muted-foreground">{detail.project ? `Project: ${detail.project.name}` : "No project"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-meta">
                <div>
                  <p className="text-micro uppercase tracking-wider text-muted-foreground">Issued</p>
                  <p className="font-medium">{formatDate(detail.issueDate)}</p>
                </div>
                <div>
                  <p className="text-micro uppercase tracking-wider text-muted-foreground">Due</p>
                  <p className="font-medium">{formatDate(detail.dueDate)}</p>
                </div>
              </div>
              {detail.client?.contacts?.length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-border/50 pt-3">
                  {detail.client.contacts.map((c: any) => (
                    <p key={c.id} className="text-meta text-muted-foreground">
                      {c.name} {c.email && <span className="text-foreground/70">· {c.email}</span>} {c.phone && <span className="text-foreground/70">· {c.phone}</span>}
                    </p>
                  ))}
                </div>
              )}
            </CardShell>

            {projBalance?.project && !projBalance?.reason && (
              <CardShell className="!p-4 !border-primary/25 !bg-gradient-to-r !from-primary/10 !via-primary/5 !to-transparent">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-micro font-bold uppercase tracking-wider text-primary">
                    Project balance · {projBalance.project.name}
                  </p>
                  {projBalance.due > 0 ? (
                    <button
                      onClick={() => {
                        openBalanceInvoice({
                          clientId: detail.client?.id,
                          projectId: projBalance.project.id,
                          amount: projBalance.due,
                          description: `Balance — ${projBalance.project.name}`,
                        });
                        onClose();
                      }}
                      className="rounded-lg bg-brand-gradient px-2.5 py-1.5 text-meta font-bold text-white transition-transform hover:scale-[1.02]"
                    >
                      Invoice remaining {formatBDT(projBalance.due)}
                    </button>
                  ) : (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-micro font-bold text-emerald-500">Cleared</span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-card/70 px-2 py-1.5">
                    <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Project value</p>
                    <p className="text-body-lg font-bold tabular-nums">{formatBDT(projBalance.value)}</p>
                  </div>
                  <div className="rounded-xl bg-card/70 px-2 py-1.5">
                    <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Paid to date</p>
                    <p className="text-body-lg font-bold tabular-nums text-emerald-500">{formatBDT(projBalance.paid)}</p>
                  </div>
                  <div className="rounded-xl bg-card/70 px-2 py-1.5">
                    <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Due now</p>
                    <p className="text-body-lg font-bold tabular-nums text-amber-500">{formatBDT(projBalance.due)}</p>
                  </div>
                </div>
                {projBalance.invoices?.length > 0 && (
                  <div className="mt-2 border-t border-border/50 pt-2">
                    <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Project invoices</p>
                    {projBalance.invoices.slice(0, 5).map((inv: any) => (
                      <p key={inv.id} className="flex items-center justify-between gap-2 py-0.5 text-meta">
                        <span className="min-w-0 truncate text-muted-foreground">
                          <span className="font-medium tabular-nums text-foreground">{inv.invoiceNumber}</span>
                          {inv.invoiceType === "ADVANCE" && <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-px text-micro font-bold uppercase text-amber-600 dark:text-amber-400">Adv</span>}
                          {inv.title && <span className="block truncate">{inv.title}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <StatusBadge status={inv.status} />
                          <span className="tabular-nums">{formatBDT(inv.balance ?? 0)}</span>
                        </span>
                      </p>
                    ))}
                    {projBalance.invoices.length > 5 && (
                      <p className="text-micro text-muted-foreground">+{projBalance.invoices.length - 5} more</p>
                    )}
                  </div>
                )}
                {projBalance.payments?.length > 0 && (
                  <div className="mt-2 border-t border-border/50 pt-2">
                    <p className="mb-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">Payment history</p>
                    {projBalance.payments.slice(0, 4).map((p: any) => (
                      <p key={p.id} className="flex items-center justify-between gap-2 py-0.5 text-meta">
                        <span className="truncate text-muted-foreground">{p.invoiceNumber} · {formatDate(p.paymentDate)}</span>
                        <span className="shrink-0 font-bold tabular-nums text-emerald-500">{formatBDT(p.amount)}</span>
                      </p>
                    ))}
                    {projBalance.payments.length > 4 && (
                      <p className="text-micro text-muted-foreground">+{projBalance.payments.length - 4} more</p>
                    )}
                  </div>
                )}
              </CardShell>
            )}

            {detail && (
              <CardShell className="!p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-micro font-bold uppercase tracking-wider text-primary">Share & WhatsApp</p>
                  {waLogs?.[0] && <StatusBadge status={waLogs[0].status} />}
                </div>
                {shareLink ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input value={shareLink} readOnly className="!font-mono !text-meta" />
                    <Btn variant="outline" onClick={copyLink} className="shrink-0">{copied ? "Copied ✓" : "Copy"}</Btn>
                  </div>
                ) : (
                  <p className="mt-2 text-meta text-muted-foreground">No public link yet — create one to share this invoice on WhatsApp.</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Btn variant="outline" onClick={rotateLink}>{share?.token ? "Regenerate link" : "Create link"}</Btn>
                  {share?.token && <Btn variant="outline" onClick={revokeLink}>Revoke</Btn>}
                  <Select value={waTpl} onChange={(e) => setWaTpl(e.target.value)} className="!w-auto">
                    <option value="invoice_ready">Invoice issued</option>
                    <option value="payment_due_today">Due today</option>
                    <option value="payment_overdue">Overdue nudge</option>
                    <option value="payment_received">Receipt</option>
                  </Select>
                  <Btn variant="primary" onClick={sendWaApi} className={waBusy ? "opacity-60" : ""}>{waBusy ? "Sending…" : "Send via WhatsApp"}</Btn>
                  <Btn variant="outline" onClick={openWaManual}>WhatsApp app</Btn>
                </div>
                {(waLogs ?? []).length > 0 && (
                  <div className="mt-2 border-t border-border/50 pt-2">
                    {(waLogs ?? []).slice(0, 3).map((l: any) => (
                      <p key={l.id} className="flex items-center justify-between gap-2 py-0.5 text-meta text-muted-foreground">
                        <span className="truncate font-mono">{l.templateName ?? l.messageType} → {l.to}</span>
                        <StatusBadge status={l.status} />
                      </p>
                    ))}
                  </div>
                )}
              </CardShell>
            )}

            <section>
              <SectionTitle title="Line items" subtitle={`${detail.lineItems?.length ?? 0} items`} />
              <div className="overflow-hidden rounded-xl border border-border/60">
                <table className="w-full">
                  <THead>
                    <Th>Description</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Amount</Th>
                  </THead>
                  <tbody>
                    {(detail.lineItems ?? []).map((l: any) => (
                      <tr key={l.id} className="border-b border-border/40 last:border-0">
                        <Td className="!py-2.5">{l.description}</Td>
                        <Td className="!py-2.5 text-right tabular-nums">{l.quantity}</Td>
                        <Td className="!py-2.5 text-right tabular-nums">{formatBDT(l.unitPrice)}</Td>
                        <Td className="!py-2.5 text-right font-semibold tabular-nums">{formatBDT(l.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <SectionTitle title="Installments" subtitle={(detail.installments ?? []).length ? "payment plan" : undefined} />
              {(detail.installments ?? []).length === 0 && <p className="text-meta text-muted-foreground">No payment plan set. Record payments as they arrive.</p>}
              {(detail.installments ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {(detail.installments ?? []).map((s: any) => {
                    const done = s.status === "PAID";
                    return (
                      <div key={s.id} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2", done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60")}>
                        <div className="flex items-center gap-2.5">
                          <span className={cn("flex size-6 items-center justify-center rounded-full text-micro font-bold", done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>{s.sequence}</span>
                          <div>
                            <p className="text-body font-medium">Due {formatDate(s.dueDate)}</p>
                            <p className="text-micro text-muted-foreground">
                              {s.status} · {formatBDT(s.paidAmount)} paid
                            </p>
                          </div>
                        </div>
                        <p className="text-body font-bold tabular-nums">{formatBDT(s.amount)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <SectionTitle title="Payments" subtitle={`${payments.length} received`} />
              <div className="flex flex-col gap-1.5">
                {payments.length === 0 && <p className="text-meta text-muted-foreground">No payments recorded yet.</p>}
                {payments.map((p: any, idx: number) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-body font-medium">
                        {label(p.paymentMethod)}{" "}
                        <button onClick={() => void downloadReceipt(p, idx)} className="font-mono text-micro text-primary hover:underline" title="Download receipt PDF">
                          #{receiptNo(p)}
                        </button>
                      </p>
                      <p className="text-micro text-muted-foreground">
                        {formatDate(p.paymentDate)} · {p.recordedBy?.name ?? "system"}
                        {p.installment ? ` · installment #${p.installment.sequence}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <p className="mr-1 text-body font-bold tabular-nums text-emerald-500">{formatBDT(p.amount)}</p>
                      <button
                        onClick={() => void downloadReceipt(p, idx)}
                        disabled={receiptBusy}
                        aria-label="Download receipt PDF"
                        className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
                        title="Download receipt PDF"
                      >
                        <Download className="size-3.5" />
                      </button>
                      <button
                        onClick={() => void shareReceipt(p, idx, "email")}
                        aria-label="Send receipt via Email"
                        className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
                        title="Send receipt via Email"
                      >
                        <Mail className="size-3.5" />
                      </button>
                      <button
                        onClick={() => void shareReceipt(p, idx, "whatsapp")}
                        aria-label="Send receipt via WhatsApp"
                        className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
                        title="Send receipt via WhatsApp"
                      >
                        <MessageCircle className="size-3.5" />
                      </button>
                      <button
                        onClick={() => void deletePaymentEntry(p)}
                        disabled={payDeleteBusy === p.id}
                        aria-label={payConfirmId === p.id ? "Confirm delete payment" : "Delete payment"}
                        className={cn(
                          "rounded-lg p-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50",
                          payConfirmId === p.id ? "bg-rose-500/15 text-rose-500 hover:bg-rose-500/25" : "text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                        )}
                        title={payConfirmId === p.id ? "Click again to confirm" : "Delete this payment"}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle
                title="Reminders"
                subtitle={(detail.reminders ?? []).length ? `${(detail.reminders ?? []).length} sent` : undefined}
                action={
                  <Btn variant="ghost" onClick={() => setRemOpen((v) => !v)} data-testid="send-reminder-btn">
                    <Bell className="size-3.5" /> Send Reminder
                  </Btn>
                }
              />
              {remOpen && (
                <form onSubmit={sendReminder} className="mb-2 flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Type">
                      <Select value={remForm.type} onChange={(e) => setRemForm({ ...remForm, type: e.target.value })}>
                        {REMINDER_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Channel">
                      <Select value={remForm.channel} onChange={(e) => setRemForm({ ...remForm, channel: e.target.value })}>
                        <option value="system">System log</option>
                        <option value="email">Email</option>
                        <option value="whatsapp">WhatsApp</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Subject"><Input value={remForm.subject} onChange={(e) => setRemForm({ ...remForm, subject: e.target.value })} placeholder={`Payment reminder — ${detail.invoiceNumber}`} /></Field>
                  <Field label="Note"><Textarea value={remForm.notes} onChange={(e) => setRemForm({ ...remForm, notes: e.target.value })} placeholder="Optional note recorded with this reminder…" /></Field>
                  <div className="flex justify-end gap-2">
                    <Btn variant="ghost" onClick={() => setRemOpen(false)}>Cancel</Btn>
                    <Btn variant="primary" type="submit" className={remBusy ? "opacity-60" : ""}>{remBusy ? "Logging…" : "Log reminder"}</Btn>
                  </div>
                </form>
              )}
              <div className="flex flex-col gap-1.5">
                {(detail.reminders ?? []).length === 0 && <p className="text-meta text-muted-foreground">No reminders sent for this invoice yet.</p>}
                {(detail.reminders ?? []).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div>
                      <p className="text-body font-medium">{r.subject || label(r.type)}</p>
                      <p className="text-micro text-muted-foreground">
                        {label(r.type)} · {r.channel} · {r.recipientName ?? r.recipientEmail ?? "—"} · {formatDate(r.sentAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-micro font-bold text-sky-500 ring-1 ring-sky-500/20">LOGGED</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle title="Credit notes" subtitle={(detail.creditNotes ?? []).length ? `${detail.creditNotes.length} issued` : undefined} />
              {(detail.creditNotes ?? []).length === 0 && <p className="text-meta text-muted-foreground">No credit notes issued for this invoice.</p>}
              <div className="flex flex-col gap-1.5">
                {(detail.creditNotes ?? []).map((cnItem: any) => (
                  <div key={cnItem.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div>
                      <p className="text-body font-medium">
                        {cnItem.referenceNumber} · {label(cnItem.type)}
                      </p>
                      <p className="text-micro text-muted-foreground">
                        {formatDate(cnItem.date)} · {cnItem.reason || "no reason"}
                        {cnItem.createdBy?.name ? ` · ${cnItem.createdBy.name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold", cnItem.status === "APPLIED" ? "bg-emerald-500/10 text-emerald-500" : cnItem.status === "VOID" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500")}>{cnItem.status}</span>
                      <p className={cn("text-body font-bold tabular-nums", cnItem.type === "REFUND" ? "text-rose-500" : "text-amber-500")}>{formatBDT(cnItem.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <CardShell className="!p-4">
              <div className="flex flex-col gap-1.5 text-body">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">{formatBDT(total)}</span>
                </div>
                {tax > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax ({detail.taxRate}%)</span>
                    <span className="font-medium tabular-nums">{formatBDT(tax)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-emerald-600 dark:text-emerald-400">Discount ({detail.discountRate}%)</span>
                    <span className="font-medium tabular-nums">− {formatBDT(discount)}</span>
                  </div>
                )}
                {shipping > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping / Delivery</span>
                    <span className="font-medium tabular-nums">{formatBDT(shipping)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border/60 pt-1.5">
                  <span className="font-semibold">Total</span>
                  <span className="font-semibold tabular-nums">{formatBDT(grand)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="font-medium tabular-nums text-emerald-500">{formatBDT(paid)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">Balance</span>
                  <span className={cn("font-bold tabular-nums", balance > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(balance)}</span>
                </div>
                <p className="border-t border-border/60 pt-1.5 text-meta italic leading-relaxed text-muted-foreground">
                  In words: {numberToWords(grand, detail.currency ?? "BDT")}
                </p>
              </div>
            </CardShell>

            {detail.notes && (
              <p className="text-meta leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Notes:</span> {detail.notes}
              </p>
            )}
            {detail.terms && (
              <p className="text-meta leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Terms:</span> {detail.terms}
              </p>
            )}

            {(branding?.authorizedSignerName || branding?.signatureImageUrl) && (
              <div className="flex justify-end">
                <div className="flex w-48 flex-col items-center gap-1 text-center">
                  {branding?.signatureImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={branding.signatureImageUrl} alt="signature" className="h-12 object-contain" />
                  ) : (
                    <p className="font-serif text-section italic text-primary">Authorized Representative</p>
                  )}
                  <div className="h-px w-full bg-border" />
                  <p className="text-meta font-semibold">{branding.authorizedSignerName}</p>
                  {branding.authorizedSignerTitle && <p className="text-micro text-muted-foreground">{branding.authorizedSignerTitle}</p>}
                </div>
              </div>
            )}

            </div>
        )}
      </Modal>
      <PaymentModal invoice={detail} open={payOpen} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} onSaved={() => void handlePaySaved()} />
      <CreditNoteModal invoice={detail} open={cnOpen} onClose={() => setCnOpen(false)} onSaved={() => { setCnOpen(false); reload(); notify("Credit note created"); }} />
      <InstallmentModal invoice={detail} open={instOpen} onClose={() => setInstOpen(false)} onSaved={() => { setInstOpen(false); reload(); notify("Installment plan set"); }} />
      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title={`Print preview — ${detail?.invoiceNumber ?? ""}`} size="2xl">
        <div className="no-print mb-3 flex flex-wrap items-center justify-end gap-2">
          {/* The preview used to offer Print only — anyone who wanted a file
              had to back out and find the button on the detail sheet. */}
          <Btn variant="outline" onClick={doPdf} disabled={pdfBusy}>
            <FileDown className="size-3.5" /> {pdfBusy ? "Exporting…" : "Download PDF"}
          </Btn>
          <Btn variant="primary" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print
          </Btn>
        </div>
        {detail && (
          <div className="invoice-print-host max-h-[70vh] overflow-auto rounded-xl border border-border/60 bg-slate-100 p-4 print:max-h-none print:overflow-visible print:border-0 print:bg-white print:p-0 dark:bg-black/40">
            <InvoicePrintView detail={detail} totals={{ subtotal: total, tax, discount, shipping, grand, paid, balance }} projBalance={projBalance?.project && !projBalance?.reason ? projBalance : null} branding={branding} shareUrl={shareLink} />
          </div>
        )}
      </Modal>
    </>
  );
}
