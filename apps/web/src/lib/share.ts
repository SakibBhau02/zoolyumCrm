/**
 * Share helpers — send invoices / receipts / reminders to clients via the
 * client's own Email / WhatsApp apps (mailto: / wa.me deep links with
 * prefilled text). The backend logs the same event as a reminder record,
 * so every share leaves an audit trail on the invoice.
 */

const digitsOnly = (v: string) => (v ?? "").replace(/\D/g, "");

/** Normalize a phone number for wa.me (defaults to Bangladesh +880). */
export function toWaNumber(raw?: string | null): string | null {
  let d = digitsOnly(raw ?? "");
  if (!d) return null;
  if (d.startsWith("880") && d.length === 13) return d;
  if (d.startsWith("0") && d.length === 11) return `880${d.slice(1)}`;
  if (d.length === 10) return `880${d}`;
  return d;
}

export function mailtoLink(email: string, subject: string, body: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const num = toWaNumber(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

const symFor = (currency?: string | null) => {
  switch ((currency ?? "BDT").toUpperCase()) {
    case "BDT": return "৳";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "INR": return "₹";
    default: return currency ?? "";
  }
};

const money = (v: any) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function buildReminderMessage(inv: {
  invoiceNumber: string;
  currency?: string | null;
  grand: number;
  balance: number;
  dueDate?: string | null;
  clientName?: string;
  companyName?: string;
}): { subject: string; body: string } {
  const sym = symFor(inv.currency);
  const subject = `Payment reminder — ${inv.invoiceNumber} (${sym}${money(inv.balance)} due)`;
  const body = [
    `Dear ${inv.clientName ?? "Valued Client"},`,
    ``,
    `This is a friendly reminder that invoice ${inv.invoiceNumber} of ${sym}${money(inv.grand)} has a remaining balance of ${sym}${money(inv.balance)}${inv.dueDate ? `, due ${String(inv.dueDate).slice(0, 10)}` : ""}.`,
    ``,
    `Please let us know once the payment is made so we can share your paid receipt.`,
    ``,
    `Thank you,`,
    `${inv.companyName ?? "Zoolyum"}`,
  ].join("\n");
  return { subject, body };
}

export function buildReceiptMessage(inv: {
  invoiceNumber: string;
  receiptNo: string;
  currency?: string | null;
  paidAmount: number;
  balance: number;
  method?: string | null;
  date?: string | null;
  clientName?: string;
  companyName?: string;
}): { subject: string; body: string } {
  const sym = symFor(inv.currency);
  const subject = inv.balance > 0
    ? `Payment received — ${inv.invoiceNumber} (${sym}${money(inv.balance)} still due)`
    : `Paid in full — ${inv.invoiceNumber} ✓`;
  const body = [
    `Dear ${inv.clientName ?? "Valued Client"},`,
    ``,
    `We have received ${sym}${money(inv.paidAmount)} against invoice ${inv.invoiceNumber}${inv.date ? ` on ${String(inv.date).slice(0, 10)}` : ""}${inv.method ? ` via ${inv.method}` : ""}.`,
    `Receipt: ${inv.receiptNo}.`,
    inv.balance > 0
      ? `Remaining balance: ${sym}${money(inv.balance)}.`
      : `This invoice is now fully paid. Thank you!`,
    ``,
    `Thank you,`,
    `${inv.companyName ?? "Zoolyum"}`,
  ].join("\n");
  return { subject, body };
}
