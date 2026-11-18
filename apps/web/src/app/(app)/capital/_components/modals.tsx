"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Pencil, Plus, ReceiptText, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { EmptyState, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, FormActions, FormSection, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { INVOICE_TEMPLATES, accountsForMethod, invoiceTotals, numberToWords } from "@/lib/invoice-utils";
import { ACCOUNT_CATEGORIES, INVOICE_STATUSES, PAYMENT_METHODS, label, today } from "./constants";
import { MOBILE_WALLET_KINDS, PAY_META } from "@/lib/payment-meta";
import { MethodPicker } from "@/components/payment-badge";

type InvoiceLineDraft = { description: string; unitPrice: string; quantity: string };

type PayDraft = {
  method: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  routingNumber: string;
  mobileWalletNumber: string;
  mobileWalletProviders: string[];
};

const blankPay = (): PayDraft => ({ method: "BANK_TRANSFER", bankName: "", accountName: "", accountNumber: "", branch: "", routingNumber: "", mobileWalletNumber: "", mobileWalletProviders: [] });

const payFrom = (src: any): PayDraft => ({
  method: src?.method ?? "BANK_TRANSFER",
  bankName: src?.bankName ?? "",
  accountName: src?.accountName ?? "",
  accountNumber: src?.accountNumber ?? "",
  branch: src?.branch ?? "",
  routingNumber: src?.routingNumber ?? "",
  mobileWalletNumber: src?.mobileWalletNumber ?? "",
  mobileWalletProviders: Array.isArray(src?.mobileWalletProviders) ? src.mobileWalletProviders : [],
});

const cleanPay = (p: PayDraft) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v;
      continue;
    }
    const s = (v ?? "").trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length > 1 || (out as any).method ? out : undefined;
};

const plusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Bank-account options matching a payment method (bKash → bKash accounts…). */
function methodAccounts(bankAccounts: any[], method: string) {
  return accountsForMethod(bankAccounts, method);
}

/** Switching method clears the account when it no longer matches. */
function withMethod(f: any, bankAccounts: any[], method: string) {
  const stillValid = accountsForMethod(bankAccounts, method).some((b: any) => b.id === f.bankAccountId);
  return { ...f, method, bankAccountId: stillValid ? f.bankAccountId : "" };
}

function InvoiceTotalsPreview({ lines, taxApplicable, taxRate, discountRate, shippingFee, currency }: {
  lines: InvoiceLineDraft[]; taxApplicable: boolean; taxRate: string; discountRate: string; shippingFee: string; currency: string;
}) {
  const t = invoiceTotals({
    lineItems: lines.map((l) => ({ amount: (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0) })),
    taxApplicable,
    taxRate: Number(taxRate) || 0,
    discountRate: Number(discountRate) || 0,
    shippingFee: Number(shippingFee) || 0,
    payments: [],
  });
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-3 py-2.5 text-body">
      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium tabular-nums">{formatBDT(t.subtotal)}</span></div>
      {t.tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT / Tax ({Number(taxRate) || 0}%)</span><span className="font-medium tabular-nums">+ {formatBDT(t.tax)}</span></div>}
      {t.discount > 0 && <div className="flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">Discount ({Number(discountRate) || 0}%)</span><span className="font-medium tabular-nums">− {formatBDT(t.discount)}</span></div>}
      {t.shipping > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Shipping / Delivery</span><span className="font-medium tabular-nums">+ {formatBDT(t.shipping)}</span></div>}
      <div className="flex justify-between border-t border-border/60 pt-1.5"><span className="font-bold">Grand Total</span><span className="font-bold tabular-nums">{formatBDT(t.grand)}</span></div>
      <p className="text-micro italic leading-relaxed text-muted-foreground">In words: {numberToWords(t.grand, currency)}</p>
    </div>
  );
}

const TEMPLATE_SWATCH: Record<string, string> = {
  "modern-orange": "bg-[#ea580c]",
  "zoolyum-dark": "bg-zinc-900",
  "minimal-clean": "bg-zinc-300",
  "classic-corporate": "bg-[#2563eb]",
};

