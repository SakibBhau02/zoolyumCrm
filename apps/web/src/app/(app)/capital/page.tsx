"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Banknote, Check, CircleDollarSign, Copy, Eye, FileDown, HandCoins, Landmark, Pencil, Plus, ReceiptText, RefreshCw, Search, Trash2, UserPlus, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, formatDay, timeAgo } from "@/lib/format";
import { buildInvoicePdf, buildInvoicePdfAsync } from "@/lib/invoice-pdf";
import { useBranding } from "@/lib/branding-context";
import { Avatar, CardShell, EmptyState, FadeIn, PageHeader, SectionTitle, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Drawer, Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { PaymentDonut, RevenueAreaChart } from "@/components/charts";

type TabKey = "overview" | "invoices" | "expenses" | "income" | "vendors" | "reports" | "profitability" | "accounts" | "activity";

const ACCOUNT_CATEGORIES = ["ASSET", "LIABILITY", "REVENUE", "DIRECT_COST", "OPEX"];

const INVOICE_STATUSES = ["DRAFT", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "VOID"];
const PAYMENT_METHODS = ["CASH", "BKASH", "NAGAD", "CARD", "BANK_TRANSFER"];
const EXPENSE_CATEGORIES = ["AD_SPEND", "FREELANCER", "PRODUCTION", "SALARY", "SOFTWARE", "RENT", "MARKETING", "TRAVEL", "BANK_CHARGE", "MISC"];
const EXPENSE_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

const CAT_TONES: Record<string, string> = {
  AD_SPEND: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
  MARKETING: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300 ring-1 ring-fuchsia-500/20",
  FREELANCER: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  PRODUCTION: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  SALARY: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  SOFTWARE: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/20",
  RENT: "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20",
  TRAVEL: "bg-teal-500/10 text-teal-600 dark:text-teal-300 ring-1 ring-teal-500/20",
  BANK_CHARGE: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  MISC: "bg-muted text-muted-foreground ring-1 ring-border",
};

const ENTITY_TONES: Record<string, string> = {
  INVOICE: "bg-primary/15 text-primary",
  PAYMENT: "bg-emerald-500/15 text-emerald-400",
  EXPENSE: "bg-amber-500/15 text-amber-400",
  VENDOR: "bg-sky-500/15 text-sky-400",
  ACCOUNT: "bg-fuchsia-500/15 text-fuchsia-400",
};

const fmtJSON = (v: any) => {
  if (v == null || v === "") return "—";
  try {
    const s = typeof v === "string" ? JSON.stringify(JSON.parse(v)) : JSON.stringify(v);
    return s.length > 70 ? `${s.slice(0, 70)}…` : s;
  } catch {
    return String(v).slice(0, 70);
  }
};

const today = () => new Date().toISOString().slice(0, 10);

function exportInvoicesCsv(invoices: any[]) {
  const rows = [["Invoice", "Client", "Project", "Type", "Amount", "Paid", "Balance", "Status", "Issued", "Due"]];
  for (const inv of invoices) {
    const amount = inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
    const paid = inv.payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
    rows.push([inv.invoiceNumber, inv.client.companyName, inv.project?.name ?? "", inv.invoiceType ?? "", String(amount), String(paid), String(amount - paid), inv.status, formatDate(inv.issueDate), inv.dueDate ? formatDate(inv.dueDate) : ""]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `invoices-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function InvoiceFormModal({ open, onClose, clients, projects, onSaved }: { open: boolean; onClose: () => void; clients: any[]; projects: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ clientId: "", projectId: "", issueDate: today(), dueDate: "", status: "DRAFT", invoiceType: "ONE_TIME", taxApplicable: false, taxRate: "0", currency: "BDT", exchangeRate: "", notes: "", lines: [{ description: "", unitPrice: "", quantity: "1" }] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ clientId: "", projectId: "", issueDate: today(), dueDate: "", status: "DRAFT", invoiceType: "ONE_TIME", taxApplicable: false, taxRate: "0", currency: "BDT", exchangeRate: "", notes: "", lines: [{ description: "", unitPrice: "", quantity: "1" }] });
  }, [open]);

  const updateLine = (i: number, key: "description" | "unitPrice" | "quantity", v: string) => setF({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)) });
  const total = f.lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.clientId) return setErr("Client is required");
    if (!f.lines.some((l) => l.description.trim())) return setErr("Add at least one line item");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/invoices", {
        method: "POST",
        body: JSON.stringify({
          clientId: f.clientId,
          projectId: f.projectId || undefined,
          issueDate: f.issueDate || undefined,
          dueDate: f.dueDate || undefined,
          status: f.status,
          invoiceType: f.invoiceType,
          taxApplicable: f.taxApplicable,
          taxRate: Number(f.taxRate) || 0,
          currency: f.currency,
          exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined,
          notes: f.notes.trim() || undefined,
          lines: f.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), unitPrice: Number(l.unitPrice) || 0, quantity: Number(l.quantity) || 1 })),
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
    <Modal open={open} onClose={onClose} title="New invoice" size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client *"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Select client…</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select></Field>
          <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">No project</option>{(projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Issue date"><Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Type"><Select value={f.invoiceType} onChange={(e) => setF({ ...f, invoiceType: e.target.value })}>{["ONE_TIME", "RECURRING", "ADVANCE", "COMBINED"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
          <Field label="Tax">
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                <input type="checkbox" checked={f.taxApplicable} onChange={(e) => setF({ ...f, taxApplicable: e.target.checked })} className="size-3.5 accent-primary" />
                Apply tax
              </label>
              {f.taxApplicable && <Input type="number" min={0} max={100} value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} placeholder="%" className="!w-20" />}
            </div>
          </Field>
          {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
        </div>
        <Field label="Line items">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_90px_70px_84px_32px] items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Description</span><span className="text-right">Rate</span><span className="text-right">Qty</span><span className="text-right">Amount</span><span />
            </div>
            {f.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_70px_84px_32px] items-center gap-2">
                <Input value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} placeholder="Design retainer…" />
                <Input type="number" min={0} value={l.unitPrice} onChange={(e) => updateLine(i, "unitPrice", e.target.value)} placeholder="Rate" />
                <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} placeholder="Qty" />
                <span className="text-right text-[12px] font-semibold tabular-nums">{formatBDT((Number(l.unitPrice) || 0) * (Number(l.quantity) || 0))}</span>
                <button type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, idx) => idx !== i) })} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="size-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setF({ ...f, lines: [...f.lines, { description: "", unitPrice: "", quantity: "1" }] })} className="flex items-center gap-1 text-[11.5px] font-bold text-primary transition-colors hover:text-primary"><Plus className="size-3" /> Add line item</button>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <span className="text-[11.5px] font-semibold text-muted-foreground">Total</span>
              <span className="text-[13px] font-bold tabular-nums">{formatBDT(total)}</span>
            </div>
          </div>
        </Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms, references…" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Create invoice" />
      </form>
    </Modal>
  );
}

function EditInvoiceModal({ invoice, onClose, clients, projects, onSaved }: { invoice: any; onClose: () => void; clients: any[]; projects: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ clientId: "", projectId: "", issueDate: today(), dueDate: "", status: "DRAFT", invoiceType: "INVOICE", taxApplicable: false, taxRate: "0", currency: "BDT", notes: "", lines: [{ description: "", unitPrice: "", quantity: "1" }] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) return;
    setF({
      clientId: invoice.clientId ?? "",
      projectId: invoice.projectId ?? "",
      issueDate: (invoice.issueDate ?? "").slice(0, 10),
      dueDate: (invoice.dueDate ?? "").slice(0, 10),
      status: invoice.status ?? "DRAFT",
      invoiceType: invoice.invoiceType ?? "ONE_TIME",
      taxApplicable: !!invoice.taxApplicable,
      taxRate: String(Number(invoice.taxRate) || 0),
      currency: invoice.currency ?? "BDT",
      notes: invoice.notes ?? "",
      lines: (invoice.lineItems ?? []).map((l: any) => ({ description: l.description, unitPrice: String(l.unitPrice), quantity: String(l.quantity) })),
    });
  }, [invoice]);

  const updateLine = (i: number, key: "description" | "unitPrice" | "quantity", v: string) => setF({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)) });
  const total = f.lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.clientId) return setErr("Client is required");
    if (!f.lines.some((l) => l.description.trim())) return setErr("Add at least one line item");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          clientId: f.clientId,
          projectId: f.projectId || undefined,
          issueDate: f.issueDate || undefined,
          dueDate: f.dueDate || undefined,
          status: f.status,
          invoiceType: f.invoiceType,
          taxApplicable: f.taxApplicable,
          taxRate: Number(f.taxRate) || 0,
          currency: f.currency,
          notes: f.notes.trim() || undefined,
          lines: f.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), unitPrice: Number(l.unitPrice) || 0, quantity: Number(l.quantity) || 1 })),
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
    <Modal open={!!invoice} onClose={onClose} title={`Edit invoice — ${invoice?.invoiceNumber ?? ""}`} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client *"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Select client…</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select></Field>
          <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">No project</option>{(projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Issue date"><Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Type"><Select value={f.invoiceType} onChange={(e) => setF({ ...f, invoiceType: e.target.value })}>{["ONE_TIME", "RECURRING", "ADVANCE", "COMBINED"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option></Select></Field>
          <Field label="Tax">
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                <input type="checkbox" checked={f.taxApplicable} onChange={(e) => setF({ ...f, taxApplicable: e.target.checked })} className="size-3.5 accent-primary" />
                Apply tax
              </label>
              {f.taxApplicable && <Input type="number" min={0} max={100} value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} placeholder="%" className="!w-20" />}
            </div>
          </Field>
        </div>
        <Field label="Line items">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_90px_70px_84px_32px] items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Description</span><span className="text-right">Rate</span><span className="text-right">Qty</span><span className="text-right">Amount</span><span />
            </div>
            {f.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_70px_84px_32px] items-center gap-2">
                <Input value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} placeholder="Design retainer…" />
                <Input type="number" min={0} value={l.unitPrice} onChange={(e) => updateLine(i, "unitPrice", e.target.value)} placeholder="Rate" />
                <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} placeholder="Qty" />
                <span className="text-right text-[12px] font-semibold tabular-nums">{formatBDT((Number(l.unitPrice) || 0) * (Number(l.quantity) || 0))}</span>
                <button type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, idx) => idx !== i) })} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="size-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setF({ ...f, lines: [...f.lines, { description: "", unitPrice: "", quantity: "1" }] })} className="flex items-center gap-1 text-[11.5px] font-bold text-primary transition-colors hover:text-primary"><Plus className="size-3" /> Add line item</button>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <span className="text-[11.5px] font-semibold text-muted-foreground">Total</span>
              <span className="text-[13px] font-bold tabular-nums">{formatBDT(total)}</span>
            </div>
          </div>
        </Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms, references…" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save changes" />
      </form>
    </Modal>
  );
}

function CreditNoteModal({ invoice, open, onClose, onSaved }: { invoice: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const total = (invoice?.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const paid = (invoice?.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const [f, setF] = useState({ type: "CREDIT_NOTE", amount: String(Math.min(total, paid)), reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ type: "CREDIT_NOTE", amount: String(Math.min(total, paid)), reason: "" });
  }, [open, invoice]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) return setErr("Amount is required");
    if (f.type === "REFUND" && Number(f.amount) > paid) return setErr(`Cannot refund more than collected ${formatBDT(paid)}`);
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/credit-notes", {
        method: "POST",
        body: JSON.stringify({ invoiceId: invoice.id, clientId: invoice.clientId, type: f.type, amount: Number(f.amount), reason: f.reason.trim() || undefined }),
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
    <Modal open={open} onClose={onClose} title={`${label(f.type)} — ${invoice?.invoiceNumber ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-[11.5px]">
          <span className="text-muted-foreground">Total</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(total)}</span>
          <span className="text-muted-foreground">Collected</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(paid)}</span>
        </div>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="CREDIT_NOTE">Credit note (client balance)</option><option value="REFUND">Refund (money back)</option><option value="WRITE_OFF">Write-off (bad debt)</option></Select></Field>
        <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Discount, service dispute, client credit…" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={`Create ${label(f.type)}`} />
      </form>
    </Modal>
  );
}

function InstallmentModal({ invoice, open, onClose, onSaved }: { invoice: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const total = (invoice?.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const tax = invoice?.taxApplicable ? (total * (Number(invoice.taxRate) || 0)) / 100 : 0;
  const grand = total + tax;
  const existing = invoice?.installments ?? [];
  const hasPayments = existing.some((s: any) => (s.payments?.length ?? 0) > 0 || s.status === "PAID" || Number(s.paidAmount) > 0);
  const [count, setCount] = useState("2");
  const [firstDue, setFirstDue] = useState(today());
  const [rows, setRows] = useState<{ amount: string; dueDate: string }[]>([]);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCount("2");
      setFirstDue(today());
      setCustom(existing.length > 0 && !hasPayments);
      setRows(existing.map((s: any) => ({ amount: String(s.amount), dueDate: String(s.dueDate).slice(0, 10) })));
    }
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let installments: { amount: number; dueDate: string }[];
    if (custom) {
      if (!rows.length) return setErr("Add at least one installment");
      const parsed: { amount: number; dueDate: string }[] = [];
      for (const r of rows) {
        const amount = Number(r.amount);
        if (!amount || amount <= 0) return setErr("Every installment needs a positive amount");
        if (!r.dueDate) return setErr("Every installment needs a due date");
        parsed.push({ amount, dueDate: r.dueDate });
      }
      installments = parsed;
    } else {
      const n = Number(count);
      if (!n || n < 2 || n > 12) return setErr("Choose 2–12 installments");
      const per = Math.round((grand / n) * 100) / 100;
      installments = Array.from({ length: n }, (_, i) => {
        const due = new Date(firstDue);
        due.setMonth(due.getMonth() + i);
        return { amount: i === n - 1 ? Math.round((grand - per * (n - 1)) * 100) / 100 : per, dueDate: due.toISOString().slice(0, 10) };
      });
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify({ installments }) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Installment plan — ${invoice?.invoiceNumber ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-[11.5px]">
          <span className="text-muted-foreground">Invoice total</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(grand)}</span>
        </div>
        {hasPayments ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-600 dark:text-amber-400">Payments already exist against this plan — amounts and dates are locked. Use credit notes for adjustments.</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="size-4 rounded accent-primary" />
              Custom amounts & dates
            </label>
            {!custom ? (
              <>
                <Field label="Number of installments *"><Select value={count} onChange={(e) => setCount(e.target.value)}>{[2, 3, 4, 6, 12].map((n) => <option key={n} value={String(n)}>{n} payments × {formatBDT(Math.round((grand / n) * 100) / 100)}</option>)}</Select></Field>
                <Field label="First installment due"><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">Subsequent installments fall on the same day each following month.</p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_1fr_32px] items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Amount</span><span>Due date</span><span />
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                    <Input type="number" min={0} value={r.amount} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} placeholder="60000" />
                    <Input type="date" value={r.dueDate} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, dueDate: e.target.value } : x)))} />
                    <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="size-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, { amount: "", dueDate: "" }])} className="flex items-center gap-1 text-[11.5px] font-bold text-primary transition-colors hover:text-primary"><Plus className="size-3" /> Add installment</button>
              </div>
            )}
          </>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={hasPayments ? "Close" : "Save plan"} />
      </form>
    </Modal>
  );
}

