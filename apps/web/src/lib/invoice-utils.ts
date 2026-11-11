/**
 * Invoice math + amount-in-words utilities.
 * Formulas mirror Finance_System (and the backend `invoiceTotals` helper):
 *   subtotal = Σ qty × rate
 *   tax      = subtotal × taxRate / 100   (only when applied)
 *   discount = subtotal × discountRate / 100
 *   grand    = subtotal + tax − discount + shipping
 */

export type InvoiceTotals = {
  subtotal: number;
  tax: number;
  discount: number;
  shipping: number;
  grand: number;
  paid: number;
  refunded: number;
  credits: number;
  balance: number;
  exchangeRate: number;
  grandBdt: number;
  paidBdt: number;
  balanceBdt: number;
};

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Start of the local calendar day expressed as UTC midnight (matches the API). */
export function startOfTodayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

/**
 * Whole days past a DATE-only value. Returns 0 for today/future.
 * Comparing local midnight with a UTC-midnight date column made every invoice
 * look one day younger than it was.
 */
export function daysLate(dueDate?: string | Date | null): number {
  if (!dueDate) return 0;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return 0;
  const due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((startOfTodayUtc().getTime() - due) / 86400000));
}

/**
 * Chronological receipt serial: earliest payment = 1.
 * Tie-breaks (same-day payments) fall back to creation order, then id —
 * so serials never flip between loads/downloads.
 */
export function paymentSerial(payments: any[] | null | undefined, id: string): number {
  const ordered = [...(payments ?? [])].sort(
    (a, b) =>
      +new Date(a.paymentDate) - +new Date(b.paymentDate) ||
      +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0) ||
      String(a.id).localeCompare(String(b.id))
  );
  const i = ordered.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i + 1;
}

export function receiptLabel(invoiceNumber: string, payments: any[] | null | undefined, p: any): string {
  if (p.referenceId) return p.referenceId;
  const s = p.serial ?? paymentSerial(payments, p.id);
  return `${invoiceNumber}-P${s || "?"}`;
}

/** Payment method → matching bank-account type (BKASH/NAGAD/BANK/CASH). */
export const METHOD_ACCOUNT_TYPE: Record<string, string> = {
  BKASH: "BKASH",
  NAGAD: "NAGAD",
  BANK_TRANSFER: "BANK",
  CASH: "CASH",
  CARD: "BANK",
};

/** Accounts valid for a method; falls back to all when none match (never trap the user). */
export function accountsForMethod(accounts: any[] | null | undefined, method: string): any[] {
  const list = accounts ?? [];
  const want = METHOD_ACCOUNT_TYPE[method];
  if (!want) return list;
  const filtered = list.filter((a) => a.accountType === want);
  return filtered.length ? filtered : list;
}

export function invoiceTotals(inv: {
  lineItems?: { amount?: any }[] | null;
  taxApplicable?: boolean | null;
  taxRate?: any;
  discountRate?: any;
  shippingFee?: any;
  exchangeRate?: any;
  currency?: string | null;
  payments?: { amount?: any; type?: string | null }[] | null;
  creditNotes?: { amount?: any; type?: string | null; status?: string | null }[] | null;
}): InvoiceTotals {
  const subtotal = (inv.lineItems ?? []).reduce((s, l) => s + num(l.amount), 0);
  const tax = inv.taxApplicable && num(inv.taxRate) ? (subtotal * num(inv.taxRate)) / 100 : 0;
  const discount = num(inv.discountRate) ? (subtotal * num(inv.discountRate)) / 100 : 0;
  const shipping = num(inv.shippingFee);
  const grand = Math.max(0, subtotal + tax - discount + shipping);
  const payments = inv.payments ?? [];
  // Refunds hand money back — they subtract from collected, matching the API.
  const paid = payments.reduce((s, p) => s + (p.type === "REFUND" ? -num(p.amount) : num(p.amount)), 0);
  const refunded = payments.filter((p) => p.type === "REFUND").reduce((s, p) => s + num(p.amount), 0);
  // Credit notes / write-offs reduce the receivable (API parity).
  const credits = (inv.creditNotes ?? [])
    .filter((c) => c && (!c.status || c.status === "ISSUED") && (c.type === "CREDIT_NOTE" || c.type === "WRITE_OFF"))
    .reduce((s, c) => s + num(c.amount), 0);
  const rate = num(inv.exchangeRate) || 1;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const balance = Math.max(grand - paid - credits, 0);
  return {
    subtotal: r2(subtotal),
    tax: r2(tax),
    discount: r2(discount),
    shipping: r2(shipping),
    grand: r2(grand),
    paid: r2(paid),
    refunded: r2(refunded),
    credits: r2(credits),
    balance: r2(balance),
    exchangeRate: rate,
    grandBdt: r2(grand * rate),
    paidBdt: r2(paid * rate),
    balanceBdt: r2(balance * rate),
  };
}