function TemplatePicker({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {INVOICE_TEMPLATES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-all ${value === t.value ? "border-primary ring-2 ring-primary/20" : "border-border/60 hover:border-primary/40"}`}
        >
          <span className={`h-6 w-full rounded-md ${TEMPLATE_SWATCH[t.value] ?? "bg-muted"}`} />
          <span className="text-meta font-semibold">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function PaymentDetailsFields({ value, onChange }: { value: PayDraft; onChange: (v: PayDraft) => void }) {
  const set = (k: keyof PayDraft, v: string) => onChange({ ...value, [k]: v });
  const toggleProvider = (provider: string) => {
    const current = value.mobileWalletProviders ?? [];
    onChange({
      ...value,
      mobileWalletProviders: current.includes(provider) ? current.filter((p) => p !== provider) : [...current, provider],
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Method">
          <Select value={value.method} onChange={(e) => set("method", e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </Select>
        </Field>
        <Field label="Mobile wallet no">
          <Input value={value.mobileWalletNumber} onChange={(e) => set("mobileWalletNumber", e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
        </Field>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-meta font-semibold text-muted-foreground">This number is used for</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {MOBILE_WALLET_KINDS.map((kind) => (
              <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-body">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={(value.mobileWalletProviders ?? []).includes(kind)}
                  onChange={() => toggleProvider(kind)}
                />
                {PAY_META[kind].short}
              </label>
            ))}
          </div>
        </div>
        <Field label="Bank name"><Input value={value.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="City Bank PLC" /></Field>
        <Field label="Branch"><Input value={value.branch} onChange={(e) => set("branch", e.target.value)} placeholder="Gulshan Branch" /></Field>
        <Field label="Routing number"><Input value={value.routingNumber} onChange={(e) => set("routingNumber", e.target.value)} placeholder="225271891" /></Field>
        <Field label="Account name"><Input value={value.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder="Zoolyum Agency" /></Field>
        <Field label="Account number"><Input value={value.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="1102938481901" /></Field>
      </div>
    </div>
  );
}

type InvoiceFormState = {
  invoiceNumber: string;
  clientId: string;
  projectId: string;
  advancePct: string;
  issueDate: string;
  dueDate: string;
  status: string;
  invoiceType: string;
  taxApplicable: boolean;
  taxRate: string;
  discountRate: string;
  shippingFee: string;
  currency: string;
  exchangeRate: string;
  notes: string;
  terms: string;
  templateStyle: string;
  pay: PayDraft;
  lines: InvoiceLineDraft[];
};

const blankForm = (): InvoiceFormState => ({
  invoiceNumber: "",
  clientId: "",
  projectId: "",
  advancePct: "",
  issueDate: today(),
  dueDate: plusDays(15),
  status: "DRAFT",
  invoiceType: "ONE_TIME",
  taxApplicable: true,
  taxRate: "5",
  discountRate: "0",
  shippingFee: "0",
  currency: "BDT",
  exchangeRate: "",
  notes: "",
  terms: "",
  templateStyle: "modern-orange",
  pay: blankPay(),
  lines: [{ description: "", unitPrice: "", quantity: "1" }],
});

function InvoiceFormBody({ f, setF, clients, projects, showNumber, sectioned = false }: {
  f: InvoiceFormState;
  setF: (v: InvoiceFormState) => void;
  clients: any[];
  projects: any[];
  showNumber: boolean;
  /** Two-pane, sectioned layout used by the create sheet. */
  sectioned?: boolean;
}) {
  const updateLine = (i: number, key: keyof InvoiceLineDraft, v: string) =>
    setF({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)) });

  // Projects belonging to a client (project rows carry clientId from /flow/projects)
  const projectsFor = (clientId: string) =>
    clientId ? (projects ?? []).filter((p: any) => p.clientId === clientId) : (projects ?? []);
  // A project always implies its client; infer it when the form was opened with
  // a project preselected but no client.
  const effectiveClientId = f.clientId || ((projects ?? []).find((p: any) => p.id === f.projectId)?.clientId ?? "");
  const visibleProjects = projectsFor(effectiveClientId);
  const selectedClient = (clients ?? []).find((c: any) => c.id === effectiveClientId) ?? null;
  const selectedProject = (projects ?? []).find((p: any) => p.id === f.projectId) ?? null;
  const linesPristine = (lines: InvoiceLineDraft[]) =>
    lines.length === 1 && !lines[0].description.trim() && !Number(lines[0].unitPrice || 0);
  const INVOICE_CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR"];

  // live billing status of the selected project (value / billed / paid / remaining)
  const [projFin, setProjFin] = useState<any | null>(null);
  const [projFinLoading, setProjFinLoading] = useState(false);
  const autoFilledFor = useRef<string | null>(null);
  // signature of the last SYSTEM-written line items — lets % entry overwrite
  // our own auto-fill while never clobbering anything the user typed
  const autoLineSig = useRef<string | null>(null);
  const systemLines = (lines: InvoiceLineDraft[]) =>
    linesPristine(lines) || (autoLineSig.current != null && autoLineSig.current === JSON.stringify(lines));
  const projectValue = (proj: any, fin: any) =>
    Number(proj?.amount ?? proj?.budgetAmount ?? fin?.project?.budgetAmount ?? 0);
  const projectRemaining = (proj: any, fin: any) =>
    Math.max(Math.round((projectValue(proj, fin) - (fin?.totalInvoiced ?? 0)) * 100) / 100, 0);

  useEffect(() => {
    if (!f.projectId) {
      setProjFin(null);
      autoFilledFor.current = null;
      return;
    }
    let cancelled = false;
    setProjFinLoading(true);
    apiFetch<any>(`/capital/projects/${f.projectId}/finance`)
      .then((fin) => { if (!cancelled) setProjFin(fin); })
      .catch(() => { if (!cancelled) setProjFin(null); })
      .finally(() => { if (!cancelled) setProjFinLoading(false); });
    return () => { cancelled = true; };
  }, [f.projectId]);

  // auto-fill the REMAINING project balance — only when line items are still untouched
  useEffect(() => {
    if (!f.projectId || !projFin || autoFilledFor.current === f.projectId) return;
    autoFilledFor.current = f.projectId;
    if (!linesPristine(f.lines)) return;
    if ((selectedProject?.billingType ?? "ONE_TIME") !== "ONE_TIME") return;
    const remaining = projectRemaining(selectedProject, projFin);
    if (remaining <= 0) return;
    const next = { ...f, lines: [{ description: selectedProject?.name ?? "Project balance", unitPrice: String(remaining), quantity: "1" }] };
    if (selectedProject?.currency && INVOICE_CURRENCIES.includes(selectedProject.currency)) next.currency = selectedProject.currency;
    autoLineSig.current = JSON.stringify(next.lines);
    setF(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projFin]);

  const onClientChange = (clientId: string) => {
    // drop the selected project if it doesn't belong to the new client
    const keepProject = f.projectId && projectsFor(clientId).some((p: any) => p.id === f.projectId);
    setF({ ...f, clientId, projectId: keepProject ? f.projectId : "" });
  };

  const onProjectChange = (projectId: string) => {
    const next = { ...f, projectId, advancePct: "" };
    const proj = (projects ?? []).find((p: any) => p.id === projectId);
    if (proj) {
      // invoice belongs to the project's client
      if (!next.clientId || next.clientId !== proj.clientId) next.clientId = proj.clientId;
    }
    // price auto-fill happens once live billing status arrives (see effect above)
    autoFilledFor.current = null;
    autoLineSig.current = null;
    setProjFin(null);
    setF(next);
  };

  // milestone billing: type a % of the project value → line auto-calculated.
  // only touches system-written lines, never anything the user typed.
  const applyAdvancePct = (pctStr: string) => {
    const next = { ...f, advancePct: pctStr };
    const pct = Number(pctStr);
    if (!selectedProject || !pctStr || !(pct > 0) || pct > 100) {
      if (!pctStr && next.invoiceType === "ADVANCE") next.invoiceType = "ONE_TIME";
      setF(next);
      return;
    }
    const value = projectValue(selectedProject, projFin);
    if (value > 0 && systemLines(next.lines)) {
      const amount = Math.round((value * pct) / 100 * 100) / 100;
      const pctLabel = String(Number(pctStr));
      next.lines = [{ description: `${pctLabel}% Advance — ${selectedProject.name}`, unitPrice: String(amount), quantity: "1" }];
      autoLineSig.current = JSON.stringify(next.lines);
      if (next.invoiceType === "ONE_TIME") next.invoiceType = "ADVANCE";
      if (selectedProject?.currency && INVOICE_CURRENCIES.includes(selectedProject.currency)) next.currency = selectedProject.currency;
    }
    setF(next);
  };
  const advancePreview = (() => {
    const pct = Number(f.advancePct);
    if (!selectedProject || !(pct > 0) || pct > 100) return null;
    const value = projectValue(selectedProject, projFin);
    if (!(value > 0)) return null;
    return formatBDT(Math.round((value * pct) / 100 * 100) / 100);
  })();
  const showAdvanceInput = !!selectedProject && (selectedProject?.billingType ?? "ONE_TIME") === "ONE_TIME";

  const totals = invoiceTotals({
    lineItems: f.lines.map((l) => ({ amount: (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0) })),
    taxApplicable: f.taxApplicable,
    taxRate: Number(f.taxRate) || 0,
    discountRate: Number(f.discountRate) || 0,
    shippingFee: Number(f.shippingFee) || 0,
    payments: [],
  });
  const clientName = (clients ?? []).find((c: any) => c.id === f.clientId)?.companyName ?? null;
  const filledLines = f.lines.filter((l) => l.description.trim()).length;

  const partyFields = (
    <>
      {showNumber && <Field label="Invoice number *"><Input value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} placeholder="ZLM-2026-0001" className="font-mono" /></Field>}
      <Field label="Client *"><Select value={f.clientId} onChange={(e) => onClientChange(e.target.value)}><option value="">Select client…</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select></Field>
      <Field label="Project">
        <Select value={f.projectId} onChange={(e) => onProjectChange(e.target.value)} disabled={!effectiveClientId}>
          <option value="">{effectiveClientId ? "No project" : "Select a client first"}</option>
          {visibleProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {effectiveClientId && visibleProjects.length === 0 && (
          <p className="mt-1 text-meta text-muted-foreground">
            No projects under {selectedClient?.companyName ?? "this client"} yet — create one in Flow, then pick it here.
          </p>
        )}
        {showAdvanceInput && (
          <div className="mt-2 flex items-center gap-2">
            <div className="relative w-28">
              <Input type="number" min={0} max={100} step="any" value={f.advancePct} onChange={(e) => applyAdvancePct(e.target.value)} placeholder="50" className="pr-7" />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-body font-bold text-muted-foreground">%</span>
            </div>
            <p className="text-meta text-muted-foreground">
              {advancePreview ? <span>Advance <span className="font-bold tabular-nums text-foreground">{advancePreview}</span> of {formatBDT(projectValue(selectedProject, projFin))}</span> : "Milestone % of project value"}
            </p>
          </div>
        )}
        {showAdvanceInput && Number(f.advancePct) > 0 && Number(f.advancePct) <= 100 && !systemLines(f.lines) && (
          <p className="mt-1 text-meta text-amber-600 dark:text-amber-400">Line edited by hand — clear it to apply the % again.</p>
        )}
        {showAdvanceInput && projFin && Number(f.advancePct) > 0 && Number(f.advancePct) <= 100 &&
          Math.round((projectValue(selectedProject, projFin) * Number(f.advancePct)) / 100 * 100) / 100 > projectRemaining(selectedProject, projFin) && (
          <p className="mt-1 text-meta text-amber-600 dark:text-amber-400">
            {String(Number(f.advancePct))}% of full value ({formatBDT(projectValue(selectedProject, projFin))}) exceeds the remaining {formatBDT(projectRemaining(selectedProject, projFin))} — {formatBDT(projFin.totalInvoiced ?? 0)} already billed.
          </p>
        )}
        {projFinLoading && f.projectId && (
          <p className="mt-1 text-meta text-muted-foreground">Loading billing status…</p>
        )}
        {!projFinLoading && projFin && f.projectId && selectedProject && (
          <div className="mt-2 rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Project billing</p>
              {projFin.project?.paymentStatus && <StatusBadge status={projFin.project.paymentStatus} />}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              <div><p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Value</p><p className="text-body font-bold tabular-nums">{formatBDT(projectValue(selectedProject, projFin))}</p></div>
              <div><p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Billed</p><p className="text-body font-bold tabular-nums">{formatBDT(projFin.totalInvoiced ?? 0)}</p></div>
              <div><p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Paid</p><p className="text-body font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatBDT(projFin.collected ?? 0)}</p></div>
              <div><p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{(selectedProject?.billingType ?? "ONE_TIME") === "ONE_TIME" ? "Remaining" : "Outstanding"}</p><p className="text-body font-bold tabular-nums">{formatBDT((selectedProject?.billingType ?? "ONE_TIME") === "ONE_TIME" ? projectRemaining(selectedProject, projFin) : (projFin.outstanding ?? 0))}</p></div>
            </div>
            {(projFin.invoices ?? []).length > 0 && (
              <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
                {(projFin.invoices ?? []).slice(0, 5).map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 text-meta">
                    <span className="min-w-0">
                      <span className="font-medium tabular-nums">{inv.invoiceNumber}</span>
                      {inv.title && <span className="block truncate text-micro text-muted-foreground">{inv.title}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {inv.invoiceType === "ADVANCE" && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Adv</span>
                      )}
                      <StatusBadge status={inv.status} />
                      <span className="tabular-nums text-muted-foreground">bal {formatBDT(inv.balance ?? 0)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>
      <Field label="Issue date"><Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
      <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
    </>
  );

  const pricingFields = (
    <>
      <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
      <Field label="Type"><Select value={f.invoiceType} onChange={(e) => setF({ ...f, invoiceType: e.target.value })}>{["ONE_TIME", "RECURRING", "ADVANCE", "COMBINED"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
      <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
      <Field label="Tax (VAT %)">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-body">
            <input type="checkbox" checked={f.taxApplicable} onChange={(e) => setF({ ...f, taxApplicable: e.target.checked })} className="size-3.5 accent-primary" />
            Apply
          </label>
          <Input type="number" min={0} max={100} step="0.01" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} placeholder="5" className="!w-20" disabled={!f.taxApplicable} />
        </div>
      </Field>
      <Field label="Discount %"><Input type="number" min={0} max={100} step="0.01" value={f.discountRate} onChange={(e) => setF({ ...f, discountRate: e.target.value })} placeholder="0" /></Field>
      <Field label="Shipping / Delivery"><Input type="number" min={0} step="0.01" value={f.shippingFee} onChange={(e) => setF({ ...f, shippingFee: e.target.value })} placeholder="0" /></Field>
      {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
    </>
  );

  const lineItemsBlock = (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <div className="grid grid-cols-[minmax(0,1fr)_92px_72px_96px_34px] items-center gap-2 border-b border-border/50 bg-muted/25 px-3 py-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">
        <span>Description</span><span className="text-right">Rate</span><span className="text-right">Qty</span><span className="text-right">Amount</span><span />
      </div>
      <div className="divide-y divide-border/40">
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_92px_72px_96px_34px] items-center gap-2 px-3 py-2">
            <Input value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} placeholder="Design retainer…" />
            <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => updateLine(i, "unitPrice", e.target.value)} placeholder="Rate" />
            <Input type="number" min={0} step="0.01" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} placeholder="Qty" />
            <span className="text-right text-body font-semibold tabular-nums">{formatBDT((Number(l.unitPrice) || 0) * (Number(l.quantity) || 0))}</span>
            <button type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, idx) => idx !== i) })} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-muted/15 px-3 py-2">
        <button type="button" onClick={() => setF({ ...f, lines: [...f.lines, { description: "", unitPrice: "", quantity: "1" }] })} className="flex items-center gap-1 text-meta font-bold text-primary transition-colors hover:text-primary"><Plus className="size-3.5" /> Add line item</button>
        <span className="text-micro text-muted-foreground">{filledLines} of {f.lines.length} filled</span>
      </div>
    </div>
  );

  return (
    <div className={cn(sectioned ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start" : "flex flex-col gap-4")}>
      <div className={cn("flex min-w-0 flex-col", sectioned ? "gap-6" : "gap-4")}>
        {sectioned ? (
          <FormSection step={1} title="Client & schedule" hint="Who is billed, which project this draws from, and when payment falls due.">
            <div className="grid gap-4 sm:grid-cols-2">{partyFields}</div>
          </FormSection>
        ) : (
          <div className="grid grid-cols-2 gap-4">{partyFields}{pricingFields}</div>
        )}

        {sectioned && (
          <FormSection step={2} title="Pricing & adjustments" hint="Anything applied on top of the line items — status, currency, VAT, discount, delivery.">
            <div className="grid gap-4 sm:grid-cols-2">{pricingFields}</div>
          </FormSection>
        )}

        {sectioned ? (
          <FormSection step={3} title="Line items" hint="Each row prints as one line on the PDF. Amount = rate × quantity.">
            {lineItemsBlock}
          </FormSection>
        ) : (
          <Field label="Line items">
            <div className="flex flex-col gap-2">
              {lineItemsBlock}
              <InvoiceTotalsPreview lines={f.lines} taxApplicable={f.taxApplicable} taxRate={f.taxRate} discountRate={f.discountRate} shippingFee={f.shippingFee} currency={f.currency} />
            </div>
          </Field>
        )}

        {!sectioned && <Field label="PDF template"><TemplatePicker value={f.templateStyle} onChange={(v) => setF({ ...f, templateStyle: v })} /></Field>}

        {sectioned ? (
          <FormSection step={4} title="Payment instructions" hint="Printed on the invoice so the client knows where to send the money.">
            <PaymentDetailsFields value={f.pay} onChange={(pay) => setF({ ...f, pay })} />
          </FormSection>
        ) : (
          <Field label="Payment instructions (printed on invoice)"><PaymentDetailsFields value={f.pay} onChange={(pay) => setF({ ...f, pay })} /></Field>
        )}

        {sectioned ? (
          <FormSection step={5} title="Notes & terms">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms, references…" /></Field>
              <Field label="Terms & conditions"><Textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="Payment is due within 15 days…" /></Field>
            </div>
          </FormSection>
        ) : (
          <>
            <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment terms, references…" /></Field>
            <Field label="Terms & conditions"><Textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="Payment is due within 15 days…" /></Field>
          </>
        )}
      </div>

      {sectioned && (
        <aside className="flex flex-col gap-4 xl:sticky xl:top-1">
          <section className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent">
            <div className="px-4 pt-4">
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-primary/80">Invoice total</p>
              <p className="mt-1 font-heading text-stat-lg font-bold leading-none tabular-nums">{formatBDT(totals.grand)}</p>
              <p className="mt-1.5 text-meta text-muted-foreground">{filledLines} line item{filledLines === 1 ? "" : "s"} · {f.currency} · {label(f.status)}</p>
            </div>
            <div className="px-4 pb-4 pt-3">
              <InvoiceTotalsPreview lines={f.lines} taxApplicable={f.taxApplicable} taxRate={f.taxRate} discountRate={f.discountRate} shippingFee={f.shippingFee} currency={f.currency} />
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card">
            <header className="border-b border-border/50 bg-muted/20 px-4 py-2">
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-muted-foreground">Snapshot</p>
            </header>
            <div className="flex flex-col gap-2 px-4 py-3 text-meta">
              <div className="flex items-baseline justify-between gap-3"><span className="shrink-0 text-muted-foreground">Client</span><span className={cn("min-w-0 truncate text-right font-medium", !clientName && "text-muted-foreground/70")}>{clientName ?? "Not selected"}</span></div>
              <div className="flex items-baseline justify-between gap-3"><span className="shrink-0 text-muted-foreground">Project</span><span className={cn("min-w-0 truncate text-right font-medium", !selectedProject && "text-muted-foreground/70")}>{selectedProject?.name ?? "No project"}</span></div>
              <div className="flex items-baseline justify-between gap-3"><span className="shrink-0 text-muted-foreground">Issue</span><span className="text-right font-medium tabular-nums">{f.issueDate ? formatDate(f.issueDate) : "—"}</span></div>
              <div className="flex items-baseline justify-between gap-3"><span className="shrink-0 text-muted-foreground">Due</span><span className="text-right font-medium tabular-nums">{f.dueDate ? formatDate(f.dueDate) : "—"}</span></div>
              <div className="flex items-baseline justify-between gap-3"><span className="shrink-0 text-muted-foreground">Status</span><span className="text-right font-medium">{label(f.status)}</span></div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4">
            <p className="mb-2 text-micro font-bold uppercase tracking-[0.14em] text-muted-foreground">PDF template</p>
            <TemplatePicker value={f.templateStyle} onChange={(v) => setF({ ...f, templateStyle: v })} compact />
          </section>
        </aside>
      )}
    </div>
  );
}

function formPayload(f: InvoiceFormState) {
  return {
    invoiceNumber: f.invoiceNumber.trim() || undefined,
    clientId: f.clientId,
    projectId: f.projectId || undefined,
    issueDate: f.issueDate || undefined,
    dueDate: f.dueDate || undefined,
    status: f.status,
    invoiceType: f.invoiceType,
    taxApplicable: f.taxApplicable,
    taxRate: f.taxApplicable ? Number(f.taxRate) || 0 : 0,
    discountRate: Number(f.discountRate) || 0,
    shippingFee: Number(f.shippingFee) || 0,
    templateStyle: f.templateStyle,
    currency: f.currency,
    exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined,
    notes: f.notes.trim() || undefined,
    terms: f.terms.trim() || undefined,
    paymentDetails: cleanPay(f.pay),
    lines: f.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), unitPrice: Number(l.unitPrice) || 0, quantity: Number(l.quantity) || 1 })),
  };
}

export function InvoiceFormModal({ open, onClose, clients, projects, onSaved, initial }: { open: boolean; onClose: () => void; clients: any[]; projects: any[]; onSaved: () => void; initial?: { clientId?: string; projectId?: string; amount?: number; description?: string } | null }) {
  const { branding } = useBranding();
  const [f, setF] = useState<InvoiceFormState>(blankForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const blank = blankForm();
    blank.notes = branding?.defaultNotes ?? "";
    blank.terms = branding?.defaultTerms ?? "";
    blank.pay = payFrom(branding?.defaultPaymentDetails);
    if (branding?.defaultCurrency) blank.currency = branding.defaultCurrency;
    if (initial?.clientId) blank.clientId = initial.clientId;
    if (initial?.projectId) blank.projectId = initial.projectId;
    if (initial?.amount != null && initial.amount > 0) {
      blank.lines = [{ description: initial.description ?? "Project balance", unitPrice: String(initial.amount), quantity: "1" }];
    }
    setF(blank);
    apiFetch<{ invoiceNumber: string }>("/capital/invoices/next-number")
      .then((r) => r?.invoiceNumber && setF((prev) => ({ ...prev, invoiceNumber: prev.invoiceNumber || r.invoiceNumber })))
      .catch(() => {});
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.clientId) return setErr("Client is required");
    if (!f.lines.some((l) => l.description.trim())) return setErr("Add at least one line item");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/invoices", { method: "POST", body: JSON.stringify(formPayload(f)) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Accounts receivable"
      icon={<ReceiptText className="size-4" />}
      title="New invoice"
      subtitle="Bill a client — schedule, line items, tax and payment instructions in one pass."
      size="3xl"
      footer={
        <FormActions
          formId="new-invoice-form"
          busy={busy}
          cancel={onClose}
          submitLabel="Create invoice"
          hint="* required · totals update live as you type"
        />
      }
    >
      <form id="new-invoice-form" onSubmit={save} className="flex flex-col gap-4">
        <InvoiceFormBody f={f} setF={setF} clients={clients} projects={projects} showNumber sectioned />
        {err && (
          <p className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-body font-medium text-rose-600 dark:text-rose-300">
            <AlertCircle className="size-3.5 shrink-0" /> {err}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function EditInvoiceModal({ invoice, onClose, clients, projects, onSaved }: { invoice: any; onClose: () => void; clients: any[]; projects: any[]; onSaved: () => void }) {
  const { branding } = useBranding();
  const [f, setF] = useState<InvoiceFormState>(blankForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) return;
    const blank = blankForm();
    setF({
      ...blank,
      clientId: invoice.clientId ?? "",
      projectId: invoice.projectId ?? "",
      issueDate: (invoice.issueDate ?? "").slice(0, 10),
      dueDate: (invoice.dueDate ?? "").slice(0, 10),
      status: invoice.status ?? "DRAFT",
      invoiceType: invoice.invoiceType ?? "ONE_TIME",
      taxApplicable: invoice.taxApplicable ?? Number(invoice.taxRate) > 0,
      taxRate: String(Number(invoice.taxRate) || 0),
      discountRate: String(Number(invoice.discountRate) || 0),
      shippingFee: String(Number(invoice.shippingFee) || 0),
      currency: invoice.currency ?? "BDT",
      notes: invoice.notes ?? "",
      terms: invoice.terms ?? "",
      templateStyle: invoice.templateStyle ?? "modern-orange",
      pay: payFrom(invoice.paymentDetails ?? branding?.defaultPaymentDetails),
      lines: (invoice.lineItems ?? []).map((l: any) => ({ description: l.description, unitPrice: String(l.unitPrice), quantity: String(l.quantity) })),
    });
  }, [invoice]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.clientId) return setErr("Client is required");
    if (!f.lines.some((l) => l.description.trim())) return setErr("Add at least one line item");
    setBusy(true);
    setErr(null);
    try {
      const { invoiceNumber: _drop, ...payload } = formPayload(f);
      await apiFetch(`/capital/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!invoice} onClose={onClose} title={`Edit invoice — ${invoice?.invoiceNumber ?? ""}`} size="xl">
      <form onSubmit={save} className="flex flex-col gap-4">
        <InvoiceFormBody f={f} setF={setF} clients={clients} projects={projects} showNumber={false} />
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save changes" />
      </form>
    </Modal>
  );
}



