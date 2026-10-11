"use client";

import { use, useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import { API_URL } from "@/lib/api";
import { CardShell, EmptyState, SkeletonBlock } from "@/components/shared";
import { Btn } from "@/components/table";
import { BrandLogo } from "@/components/brand-logo";
import { buildInvoicePdfAsync } from "@/lib/invoice-pdf";
import { InvoicePrintView } from "@/app/(app)/capital/_components/invoice-print-view";

/**
 * No-login invoice view for client share links (/p/inv/:token).
 * Same professional sheet as Capital (print + PDF included).
 */
export default function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/public/invoices/by-token/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("This link is invalid or has been revoked.");
        return r.json();
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: any) => !cancelled && setError(e.message ?? "Failed to load invoice"))
      .finally(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const downloadPdf = async () => {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    try {
      const shareUrl = typeof window !== "undefined" ? window.location.href : undefined;
      const doc = await buildInvoicePdfAsync({ ...data, shareUrl }, data.branding ?? undefined);
      doc.save(`${data.invoiceNumber}.pdf`);
    } catch {
      setError("Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <BrandLogo height={30} />
          <div className="flex items-center gap-2">
            {data && (
              <>
                <Btn variant="outline" onClick={() => window.print()}>
                  <Printer className="size-3.5" /> Print
                </Btn>
                <Btn variant="primary" onClick={downloadPdf} className={pdfBusy ? "opacity-60" : ""}>
                  <Download className="size-3.5" /> {pdfBusy ? "Preparing…" : "Download PDF"}
                </Btn>
              </>
            )}
          </div>
        </div>
        {!data && !error && <SkeletonBlock className="h-96" />}
        {error && (
          <CardShell className="text-center">
            <EmptyState title={error} hint="Please ask your agency contact for a fresh link." />
          </CardShell>
        )}
        {data && (
          <InvoicePrintView
            detail={data}
            totals={{ subtotal: data.totals.subtotal, tax: data.totals.tax, discount: data.totals.discount, shipping: data.totals.shipping, grand: data.totals.grand, paid: data.totals.paid, balance: data.totals.balance }}
            projBalance={data.projectBalance}
            branding={data.branding}
            shareUrl={typeof window !== "undefined" ? window.location.href : null}
          />
        )}
      </div>
    </main>
  );
}
