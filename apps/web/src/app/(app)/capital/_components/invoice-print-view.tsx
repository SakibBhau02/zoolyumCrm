"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatDate } from "@/lib/format";
import { numberToWords } from "@/lib/invoice-utils";
import { API_URL } from "@/lib/api";
import { invoicePaymentLines, pickPaymentDetails } from "@/lib/payment-meta";

const brandingImg = (url: string | null | undefined) => {
  if (!url) return null;
  if (url.startsWith("/api/")) return `${API_URL}${url.slice(4)}`;
  return url;
};

/** Same currency symbols the PDF uses, so screen and download never disagree. */
function currencySymbol(code?: string | null): string {
  switch ((code ?? "BDT").toUpperCase()) {
    case "BDT": return "৳";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "INR": return "₹";
    default: return code ?? "৳";
  }
}

/** Full, grouped amount — a formal invoice must never print "৳1.2L". */
function money(v: unknown, sym: string): string {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : 0;
  return `${sym} ${safe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Date-only values arrive as UTC midnight — print the calendar date, not a shifted one. */
function docDate(d: string | null | undefined): string {
  if (!d) return "-";
  const iso = String(d).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, day] = iso.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  return formatDate(d);
}

/**
 * Print-optimized A4 invoice sheet (screen preview + window.print()).
 * Mirrors the PDF: header, client + payment instructions, items, totals,
 * project statement, in-words, terms/notes, QR, signature and footer.
 *
 * Every money column shares one right edge and the table uses a fixed layout,
 * so the sheet does not re-flow when printed from a different screen width.
 */
export function InvoicePrintView({
  detail,
  totals,
  projBalance,
  branding,
  shareUrl,
}: {
  detail: any;
  totals: { subtotal: number; tax: number; discount: number; shipping: number; grand: number; paid: number; balance: number };
  projBalance: any | null;
  branding: any;
  shareUrl?: string | null;
}) {
  const appName = branding?.appName?.trim() || "Zoolyum";
  const addrLine = [branding?.address, branding?.city, branding?.country].filter(Boolean).join(", ");
  const logoUrl = brandingImg(branding?.logoDarkUrl);
  const sigUrl = brandingImg(branding?.signatureImageUrl);
  const showStatement = projBalance?.project && !projBalance?.reason;
  const sym = currencySymbol(detail.currency);
  const pay = pickPaymentDetails(detail.paymentDetails, branding?.defaultPaymentDetails);
  // Plain-text payment lines: managed accounts plus the legacy default when it
  // is not already covered. Wallets sharing a number print on one line.
  const paymentLines = invoicePaymentLines(detail.paymentAccounts, pay);
  const terms = detail.terms || branding?.defaultTerms;
  const notes = detail.notes || branding?.defaultNotes;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!shareUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(shareUrl, { width: 200, margin: 1 })
      .then((u) => !cancelled && setQrDataUrl(u))
      .catch(() => !cancelled && setQrDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  return (
    <div
      className="invoice-print-area mx-auto w-full max-w-[190mm] bg-white px-8 py-6 text-[11px] leading-relaxed text-slate-900"
      style={{ colorScheme: "light" }}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="min-w-0">
          {logoUrl && <img src={logoUrl} alt="" className="mb-1.5 h-10 w-auto max-w-[180px] object-contain" />}
          <p className="text-[22px] font-extrabold tracking-tight text-slate-900">{appName}</p>
          {branding?.tagline && <p className="text-[11px] italic text-slate-500">{branding.tagline}</p>}
          {addrLine && <p className="mt-1 text-[10.5px] text-slate-500">{addrLine}</p>}
          {(branding?.phone || branding?.email) && (
            <p className="text-[10.5px] text-slate-500">
              {[branding?.phone && `Phone: ${branding.phone}`, branding?.email && `Email: ${branding.email}`].filter(Boolean).join("  •  ")}
            </p>
          )}
          {(branding?.taxId || branding?.website) && (
            <p className="text-[10.5px] text-slate-500">
              {[branding?.taxId && `Tax ID: ${branding.taxId}`, branding?.website].filter(Boolean).join("  •  ")}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[20px] font-extrabold text-primary">#{detail.invoiceNumber}</p>
          <p className="mt-1 text-[10.5px] text-slate-500">Issue Date: {docDate(detail.issueDate)}</p>
          <p className="text-[10.5px] text-slate-500">Due Date: {docDate(detail.dueDate)}</p>
          <p className="mt-1 inline-block rounded-md border border-slate-300 px-2 py-0.5 text-[10px] font-bold tracking-wide">
            {String(detail.status ?? "").replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* billed to */}
      <div className="mt-4">
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-primary">Billed to / Client</p>
        <p className="mt-0.5 text-[14px] font-bold">{detail.client?.companyName ?? "Valued Client"}</p>
        {(detail.client?.contacts ?? []).slice(0, 3).map((c: any) => (
          <p key={c.id ?? c.name} className="text-[10.5px] text-slate-500">
            {[c.name, c.phone, c.email].filter(Boolean).join("  •  ")}
          </p>
        ))}
        {detail.client?.address && <p className="text-[10.5px] text-slate-500">{detail.client.address}</p>}
        {detail.client?.taxId && <p className="text-[10px] text-slate-400">Tax ID: {detail.client.taxId}</p>}
        {detail.project?.name && <p className="text-[10.5px] text-slate-500">Project: {detail.project.name}</p>}
      </div>

      {/* items */}
      <table className="mt-4 w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: "7%" }} />
          <col style={{ width: "45%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "19%" }} />
        </colgroup>
        <thead>
          <tr className="bg-slate-100 text-left text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-2 py-2 text-center">#</th>
            <th className="px-2 py-2">Item &amp; Description</th>
            <th className="px-2 py-2 text-center">Qty</th>
            <th className="px-2 py-2 text-right">Rate ({sym})</th>
            <th className="px-2 py-2 text-right">Amount ({sym})</th>
          </tr>
        </thead>
        <tbody>
          {(detail.lineItems ?? []).map((l: any, i: number) => (
            <tr key={l.id ?? i} className="border-b border-slate-100 align-top">
              <td className="px-2 py-2 text-center text-slate-400">{i + 1}</td>
              <td className="px-2 py-2 font-medium break-words">{l.description}</td>
              <td className="px-2 py-2 text-center tabular-nums">{l.quantity ?? 1}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {Number(l.unitPrice ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="px-2 py-2 text-right font-bold tabular-nums">
                {Number(l.amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="mt-4 flex items-start justify-end">
        <div className="w-[62%] text-[11px]">
          <div className="flex justify-between py-0.5"><span className="text-slate-500">Subtotal:</span><span className="font-medium tabular-nums">{money(totals.subtotal, sym)}</span></div>
          {totals.tax > 0 && <div className="flex justify-between py-0.5"><span className="text-slate-500">VAT / Tax:</span><span className="font-medium tabular-nums">+ {money(totals.tax, sym)}</span></div>}
          {totals.discount > 0 && <div className="flex justify-between py-0.5"><span className="text-emerald-600">Discount:</span><span className="font-medium tabular-nums">− {money(totals.discount, sym)}</span></div>}
          {totals.shipping > 0 && <div className="flex justify-between py-0.5"><span className="text-slate-500">Shipping:</span><span className="font-medium tabular-nums">+ {money(totals.shipping, sym)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-[14px] font-extrabold text-primary">
            <span>Grand Total:</span><span className="tabular-nums">{money(totals.grand, sym)}</span>
          </div>
          {totals.paid > 0 && (
            <>
              <div className="flex justify-between py-0.5"><span className="text-emerald-600">Paid Amount:</span><span className="font-bold tabular-nums">{money(totals.paid, sym)}</span></div>
              <div className="flex justify-between py-0.5 font-bold text-rose-600"><span>Balance Due:</span><span className="tabular-nums">{money(totals.balance, sym)}</span></div>
            </>
          )}
        </div>
      </div>

      {showStatement && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Project Statement — {projBalance.project.name}</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            <div><p className="text-[9px] font-bold uppercase text-slate-400">Project value</p><p className="text-[12.5px] font-bold tabular-nums">{money(projBalance.value, sym)}</p></div>
            <div><p className="text-[9px] font-bold uppercase text-slate-400">Paid to date</p><p className="text-[12.5px] font-bold tabular-nums text-emerald-600">{money(projBalance.paid, sym)}</p></div>
            <div><p className="text-[9px] font-bold uppercase text-slate-400">Balance due</p><p className="text-[12.5px] font-bold tabular-nums text-amber-600">{money(projBalance.due, sym)}</p></div>
          </div>
          {(projBalance.invoices ?? []).slice(0, 5).map((inv: any) => (
            <div key={inv.id} className="py-px">
              <p className="flex justify-between gap-2 text-[10.5px] text-slate-500">
                <span className="shrink-0">{inv.invoiceNumber}{inv.invoiceType === "ADVANCE" ? " · Advance" : ""} · {String(inv.status ?? "").replace(/_/g, " ")}</span>
                <span className="shrink-0 font-bold tabular-nums">{money(inv.amount ?? 0, sym)}</span>
              </p>
              {inv.title && <p className="pr-2 text-[10px] leading-snug text-slate-400 break-words">{inv.title}</p>}
            </div>
          ))}
          {(projBalance.payments ?? []).slice(0, 5).map((p: any) => (
            <p key={p.id} className="flex justify-between gap-2 py-px text-[10.5px] text-slate-500">
              <span>{p.invoiceNumber} · {docDate(p.paymentDate)}</span>
              <span className="font-bold tabular-nums text-emerald-600">{money(p.amount, sym)}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px]">
        <span className="font-bold text-primary">In Words: </span>
        <span className="italic">{numberToWords(totals.grand, detail.currency ?? "BDT")}</span>
      </div>

      {/* payment instructions — bottom left, plain text */}
      <div className="mt-3 break-inside-avoid text-[10.5px] text-slate-600">
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-primary">Payment instructions</p>
        {paymentLines.length > 0 ? (
          <div className="mt-0.5">
            {paymentLines.map((line, i) => <p key={i} className="leading-relaxed">{line}</p>)}
          </div>
        ) : (
          <p className="mt-0.5">Please transfer the balance and quote the reference below.</p>
        )}
        <p className="mt-0.5 text-slate-400">Ref: Invoice #{detail.invoiceNumber}</p>
      </div>

      <div className="mt-4 flex items-end justify-end gap-4 break-inside-avoid">
        {(terms || notes) && (
          <div className="min-w-0 flex-1 text-[10.5px] text-slate-500">
            {terms && <p><span className="font-bold text-slate-700">Terms: </span>{terms}</p>}
            {notes && <p className="mt-1"><span className="font-bold text-slate-700">Notes: </span>{notes}</p>}
          </div>
        )}
        {qrDataUrl && (
          <div className="flex w-20 shrink-0 flex-col items-center">
            <img src={qrDataUrl} alt="Scan to view invoice" className="h-20 w-20" />
            <p className="mt-0.5 text-[8.5px] font-semibold text-slate-400">Scan to view</p>
          </div>
        )}
        <div className="w-44 shrink-0 text-center">
          {sigUrl && <img src={sigUrl} alt="" className="mx-auto mb-1 h-10 w-auto max-w-[160px] object-contain" />}
          <div className="border-t border-slate-300 pt-1">
            <p className="text-[11px] font-bold">{branding?.authorizedSignerName?.trim() || "Authorized Signer"}</p>
            <p className="text-[9.5px] text-slate-400">{branding?.authorizedSignerTitle?.trim() || "Authorized Signature"}</p>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mt-6 border-t border-slate-200 pt-2 text-center">
        <p className="text-[10px] text-slate-500">{[appName, addrLine].filter(Boolean).join(" • ")}</p>
        <p className="mt-0.5 text-[9px] text-slate-400">Powered by Zoolyum OS{branding?.website ? ` • ${branding.website}` : ""}</p>
      </div>
    </div>
  );
}