export function CreditNoteModal({ invoice, open, onClose, onSaved }: { invoice: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = invoiceTotals({
    lineItems: invoice?.lineItems,
    taxApplicable: invoice?.taxApplicable,
    taxRate: invoice?.taxRate,
    discountRate: invoice?.discountRate,
    shippingFee: invoice?.shippingFee,
    payments: invoice?.payments,
    creditNotes: invoice?.creditNotes,
  });
  const collected = t.paid;
  const outstanding = t.balance;
  // The ceiling depends on the document: you cannot refund more than was
  // collected, and a credit note/write-off cannot exceed what is still owed.
  const maxFor = (type: string) => (type === "REFUND" ? collected : outstanding);
  const defaultAmount = (type: string) => String(Math.max(0, maxFor(type)));
  const [f, setF] = useState({ type: "CREDIT_NOTE", amount: defaultAmount("CREDIT_NOTE"), reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ type: "CREDIT_NOTE", amount: defaultAmount("CREDIT_NOTE"), reason: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) return setErr("Amount is required");
    const max = maxFor(f.type);
    if (Number(f.amount) > max + 0.001) {
      return setErr(
        f.type === "REFUND"
          ? `Cannot refund more than collected ${formatBDT(collected)}`
          : `Cannot exceed the outstanding ${formatBDT(outstanding)}`
      );
    }
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
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-meta">
          <span className="text-muted-foreground">Total</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(t.grand)}</span>
          <span className="text-muted-foreground">Collected</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(collected)}</span>
          <span className="text-muted-foreground">Outstanding</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(outstanding)}</span>
        </div>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, amount: defaultAmount(e.target.value) })}><option value="CREDIT_NOTE">Credit note (client balance)</option><option value="REFUND">Refund (money back)</option><option value="WRITE_OFF">Write-off (bad debt)</option></Select></Field>
        <Field label="Amount *" hint={f.type === "REFUND" ? `max ${formatBDT(collected)} collected` : `max ${formatBDT(outstanding)} outstanding`}><Input type="number" min={0} max={maxFor(f.type)} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Discount, service dispute, client credit…" /></Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={`Create ${label(f.type)}`} />
      </form>
    </Modal>
  );
}