function PaymentModal({ invoice, open, bankAccounts, onClose, onSaved }: { invoice: any; open: boolean; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
  const total = (invoice?.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const balance = Math.max(0, total - (invoice?.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0));
  const [f, setF] = useState({ amount: String(balance), method: "CASH", date: today(), bankAccountId: "", installmentId: "", referenceId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ amount: String(balance), method: "CASH", date: today(), bankAccountId: bankAccounts[0]?.id ?? "", installmentId: "", referenceId: "" });
  }, [open, balance]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) return setErr("Amount is required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/invoices/${invoice.id}/payment`, { method: "POST", body: JSON.stringify({ amount: Number(f.amount), paymentMethod: f.method, paymentDate: f.date || undefined, bankAccountId: f.bankAccountId || undefined, installmentId: f.installmentId || undefined, referenceId: f.referenceId.trim() || undefined }) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Record payment — ${invoice?.invoiceNumber ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-[11.5px]">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(balance)}</span>
        </div>
        <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
        <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
        <Field label="Payment date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {(invoice?.installments ?? []).length > 0 && (
          <Field label="Installment"><Select value={f.installmentId} onChange={(e) => setF({ ...f, installmentId: e.target.value })}><option value="">Auto (next due)</option>{(invoice.installments ?? []).map((s: any) => <option key={s.id} value={s.id}>#{s.sequence} — {formatBDT(s.amount)} ({s.status.toLowerCase()})</option>)}</Select></Field>
        )}
        <Field label="Reference (optional)"><Input value={f.referenceId} onChange={(e) => setF({ ...f, referenceId: e.target.value })} placeholder="Client ref / bank slip no" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record payment" />
      </form>
    </Modal>
  );
}