export const INVOICE_TEMPLATES = [
  { value: "modern-orange", label: "Modern Orange" },
  { value: "zoolyum-dark", label: "Zoolyum Dark" },
  { value: "minimal-clean", label: "Minimal Clean" },
  { value: "classic-corporate", label: "Classic Corporate" },
] as const;

export type InvoiceTemplateStyle = (typeof INVOICE_TEMPLATES)[number]["value"];

export const REMINDER_TYPES = [
  { value: "approaching", label: "Payment approaching" },
  { value: "due_today", label: "Due today" },
  { value: "overdue_1", label: "Overdue — 1st notice" },
  { value: "overdue_2", label: "Overdue — 2nd notice" },
  { value: "final_notice", label: "Final notice" },
  { value: "paid_receipt", label: "Payment receipt" },
  { value: "custom", label: "Custom" },
] as const;

// ── Amount in words (ported from Finance_System) ──────────────────────────

type CurrencyUnitConfig = {
  singular: string;
  plural: string;
  fractionSingular?: string;
  fractionPlural?: string;
  isSouthAsian?: boolean;
};

const CURRENCY_UNITS: Record<string, CurrencyUnitConfig> = {
  BDT: { singular: "Taka", plural: "Taka", fractionSingular: "Poisha", fractionPlural: "Poisha", isSouthAsian: true },
  INR: { singular: "Rupee", plural: "Rupees", fractionSingular: "Paisa", fractionPlural: "Paise", isSouthAsian: true },
  PKR: { singular: "Rupee", plural: "Rupees", fractionSingular: "Paisa", fractionPlural: "Paise", isSouthAsian: true },
  LKR: { singular: "Rupee", plural: "Rupees", fractionSingular: "Cent", fractionPlural: "Cents", isSouthAsian: true },
  NPR: { singular: "Rupee", plural: "Rupees", fractionSingular: "Paisa", fractionPlural: "Paise", isSouthAsian: true },
  USD: { singular: "US Dollar", plural: "US Dollars", fractionSingular: "Cent", fractionPlural: "Cents" },
  AUD: { singular: "Australian Dollar", plural: "Australian Dollars", fractionSingular: "Cent", fractionPlural: "Cents" },
  CAD: { singular: "Canadian Dollar", plural: "Canadian Dollars", fractionSingular: "Cent", fractionPlural: "Cents" },
  EUR: { singular: "Euro", plural: "Euros", fractionSingular: "Cent", fractionPlural: "Cents" },
  GBP: { singular: "British Pound", plural: "British Pounds", fractionSingular: "Penny", fractionPlural: "Pence" },
  AED: { singular: "UAE Dirham", plural: "UAE Dirhams", fractionSingular: "Fils", fractionPlural: "Fils" },
  SAR: { singular: "Saudi Riyal", plural: "Saudi Riyals", fractionSingular: "Halala", fractionPlural: "Halalas" },
  QAR: { singular: "Qatari Riyal", plural: "Qatari Riyals", fractionSingular: "Dirham", fractionPlural: "Dirhams" },
  KWD: { singular: "Kuwaiti Dinar", plural: "Kuwaiti Dinars", fractionSingular: "Fils", fractionPlural: "Fils" },
  OMR: { singular: "Omani Rial", plural: "Omani Rials", fractionSingular: "Baisa", fractionPlural: "Baisas" },
  BHD: { singular: "Bahraini Dinar", plural: "Bahraini Dinars", fractionSingular: "Fils", fractionPlural: "Fils" },
  SGD: { singular: "Singapore Dollar", plural: "Singapore Dollars", fractionSingular: "Cent", fractionPlural: "Cents" },
  MYR: { singular: "Ringgit", plural: "Ringgit", fractionSingular: "Sen", fractionPlural: "Sen" },
  JPY: { singular: "Yen", plural: "Yen", fractionSingular: "Sen", fractionPlural: "Sen" },
  CNY: { singular: "Yuan", plural: "Yuan", fractionSingular: "Fen", fractionPlural: "Fen" },
  KRW: { singular: "Won", plural: "Won", fractionSingular: "Jeon", fractionPlural: "Jeon" },
  CHF: { singular: "Swiss Franc", plural: "Swiss Francs", fractionSingular: "Rappen", fractionPlural: "Rappen" },
};