export function InstallmentModal({ invoice, open, onClose, onSaved }: { invoice: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const planGrand = invoiceTotals({
    lineItems: invoice?.lineItems,
    taxApplicable: invoice?.taxApplicable,
    taxRate: invoice?.taxRate,
    discountRate: invoice?.discountRate,
    shippingFee: invoice?.shippingFee,
    payments: [],
  }).grand;
  const total = (invoice?.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const tax = invoice?.taxApplicable ? (total * (Number(invoice.taxRate) || 0)) / 100 : 0;
  const grand = planGrand;
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
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-meta">
          <span className="text-muted-foreground">Invoice total</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(grand)}</span>
        </div>
        {hasPayments ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-600 dark:text-amber-400">Payments already exist against this plan — amounts and dates are locked. Use credit notes for adjustments.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-meta font-bold uppercase tracking-wider text-muted-foreground">Quick plans (amounts auto-split, monthly dues)</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: "50 / 50", parts: [50, 50] },
                  { name: "50 / 30 / 20", parts: [50, 30, 20] },
                  { name: "30 / 40 / 30", parts: [30, 40, 30] },
                  { name: "25 × 4", parts: [25, 25, 25, 25] },
                ].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      const base = new Date(today());
                      let assigned = 0;
                      const built = p.parts.map((pct, i) => {
                        const due = new Date(base);
                        due.setMonth(due.getMonth() + i);
                        const amt = i === p.parts.length - 1
                          ? Math.round((grand - assigned) * 100) / 100
                          : Math.round(((grand * pct) / 100) * 100) / 100;
                        assigned += amt;
                        return { amount: String(amt), dueDate: due.toISOString().slice(0, 10) };
                      });
                      setRows(built);
                      setCustom(true);
                    }}
                    className="rounded-full border border-border/60 px-2.5 py-1 text-meta font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="size-4 rounded accent-primary" />
              Custom amounts & dates
            </label>
            {!custom ? (
              <>
                <Field label="Number of installments *"><Select value={count} onChange={(e) => setCount(e.target.value)}>{[2, 3, 4, 6, 12].map((n) => <option key={n} value={String(n)}>{n} payments × {formatBDT(Math.round((grand / n) * 100) / 100)}</option>)}</Select></Field>
                <Field label="First installment due"><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
                <p className="text-meta leading-relaxed text-muted-foreground">Subsequent installments fall on the same day each following month.</p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_1fr_32px] items-center gap-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Amount</span><span>Due date</span><span />
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                    <Input type="number" min={0} value={r.amount} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} placeholder="60000" />
                    <Input type="date" value={r.dueDate} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, dueDate: e.target.value } : x)))} />
                    <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="size-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, { amount: "", dueDate: "" }])} className="flex items-center gap-1 text-meta font-bold text-primary transition-colors hover:text-primary"><Plus className="size-3.5" /> Add installment</button>
              </div>
            )}
          </>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={hasPayments ? "Close" : "Save plan"} />
      </form>
    </Modal>
  );
}