function InvoiceDrawer({ selectedId, refresh, notify, onClose, onEdit, bankAccounts }: { selectedId: string | null; refresh: () => void; notify: (m: string) => void; onClose: () => void; onEdit: (inv: any) => void; bankAccounts: any[] }) {
  const { branding } = useBranding();
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [instOpen, setInstOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch<any>(`/capital/invoices/${selectedId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [selectedId, refresh]);

  const total = (detail?.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const tax = detail?.taxApplicable ? (total * (Number(detail.taxRate) || 0)) / 100 : 0;
  const grand = total + tax;
  const paid = (detail?.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const balance = grand - paid;

  const setStatus = async (status: string) => {
    if (!detail) return;
    setStatusBusy(true);
    try {
      await apiFetch(`/capital/invoices/${detail.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify("Status updated");
      refresh();
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
      const pdfBranding = branding
        ? { primaryColor: branding.primaryColor ?? undefined, logoDarkUrl: branding.logoDarkUrl ?? undefined, appName: branding.appName ?? undefined }
        : undefined;
      const doc = pdfBranding?.logoDarkUrl ? await buildInvoicePdfAsync(detail, pdfBranding) : buildInvoicePdf(detail, pdfBranding);
      doc.save(`${detail.invoiceNumber}.pdf`);
    } catch {
      notify("PDF generation failed");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <Drawer
        open={!!selectedId}
        onClose={onClose}
        title={<div className="flex flex-wrap items-center gap-2"><p className="font-heading text-[15px] font-semibold">{detail?.invoiceNumber ?? "Invoice"}</p>{detail && <StatusBadge status={detail.status} />}</div>}
        footer={<div className="flex items-center gap-2">
          <Btn variant="outline" onClick={doPdf} className={pdfBusy ? "opacity-60" : ""}><FileDown className="size-3.5" /> {pdfBusy ? "Exporting…" : "Download PDF"}</Btn>
          <Btn variant="outline" onClick={() => detail && onEdit(detail)} className={!detail ? "pointer-events-none opacity-50" : ""}><Pencil className="size-3.5" /> Edit</Btn>
          <Btn variant="outline" onClick={() => detail && setInstOpen(true)} className={!detail ? "pointer-events-none opacity-50" : ""}><Wallet className="size-3.5" /> Installments</Btn>
          <Btn variant="outline" onClick={() => detail && setCnOpen(true)} className={!detail ? "pointer-events-none opacity-50" : ""}><HandCoins className="size-3.5" /> Credit / Refund</Btn>
          <Btn variant="primary" onClick={() => balance > 0 && setPayOpen(true)} className={balance <= 0 ? "opacity-50" : ""}><Plus className="size-3.5" /> Record Payment</Btn>
        </div>}
      >
        {loading ? (
          <div className="flex flex-col gap-3">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : !detail ? (
          <EmptyState title="Invoice not found" hint="It may have been deleted." />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Field label="Status"><Select value={detail.status} onChange={(e) => setStatus(e.target.value)} disabled={statusBusy} className="!w-44">{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
              <div className="ml-auto text-right">
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Amount</p>
                <p className="text-lg font-heading font-bold tabular-nums">{formatBDT(grand)}</p>
              </div>
            </div>

            <CardShell className="!p-4">
              <div className="flex items-center gap-3">
                <Avatar name={detail.client?.companyName ?? "?"} size="size-10" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{detail.client?.companyName}</p>
                  <p className="text-[11.5px] text-muted-foreground">{detail.project ? `Project: ${detail.project.name}` : "No project"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[11.5px]">
                <div><p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Issued</p><p className="font-medium">{formatDate(detail.issueDate)}</p></div>
                <div><p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Due</p><p className="font-medium">{formatDate(detail.dueDate)}</p></div>
              </div>
              {detail.client?.contacts?.length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-border/50 pt-3">
                  {detail.client.contacts.map((c: any) => (
                    <p key={c.id} className="text-[11.5px] text-muted-foreground">{c.name} {c.email && <span className="text-foreground/70">· {c.email}</span>} {c.phone && <span className="text-foreground/70">· {c.phone}</span>}</p>
                  ))}
                </div>
              )}
            </CardShell>

            <section>
              <SectionTitle title="Line items" subtitle={`${detail.lineItems?.length ?? 0} items`} />
              <div className="overflow-hidden rounded-xl border border-border/60">
                <table className="w-full">
                  <THead><Th>Description</Th><Th className="text-right">Qty</Th><Th className="text-right">Rate</Th><Th className="text-right">Amount</Th></THead>
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
              <SectionTitle title="Installments" subtitle={(detail.installments ?? []).length ? "payment plan" : "none"} />
              {(detail.installments ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No payment plan set. Record payments as they arrive.</p>}
              {(detail.installments ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {(detail.installments ?? []).map((s: any) => {
                    const done = s.status === "PAID";
                    return (
                      <div key={s.id} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2", done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60")}>
                        <div className="flex items-center gap-2.5">
                          <span className={cn("flex size-6 items-center justify-center rounded-full text-[10px] font-bold", done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>{s.sequence}</span>
                          <div>
                            <p className="text-[12px] font-medium">Due {formatDate(s.dueDate)}</p>
                            <p className="text-[10.5px] text-muted-foreground">{s.status} · {formatBDT(s.paidAmount)} paid</p>
                          </div>
                        </div>
                        <p className="text-[12.5px] font-bold tabular-nums">{formatBDT(s.amount)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <SectionTitle title="Payments" subtitle={`${detail.payments?.length ?? 0} received`} />
              <div className="flex flex-col gap-1.5">
                {(detail.payments ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No payments recorded yet.</p>}
                {(detail.payments ?? []).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div>
                      <p className="text-[12px] font-medium">{label(p.paymentMethod)}</p>
                      <p className="text-[10.5px] text-muted-foreground">{formatDate(p.paymentDate)} · {p.recordedBy?.name ?? "system"}{p.referenceId ? ` · ${p.referenceId}` : ""}{p.installment ? ` · #${p.installment.sequence}` : ""}</p>
                    </div>
                    <p className="text-[12.5px] font-bold tabular-nums text-emerald-500">{formatBDT(p.amount)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle title="Credit notes" subtitle={`${detail.creditNotes?.length ?? 0} issued`} />
              {(detail.creditNotes ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No credit notes issued for this invoice.</p>}
              <div className="flex flex-col gap-1.5">
                {(detail.creditNotes ?? []).map((cn: any) => (
                  <div key={cn.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
                    <div>
                      <p className="text-[12px] font-medium">{cn.referenceNumber} · {label(cn.type)}</p>
                      <p className="text-[10.5px] text-muted-foreground">{formatDate(cn.date)} · {cn.reason || "no reason"}{cn.createdBy?.name ? ` · ${cn.createdBy.name}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-bold", cn.status === "APPLIED" ? "bg-emerald-500/10 text-emerald-500" : cn.status === "VOID" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500")}>{cn.status}</span>
                      <p className={cn("text-[12.5px] font-bold tabular-nums", cn.type === "REFUND" ? "text-rose-500" : "text-amber-500")}>{formatBDT(cn.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <CardShell className="!p-4">
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium tabular-nums">{formatBDT(total)}</span></div>
                {tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({detail.taxRate}%)</span><span className="font-medium tabular-nums">{formatBDT(tax)}</span></div>}
                <div className="flex justify-between border-t border-border/60 pt-1.5"><span className="font-semibold">Total</span><span className="font-semibold tabular-nums">{formatBDT(grand)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-medium tabular-nums text-emerald-500">{formatBDT(paid)}</span></div>
                <div className="flex justify-between"><span className="font-semibold">Balance</span><span className={cn("font-bold tabular-nums", balance > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(balance)}</span></div>
              </div>
            </CardShell>

            {detail.notes && <p className="text-[11.5px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Notes:</span> {detail.notes}</p>}
          </div>
        )}
      </Drawer>
      <PaymentModal invoice={detail} open={payOpen} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); refresh(); notify("Payment recorded"); }} />
      <CreditNoteModal invoice={detail} open={cnOpen} onClose={() => setCnOpen(false)} onSaved={() => { setCnOpen(false); refresh(); notify("Credit note created"); }} />
      <InstallmentModal invoice={detail} open={instOpen} onClose={() => setInstOpen(false)} onSaved={() => { setInstOpen(false); refresh(); notify("Installment plan set"); }} />
    </>
  );
}

function ExpenseModal({ open, onClose, onSaved, bankAccounts, categories, vendors }: { open: boolean; onClose: () => void; onSaved: () => void; bankAccounts: any[]; categories: any[]; vendors: any[] }) {
  const [f, setF] = useState({ description: "", amount: "", category: "AD_SPEND", subcategory: "", date: today(), method: "CASH", billable: false, bankAccountId: "", receiptUrl: "", vendorId: "", isPayable: false, dueDate: "", currency: "BDT", exchangeRate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cats = categories ?? [];
  const currentCat = cats.find((c: any) => c.key === f.category);
  const subs: string[] = currentCat?.subcategories ?? [];

  useEffect(() => {
    if (open) setF({ description: "", amount: "", category: cats[0]?.key ?? "AD_SPEND", subcategory: "", date: today(), method: "CASH", billable: false, bankAccountId: bankAccounts[0]?.id ?? "", receiptUrl: "", vendorId: "", isPayable: false, dueDate: "", currency: "BDT", exchangeRate: "" });
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    if (f.isPayable && !f.vendorId) return setErr("Select a vendor for payable expenses");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/expenses", {
        method: "POST",
        body: JSON.stringify({ description: f.description.trim(), amount: Number(f.amount), category: f.category, subcategory: f.subcategory || undefined, date: f.date || undefined, paymentMethod: f.method, isClientBillable: f.billable, bankAccountId: f.bankAccountId || undefined, receiptUrl: f.receiptUrl.trim() || undefined, vendorId: f.vendorId || undefined, isPayable: f.isPayable, dueDate: f.dueDate || undefined, currency: f.currency, exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined }),
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
    <Modal open={open} onClose={onClose} title="Record expense">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Google Ads — June campaign" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="12000" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, subcategory: "" })}>{(cats.length ? cats : [{ key: "MISC", name: "MISC" }]).map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
          <Field label="Subcategory"><Select value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })}><option value="">—</option>{subs.map((s: string) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Payment method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
          <Field label="Vendor"><Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}><option value="">No vendor</option>{(vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
          {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
          <Field label="Receipt URL"><Input value={f.receiptUrl} onChange={(e) => setF({ ...f, receiptUrl: e.target.value })} placeholder="https://…" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
            <input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} className="size-4 rounded accent-primary" />
            Client billable (pass-through)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
            <input type="checkbox" checked={f.isPayable} onChange={(e) => setF({ ...f, isPayable: e.target.checked })} className="size-4 rounded accent-amber-500" />
            Unpaid (accounts payable)
          </label>
        </div>
        {f.isPayable && <Field label="Payable due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record expense" />
      </form>
    </Modal>
  );
}

function VendorModal({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
  const [f, setF] = useState({ name: "", contactInfo: "", email: "", phone: "", paymentTerms: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ name: editing?.name ?? "", contactInfo: editing?.contactInfo ?? "", email: editing?.email ?? "", phone: editing?.phone ?? "", paymentTerms: editing?.paymentTerms ?? "" });
  }, [open, editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Vendor name is required");
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ name: f.name.trim(), contactInfo: f.contactInfo.trim() || undefined, email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, paymentTerms: f.paymentTerms.trim() || undefined });
      if (editing) await apiFetch(`/capital/vendors/${editing.id}`, { method: "PATCH", body });
      else await apiFetch("/capital/vendors", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit vendor" : "Add vendor"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Vendor name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Freelance designer" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="vendor@company.com" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+880 1X-XXXXXXX" /></Field>
        </div>
        <Field label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => setF({ ...f, paymentTerms: e.target.value })} placeholder="Net 30" /></Field>
        <Field label="Contact info"><Input value={f.contactInfo} onChange={(e) => setF({ ...f, contactInfo: e.target.value })} placeholder="Address, bank details, notes…" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add vendor"} />
      </form>
    </Modal>
  );
}

function ConfirmModal({ open, onClose, title, message, busy, onConfirm }: { open: boolean; onClose: () => void; title: string; message: string; busy: boolean; onConfirm: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(); }} className="flex flex-col gap-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{message}</p>
        <FormActions busy={busy} cancel={onClose} submitLabel="Delete" danger />
      </form>
    </Modal>
  );
}

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <EmptyState title={message} hint="Could not load data" />
      <Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn>
    </div>
  );
}

function OverviewTab({ overview, invoices, expenses }: { overview: any; invoices: any[] | null; expenses: any[] | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Invoiced" value={formatBDT(overview?.totalInvoiced)} sub="incl. pass-through" delta="+9.8%" icon={<Wallet className="size-5" />} />
        <StatCard label="Recognized Revenue" value={formatBDT(overview?.recognizedRevenue)} sub="agency revenue only" delta="+7.2%" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Collected" value={formatBDT(overview?.collected)} sub={`${overview?.billableShare ?? 0}% billable`} delta="+11%" icon={<HandCoins className="size-5" />} />
        <StatCard label="Outstanding" value={formatBDT(overview?.outstanding)} sub={`${formatBDT(overview?.overdueAmount)} overdue`} delta={`-${formatBDT(overview?.overdueAmount ?? 0)}`} deltaGood={false} icon={<Banknote className="size-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <SectionTitle title="Revenue Trend" subtitle="Invoiced vs collected vs expenses" />
          <RevenueAreaChart data={(overview?.trend ?? []).map((t: any) => ({ ...t, month: String(t.month).slice(0, 3) }))} />
        </CardShell>
        <CardShell>
          <SectionTitle title="Payment Split" subtitle="collected by method" />
          <PaymentDonut data={overview?.paymentSplit ?? []} />
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {!invoices ? (
            <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
          ) : (
            <FadeIn>
              <TableShell footer={<><span className="text-[11.5px] text-muted-foreground">{(invoices ?? []).length} invoices · cash position {formatBDT(overview?.cashPosition)}</span><Btn variant="ghost" onClick={() => exportInvoicesCsv(invoices ?? [])}>Export CSV</Btn></>}>
                <table className="w-full">
                  <THead><Th>Invoice</Th><Th>Client</Th><Th>Type</Th><Th>Amount</Th><Th>Status</Th><Th>Due</Th></THead>
                  <tbody>
                    {(invoices ?? []).slice(0, 8).map((inv, i) => (
                      <Tr key={inv.id} index={i}>
                        <Td>
                          <p className="font-medium tabular-nums">{inv.invoiceNumber}</p>
                          <p className="text-[11px] text-muted-foreground">{label(inv.invoiceType)}</p>
                        </Td>
                        <Td className="text-muted-foreground">{inv.client.companyName}</Td>
                        <Td className="text-muted-foreground">{inv.project?.name ?? "—"}</Td>
                        <Td className="font-semibold tabular-nums">{formatBDT(inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0))}</Td>
                        <Td><StatusBadge status={inv.status} /></Td>
                        <Td className="text-muted-foreground">{formatDay(inv.dueDate)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          )}
        </div>

        <FadeIn delay={0.1}>
          <CardShell className="h-full">
            <h3 className="mb-4 text-[15px] font-heading font-semibold">Recent Expenses</h3>
            <div className="flex flex-col gap-3">
              {(expenses ?? []).slice(0, 7).map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">{e.description}</p>
                    <p className="text-[10.5px] text-muted-foreground">{label(e.category)} · {e.isClientBillable ? "billable" : "absorbed"} · {formatDay(e.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12.5px] font-bold tabular-nums">{formatBDT(e.amount)}</p>
                    <StatusBadge status={e.approvalStatus} />
                  </div>
                </div>
              ))}
              {!expenses?.length && <p className="text-[12px] text-muted-foreground">No expenses</p>}
            </div>
          </CardShell>
        </FadeIn>
      </div>
    </div>
  );
}

function InvoicesTab({ invoices, error, refresh, clients, onView, onNew, onDuplicate, onDelete }: { invoices: any[] | null; error: string | null; refresh: () => void; clients: any[]; onView: (id: string) => void; onNew: () => void; onDuplicate: (id: string) => void; onDelete: (inv: any) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");

  const list = useMemo(() => {
    const items = invoices ?? [];
    const ql = q.trim().toLowerCase();
    return items.filter((inv) => {
      if (ql && !inv.invoiceNumber.toLowerCase().includes(ql) && !inv.client.companyName.toLowerCase().includes(ql)) return false;
      if (status && inv.status !== status) return false;
      if (clientId && inv.client.id !== clientId) return false;
      return true;
    });
  }, [invoices, q, status, clientId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-40"><option value="">All statuses</option>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="!w-44"><option value="">All clients</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select>
        <div className="ml-auto"><Btn variant="primary" onClick={onNew}><Plus className="size-3.5" /> New Invoice</Btn></div>
      </div>

      {!invoices && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} invoices</span>}>
            <table className="w-full">
              <THead><Th>Invoice #</Th><Th>Client</Th><Th>Issue / Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th /></THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No invoices match" hint="Adjust filters or create a new invoice." /></td></tr>
                )}
                {list.map((inv, i) => {
                  const amount = inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
                  const paidAmt = inv.payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
                  return (
                    <Tr key={inv.id} index={i} onClick={() => onView(inv.id)} className="cursor-pointer">
                      <Td>
                        <p className="font-medium tabular-nums">{inv.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground">{label(inv.invoiceType ?? "INVOICE")}</p>
                      </Td>
                      <Td className="text-muted-foreground">{inv.client.companyName}</Td>
                      <Td>
                        <p className="text-[11.5px]">{formatDate(inv.issueDate)}</p>
                        <p className="text-[11px] text-muted-foreground">due {formatDate(inv.dueDate)}</p>
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBDT(amount)}</Td>
                      <Td className="text-right tabular-nums text-emerald-500">{formatBDT(paidAmt)}</Td>
                      <Td className={cn("text-right font-medium tabular-nums", amount - paidAmt > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(amount - paidAmt)}</Td>
                      <Td><StatusBadge status={inv.status} /></Td>
                      <Td>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => onView(inv.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="View"><Eye className="size-3.5" /></button>
                          <button onClick={() => onDuplicate(inv.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Duplicate"><Copy className="size-3.5" /></button>
                          <button onClick={() => onDelete(inv)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete"><Trash2 className="size-3.5" /></button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
    </div>
  );
}

function PayExpenseModal({ expense, open, bankAccounts, onClose, onSaved }: { expense: any; open: boolean; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
  const due = Math.max(0, Number(expense?.amount ?? 0) - Number(expense?.paidAmount ?? 0));
  const [f, setF] = useState({ amount: String(due), method: "CASH", date: today(), bankAccountId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ amount: String(due), method: "CASH", date: today(), bankAccountId: bankAccounts[0]?.id ?? "" });
  }, [open, expense]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) return setErr("Amount is required");
    if (Number(f.amount) > due) return setErr(`Cannot exceed outstanding ${formatBDT(due)}`);
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/expenses/${expense.id}/payment`, { method: "POST", body: JSON.stringify({ amount: Number(f.amount), paymentMethod: f.method, paymentDate: f.date || undefined, bankAccountId: f.bankAccountId || undefined }) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Pay expense — ${expense?.description ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-[11.5px]">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(due)}</span>
        </div>
        <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
        </div>
        <Field label="Payment date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record payment" />
      </form>
    </Modal>
  );
}

function CategoriesModal({ open, categories, accounts, onClose, onSaved }: { open: boolean; categories: any[]; accounts: any[]; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState<any | null>(null);
  const [f, setF] = useState({ key: "", name: "", subcategories: "", accountId: "", isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEditing(null);
      setF({ key: "", name: "", subcategories: "", accountId: "", isActive: true });
    }
  }, [open]);

  const startEdit = (c: any) => {
    setEditing(c);
    setF({ key: c.key, name: c.name, subcategories: (c.subcategories ?? []).join(", "), accountId: c.accountId ?? "", isActive: c.isActive });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || (!editing && !f.key.trim())) return setErr("Name and key are required");
    setBusy(true);
    setErr(null);
    try {
      const subs = f.subcategories.split(",").map((s) => s.trim()).filter(Boolean);
      const body = JSON.stringify({ key: f.key.trim().toUpperCase().replace(/\s+/g, "_"), name: f.name.trim(), subcategories: subs, accountId: f.accountId || undefined, isActive: f.isActive });
      if (editing) await apiFetch(`/capital/expense-categories/${editing.id}`, { method: "PATCH", body });
      else await apiFetch("/capital/expense-categories", { method: "POST", body });
      onSaved();
      setEditing(null);
      setF({ key: "", name: "", subcategories: "", accountId: "", isActive: true });
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Expense categories" size="lg">
      <div className="flex flex-col gap-4">
        <form onSubmit={save} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">{editing ? `Edit ${editing.name}` : "New category"}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Insurance" /></Field>
            <Field label="Key (slug, e.g. INSURANCE)"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} disabled={!!editing} placeholder="INSURANCE" /></Field>
          </div>
          <Field label="Subcategories (comma-separated)"><Input value={f.subcategories} onChange={(e) => setF({ ...f, subcategories: e.target.value })} placeholder="Fire, Health, Vehicle" /></Field>
          <div className="flex items-center gap-3">
            <Field label="GL account"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">No account</option>{(accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}</Select></Field>
            {editing && (
              <label className="flex cursor-pointer items-center gap-2 pt-4 text-[12.5px] font-medium">
                <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 rounded accent-primary" />
                Active
              </label>
            )}
          </div>
          {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
          <div className="flex items-center gap-2">
            <Btn variant="primary" type="submit" className={busy ? "opacity-60" : ""}>{busy ? "Saving…" : editing ? "Save changes" : "Add category"}</Btn>
            {editing && <Btn variant="ghost" onClick={() => { setEditing(null); setF({ key: "", name: "", subcategories: "", accountId: "", isActive: true }); }}>Cancel edit</Btn>}
          </div>
        </form>

        <TableShell>
          <table className="w-full">
            <THead><Th>Name</Th><Th>Key</Th><Th>Subcategories</Th><Th>GL account</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {categories.length === 0 && <tr><td colSpan={6} className="px-5 py-8"><EmptyState title="No categories" /></td></tr>}
              {categories.map((c, i) => (
                <Tr key={c.id} index={i}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="font-mono text-[11px] text-muted-foreground">{c.key}</Td>
                  <Td className="text-[11.5px] text-muted-foreground">{(c.subcategories ?? []).slice(0, 3).join(", ")}{(c.subcategories ?? []).length > 3 ? ` +${c.subcategories.length - 3}` : ""}</Td>
                  <Td className="text-[11.5px]">{c.account ? `${c.account.code} — ${c.account.name}` : "—"}</Td>
                  <Td><StatusBadge status={c.isActive ? "Active" : "Inactive"} /></Td>
                  <Td><button onClick={() => startEdit(c)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>
    </Modal>
  );
}

function ExpensesTab({ expenses, error, refresh, notify, onRecord, onVendor, onDelete, categories, bankAccounts, accounts }: { expenses: any[] | null; error: string | null; refresh: () => void; notify: (m: string) => void; onRecord: () => void; onVendor: () => void; onDelete: (e: any) => void; categories: any[]; bankAccounts: any[]; accounts: any[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payExpense, setPayExpense] = useState<any | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);

  const catOptions = categories ?? [];
  const list = useMemo(() => {
    const items = expenses ?? [];
    const ql = q.trim().toLowerCase();
    return items.filter((e) => {
      if (ql && !e.description.toLowerCase().includes(ql) && !(e.vendor?.name ?? "").toLowerCase().includes(ql)) return false;
      if (cat && e.category !== cat) return false;
      if (status && e.approvalStatus !== status) return false;
      return true;
    });
  }, [expenses, q, cat, status]);

  const setApproval = async (e: any, s: string) => {
    setBusyId(e.id);
    try {
      await apiFetch(`/capital/expenses/${e.id}`, { method: "PATCH", body: JSON.stringify({ approvalStatus: s }) });
      notify(`Expense ${label(s)}`);
      refresh();
    } catch (err2: any) {
      notify(err2.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const openPay = (e: any) => { setPayExpense(e); setPayOpen(true); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expenses…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-44"><option value="">All categories</option>{catOptions.map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-36"><option value="">All statuses</option>{EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="outline" onClick={onVendor}><UserPlus className="size-3.5" /> Add Vendor</Btn>
          <Btn variant="outline" onClick={() => setCatsOpen(true)}><Pencil className="size-3.5" /> Categories</Btn>
          <Btn variant="primary" onClick={onRecord}><Plus className="size-3.5" /> Record Expense</Btn>
        </div>
      </div>

      {!expenses && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} expenses · pending approvals {list.filter((e) => e.approvalStatus === "PENDING").length} · payable {list.filter((e) => e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount)).length}</span>}>
            <table className="w-full">
              <THead><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Date</Th><Th>Method</Th><Th>Status</Th><Th>By</Th><Th /></THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No expenses match" hint="Adjust filters or record a new expense." /></td></tr>
                )}
                {list.map((e, i) => {
                  const catName = catOptions.find((c: any) => c.key === e.category)?.name ?? label(e.category);
                  const owing = e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount);
                  return (
                    <Tr key={e.id} index={i}>
                      <Td>
                        <p className="font-medium">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">{e.vendor?.name ?? "no vendor"} {e.subcategory ? `· ${e.subcategory}` : ""} {e.isClientBillable && "· billable"} {e.client && `· ${e.client.companyName}`}</p>
                      </Td>
                      <Td><span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold", CAT_TONES[e.category] ?? CAT_TONES.MISC)}>{catName}</span>{owing && <span className="ml-1.5 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500 ring-1 ring-amber-500/20">PAYABLE</span>}</Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBDT(e.amount)}{e.currency && e.currency !== "BDT" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{e.currency}</span>}</Td>
                      <Td className="text-muted-foreground">{formatDate(e.date)}</Td>
                      <Td className="text-muted-foreground">{label(e.paymentMethod ?? "N/A")}</Td>
                      <Td><StatusBadge status={e.approvalStatus} /></Td>
                      <Td>
                        <p className="text-[11.5px]">{e.submittedBy?.name ?? "—"}</p>
                        <p className="text-[10.5px] text-muted-foreground">{e.approvalStatus === "APPROVED" ? `approved by ${e.approvedBy?.name ?? "—"}` : e.approvalStatus === "REJECTED" ? "rejected" : "awaiting review"}</p>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-0.5">
                          {owing && <button onClick={() => openPay(e)} className="rounded-lg p-1.5 text-amber-500 transition-colors hover:bg-amber-500/10" title="Pay expense"><HandCoins className="size-3.5" /></button>}
                          {e.approvalStatus === "PENDING" && (
                            <>
                              <button onClick={() => setApproval(e, "APPROVED")} disabled={busyId === e.id} className="rounded-lg p-1.5 text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-50" title="Approve"><Check className="size-3.5" /></button>
                              <button onClick={() => setApproval(e, "REJECTED")} disabled={busyId === e.id} className="rounded-lg p-1.5 text-rose-500 transition-colors hover:bg-rose-500/10 disabled:opacity-50" title="Reject"><X className="size-3.5" /></button>
                            </>
                          )}
                          <button onClick={() => onDelete(e)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete"><Trash2 className="size-3.5" /></button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <PayExpenseModal expense={payExpense} open={payOpen} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); notify("Payment recorded"); refresh(); }} />
      <CategoriesModal open={catsOpen} categories={categories} accounts={accounts} onClose={() => setCatsOpen(false)} onSaved={() => { notify("Category saved"); refresh(); }} />
    </div>
  );
}

function AddIncomeModal({ open, bankAccounts, onClose, onSaved }: { open: boolean; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ description: "", amount: "", category: "OTHER_INCOME", date: today(), method: "CASH", bankAccountId: "", referenceId: "", currency: "BDT", exchangeRate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ description: "", amount: "", category: "OTHER_INCOME", date: today(), method: "CASH", bankAccountId: bankAccounts[0]?.id ?? "", referenceId: "", currency: "BDT", exchangeRate: "" });
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/income", {
        method: "POST",
        body: JSON.stringify({ description: f.description.trim(), amount: Number(f.amount), category: f.category, paymentDate: f.date || undefined, paymentMethod: f.method, bankAccountId: f.bankAccountId || undefined, referenceId: f.referenceId.trim() || undefined, currency: f.currency, exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined }),
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
    <Modal open={open} onClose={onClose} title="Record income (manual)">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Bank interest, forex gain, workshop fee…" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="5000" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["OTHER_INCOME", "COMMISSION", "REFERRAL", "SALE", "INTEREST"].map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
          {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
          <Field label="Reference"><Input value={f.referenceId} onChange={(e) => setF({ ...f, referenceId: e.target.value })} placeholder="Transaction ref" /></Field>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record income" />
      </form>
    </Modal>
  );
}

function IncomeTab({ income, error, refresh, stats, bankAccounts }: { income: any[] | null; error: string | null; refresh: () => void; stats: any; bankAccounts: any[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const byMethod = stats?.byMethod ?? [];
  const byMethodTotal = byMethod.reduce((s: number, m: any) => s + Number(m.amount ?? 0), 0);
  const bySource = stats?.bySource ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Income" value={formatBDT(stats?.total)} sub="all-time collections" icon={<HandCoins className="size-5" />} />
          <StatCard label="Payments" value={stats?.count ?? "—"} sub="transactions recorded" icon={<ReceiptText className="size-5" />} />
          <StatCard label="Avg Payment" value={formatBDT(stats?.avgAmount)} sub="per transaction" icon={<Banknote className="size-5" />} />
          <StatCard label="Top Method" value={byMethod.length ? label(byMethod[0].method) : "—"} sub={`${byMethod.length ? formatBDT(byMethod[0].amount) : "৳0"} · ${byMethodTotal ? Math.round((byMethod[0].amount / byMethodTotal) * 100) : 0}% of collections`} icon={<Landmark className="size-5" />} />
        </div>
        <Btn variant="primary" onClick={() => setAddOpen(true)}><Plus className="size-3.5" /> Record Income</Btn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {byMethod.length > 1 && (
          <CardShell>
            <SectionTitle title="By Method" subtitle="collected income by payment channel" />
            <PaymentDonut data={byMethod} />
          </CardShell>
        )}
        {bySource.length > 0 && (
          <CardShell>
            <SectionTitle title="By Source" subtitle="invoice payments vs manual income" />
            <div className="flex flex-col gap-3">
              {bySource.map((s: any) => (
                <div key={s.source} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 text-[12px] capitalize text-muted-foreground">{label(s.source)}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(s.amount ?? 0) / Math.max(bySource.reduce((a: number, b: any) => a + Number(b.amount ?? 0), 0), 1)) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[12px] font-bold tabular-nums">{formatBDT(s.amount)}</span>
                </div>
              ))}
            </div>
          </CardShell>
        )}
      </div>

      {!income && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{income?.length ?? 0} income entries</span>}>
            <table className="w-full">
              <THead><Th>Date</Th><Th>Client</Th><Th>Project</Th><Th>Invoice</Th><Th>Method</Th><Th>Source</Th><Th className="text-right">Amount</Th><Th>Recorded by</Th></THead>
              <tbody>
                {income?.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No income recorded" hint="Collections will appear here as invoices are paid." /></td></tr>
                )}
                {(income ?? []).map((it, i) => {
                  const isManual = it.source === "MANUAL" || it.source === "manual";
                  return (
                    <Tr key={it.id} index={i}>
                      <Td className="text-muted-foreground">{formatDate(it.date ?? it.paymentDate)}</Td>
                      <Td className="font-medium">{it.client ?? it.invoice?.client?.companyName ?? "—"}</Td>
                      <Td className="text-muted-foreground">{it.project ?? it.invoice?.project?.name ?? "—"}</Td>
                      <Td className="tabular-nums text-muted-foreground">{it.invoice?.invoiceNumber ?? (isManual ? "—" : it.description ?? "—")}</Td>
                      <Td className="text-muted-foreground">{label(it.method ?? it.paymentMethod)}</Td>
                      <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", isManual ? "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20" : "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20")}>{isManual ? "MANUAL" : "INVOICE"}</span></Td>
                      <Td className="text-right font-semibold tabular-nums text-emerald-500">{formatBDT(it.amount)}{it.currency && it.currency !== "BDT" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{it.currency}</span>}</Td>
                      <Td className="text-muted-foreground">{it.recordedBy?.name ?? it.recordedBy ?? "system"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <AddIncomeModal open={addOpen} bankAccounts={bankAccounts} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); refresh(); }} />
    </div>
  );
}

function BudgetModal({ open, onClose, onSaved, editing, projects, categories }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null; projects: any[]; categories: any[] }) {
  const [f, setF] = useState({ scopeType: "PROJECT", projectId: "", category: "", budgetAmount: "", currency: "BDT", periodStart: "", periodEnd: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({
      scopeType: editing?.scopeType ?? "PROJECT",
      projectId: editing?.projectId ?? "",
      category: editing?.category ?? "",
      budgetAmount: String(editing?.budgetAmount ?? ""),
      currency: editing?.currency ?? "BDT",
      periodStart: editing?.periodStart ? String(editing.periodStart).slice(0, 10) : "",
      periodEnd: editing?.periodEnd ? String(editing.periodEnd).slice(0, 10) : "",
    });
  }, [open, editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.budgetAmount || Number(f.budgetAmount) <= 0) return setErr("Budget amount is required");
    if (f.scopeType === "PROJECT" && !f.projectId) return setErr("Select a project");
    if (f.scopeType === "DEPARTMENT" && !f.category) return setErr("Select a category");
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ scopeType: f.scopeType, projectId: f.scopeType === "PROJECT" ? f.projectId : undefined, category: f.scopeType === "DEPARTMENT" ? f.category : undefined, budgetAmount: Number(f.budgetAmount), currency: f.currency, periodStart: f.periodStart || undefined, periodEnd: f.periodEnd || undefined });
      if (editing) await apiFetch(`/capital/budgets/${editing.id}`, { method: "PATCH", body });
      else await apiFetch("/capital/budgets", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit budget" : "New budget"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Scope"><Select value={f.scopeType} onChange={(e) => setF({ ...f, scopeType: e.target.value })}><option value="PROJECT">Project</option><option value="DEPARTMENT">Category (department)</option></Select></Field>
        {f.scopeType === "PROJECT" ? (
          <Field label="Project *"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Select project…</option>{(projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        ) : (
          <Field label="Category *"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Select category…</option>{(categories ?? []).map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Budget amount *"><Input type="number" min={0} value={f.budgetAmount} onChange={(e) => setF({ ...f, budgetAmount: e.target.value })} placeholder="500000" /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></Select></Field>
          <Field label="Period start"><Input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
          <Field label="Period end"><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
        </div>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create budget"} />
      </form>
    </Modal>
  );
}

function ReconcileModal({ open, bankAccounts, txns, onClose, onSaved }: { open: boolean; bankAccounts: any[]; txns: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ bankAccountId: "", statementDate: today(), statementAmount: "", statementReference: "", matchedPaymentId: "", matchStatus: "UNMATCHED" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ bankAccountId: bankAccounts[0]?.id ?? "", statementDate: today(), statementAmount: "", statementReference: "", matchedPaymentId: "", matchStatus: "UNMATCHED" });
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.bankAccountId || !f.statementAmount) return setErr("Account and statement amount are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/reconciliation", {
        method: "POST",
        body: JSON.stringify({ bankAccountId: f.bankAccountId, statementDate: f.statementDate || undefined, statementAmount: Number(f.statementAmount), statementReference: f.statementReference.trim() || undefined, matchedPaymentId: f.matchedPaymentId || undefined, matchStatus: f.matchedPaymentId ? "MATCHED" : f.matchStatus }),
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
    <Modal open={open} onClose={onClose} title="Add statement entry">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Bank account *"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Statement date"><Input type="date" value={f.statementDate} onChange={(e) => setF({ ...f, statementDate: e.target.value })} /></Field>
          <Field label="Statement amount *"><Input type="number" step="0.01" value={f.statementAmount} onChange={(e) => setF({ ...f, statementAmount: e.target.value })} placeholder="0.00" /></Field>
        </div>
        <Field label="Match with ledger transaction"><Select value={f.matchedPaymentId} onChange={(e) => setF({ ...f, matchedPaymentId: e.target.value })}><option value="">No match</option>{(txns ?? []).map((t: any) => <option key={t.id} value={t.id}>{formatDate(t.date)} · {t.ref} · {formatBDT(t.amount)}</option>)}</Select></Field>
        <Field label="Statement reference"><Input value={f.statementReference} onChange={(e) => setF({ ...f, statementReference: e.target.value })} placeholder="Bank statement line ref" /></Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save entry" />
      </form>
    </Modal>
  );
}

function ReportsTab({ reports, aging, forecast, statements, apAging, budgets, projects, bankAccounts, categories, onRunRecurring, running }: { reports: any; aging: any; forecast: any; statements: any; apAging: any; budgets: any[]; projects: any[]; bankAccounts: any[]; categories: any[]; onRunRecurring: () => void; running: boolean }) {
  const km = reports?.keyMetrics ?? {};
  const byCategory = reports?.byCategory ?? [];
  const byMethod = reports?.byMethod ?? [];
  const cashFlow = reports?.cashFlow ?? [];
  const budget = reports?.budgetOverview ?? [];
  const tax = reports?.taxReport ?? {};
  const maxCat = Math.max(...byCategory.map((c: any) => Number(c.amount ?? 0)), 1);
  const maxFlow = Math.max(...cashFlow.map((w: any) => Math.max(Number(w.income ?? 0), Number(w.outflow ?? 0))), 1);
  const agingBuckets = aging?.buckets ?? {};
  const agingClients = aging?.byClient ?? [];
  const maxAging = Math.max(...agingClients.map((c: any) => Number(c.total ?? 0)), 1);
  const forecastBuckets = forecast?.buckets ?? [];
  const maxForecast = Math.max(...forecastBuckets.map((b: any) => Math.max(Number(b.inflow ?? 0), Number(b.outflow ?? 0))), 1);
  const AGING_KEYS = [
    { key: "CURRENT", label: "Current" },
    { key: "1-30", label: "1–30d" },
    { key: "31-60", label: "31–60d" },
    { key: "61-90", label: "61–90d" },
    { key: "90+", label: "90d+" },
  ];
  const clientCell = (c: any, key: string) => (c[key] ? formatBDT(c[key]) : "—");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<any | null>(null);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [reconAccount, setReconAccount] = useState(bankAccounts[0]?.id ?? "");
  const [reconData, setReconData] = useState<any | null>(null);
  const [reconErr, setReconErr] = useState<string | null>(null);
  const [reconOpen, setReconOpen] = useState(false);
  const [reconBusy, setReconBusy] = useState(false);

  useEffect(() => {
    if (!reconAccount) return;
    let cancelled = false;
    apiFetch<any>(`/capital/reconciliation?bankAccountId=${reconAccount}`)
      .then((d) => !cancelled && setReconData(d))
      .catch((e) => !cancelled && setReconErr(e.message));
    return () => { cancelled = true; };
  }, [reconAccount, budgets, apAging]);

  const deleteBudget = async (id: string) => {
    setBudgetBusy(true);
    try {
      await apiFetch(`/capital/budgets/${id}`, { method: "DELETE" });
      setBudgetOpen(false);
      setBudgetEdit(null);
    } catch (e: any) {
      setReconErr(e.message ?? "Delete failed");
    } finally {
      setBudgetBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Avg Invoice Value" value={formatBDT(km.avgInvoiceValue)} sub="per invoice" icon={<ReceiptText className="size-5" />} />
        <StatCard label="Profit Margin" value={km.profitMargin != null ? `${Math.round(km.profitMargin)}%` : "—"} sub="recognized revenue basis" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Collection Rate" value={km.collectionRate != null ? `${Math.round(km.collectionRate)}%` : "—"} sub="collected vs invoiced" icon={<HandCoins className="size-5" />} />
        <StatCard label="Tax Year" value={tax.fiscalYear ?? "—"} sub={`rate ${tax.taxRate ?? 22}%`} icon={<Landmark className="size-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <SectionTitle title="8-Month Trend" subtitle="invoiced vs collected vs expenses" />
          <RevenueAreaChart data={(reports?.trend8 ?? []).map((t: any) => ({ ...t, month: String(t.month).slice(0, 3) }))} />
        </CardShell>
        <CardShell>
          <SectionTitle title="By Method" subtitle="collections split" />
          <PaymentDonut data={byMethod} />
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell>
          <SectionTitle title="By Category" subtitle="expenses grouped" />
          <div className="flex flex-col gap-3">
            {byCategory.length === 0 && <p className="text-[12px] text-muted-foreground">No expense data</p>}
            {byCategory.map((c: any) => (
              <div key={c.name} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 truncate text-[12px] capitalize text-muted-foreground">{label(c.name)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(c.amount ?? 0) / maxCat) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-[12px] font-bold tabular-nums">{formatBDT(c.amount)}</span>
              </div>
            ))}
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Weekly Cash Flow" subtitle="income vs outflow" />
          <div className="flex flex-col gap-2.5">
            {cashFlow.length === 0 && <p className="text-[12px] text-muted-foreground">No cash flow data</p>}
            {cashFlow.map((w: any) => (
              <div key={w.week} className="grid grid-cols-[64px_1fr_1fr] items-center gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{w.week}</span>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 rounded-full bg-emerald-500/80" style={{ width: `${(Number(w.income ?? 0) / maxFlow) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-emerald-500">{formatBDT(w.income)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 rounded-full bg-rose-500/80" style={{ width: `${(Number(w.outflow ?? 0) / maxFlow) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-rose-500">{formatBDT(w.outflow)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Budget Overview" subtitle="planned vs actual" />
          <TableShell>
            <table className="w-full">
              <THead><Th>Bucket</Th><Th className="text-right">Planned</Th><Th className="text-right">Actual</Th><Th className="text-right">Var.</Th></THead>
              <tbody>
                {budget.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No budget data" /></td></tr>
                )}
                {budget.map((b: any, i: number) => {
                  const diff = Number(b.actual ?? 0) - Number(b.planned ?? 0);
                  return (
                    <Tr key={b.name} index={i}>
                      <Td className="text-[12px] font-medium">{label(b.name)}</Td>
                      <Td className="text-right text-[12px] tabular-nums text-muted-foreground">{formatBDT(b.planned)}</Td>
                      <Td className="text-right text-[12px] tabular-nums">{formatBDT(b.actual)}</Td>
                      <Td className={cn("text-right text-[12px] font-semibold tabular-nums", diff > 0 ? "text-rose-500" : "text-emerald-500")}>{diff > 0 ? "+" : ""}{formatBDT(diff)}</Td>
                    </Tr>
                  );
                })}
            </tbody>
          </table>
          </TableShell>
        </CardShell>
      </div>

      <CardShell>
        <SectionTitle title="Tax Report" subtitle={`estimated tax at ${tax.taxRate ?? 22}% · fiscal year ${tax.fiscalYear ?? "—"}`} />
        <TableShell>
          <table className="w-full">
            <THead><Th>Period</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Collected</Th><Th className="text-right">Expenses</Th><Th className="text-right">Net</Th><Th className="text-right">Est. Tax</Th></THead>
            <tbody>
              {(tax.rows ?? []).map((r: any, i: number) => (
                <Tr key={r.label} index={i}>
                  <Td className="font-medium">{r.label}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.invoiced)}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.collected)}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.expenses)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatBDT(r.net)}</Td>
                  <Td className="text-right tabular-nums text-amber-500">{formatBDT(r.estimatedTax)}</Td>
                </Tr>
              ))}
              {tax.totals && (
                <tr className="border-t border-border/60 bg-muted/40">
                  <Td className="font-bold">Totals</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.invoiced)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.collected)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.expenses)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.net)}</Td>
                  <Td className="text-right font-bold tabular-nums text-amber-500">{formatBDT(tax.totals.estimatedTax)}</Td>
                </tr>
              )}
            </tbody>
          </table>
        </TableShell>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="Accounts Receivable Aging" subtitle={`${formatBDT(aging?.totalOutstanding ?? 0)} outstanding as of today`} />
        <Btn variant="outline" onClick={onRunRecurring} className={running ? "opacity-60" : ""}><RefreshCw className="size-3.5" /> {running ? "Running…" : "Run recurring billing"}</Btn>
      </div>
      <CardShell>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-[15px] font-heading font-bold tabular-nums", b.key === "90+" && Number(agingBuckets[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(agingBuckets[b.key] ?? 0)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <TableShell>
            <table className="w-full">
            <THead><Th>Client</Th><Th className="text-right">Total</Th><Th className="text-right">Current</Th><Th className="text-right">1–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90d+</Th><Th className="w-40">Concentration</Th></THead>
            <tbody>
              {agingClients.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-8"><EmptyState title="No outstanding invoices" hint="Everything is collected." /></td></tr>
              )}
              {agingClients.map((c: any, i: number) => (
                <Tr key={c.clientId} index={i}>
                  <Td className="font-medium">{c.clientName}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatBDT(c.total)}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "current")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d30")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d60")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d90")}</Td>
                  <Td className="text-right tabular-nums text-rose-500">{clientCell(c, "d90p")}</Td>
                  <Td>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(c.total ?? 0) / maxAging) * 100}%` }} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title="90-Day Cash Flow Forecast" subtitle={`cash position ${formatBDT(forecast?.cashPosition ?? 0)} · projected inflow ${formatBDT(forecast?.totalInflow ?? 0)} vs outflow ${formatBDT(forecast?.totalOutflow ?? 0)}`} />
        <div className="flex flex-col gap-3">
          {forecastBuckets.length === 0 && <p className="text-[12px] text-muted-foreground">Nothing scheduled in the next 90 days.</p>}
          {forecastBuckets.map((b: any) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11.5px] font-semibold">{b.label}</span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-emerald-500/80" style={{ width: `${(Number(b.inflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-emerald-500">{formatBDT(b.inflow)} in</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-rose-500/80" style={{ width: `${(Number(b.outflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-rose-500">{formatBDT(b.outflow)} out</span>
                </div>
              </div>
              <span className={cn("w-24 shrink-0 text-right text-[11.5px] font-bold tabular-nums", b.net >= 0 ? "text-emerald-500" : "text-rose-500")}>{b.net >= 0 ? "+" : ""}{formatBDT(b.net)}</span>
            </div>
          ))}
        </div>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="GL Statements" subtitle="double-entry ledger · all figures in BDT" />
        {statements?.trialBalance && <p className={cn("text-[11.5px] font-bold", Number(statements.trialBalance.totalDebit) === Number(statements.trialBalance.totalCredit) ? "text-emerald-500" : "text-rose-500")}>Balanced: {formatBDT(statements.trialBalance.totalDebit)} = {formatBDT(statements.trialBalance.totalCredit)}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell>
          <SectionTitle title="Trial Balance" subtitle="all ledger accounts" />
          <TableShell>
            <table className="w-full">
              <THead><Th>Account</Th><Th>Code</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></THead>
              <tbody>
                {(statements?.trialBalance?.rows ?? []).length === 0 && <tr><td colSpan={5} className="px-5 py-6"><EmptyState title="No ledger entries" /></td></tr>}
                {(statements?.trialBalance?.rows ?? []).map((r: any, i: number) => (
                  <Tr key={r.accountId} index={i}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="tabular-nums text-muted-foreground">{r.code}</Td>
                    <Td className="text-right tabular-nums">{r.debit ? formatBDT(r.debit) : "—"}</Td>
                    <Td className="text-right tabular-nums">{r.credit ? formatBDT(r.credit) : "—"}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", Number(r.balance) < 0 ? "text-rose-500" : "")}>{formatBDT(r.balance)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </CardShell>

        <CardShell>
          <SectionTitle title="Balance Sheet" subtitle={`assets ${formatBDT(statements?.balanceSheet?.totalAssets ?? 0)} · equity & liabilities ${formatBDT(statements?.balanceSheet?.totalEquityAndLiabilities ?? 0)}`} />
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Assets</p>
              {(statements?.balanceSheet?.assets ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{a.name} <span className="text-[10px] text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Liabilities</p>
              {(statements?.balanceSheet?.liabilities ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">None</p>}
              {(statements?.balanceSheet?.liabilities ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{a.name} <span className="text-[10px] text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Equity (balancing figure)</p>
              <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]">
                <span>Retained earnings + current profit</span>
                <span className="font-semibold tabular-nums">{formatBDT(statements?.balanceSheet?.equity ?? 0)}</span>
              </div>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Profit & Loss" subtitle="accrual basis · period to date" />
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Revenue</p>
              {(statements?.profitLoss?.revenue ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{r.name} <span className="text-[10px] text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-emerald-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
              {(statements?.profitLoss?.expenses ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">None</p>}
              {(statements?.profitLoss?.expenses ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{r.name} <span className="text-[10px] text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-rose-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <span className="text-[11.5px] font-bold">Net Profit</span>
              <span className={cn("text-[13px] font-bold tabular-nums", Number(statements?.profitLoss?.netIncome ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(statements?.profitLoss?.netIncome ?? 0)}</span>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Cash Flow" subtitle={`net ${formatBDT(statements?.cashFlow?.netOperating ?? 0)} operating · closing ${formatBDT(statements?.cashFlow?.closingBalance ?? 0)}`} />
          <TableShell>
            <table className="w-full">
              <THead><Th>Detail</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Net</Th></THead>
              <tbody>
                {(statements?.cashFlow?.detail ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No transactions" /></td></tr>}
                {(statements?.cashFlow?.detail ?? []).map((d: any, i: number) => (
                  <Tr key={i} index={i}>
                    <Td className="font-medium">{d.label}</Td>
                    <Td className="text-right tabular-nums text-emerald-500">{d.in ? formatBDT(d.in) : "—"}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{d.out ? formatBDT(d.out) : "—"}</Td>
                    <Td className="text-right font-semibold tabular-nums">{d.net >= 0 ? "+" : ""}{formatBDT(d.net)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </CardShell>
      </div>

      <CardShell>
        <SectionTitle title="Accounts Payable Aging" subtitle={`${formatBDT(apAging?.totalPayable ?? 0)} payable to vendors as of today`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-[15px] font-heading font-bold tabular-nums", b.key === "90+" && Number(apAging?.buckets?.[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(apAging?.buckets?.[b.key] ?? 0)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <TableShell>
            <table className="w-full">
              <THead><Th>Vendor</Th><Th className="text-right">Total</Th><Th className="text-right">Current</Th><Th className="text-right">1–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90d+</Th></THead>
              <tbody>
                {(apAging?.byVendor ?? []).length === 0 && <tr><td colSpan={7} className="px-5 py-8"><EmptyState title="Nothing payable" hint="No unpaid vendor bills." /></td></tr>}
                {(apAging?.byVendor ?? []).map((c: any, i: number) => (
                  <Tr key={c.vendorId} index={i}>
                    <Td className="font-medium">{c.vendorName}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatBDT(c.total)}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "current")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d30")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d60")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d90")}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{clientCell(c, "d90p")}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="Budget Plans" subtitle={`${budgets?.length ?? 0} budgets set`} />
        <Btn variant="outline" onClick={() => { setBudgetEdit(null); setBudgetOpen(true); }}><Plus className="size-3.5" /> New Budget</Btn>
      </div>
      <CardShell>
        <TableShell>
          <table className="w-full">
            <THead><Th>Scope</Th><Th>Target</Th><Th className="text-right">Budget</Th><Th className="text-right">Spent</Th><Th className="text-right">Remaining</Th><Th>Period</Th><Th /></THead>
            <tbody>
              {(budgets ?? []).length === 0 && <tr><td colSpan={7} className="px-5 py-8"><EmptyState title="No budgets yet" hint="Create budgets to track spend vs plan." /></td></tr>}
              {(budgets ?? []).map((b: any, i: number) => {
                const spent = Number(b.spent ?? 0);
                const remaining = Number(b.budgetAmount) - spent;
                return (
                  <Tr key={b.id} index={i}>
                    <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", b.scopeType === "PROJECT" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20")}>{label(b.scopeType)}</span></Td>
                    <Td className="font-medium">{b.project?.name ?? label(b.category ?? "—")}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatBDT(b.budgetAmount)}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{formatBDT(spent)}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", remaining < 0 ? "text-rose-500" : "text-emerald-500")}>{formatBDT(remaining)}</Td>
                    <Td className="text-[11px] text-muted-foreground">{b.periodStart ? `${formatDate(b.periodStart)} → ${b.periodEnd ? formatDate(b.periodEnd) : "open"}` : "All time"}</Td>
                    <Td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => { setBudgetEdit(b); setBudgetOpen(true); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                        <button onClick={() => deleteBudget(b.id)} disabled={budgetBusy} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50" title="Delete"><Trash2 className="size-3.5" /></button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </CardShell>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle title="Bank Reconciliation" subtitle="match ledger to bank statement" />
        <div className="flex items-center gap-2">
          <Select value={reconAccount} onChange={(e) => setReconAccount(e.target.value)} className="!w-48">{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName}</option>)}</Select>
          <Btn variant="primary" onClick={() => setReconOpen(true)}><Plus className="size-3.5" /> Add Entry</Btn>
        </div>
      </div>
      <CardShell>
        {reconErr && <p className="mb-2 text-[12px] font-medium text-rose-400">{reconErr}</p>}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Ledger transactions</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Ref</Th><Th>Kind</Th><Th className="text-right">Amount</Th></THead>
                <tbody>
                  {(reconData?.transactions ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No transactions" /></td></tr>}
                  {(reconData?.transactions ?? []).map((t: any, i: number) => (
                    <Tr key={t.id} index={i}>
                      <Td className="text-[11px] text-muted-foreground">{formatDate(t.date)}</Td>
                      <Td className="text-[11.5px]">{t.ref}</Td>
                      <Td className="text-[10.5px] text-muted-foreground">{label(t.kind)}</Td>
                      <Td className={cn("text-right text-[11.5px] font-semibold tabular-nums", t.amount >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(t.amount)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Statement records</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th>Status</Th></THead>
                <tbody>
                  {(reconData?.records ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No statement entries" /></td></tr>}
                  {(reconData?.records ?? []).map((r: any, i: number) => (
                    <Tr key={r.id} index={i}>
                      <Td className="text-[11px] text-muted-foreground">{formatDate(r.statementDate)}</Td>
                      <Td className="text-[11.5px]">{r.statementReference ?? "—"}</Td>
                      <Td className="text-right text-[11.5px] font-semibold tabular-nums">{formatBDT(r.statementAmount)}</Td>
                      <Td><StatusBadge status={r.matchStatus} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
        </div>
      </CardShell>
      <BudgetModal open={budgetOpen} onClose={() => { setBudgetOpen(false); setBudgetEdit(null); }} onSaved={() => { setBudgetOpen(false); setBudgetEdit(null); }} editing={budgetEdit} projects={projects} categories={categories} />
      <ReconcileModal open={reconOpen} bankAccounts={bankAccounts} txns={reconData?.transactions ?? []} onClose={() => setReconOpen(false)} onSaved={() => { setReconOpen(false); setReconErr(null); }} />
    </div>
  );
}

function ProfitabilityTab({ data }: { data: any }) {
  const monthly = data?.monthly ?? [];
  const summary = data?.summary ?? {};
  const maxProfit = Math.max(...monthly.map((m: any) => Math.max(Math.abs(Number(m.profit ?? 0)), 1)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatBDT(summary.totalRevenue)} sub="recognized" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Total Expenses" value={formatBDT(summary.totalExpenses)} sub="incl. pass-through" icon={<Banknote className="size-5" />} />
        <StatCard label="Net Profit" value={formatBDT(summary.netProfit)} sub={summary.margin != null ? `${Math.round(summary.margin)}% margin` : "—"} delta={summary.margin != null ? `+${Math.round(summary.margin)}%` : undefined} icon={<HandCoins className="size-5" />} />
        <StatCard label="Avg Monthly Profit" value={formatBDT(monthly.length ? Number(summary.totalProfit ?? 0) / monthly.length : 0)} sub={`${monthly.length} months tracked`} icon={<Wallet className="size-5" />} />
      </div>

      {!data ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : (
        <FadeIn>
          <CardShell>
            <SectionTitle title="Monthly Profitability" subtitle="revenue vs expenses per month" />
            <TableShell>
              <table className="w-full">
                <THead><Th>Month</Th><Th className="text-right">Revenue</Th><Th className="text-right">Expenses</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th><Th className="w-40">Profit vs peak</Th></THead>
                <tbody>
                  {monthly.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10"><EmptyState title="No profitability data" hint="Data appears once invoices and expenses are recorded." /></td></tr>
                  )}
                  {monthly.map((m: any, i: number) => (
                    <Tr key={m.month} index={i}>
                      <Td className="font-medium">{String(m.month).slice(0, 7)}</Td>
                      <Td className="text-right tabular-nums">{formatBDT(m.revenue)}</Td>
                      <Td className="text-right tabular-nums text-rose-500">{formatBDT(m.expenses)}</Td>
                      <Td className={cn("text-right font-semibold tabular-nums", m.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(m.profit)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{m.margin != null ? `${Math.round(m.margin)}%` : "—"}</Td>
                      <Td>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", m.profit >= 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${(Math.abs(Number(m.profit ?? 0)) / maxProfit) * 100}%` }} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </CardShell>
          <CardShell>
            <SectionTitle title="Project Profitability" subtitle={`best: ${summary.bestProject ?? "—"}`} />
            <TableShell>
              <table className="w-full">
                <THead><Th>Project</Th><Th className="text-right">Budget</Th><Th className="text-right">Collected</Th><Th className="text-right">Revenue</Th><Th className="text-right">Cost</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th><Th className="text-right">Hours</Th></THead>
                <tbody>
                  {(data?.projects ?? []).length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No project data" /></td></tr>}
                  {(data?.projects ?? []).map((p: any, i: number) => (
                    <Tr key={p.id} index={i}>
                      <Td className="font-medium">{p.name}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{formatBDT(p.budget)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{formatBDT(p.collected)}</Td>
                      <Td className="text-right tabular-nums">{formatBDT(p.revenue)}</Td>
                      <Td className="text-right tabular-nums text-rose-500">{formatBDT(p.cost)}</Td>
                      <Td className={cn("text-right font-semibold tabular-nums", p.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(p.profit)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{p.margin != null ? `${Math.round(p.margin)}%` : "—"}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{p.hoursLogged ?? 0}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </CardShell>
        </FadeIn>
      )}
    </div>
  );
}

function AccountModal({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
  const [f, setF] = useState({ code: "", name: "", category: "OPEX", isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ code: editing?.code ?? "", name: editing?.name ?? "", category: editing?.category ?? "OPEX", isActive: editing?.isActive ?? true });
  }, [open, editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Account name is required");
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ name: f.name.trim(), code: f.code.trim() || undefined, category: f.category, isActive: f.isActive });
      if (editing) await apiFetch(`/capital/accounts/${editing.id}`, { method: "PATCH", body });
      else await apiFetch("/capital/accounts", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit account" : "Add account"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. 6100" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        </div>
        <Field label="Account name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Insurance" autoFocus /></Field>
        {editing && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 rounded accent-primary" />
            Active (usable for new entries)
          </label>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add account"} />
      </form>
    </Modal>
  );
}

function AccountsTab({ accounts, balances, onEdit, onAdd, onDelete, onSaved }: { accounts: any[]; balances: any[]; onEdit: (a: any) => void; onAdd: () => void; onDelete: (a: any) => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (ql && !a.name.toLowerCase().includes(ql) && !(a.code ?? "").toLowerCase().includes(ql)) return false;
      if (cat && a.category !== cat) return false;
      return true;
    });
  }, [accounts, q, cat]);
  const balanceOf = (id: string) => balances.find((b: any) => b.accountId === id)?.balance ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-40"><option value="">All categories</option>{ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd}><Plus className="size-3.5" /> Add Account</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} accounts · {list.filter((a) => a.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Code</Th><Th>Name</Th><Th>Category</Th><Th className="text-right">Ledger balance</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10"><EmptyState title="No accounts match" hint="Adjust filters or add a new account." /></td></tr>
              )}
              {list.map((a, i) => (
                <Tr key={a.id} index={i}>
                  <Td className="font-mono text-[12px] tabular-nums text-muted-foreground">{a.code ?? "—"}</Td>
                  <Td className="font-medium">{a.name}</Td>
                  <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold", a.category === "ASSET" ? "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20" : a.category === "LIABILITY" ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20" : a.category === "REVENUE" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20")}>{label(a.category)}</span></Td>
                  <Td className={cn("text-right font-semibold tabular-nums", balanceOf(a.id) < 0 ? "text-rose-500" : "")}>{formatBDT(balanceOf(a.id))}</Td>
                  <Td><StatusBadge status={a.isActive ? "Active" : "Inactive"} /></Td>
                  <Td>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onEdit(a)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                      {a.isActive && <button onClick={() => onDelete(a)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Deactivate"><Trash2 className="size-3.5" /></button>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </FadeIn>
    </div>
  );
}

function VendorsTab({ vendors, expenses, onEdit, onAdd, onDelete, onSaved }: { vendors: any[]; expenses: any[]; onEdit: (v: any) => void; onAdd: () => void; onDelete: (v: any) => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return vendors.filter((v) => !ql || v.name.toLowerCase().includes(ql) || (v.email ?? "").toLowerCase().includes(ql));
  }, [vendors, q]);
  const expByVendor = useMemo(() => {
    const m = new Map<string, { count: number; paid: number; payable: number }>();
    for (const e of expenses) {
      if (!e.vendorId) continue;
      const entry = m.get(e.vendorId) ?? { count: 0, paid: 0, payable: 0 };
      entry.count += 1;
      if (e.isPayable) entry.payable += Number(e.amount) - Number(e.paidAmount ?? 0);
      m.set(e.vendorId, entry);
    }
    return m;
  }, [expenses]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd}><UserPlus className="size-3.5" /> Add Vendor</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} vendors · {list.filter((v) => v.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Name</Th><Th>Contact</Th><Th>Payment terms</Th><Th className="text-right">Expenses</Th><Th className="text-right">Payable</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10"><EmptyState title="No vendors" hint="Add vendors to track accounts payable." /></td></tr>
              )}
              {list.map((v, i) => {
                const stat = expByVendor.get(v.id);
                return (
                  <Tr key={v.id} index={i}>
                    <Td className="font-medium">{v.name}</Td>
                    <Td className="text-[11.5px] text-muted-foreground">{v.email ? <p>{v.email}</p> : null}{v.phone ? <p>{v.phone}</p> : null}{!v.email && !v.phone ? "—" : null}</Td>
                    <Td className="text-[11.5px] text-muted-foreground">{v.paymentTerms ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{stat?.count ?? 0}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", (stat?.payable ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground")}>{formatBDT(stat?.payable ?? 0)}</Td>
                    <Td><StatusBadge status={v.isActive ? "Active" : "Inactive"} /></Td>
                    <Td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => onEdit(v)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                        <button onClick={() => onDelete(v)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete"><Trash2 className="size-3.5" /></button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </FadeIn>
    </div>
  );
}

function ActivityTab({ activity, refresh }: { activity: any[] | null; refresh: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {!activity ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : (
        <FadeIn>
          <CardShell>
            <SectionTitle title="Activity Log" subtitle="all finance mutations, newest first" action={<Btn variant="ghost" onClick={refresh}><RefreshCw className="size-3.5" /> Refresh</Btn>} />
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" hint="Invoice, payment and expense changes will show up here." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <span className={cn("mt-1 size-2 shrink-0 rounded-full", a.entityType === "PAYMENT" ? "bg-emerald-500" : a.entityType === "EXPENSE" ? "bg-amber-400" : a.entityType === "INVOICE" ? "bg-primary" : "bg-sky-400")} />
                    <div className="min-w-0 flex-1 rounded-xl border border-border/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", ENTITY_TONES[a.entityType] ?? "bg-muted text-muted-foreground")}>{label(a.entityType)}</span>
                        <p className="text-[12.5px] font-medium">{a.action}</p>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(a.timestamp)} · {a.performedBy?.name ?? "system"}</span>
                      </div>
                      {(a.beforeValue != null || a.afterValue != null) && (
                        <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground/80">{fmtJSON(a.beforeValue)} → {fmtJSON(a.afterValue)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </FadeIn>
      )}
    </div>
  );
}

export default function CapitalPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const TAB_KEYS: TabKey[] = ["overview", "invoices", "expenses", "income", "vendors", "reports", "profitability", "accounts", "activity"];
  const rawTab = searchParams.get("tab");
  const tab: TabKey = TAB_KEYS.includes(rawTab as TabKey) ? (rawTab as TabKey) : "overview";
  const selectedId = searchParams.get("inv");

  const setTabUrl = useCallback(
    (t: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", t);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const openInvoice = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "invoices");
      params.set("inv", id);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const closeInvoice = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("inv");
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const [refresh, setRefresh] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const notify = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const { data: overview } = useApi<any>(`/capital/overview?ts=${refresh}`);
  const { data: clients } = useApi<any[]>("/accounts/clients");
  const { data: projects } = useApi<any[]>("/flow/projects");
  const { data: incomeStats } = useApi<any>(`/capital/income/stats?ts=${refresh}`);
  const { data: reports } = useApi<any>(`/capital/reports?ts=${refresh}`);
  const { data: profitability } = useApi<any>(`/capital/profitability?ts=${refresh}`);
  const { data: activity } = useApi<any[]>(`/capital/activity?ts=${refresh}`);
  const { data: aging } = useApi<any>(`/capital/aging?ts=${refresh}`);
  const { data: forecast } = useApi<any>(`/capital/forecast?ts=${refresh}`);
  const { data: bankAccounts } = useApi<any[]>("/capital/bank-accounts");
  const { data: expenseCategories } = useApi<any[]>("/capital/expense-categories");
  const { data: vendors } = useApi<any[]>("/capital/vendors");
  const { data: accounts } = useApi<any[]>("/capital/accounts");
  const { data: budgets } = useApi<any[]>(`/capital/budgets?ts=${refresh}`);
  const { data: tb } = useApi<any>(`/capital/statements/trial-balance?ts=${refresh}`);
  const { data: pl } = useApi<any>(`/capital/statements/profit-loss?ts=${refresh}`);
  const { data: bs } = useApi<any>(`/capital/statements/balance-sheet?ts=${refresh}`);
  const { data: cf } = useApi<any>(`/capital/statements/cash-flow?ts=${refresh}`);
  const { data: apAging } = useApi<any>(`/capital/aging/ap?ts=${refresh}`);
  const statements = useMemo(() => ({ trialBalance: tb, profitLoss: pl, balanceSheet: bs, cashFlow: cf }), [tb, pl, bs, cf]);
  const [recurringBusy, setRecurringBusy] = useState(false);

  const runRecurring = async () => {
    setRecurringBusy(true);
    try {
      const r = await apiFetch<any>("/capital/recurring/run", { method: "POST" });
      notify(r.created > 0 ? `${r.created} recurring invoice(s) generated` : "No recurring invoices due");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Recurring billing failed");
    } finally {
      setRecurringBusy(false);
    }
  };

  const [invoices, setInvoices] = useState<any[] | null>(null);
  const [invoicesErr, setInvoicesErr] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<any[] | null>(null);
  const [expensesErr, setExpensesErr] = useState<string | null>(null);
  const [income, setIncome] = useState<any[] | null>(null);
  const [incomeErr, setIncomeErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>("/capital/invoices").then((d) => !cancelled && setInvoices(d)).catch((e) => !cancelled && setInvoicesErr(e.message));
    apiFetch<any[]>("/capital/expenses").then((d) => !cancelled && setExpenses(d)).catch((e) => !cancelled && setExpensesErr(e.message));
    apiFetch<any[]>("/capital/income").then((d) => !cancelled && setIncome(d)).catch((e) => !cancelled && setIncomeErr(e.message));
    return () => { cancelled = true; };
  }, [refresh]);

  const [invOpen, setInvOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorEdit, setVendorEdit] = useState<any | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEdit, setAccountEdit] = useState<any | null>(null);
  const [toDeleteVendor, setToDeleteVendor] = useState<any | null>(null);
  const [deletingVendor, setDeletingVendor] = useState(false);
  const [editInv, setEditInv] = useState<any | null>(null);
  const [toDelete, setToDelete] = useState<{ kind: "invoice" | "expense"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async (a: any) => {
    try {
      await apiFetch(`/capital/accounts/${a.id}`, { method: "DELETE" });
      notify("Account deactivated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Deactivate failed");
    }
  };

  const doDeleteVendor = async () => {
    if (!toDeleteVendor) return;
    setDeletingVendor(true);
    try {
      await apiFetch(`/capital/vendors/${toDeleteVendor.id}`, { method: "DELETE" });
      notify("Vendor deleted");
      setToDeleteVendor(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeletingVendor(false);
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/capital/${toDelete.kind === "invoice" ? "invoices" : "expenses"}/${toDelete.id}`, { method: "DELETE" });
      notify("Deleted");
      setToDelete(null);
      if (selectedId === toDelete.id) closeInvoice();
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const duplicateInvoice = async (id: string) => {
    try {
      await apiFetch(`/capital/invoices/${id}/duplicate`, { method: "POST" });
      notify("Invoice duplicated");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Duplicate failed");
    }
  };

  return (
    <div>
      {flash && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl">
          {flash}
        </motion.div>
      )}

      <PageHeader
        title="Capital — Finance"
        subtitle="Invoicing, expenses, payments and real-time profitability."
        actions={
          <>
            <Btn variant="outline" onClick={() => setExpOpen(true)}><ReceiptText className="size-3.5" /> Record Expense</Btn>
            <Btn variant="primary" onClick={() => setInvOpen(true)}><Plus className="size-3.5" /> New Invoice</Btn>
          </>
        }
      />

      <div className="mb-5">
        <Segmented
          value={tab}
          onChange={setTabUrl}
          options={[
            { value: "overview", label: "Overview" },
            { value: "invoices", label: "Invoices" },
            { value: "expenses", label: "Expenses" },
            { value: "income", label: "Income" },
            { value: "vendors", label: "Vendors" },
            { value: "reports", label: "Reports" },
            { value: "profitability", label: "Profitability" },
            { value: "accounts", label: "Accounts" },
            { value: "activity", label: "Activity" },
          ]}
        />
      </div>

      {tab === "overview" && <OverviewTab overview={overview} invoices={invoices} expenses={expenses} />}
      {tab === "invoices" && (
        <InvoicesTab
          invoices={invoices}
          error={invoicesErr}
          refresh={reload}
          clients={clients ?? []}
          onView={openInvoice}
          onNew={() => setInvOpen(true)}
          onDuplicate={duplicateInvoice}
          onDelete={(inv) => setToDelete({ kind: "invoice", id: inv.id, name: inv.invoiceNumber })}
        />
      )}
      {tab === "expenses" && (
        <ExpensesTab
          expenses={expenses}
          error={expensesErr}
          refresh={reload}
          notify={notify}
          onRecord={() => setExpOpen(true)}
          onVendor={() => setVendorOpen(true)}
          onDelete={(e) => setToDelete({ kind: "expense", id: e.id, name: e.description })}
          categories={expenseCategories ?? []}
          bankAccounts={bankAccounts ?? []}
          accounts={accounts ?? []}
        />
      )}
      {tab === "income" && <IncomeTab income={income} error={incomeErr} refresh={reload} stats={incomeStats} bankAccounts={bankAccounts ?? []} />}
      {tab === "vendors" && <VendorsTab vendors={vendors ?? []} expenses={expenses ?? []} onEdit={(v) => setVendorEdit(v)} onAdd={() => setVendorOpen(true)} onDelete={(v) => setToDeleteVendor(v)} onSaved={reload} />}
      {tab === "reports" && <ReportsTab reports={reports} aging={aging} forecast={forecast} statements={statements} apAging={apAging} budgets={budgets ?? []} projects={projects ?? []} bankAccounts={bankAccounts ?? []} categories={expenseCategories ?? []} onRunRecurring={runRecurring} running={recurringBusy} />}
      {tab === "profitability" && <ProfitabilityTab data={profitability} />}
      {tab === "accounts" && <AccountsTab accounts={accounts ?? []} balances={tb?.rows ?? []} onEdit={(a) => setAccountEdit(a)} onAdd={() => setAccountOpen(true)} onDelete={deleteAccount} onSaved={reload} />}
      {tab === "activity" && <ActivityTab activity={activity} refresh={reload} />}

      <InvoiceFormModal open={invOpen} onClose={() => setInvOpen(false)} clients={clients ?? []} projects={projects ?? []} onSaved={() => { notify("Invoice created"); reload(); }} />
      <ExpenseModal open={expOpen} onClose={() => setExpOpen(false)} onSaved={() => { notify("Expense recorded"); reload(); }} bankAccounts={bankAccounts ?? []} categories={expenseCategories ?? []} vendors={vendors ?? []} />
      <VendorModal open={vendorOpen || !!vendorEdit} onClose={() => { setVendorOpen(false); setVendorEdit(null); }} onSaved={() => { notify("Vendor saved"); reload(); }} editing={vendorEdit} />
      <AccountModal open={accountOpen || !!accountEdit} onClose={() => { setAccountOpen(false); setAccountEdit(null); }} onSaved={() => { notify("Account saved"); reload(); }} editing={accountEdit} />
      <InvoiceDrawer selectedId={selectedId} refresh={reload} notify={notify} onClose={closeInvoice} onEdit={setEditInv} bankAccounts={bankAccounts ?? []} />
      <EditInvoiceModal invoice={editInv} onClose={() => setEditInv(null)} clients={clients ?? []} projects={projects ?? []} onSaved={() => { notify("Invoice updated"); reload(); }} />
      <ConfirmModal open={!!toDelete} onClose={() => setToDelete(null)} title={toDelete?.kind === "invoice" ? "Delete invoice" : "Delete expense"} message={toDelete ? `Delete "${toDelete.name}"? This cannot be undone.` : ""} busy={deleting} onConfirm={doDelete} />
      <ConfirmModal open={!!toDeleteVendor} onClose={() => setToDeleteVendor(null)} title="Delete vendor" message={toDeleteVendor ? `Delete vendor "${toDeleteVendor.name}"? Vendors with expenses must be deactivated instead.` : ""} busy={deletingVendor} onConfirm={doDeleteVendor} />
    </div>
  );
}