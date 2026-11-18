/**
 * Bank / mobile-financial-service metadata, framework-free.
 *
 * Kept out of the React component file so the invoice PDF (plain JS) can use
 * the same colours and labels as the on-screen badge — one source of truth for
 * "what does bKash look like".
 *
 * We deliberately do not embed operators' logo files (trademark): a brand
 * colour plus a two-letter glyph is enough to tell them apart.
 */
export type PaymentKind = "BANK" | "BKASH" | "NAGAD" | "ROCKET" | "UPAY" | "CASH" | "CARD";

export type PaymentMeta = { label: string; short: string; color: string; glyph: string; mfs: boolean };

export const PAY_META: Record<PaymentKind, PaymentMeta> = {
  BANK:   { label: "Bank transfer", short: "Bank",   color: "#1d4ed8", glyph: "BD", mfs: false },
  BKASH:  { label: "bKash",         short: "bKash",  color: "#e2136e", glyph: "bK", mfs: true },
  NAGAD:  { label: "Nagad",         short: "Nagad",  color: "#ee7623", glyph: "N",  mfs: true },
  ROCKET: { label: "Rocket",        short: "Rocket", color: "#8c3494", glyph: "R",  mfs: true },
  UPAY:   { label: "Upay",          short: "Upay",   color: "#0e7aa8", glyph: "U",  mfs: true },
  CASH:   { label: "Cash",          short: "Cash",   color: "#047857", glyph: "৳",  mfs: false },
  CARD:   { label: "Card",          short: "Card",   color: "#475569", glyph: "CC", mfs: false },
};

export const PAYMENT_KIND_ORDER: PaymentKind[] = ["BANK", "BKASH", "NAGAD", "ROCKET", "UPAY", "CASH", "CARD"];

/** `BANK_TRANSFER` / `bank` / `BKASH` → `BANK` / `BKASH`. */
export function paymentKind(raw?: string | null): PaymentKind {
  const v = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!v) return "BANK";
  if (v.startsWith("BANK")) return "BANK";
  if (v === "MOBILE_WALLET" || v === "MFS") return "BKASH";
  if (v in PAY_META) return v as PaymentKind;
  return "BANK";
}

/** The enum value the API/ledger expects for a kind. */
export function paymentEnum(kind: PaymentKind): string {
  return kind === "BANK" ? "BANK_TRANSFER" : kind;
}

/**
 * An invoice usually stores only the method it was created with; the bank
 * details live in the workspace default (or in the managed accounts). Prefer
 * whichever actually names an account so the invoice never prints a blank box.
 */
export function pickPaymentDetails(invoicePay: any, brandPay: any) {
  const useful = (p: any) => !!(p && (p.bankName || p.accountNumber || p.mobileWalletNumber || p.accountName));
  if (useful(invoicePay)) return invoicePay;
  if (useful(brandPay)) return brandPay;
  return invoicePay ?? brandPay ?? {};
}

export type PayOption = {
  id: string;
  accountName?: string | null;
  accountType: string;
  accountHolder?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  branch?: string | null;
  routingNumber?: string | null;
};

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Wallet providers that can share one phone number. */
export const MOBILE_WALLET_KINDS = PAYMENT_KIND_ORDER.filter((k) => PAY_META[k].mfs);

/**
 * Plain text lines for the invoice "Payment instructions" block.
 *
 * One mobile number can belong to several providers (bKash + Nagad + Rocket on
 * the same number is normal in Bangladesh), so wallets are grouped by number and
 * printed on ONE line: `bKash / Nagad / Rocket: 01XXXXXXXXX`. Banks keep a
 * shorter line each. No badges, no colours — this block is read, not scanned.
 */
