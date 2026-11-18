"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Download, Printer } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Avatar, EmptyState, PageHeader, SkeletonBlock, StatusBadge } from "@/components/shared";
import { Btn } from "@/components/table";
import { formatBDT, formatDate } from "@/lib/format";
import { useBranding } from "@/lib/branding-context";
import { buildPayslipPdf } from "@/lib/payslip-pdf";

function Row({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "rose" | "emerald" | "default" }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-body font-medium">{label}</p>
        {sub && <p className="text-micro text-muted-foreground">{sub}</p>}
      </div>
      <p className={`text-body-lg font-bold tabular-nums ${tone === "rose" ? "text-rose-500" : tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</p>
    </div>
  );
}

export default function PayslipPage() {
  const params = useParams<{ id: string }>();
  const { branding: contextBranding } = useBranding();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<any>(`/people/payroll/${params.id}/payslip`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [params.id]);
  const r = data?.record;
  const breakdown = r?.breakdown ?? {};
  const payslipBranding = data?.company?.branding ?? contextBranding;

  // The payslip had Print only — no file for records, banks or a visa pack.
  const downloadPdf = async () => {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    try {
      const doc = await buildPayslipPdf(data, payslipBranding);
      const safeName = String(data.employee?.name ?? "employee").replace(/\s+/g, "-").toLowerCase();
      doc.save(`payslip-${data.record?.period ?? "salary"}-${safeName}.pdf`);
    } catch {
      setError("Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };
  const brandingAppName = payslipBranding?.appName ?? data?.company?.name ?? "Zoolyum OS";
  const brandingLogo = payslipBranding?.logoDarkUrl ?? payslipBranding?.logoUrl ?? null;

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Payslip"
          subtitle="Monthly salary statement with attendance deductions"
          actions={
            <div className="flex items-center gap-2">
              <Link href="/people"><Btn variant="outline"><ArrowLeft className="size-3.5" /> Back to People</Btn></Link>
              <Btn variant="outline" onClick={downloadPdf} disabled={!data || pdfBusy}>
                <Download className="size-3.5" /> {pdfBusy ? "Preparing…" : "Download PDF"}
              </Btn>
              <Btn variant="primary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Btn>
            </div>
          }
        />
      </div>
      <div className="mx-auto max-w-2xl">
        {loading && <div className="flex flex-col gap-3">{[...Array(8)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}</div>}
        {error && <EmptyState title={error} hint="Could not load this payslip" />}
        {data && r && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-start justify-between gap-4 border-b border-border/60 bg-muted/30 p-5">
              <div className="flex items-center gap-3">
                {brandingLogo ? (
                  <img src={brandingLogo} alt={brandingAppName} className="h-10 max-w-[140px] object-contain" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md shadow-orange-500/25"><Building2 className="size-4" /></span>
                )}
                <div>
                  <p className="font-heading text-section font-bold">{brandingAppName}</p>
                  <p className="text-meta text-muted-foreground">Salary slip — {r.period}</p>
                </div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border/60 p-5">
              <div className="flex items-center gap-3">
                <Avatar name={data.employee?.name} />
                <div>
                  <p className="text-body-lg font-bold">{data.employee?.name}</p>
                  <p className="text-meta text-muted-foreground">{data.employee?.roleTitle}{data.employee?.department ? ` · ${data.employee.department}` : ""}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Pay period</p>
                <p className="text-body font-semibold tabular-nums">{r.period}</p>
                <p className="text-micro text-muted-foreground">Issued {formatDate(r.updatedAt ?? r.createdAt)}</p>
              </div>
            </div>
            <div className="p-5">
              <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Earnings</p>
              <div className="divide-y divide-border/60">
                <Row label="Basic salary" value={formatBDT(Number(r.basicSalary ?? 0))} sub={`daily rate ${formatBDT(Number(breakdown.dailyRate ?? 0))} × ${breakdown.divisor ?? "—"} (divisor)`} />
                {Number(r.allowances ?? 0) > 0 && <Row label="Allowances" value={formatBDT(Number(r.allowances))} />}
                {Number(r.bonus ?? 0) > 0 && <Row label="Bonus" value={formatBDT(Number(r.bonus))} tone="emerald" />}
              </div>
              <p className="mb-2 mt-5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Deductions</p>
              <div className="divide-y divide-border/60">
                <Row label="Late arrivals" value={`−${formatBDT(Number(r.lateDeduction ?? 0))}`} sub={`${breakdown.lateCount ?? 0} late day(s) in ${breakdown.workingDays ?? "—"} working days`} tone="rose" />
                <Row label="Half-day LOP" value={`−${formatBDT(Number(r.halfDayDeduction ?? 0))}`} sub={`${breakdown.halfDays ?? 0} half day(s)`} tone="rose" />
                <Row label="Absent days" value={`−${formatBDT(Number(r.absentDeduction ?? 0))}`} sub={`${breakdown.absentDays ?? 0} absent day(s)`} tone="rose" />
                <Row label="Unpaid leave" value={`−${formatBDT(Number(r.unpaidLeaveDeduction ?? 0))}`} tone="rose" />
              </div>
              <div className="mt-5 flex items-center justify-between rounded-xl bg-brand-gradient-soft px-4 py-3">
                <p className="text-body font-bold text-primary dark:text-primary">Net pay</p>
                <p className="text-section font-extrabold tabular-nums text-primary dark:text-primary">{formatBDT(Number(r.netPay ?? 0))}</p>
              </div>
              <div className="mt-6 flex items-end justify-between gap-4">
                <p className="text-micro text-muted-foreground">Generated by Zoolyum OS payroll. Deductions follow the attendance policy (late ladder, half-day cutoff, daily rate divisor).</p>
                <div className="text-right">
                  <div className="w-40 border-b border-border" />
                  <p className="mt-1 text-micro font-semibold text-muted-foreground">Authorized signature</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}