export function PaymentModal({ invoice, open, bankAccounts, onClose, onSaved }: { invoice: any; open: boolean; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
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
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-meta">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(balance)}</span>
        </div>
        <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-meta font-semibold text-muted-foreground">Method</span><MethodPicker value={f.method} onChange={(v) => setF(withMethod(f, bankAccounts, v))} /></div>
        <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{methodAccounts(bankAccounts, f.method).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
        <Field label="Payment date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {(invoice?.installments ?? []).length > 0 && (
          <Field label="Installment"><Select value={f.installmentId} onChange={(e) => setF({ ...f, installmentId: e.target.value })}><option value="">Auto (next due)</option>{(invoice.installments ?? []).map((s: any) => <option key={s.id} value={s.id}>#{s.sequence} — {formatBDT(s.amount)} ({s.status.toLowerCase()})</option>)}</Select></Field>
        )}
        <Field label="Reference (optional)"><Input value={f.referenceId} onChange={(e) => setF({ ...f, referenceId: e.target.value })} placeholder="Client ref / bank slip no" /></Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record payment" />
      </form>
    </Modal>
  );
}

function FormBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/[0.15] p-3.5">
      <p className="text-meta font-semibold">{title}</p>
      {hint && <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

const DEPARTMENTS = ["Accounts", "Creative", "Production", "Media", "Strategy", "Admin", "Tech", "Other"];
const RECURRENCE = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

export function ExpenseModal({ open, onClose, onSaved, bankAccounts, categories, vendors, clients, projects }: { open: boolean; onClose: () => void; onSaved: () => void; bankAccounts: any[]; categories: any[]; vendors: any[]; clients: any[]; projects: any[] }) {
  const { user } = useAuth();
  const canDirect = ["Owner", "Finance", "Admin", "HR/Admin", "CONTROL"].includes(user?.role ?? "");
  const blank = () => ({
    scope: "PROJECT",
    clientId: "",
    projectId: "",
    description: "",
    amount: "",
    category: (categories?.[0]?.key ?? "AD_SPEND") as string,
    subcategory: "",
    date: today(),
    method: "CASH",
    bankAccountId: bankAccounts[0]?.id ?? "",
    receiptUrl: "",
    vendorId: "",
    isPayable: false,
    dueDate: "",
    currency: "BDT",
    exchangeRate: "",
    vendorBillNumber: "",
    vendorBillDate: "",
    notes: "",
    department: "Accounts",
    markupPct: "",
    billable: true,
    isRecurring: false,
    recurrenceSchedule: "MONTHLY",
  });
  const [f, setF] = useState<any>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cats = categories ?? [];
  const currentCat = cats.find((c: any) => c.key === f.category);
  const subs: string[] = currentCat?.subcategories ?? [];
  const projectsFor = (clientId: string) =>
    clientId ? (projects ?? []).filter((p: any) => p.clientId === clientId) : (projects ?? []);

  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onScopeChange = (scope: string) => {
    setF({
      ...f,
      scope,
      clientId: scope === "COMPANY" ? "" : f.clientId,
      projectId: scope === "COMPANY" ? "" : f.projectId,
      billable: scope === "COMPANY" ? false : f.billable,
    });
  };
  const onClientChange = (clientId: string) => {
    const keep = f.projectId && projectsFor(clientId).some((p: any) => p.id === f.projectId);
    setF({ ...f, clientId, projectId: keep ? f.projectId : "" });
  };
  const onProjectChange = (projectId: string) => {
    const proj = (projects ?? []).find((p: any) => p.id === projectId);
    setF({ ...f, projectId, clientId: proj && (!f.clientId || f.clientId !== proj.clientId) ? proj.clientId : f.clientId });
  };

  const amount = Number(f.amount) || 0;
  const markUp = f.scope === "PROJECT" && f.billable ? Number(f.markupPct) || 0 : 0;
  const recharge = amount * (1 + markUp / 100);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    if (f.scope === "PROJECT" && !f.projectId) return setErr("Select the project this expense belongs to");
    if (f.isPayable && !f.vendorId) return setErr("Select a vendor for payable expenses");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    if (f.billable && (markUp < 0 || markUp > 100)) return setErr("Markup must be between 0 and 100%");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: f.description.trim(),
          amount,
          category: f.category,
          subcategory: f.subcategory || undefined,
          date: f.date || undefined,
          paymentMethod: f.method,
          isClientBillable: f.scope === "PROJECT" && f.billable,
          markupPct: f.scope === "PROJECT" && f.billable ? markUp : 0,
          clientId: f.scope === "PROJECT" ? f.clientId || undefined : undefined,
          projectId: f.scope === "PROJECT" ? f.projectId || undefined : undefined,
          bankAccountId: f.bankAccountId || undefined,
          receiptUrl: f.receiptUrl.trim() || undefined,
          vendorId: f.vendorId || undefined,
          vendorBillNumber: f.vendorBillNumber.trim() || undefined,
          vendorBillDate: f.vendorBillDate || undefined,
          isPayable: f.isPayable,
          dueDate: f.dueDate || undefined,
          currency: f.currency,
          exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined,
          notes: f.notes.trim() || undefined,
          department: f.scope === "COMPANY" ? f.department : undefined,
          isRecurring: f.isRecurring,
          recurrenceSchedule: f.isRecurring ? f.recurrenceSchedule : undefined,
          approvalStatus: canDirect ? "APPROVED" : "PENDING",
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
    <Modal open={open} onClose={onClose} title="Record expense" size="lg">
      <form onSubmit={save} className="flex flex-col gap-3">
        <FormBlock title="What is it?" hint="Project spend is costed to the client; company overhead stays internal.">
          <Segmented options={[{ value: "PROJECT", label: "Project expense" }, { value: "COMPANY", label: "Company overhead" }]} value={f.scope} onChange={onScopeChange} />
          {f.scope === "PROJECT" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Client *"><Select value={f.clientId} onChange={(e) => onClientChange(e.target.value)}><option value="">Select client…</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select></Field>
              <Field label="Project *">
                <Select value={f.projectId} onChange={(e) => onProjectChange(e.target.value)} disabled={!f.clientId}>
                  <option value="">{f.clientId ? "Select project…" : "Select a client first"}</option>
                  {projectsFor(f.clientId).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                {f.clientId && projectsFor(f.clientId).length === 0 && (
                  <p className="mt-1 text-meta text-muted-foreground">No projects under this client yet — create one in Flow.</p>
                )}
              </Field>
            </div>
          ) : (
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-meta text-muted-foreground">
              Salary, rent, software, utilities — not charged to a client. Use the department field to attribute it.
            </p>
          )}
          <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Google Ads — June campaign, DOP day rate…" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Amount *"><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="12000" /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, subcategory: "" })}>{(cats.length ? cats : [{ key: "MISC", name: "MISC" }]).map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
            <Field label="Subcategory"><Select value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })}><option value="">—</option>{subs.map((s: string) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Expense date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
        </FormBlock>

        <FormBlock title="Vendor & bill" hint="The bill details are what an auditor or AP review looks for first.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Vendor"><Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}><option value="">No vendor</option>{(vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
            <Field label="Vendor bill no."><Input value={f.vendorBillNumber} onChange={(e) => setF({ ...f, vendorBillNumber: e.target.value })} placeholder="INV-2043" /></Field>
            <Field label="Bill date"><Input type="date" value={f.vendorBillDate} onChange={(e) => setF({ ...f, vendorBillDate: e.target.value })} /></Field>
            <div className="flex flex-col gap-1.5"><span className="text-meta font-semibold text-muted-foreground">Payment method</span><MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} /></div>
            <Field label="Paid from"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">Default account</option>{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
            <Field label="Receipt URL"><Input value={f.receiptUrl} onChange={(e) => setF({ ...f, receiptUrl: e.target.value })} placeholder="https://…" /></Field>
          </div>
        </FormBlock>

        <FormBlock title="Recharge, approval & schedule" hint="Agency rules that change how the cost is recovered and approved.">
          {f.scope === "PROJECT" && (
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
                <input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} className="size-4 rounded accent-primary" />
                Client billable (recharge the client)
              </label>
              {f.billable && (
                <div className="mt-2 grid grid-cols-2 items-end gap-3">
                  <Field label="Markup %" hint="Pass-through cost + markup = client recharge">
                    <Input type="number" min={0} max={100} step="0.5" value={f.markupPct} onChange={(e) => setF({ ...f, markupPct: e.target.value })} placeholder="15" />
                  </Field>
                  <p className="rounded-lg bg-emerald-500/10 px-2.5 py-2 text-meta font-semibold text-emerald-600 dark:text-emerald-400">
                    Recharge {formatBDT(recharge)}{markUp > 0 ? ` · margin ${formatBDT(recharge - amount)}` : ""}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col justify-end gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
                <input type="checkbox" checked={f.isPayable} onChange={(e) => setF({ ...f, isPayable: e.target.checked })} className="size-4 rounded accent-amber-500" />
                Unpaid (accounts payable)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
                <input type="checkbox" checked={f.isRecurring} onChange={(e) => setF({ ...f, isRecurring: e.target.checked })} className="size-4 rounded accent-sky-500" />
                Recurring expense
              </label>
            </div>
            {f.isPayable ? (
              <Field label="Payable due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
            ) : (
              <div className="flex items-end text-micro text-muted-foreground">Paid now — bank balance is reduced immediately.</div>
            )}
            {f.isRecurring ? (
              <Field label="Repeats"><Select value={f.recurrenceSchedule} onChange={(e) => setF({ ...f, recurrenceSchedule: e.target.value })}>{RECURRENCE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
            ) : f.scope === "COMPANY" ? (
              <Field label="Department"><Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            ) : null}
            <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
            {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
          </div>
        </FormBlock>

        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was bought, who approved it, any context for the audit trail…" /></Field>

        {canDirect ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-meta text-emerald-600 dark:text-emerald-400">
            Posts to {f.bankAccountId ? "the selected account" : "the default account"} &amp; ledger immediately{f.isPayable ? " as an unpaid bill" : ""}.
          </p>
        ) : (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-600 dark:text-amber-400">
            Goes to admin for approval first — accounts update on approval.
          </p>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record expense" />
      </form>
    </Modal>
  );
}

export function EditExpenseModal({ expense, onClose, onSaved, categories }: { expense: any; onClose: () => void; onSaved: () => void; categories: any[] }) {
  const [f, setF] = useState({ description: "", amount: "", category: "MISC", date: today(), method: "CASH", notes: "", vendorBillNumber: "", vendorBillDate: "", department: "", markupPct: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setErr(null);
    setF({
      description: expense.description ?? "",
      amount: expense.amount != null ? String(expense.amount) : "",
      category: expense.category ?? "MISC",
      date: String(expense.date ?? "").slice(0, 10),
      method: expense.paymentMethod ?? "CASH",
      notes: expense.notes ?? "",
      vendorBillNumber: expense.vendorBillNumber ?? "",
      vendorBillDate: expense.vendorBillDate ? String(expense.vendorBillDate).slice(0, 10) : "",
      department: expense.department ?? "",
      markupPct: expense.markupPct != null ? String(expense.markupPct) : "",
    });
  }, [expense]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/expenses/${expense.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: f.description.trim(),
          amount: Number(f.amount),
          category: f.category,
          date: f.date || undefined,
          paymentMethod: f.method,
          notes: f.notes || undefined,
          vendorBillNumber: f.vendorBillNumber || undefined,
          vendorBillDate: f.vendorBillDate || undefined,
          department: f.department || undefined,
          markupPct: f.markupPct !== "" ? Number(f.markupPct) : undefined,
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
    <Modal open={!!expense} onClose={onClose} title={`Edit expense`} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        {expense?.payrollRecordId && (
          <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-meta text-sky-600 dark:text-sky-300">
            Posted from payroll — saving here syncs the linked payroll record, ledger and bank automatically.
          </p>
        )}
        <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount *"><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(categories?.length ? categories : [{ key: "MISC", name: "Misc" }]).map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-meta font-semibold text-muted-foreground">Method</span><MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} /></div>
          <Field label="Vendor bill no."><Input value={f.vendorBillNumber} onChange={(e) => setF({ ...f, vendorBillNumber: e.target.value })} placeholder="INV-2043" /></Field>
          <Field label="Bill date"><Input type="date" value={f.vendorBillDate} onChange={(e) => setF({ ...f, vendorBillDate: e.target.value })} /></Field>
          <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Accounts / Creative…" /></Field>
          <Field label="Markup % (billable)"><Input type="number" min={0} max={100} step="0.5" value={f.markupPct} onChange={(e) => setF({ ...f, markupPct: e.target.value })} placeholder="15" /></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Internal context for this expense…" /></Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save changes" />
      </form>
    </Modal>
  );
}

export function VendorModal({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
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
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add vendor"} />
      </form>
    </Modal>
  );
}

/**
 * Shared confirmation sheet for destructive/side-effectful actions.
 * `submitLabel` lets callers name the verb ("Archive", "Revoke") instead of
 * always showing "Delete" — Tasks reuses this for archive/bulk actions.
 */
export function ConfirmModal({ open, onClose, title, message, busy, onConfirm, submitLabel = "Delete" }: { open: boolean; onClose: () => void; title: string; message: string; busy: boolean; onConfirm: () => void; submitLabel?: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(); }} className="flex flex-col gap-4">
        <p className="text-body leading-relaxed text-muted-foreground">{message}</p>
        <FormActions busy={busy} cancel={onClose} submitLabel={submitLabel} danger />
      </form>
    </Modal>
  );
}

export function PayExpenseModal({ expense, open, bankAccounts, onClose, onSaved }: { expense: any; open: boolean; bankAccounts: any[]; onClose: () => void; onSaved: () => void }) {
  const due = Math.max(0, Number(expense?.amount ?? 0) - Number(expense?.paidAmount ?? 0));
  const [f, setF] = useState({ amount: String(due), method: "CASH", date: today(), bankAccountId: "", taxWithheld: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF({ amount: String(due), method: "CASH", date: today(), bankAccountId: bankAccounts[0]?.id ?? "", taxWithheld: "" });
  }, [open, expense]);

  const tax = Math.min(Number(f.taxWithheld) || 0, Number(f.amount) || 0);
  const net = Math.max((Number(f.amount) || 0) - tax, 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.amount || Number(f.amount) <= 0) return setErr("Amount is required");
    if (Number(f.amount) > due) return setErr(`Cannot exceed outstanding ${formatBDT(due)}`);
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/capital/expenses/${expense.id}/payment`, { method: "POST", body: JSON.stringify({ amount: Number(f.amount), paymentMethod: f.method, paymentDate: f.date || undefined, bankAccountId: f.bankAccountId || undefined, taxWithheld: tax }) });
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
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-meta">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="text-right font-bold tabular-nums">{formatBDT(due)}</span>
        </div>
        <Field label="Amount *"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 items-end gap-4">
          <Field label="TDS / VDS withheld" hint="Vendor receives amount − tax"><Input type="number" min={0} step="0.01" value={f.taxWithheld} onChange={(e) => setF({ ...f, taxWithheld: e.target.value })} placeholder="0" /></Field>
          <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-meta font-semibold">Net cash out {formatBDT(net)}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-meta font-semibold text-muted-foreground">Method</span><MethodPicker value={f.method} onChange={(v) => setF(withMethod(f, bankAccounts, v))} /></div>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">No account</option>{methodAccounts(bankAccounts, f.method).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
        </div>
        <Field label="Payment date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record payment" />
      </form>
    </Modal>
  );
}

export function CategoriesModal({ open, categories, accounts, onClose, onSaved }: { open: boolean; categories: any[]; accounts: any[]; onClose: () => void; onSaved: () => void }) {
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
          <p className="text-meta font-bold uppercase tracking-wider text-muted-foreground">{editing ? `Edit ${editing.name}` : "New category"}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Insurance" /></Field>
            <Field label="Key (slug, e.g. INSURANCE)"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} disabled={!!editing} placeholder="INSURANCE" /></Field>
          </div>
          <Field label="Subcategories (comma-separated)"><Input value={f.subcategories} onChange={(e) => setF({ ...f, subcategories: e.target.value })} placeholder="Fire, Health, Vehicle" /></Field>
          <div className="flex items-center gap-3">
            <Field label="GL account"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">No account</option>{(accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}</Select></Field>
            {editing && (
              <label className="flex cursor-pointer items-center gap-2 pt-4 text-body font-medium">
                <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 rounded accent-primary" />
                Active
              </label>
            )}
          </div>
          {err && <p className="text-body font-medium text-rose-400">{err}</p>}
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
                  <Td className="font-mono text-meta text-muted-foreground">{c.key}</Td>
                  <Td className="text-meta text-muted-foreground">{(c.subcategories ?? []).slice(0, 3).join(", ")}{(c.subcategories ?? []).length > 3 ? ` +${c.subcategories.length - 3}` : ""}</Td>
                  <Td className="text-meta">{c.account ? `${c.account.code} — ${c.account.name}` : "—"}</Td>
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

const INCOME_CATEGORIES = [
  { value: "PROJECT_PAYMENT", label: "Project payment" },
  { value: "RETAINER", label: "Retainer" },
  { value: "CONSULTING", label: "Consulting / strategy" },
  { value: "WORKSHOP", label: "Workshop / training" },
  { value: "COMMISSION", label: "Commission" },
  { value: "REFERRAL", label: "Referral fee" },
  { value: "REIMBURSEMENT", label: "Reimbursement" },
  { value: "INTEREST", label: "Bank interest" },
  { value: "FX_GAIN", label: "FX / dollar gain" },
  { value: "OTHER_INCOME", label: "Other income" },
];

export function AddIncomeModal({ open, bankAccounts, clients, projects, onClose, onSaved }: { open: boolean; bankAccounts: any[]; clients: any[]; projects: any[]; onClose: () => void; onSaved: () => void }) {
  const blank = () => ({
    description: "",
    amount: "",
    category: "OTHER_INCOME",
    date: today(),
    method: "CASH",
    bankAccountId: bankAccounts[0]?.id ?? "",
    referenceId: "",
    currency: "BDT",
    exchangeRate: "",
    clientId: "",
    projectId: "",
    taxWithheld: "",
    notes: "",
    attachmentUrl: "",
  });
  const [f, setF] = useState<any>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const projectsFor = (clientId: string) =>
    clientId ? (projects ?? []).filter((p: any) => p.clientId === clientId) : (projects ?? []);

  const gross = Number(f.amount) || 0;
  const tax = Math.min(Number(f.taxWithheld) || 0, Math.max(gross - 0.01, 0));
  const net = Math.max(gross - tax, 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount || Number(f.amount) <= 0) return setErr("Description and amount are required");
    if (Number(f.taxWithheld) < 0) return setErr("Tax withheld cannot be negative");
    if (Number(f.taxWithheld) >= Number(f.amount)) return setErr("Tax withheld must be less than the gross amount");
    if (f.currency !== "BDT" && !f.exchangeRate) return setErr("Exchange rate required for foreign currency");
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/income", {
        method: "POST",
        body: JSON.stringify({
          description: f.description.trim(),
          amount: gross,
          category: f.category,
          date: f.date || undefined,
          paymentMethod: f.method,
          bankAccountId: f.bankAccountId || undefined,
          referenceId: f.referenceId.trim() || undefined,
          currency: f.currency,
          exchangeRate: f.currency === "BDT" ? 1 : Number(f.exchangeRate) || undefined,
          clientId: f.clientId || undefined,
          projectId: f.projectId || undefined,
          taxWithheld: Number(f.taxWithheld) || 0,
          notes: f.notes.trim() || undefined,
          attachmentUrl: f.attachmentUrl.trim() || undefined,
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
    <Modal open={open} onClose={onClose} title="Record income (manual)" size="lg">
      <form onSubmit={save} className="flex flex-col gap-3">
        <FormBlock title="What came in?" hint="For money received without an invoice — retainers, workshops, FX gains, reimbursements.">
          <Field label="Description *"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Brand workshop fee, bank interest, referral commission…" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Gross amount *"><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="5000" /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{INCOME_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
            <Field label="Tax withheld (TDS)" hint="Client deducted this before paying"><Input type="number" min={0} step="0.01" value={f.taxWithheld} onChange={(e) => setF({ ...f, taxWithheld: e.target.value })} placeholder="0" /></Field>
            <div className="flex flex-col justify-end">
              <p className="rounded-lg bg-emerald-500/10 px-2.5 py-2 text-meta font-semibold text-emerald-600 dark:text-emerald-400">
                Net received {formatBDT(net)}
              </p>
            </div>
          </div>
        </FormBlock>

        <FormBlock title="Who is it from?" hint="Optional — linking makes client profitability and the income table accurate.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, projectId: "" })}><option value="">No client</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select></Field>
            <Field label="Project">
              <Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} disabled={!f.clientId}>
                <option value="">{f.clientId ? "No project" : "Select a client first"}</option>
                {projectsFor(f.clientId).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {f.clientId && projectsFor(f.clientId).length === 0 && (
                <p className="mt-1 text-meta text-muted-foreground">No projects under this client yet — create one in Flow.</p>
              )}
            </Field>
          </div>
        </FormBlock>

        <FormBlock title="How was it received?">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-meta font-semibold text-muted-foreground">Method</span><MethodPicker value={f.method} onChange={(v) => setF(withMethod(f, bankAccounts, v))} /></div>
            <Field label="Received into"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">Default account</option>{methodAccounts(bankAccounts, f.method).map((b: any) => <option key={b.id} value={b.id}>{b.accountName} ({label(b.accountType)})</option>)}</Select></Field>
            <Field label="Reference"><Input value={f.referenceId} onChange={(e) => setF({ ...f, referenceId: e.target.value })} placeholder="Txn / cheque no." /></Field>
            <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option></Select></Field>
            {f.currency !== "BDT" && <Field label={`Rate (1 ${f.currency} → BDT) *`}><Input type="number" min={0} step="0.01" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} placeholder="e.g. 120" /></Field>}
          </div>
        </FormBlock>

        <FormBlock title="Backup">
          <Field label="Attachment URL"><Input value={f.attachmentUrl} onChange={(e) => setF({ ...f, attachmentUrl: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Any context for the audit trail…" /></Field>
        </FormBlock>

        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Record income" />
      </form>
    </Modal>
  );
}

export function BudgetModal({ open, onClose, onSaved, editing, projects, categories }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null; projects: any[]; categories: any[] }) {
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
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create budget"} />
      </form>
    </Modal>
  );
}

export function ReconcileModal({ open, bankAccounts, txns, onClose, onSaved }: { open: boolean; bankAccounts: any[]; txns: any[]; onClose: () => void; onSaved: () => void }) {
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
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Save entry" />
      </form>
    </Modal>
  );
}

export function AccountModal({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
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
          <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 rounded accent-primary" />
            Active (usable for new entries)
          </label>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add account"} />
      </form>
    </Modal>
  );
}

