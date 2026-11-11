"use client";

import { Suspense, useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, CircleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { Btn } from "@/components/table";
import { InvoicesTab } from "../_components/tabs";
import { InvoiceDetailModal } from "../_components/invoice-detail-modal";
import { useCapital } from "../_components/capital-context";

function InstallmentWatch({ onView }: { onView: (id: string) => void }) {
  const { installmentsDue, notify, reload } = useCapital();
  if (!installmentsDue || installmentsDue.length === 0) return null;
  const overdue = installmentsDue.filter((s) => s.overdue);
  const upcoming = installmentsDue.filter((s) => !s.overdue);
  const remind = async (s: any) => {
    try {
      await apiFetch(`/capital/invoices/${s.invoiceId}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          type: s.overdue ? "overdue_1" : "approaching",
          channel: "system",
          subject: `Installment #${s.sequence} ${s.overdue ? "overdue" : "due soon"} — ${s.invoiceNumber}`,
          notes: `[inst:${s.id}] Manual nudge: installment #${s.sequence} of ${s.invoiceNumber}.`,
        }),
      });
      notify("Installment reminder logged");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Reminder failed");
    }
  };
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
      <p className="flex items-center gap-1.5 text-body font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        <AlarmClock className="size-3.5" />
        {overdue.length > 0 ? `${overdue.length} overdue` : "Due soon"}
        {upcoming.length > 0 && overdue.length > 0 ? ` · ${upcoming.length} due within 7 days` : upcoming.length > 0 ? ` — ${upcoming.length} due within 7 days` : ""}
      </p>
      {installmentsDue.slice(0, 5).map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
          <CircleAlert className={`size-3.5 shrink-0 ${s.overdue ? "text-rose-500" : "text-amber-500"}`} />
          <button onClick={() => onView(s.invoiceId)} className="text-body font-bold text-primary hover:underline">
            {s.invoiceNumber} #{s.sequence}
          </button>
          <span className="text-meta text-muted-foreground">{s.clientName} · {s.overdue ? "overdue since" : "due"} {formatDate(s.dueDate)}</span>
          <span className="ml-auto text-body font-bold tabular-nums">{formatBDT(s.balance)}</span>
          <Btn variant="ghost" onClick={() => void remind(s)}>Remind</Btn>
        </div>
      ))}
      {installmentsDue.length > 5 && (
        <p className="text-meta text-muted-foreground">+{installmentsDue.length - 5} more — open each invoice for details.</p>
      )}
    </div>
  );
}

function InvoicesContent() {
  const c = useCapital();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("inv");
  const clientId = searchParams.get("clientId") ?? undefined;

  const openInvoice = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("inv", id);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const closeInvoice = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("inv");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams]);

  // Auto-close the centered popup if its invoice disappears (e.g. after delete).
  useEffect(() => {
    if (selectedId && c.invoices !== null && !c.invoices.some((i) => i.id === selectedId)) {
      closeInvoice();
    }
  }, [selectedId, c.invoices, closeInvoice]);

  return (
    <>
      <InstallmentWatch onView={openInvoice} />
      <InvoicesTab
        error={c.invoicesErr}
        refresh={c.reload}
        refreshKey={c.refreshKey}
        clients={c.clients}
        onView={openInvoice}
        onNew={() => c.setInvOpen(true)}
        onDuplicate={(id) => void c.duplicateInvoice(id)}
        onDelete={(inv) => c.setToDelete({ kind: "invoice", id: inv.id, name: inv.invoiceNumber, status: inv.status })}
        initialClientId={clientId}
      />
      <InvoiceDetailModal selectedId={selectedId} onClose={closeInvoice} onEdit={(inv) => c.setEditInv(inv)} />
    </>
  );
}

export default function CapitalInvoicesPage() {
  return (
    <Suspense>
      <InvoicesContent />
    </Suspense>
  );
}