function getCurrencyUnitConfig(currency?: { code?: string; name?: string } | string): CurrencyUnitConfig {
  if (!currency) return CURRENCY_UNITS.BDT;
  const code = (typeof currency === "string" ? currency : currency.code || "").toUpperCase().trim();
  if (code && CURRENCY_UNITS[code]) return CURRENCY_UNITS[code];
  const rawName = typeof currency === "object" ? (currency.name || "").trim() : "";
  if (rawName) {
    const isPlural = rawName.endsWith("s");
    return { singular: isPlural ? rawName.slice(0, -1) : rawName, plural: isPlural ? rawName : rawName + "s", fractionSingular: "Cent", fractionPlural: "Cents", isSouthAsian: false };
  }
  if (code) return { singular: code, plural: code, fractionSingular: "Cent", fractionPlural: "Cents", isSouthAsian: false };
  return CURRENCY_UNITS.BDT;
}

const SINGLE = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convertHundreds(n: number): string {
  let str = "";
  if (n >= 100) {
    str += SINGLE[Math.floor(n / 100)] + " Hundred ";
    n %= 100;
  }
  if (n >= 20) {
    str += TENS[Math.floor(n / 10)] + " ";
    n %= 10;
  }
  if (n > 0) str += SINGLE[n] + " ";
  return str.trim();
}

function westernToWords(n: number): string {
  if (n === 0) return "Zero";
  const billion = Math.floor(n / 1000000000);
  const million = Math.floor((n % 1000000000) / 1000000);
  const thousand = Math.floor((n % 1000000) / 1000);
  const remaining = n % 1000;
  let res = "";
  if (billion > 0) res += convertHundreds(billion) + " Billion ";
  if (million > 0) res += convertHundreds(million) + " Million ";
  if (thousand > 0) res += convertHundreds(thousand) + " Thousand ";
  if (remaining > 0) res += convertHundreds(remaining) + " ";
  return res.trim();
}

function southAsianToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const remaining = n % 1000;
  let res = "";
  if (crore > 0) res += (crore >= 100 ? westernToWords(crore) : convertHundreds(crore)) + " Crore ";
  if (lakh > 0) res += convertHundreds(lakh) + " Lakh ";
  if (thousand > 0) res += convertHundreds(thousand) + " Thousand ";
  if (remaining > 0) res += convertHundreds(remaining) + " ";
  return res.trim();
}

export function numberToWords(amount: number, currency?: { code?: string; name?: string } | string): string {
  const unit = getCurrencyUnitConfig(currency);
  const absAmount = Math.abs(amount || 0);
  const whole = Math.floor(absAmount);
  const fraction = Math.round((absAmount - whole) * 100);
  if (whole === 0 && fraction === 0) return `Zero ${unit.plural} Only`;
  let text = "";
  if (whole > 0) {
    const wholeWords = unit.isSouthAsian ? southAsianToWords(whole) : westernToWords(whole);
    text = `${wholeWords} ${whole === 1 ? unit.singular : unit.plural}`;
  }
  if (fraction > 0) {
    const fracWords = convertHundreds(fraction);
    const fracUnit = fraction === 1 ? unit.fractionSingular || "Cent" : unit.fractionPlural || "Cents";
    text = whole > 0 ? `${text} and ${fracWords} ${fracUnit}` : `${fracWords} ${fracUnit}`;
  }
  if (amount < 0) text = `Minus ${text}`;
  return `${text.trim()} Only`;
}