export function invoicePaymentLines(accounts: PayOption[] | null | undefined, legacy: any): string[] {
  const list = Array.isArray(accounts) ? accounts : [];
  const banks: string[] = [];
  const wallets = new Map<string, { number: string; providers: Set<string>; names: Set<string> }>();

  const addWallet = (number: unknown, kind: unknown, accountName?: unknown) => {
    const value = String(number ?? "").trim();
    const key = digits(value);
    if (!key) return;
    const entry = wallets.get(key) ?? { number: value, providers: new Set<string>(), names: new Set<string>() };
    const meta = PAY_META[paymentKind(String(kind ?? ""))];
    if (meta.mfs) entry.providers.add(meta.short);
    const name = String(accountName ?? "").trim();
    if (name) entry.names.add(name);
    wallets.set(key, entry);
  };

  // The account name typed when the account was saved is what the client must
  // see — it is the same label the workspace uses everywhere else.
  const addBank = (
    accountName: unknown,
    bankName: unknown,
    number: unknown,
    holder: unknown,
    branch: unknown,
    routing: unknown,
  ) => {
    const name = String(accountName ?? "").trim();
    const bank = String(bankName ?? "").trim();
    const acct = String(number ?? "").trim();
    if (!name && !bank && !acct) return;
    const title = name || bank || "Bank";
    const bankSuffix = bank && bank !== name ? ` — ${bank}` : "";
    banks.push(`${title}${bankSuffix}${acct ? ` · A/C: ${acct}` : ""}`);
    const extra = [
      holder && String(holder).trim() !== name ? `Holder: ${String(holder).trim()}` : "",
      branch ? `Branch: ${String(branch).trim()}` : "",
      routing ? `Routing: ${String(routing).trim()}` : "",
    ].filter(Boolean).join(" · ");
    if (extra) banks.push(extra);
  };

  for (const account of list) {
    const kind = paymentKind(account.accountType);
    if (PAY_META[kind].mfs) {
      addWallet(account.accountNumber, kind, account.accountName);
    } else if (kind !== "CASH") {
      addBank(account.accountName, account.bankName, account.accountNumber, account.accountHolder, account.branch, account.routingNumber);
    }
  }

  // Legacy single-account default (Control → Invoice & signature). Only added
  // when the managed accounts do not already cover the same number.
  const legacyWalletNumber = String(legacy?.mobileWalletNumber ?? "").trim();
  if (legacyWalletNumber) {
    const providers: string[] = Array.isArray(legacy?.mobileWalletProviders) && legacy.mobileWalletProviders.length
      ? legacy.mobileWalletProviders
      : [legacy?.method ?? "BKASH"];
    for (const provider of providers) addWallet(legacyWalletNumber, provider);
  }
  const legacyBankNumber = String(legacy?.accountNumber ?? "").trim();
  const legacyBankKey = digits(legacyBankNumber);
  const alreadyListed = !!legacyBankKey && list.some((a) => digits(a.accountNumber) === legacyBankKey);
  if (!alreadyListed && (legacy?.bankName || legacyBankNumber)) {
    addBank(legacy?.accountName, legacy?.bankName, legacyBankNumber, null, legacy?.branch, legacy?.routingNumber);
  }

  const lines = [...banks];
  for (const wallet of wallets.values()) {
    const names = [...wallet.providers].join(" / ");
    const accountNames = [...wallet.names].filter((n) => !wallet.providers.has(n));
    lines.push(`${names || "Mobile wallet"}: ${wallet.number}${accountNames.length ? ` (${accountNames.join(" / ")})` : ""}`);
  }
  return lines;
}

/**
 * The rows an invoice should print in its "Pay via" box.
 *
 * The managed accounts win, but a workspace that still only has the single
 * legacy default (Control → Invoice & signature) must keep printing it — that
 * is where the real bank details live until the accounts are filled in. A
 * legacy entry is appended only when no account already carries its number, so
 * nothing is printed twice.
 */
export function mergePaymentOptions(accounts: PayOption[] | null | undefined, legacy: any): PayOption[] {
  const list = Array.isArray(accounts) ? [...accounts] : [];
  const number = legacy?.accountNumber || legacy?.mobileWalletNumber;
  const hasLegacy = !!(legacy?.bankName || number || legacy?.accountName);
  if (!hasLegacy) return list;

  const key = digits(number);
  if (key && list.some((a) => digits(a.accountNumber) === key)) return list;

  list.push({
    id: "legacy-default",
    accountName: legacy?.accountName ?? null,
    accountType: legacy?.method || (legacy?.mobileWalletNumber ? "BKASH" : "BANK"),
    bankName: legacy?.bankName ?? null,
    accountNumber: number ?? null,
    branch: legacy?.branch ?? null,
    routingNumber: legacy?.routingNumber ?? null,
    accountHolder: legacy?.accountName ?? null,
  });
  return list;
}
