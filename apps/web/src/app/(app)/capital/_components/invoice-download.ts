"use client";

import { apiFetch } from "@/lib/api";
import { buildInvoicePdfAsync } from "@/lib/invoice-pdf";

/**
 * One-click invoice PDF from anywhere (list row, quick action).
 *
 * The detail sheet already had this, but you had to open the invoice first and
 * the print preview offered Print only. This helper fetches the same payload
 * the detail view uses — line items, payments, project statement and the public
 * share link (for the QR) — so every entry point produces an identical PDF.
 */
export async function downloadInvoicePdf(invoiceId: string, branding?: any): Promise<string> {
  const detail = await apiFetch<any>(`/capital/invoices/${invoiceId}`);

  let projBalance: any = null;
  try {
    projBalance = await apiFetch<any>(`/capital/invoices/${invoiceId}/project-balance`);
  } catch {
    projBalance = null; // statement is optional; the PDF renders without it
  }
  const invForPdf = projBalance?.project && !projBalance?.reason ? { ...detail, projectBalance: projBalance } : detail;

  // QR points at the public share page. Drafts stay private: no token is minted
  // until the invoice is actually issued.
  let shareUrl: string | undefined;
  try {
    let token = detail.shareToken as string | undefined;
    if (!token && detail.status !== "DRAFT") {
      const s = await apiFetch<any>(`/capital/invoices/${invoiceId}/share/ensure`, { method: "POST" });
      token = s?.token;
    }
    if (token && typeof window !== "undefined") shareUrl = `${window.location.origin}/p/inv/${token}`;
  } catch {
    shareUrl = undefined;
  }

  const doc = await buildInvoicePdfAsync({ ...invForPdf, shareUrl }, branding);
  doc.save(`${detail.invoiceNumber}.pdf`);
  return detail.invoiceNumber as string;
}
