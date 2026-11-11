# Finance / Capital — Remediation Report (সব ফিক্স + যাচাই)

**Module:** Capital · Finance
**তারিখ:** 10 Nov 2026
**ভিত্তি:** `docs/qa-finance-audit.md`-এ তোলা সব finding
**অবস্থা:** 🟢 P0 ও P1 সম্পূর্ণ ফিক্সড ও লাইভ যাচাইকৃত; P2-এর সবগুলো ফিক্সড (একটি ডকুমেন্টেড সীমাবদ্ধতা ছাড়া)
**যাচাই পদ্ধতি:** typecheck (api+web) · `npm run build` · নিজের e2e 3/3 · ১১৩-পয়েন্ট live API audit (0 fail) · ১৮টি targeted probe · ৮টি probe · ব্রাউজারে আসল UI ফ্লো

টেস্ট-ডেটা **সম্পূর্ণ পরিষ্কার**: Invoice 18 · Expense 8 · Payment 11 · CreditNote 0 · DollarSale 5; GL `debits = credits = ৳6,955,200`; GL cash == bank == ৳3,779,000; bank accounts baseline-এ (DBBL ৳26,89,000 · Nagad ৳3,20,000 · bKash ৳6,80,000 · Petty Cash ৳90,000)।

---

## ১. P0 — Critical (সব ফিক্সড)

### F-01 · UI থেকে Expense রেকর্ড করা যেত না
- **ফিক্স:** `expense.service.ts` — create-path-এ approval matrix এর role+limit চেক থাকে, কিন্তু "different approver" নিয়ম আর প্রযোজ্য হয় না (`submittedById: null`)। ফলে Owner/Finance সরাসরি (pre-approved) expense পোস্ট করতে পারে; অন্যদের আবেদন PENDING থেকে admin approval যায়।
- **যাচাই:** UI-তে Owner একটি ৳2,500 overhead expense সেভ করে সাথেই APPROVED হিসেবে লিস্টে দেখেছেন; পরে Delete-ও কাজ করেছে। API: `POST /capital/expenses {approvalStatus:"APPROVED"}` → **201**। Audit: `Owner can create a pre-approved expense | status=APPROVED`।

### F-02 · এডিট করলে ledger-এ posting duaplicake হতো
- **ফিক্স:** `invoice.service.ts` / `expense.service.ts` — এখন reverse+re-post হয় **শুধু ledger-affecting** ফিল্ড বদলালে (lines, status, tax, discount, shipping, issueDate, currency, rate / amount, category, isPayable, accountId)। শুধু notes/due date/vendor/receipt বদলালে journal অপরিবর্তিত।
- **যাচাই:** issued invoice-এ notes এডিট → journal count **1** (আগে 2); approved expense-এ notes এডিট → **1**। Audit: `notes-only edit does not duplicate the journal` (PASS ×2)।

### F-03 · `reverseGL` ভুল journal রিভার্স করত
- **ফিক্স:** `ledger.service.ts` — reversal এখন `entryType` দিয়ে scope করা (`["INVOICE"]`, `["EXPENSE"]`, `["EXPENSE_PAYMENT"]`); যে entry নিজেই reversal সেটি বাদ যায়; এবং নতুন `reverseJournalEntry(entryId)` দিয়ে একটা নির্দিষ্ট payment-এর journal আলাদা করে রিভার্স করা যায়।
- **যাচাই:** delete-expense এখন সব leg (EXPENSE + প্রতিটি EXPENSE_PAYMENT) রিভার্স করে; account-level net **শূন্য** (`deleting an expense fully reverses every ledger leg` PASS)। Voided invoice-ও সব অ্যাকাউন্টে net শূন্য।

---

## ২. P1 — High

| # | Finding | ফিক্স | যাচাই |
|---|---|---|---|
| F-04 | collect-এর চেয়ে বেশি refund | `invoiceTotals` এখন credit note/write-off-ও ধরে; refund ≤ paid, credit ≤ outstanding — **server + UI `max`** | over-refund → **400**; credit modal max ৳1.15L (collected)/৳76,800 (outstanding); credit note এখন invoice balance কমায় (1050→850) |
| F-05 | delete করলে cash ফেরে না, journal অসম্পূর্ণ | delete এখন সব journal রিভার্স করে এবং **যত টাকা সত্যিই দেওয়া হয়েছে** ঠিক তত ফেরায় | `delete restores only the cash actually paid` (৳14,500) + ledger net zero |
| F-06 | approved expense-এর amount এডিটে bank adjust হতো না | amount বদলালে GL-এর সাথে **bank-ও delta-য় ছোটে** | `editing an approved expense keeps bank and GL in step` (bank −৪,০০০, GL +৪,০০০) |
| F-07 | Reconciliation UI কখনো ডেটা লোড করত না | bank accounts লোড হলে প্রথম account adopt করার `useEffect` | UI-তে DBBL-এর ৯টি transaction + ৩টি statement record দেখা যাচ্ছে |
| F-08 | list create/delete-এর পর refresh হতো না | paged query-তে `refreshKey` যোগ | create → `1–12 of 19` তাৎক্ষণিক; delete → `1–12 of 18`, row গায়েব (reload ছাড়াই) |
| F-09 | overdue একদিন দেরিতে | server `startOfTodayUtc` + client `daysLate` (UTC দিন-তুলনা) | ZLM-2026-0045 (due 9 Nov) এখন **OVERDUE**, chips-এর সাথে মিলে |
| F-10 | multi-currency GL/reports-এ কনভার্ট হতো না | `toBdt()` সব GL leg + bank + report aggregate-এ | USD 100 @110 → AR debit **৳11,000** |
| F-11 | GL cash ≠ bank, negative FX asset, "balanced" tautology | opening-balance backfill + seed ফিক্স; equity breakdown (retained + current profit) + **আসল** `assets = liabilities + equity` চেক; FX inventory negative হতে দেয় না | cash ৳37.8L == bank; FX ৳0; `Assets = liabilities + equity ✓`; `trialBalanced=true` |
| F-12 | Tax report-এ Collected সবসময় ৳0 | quarter অনুযায়ী আসল payment থেকে collect | Q3 ৳5.80L + Q4 ৳4.85L = **৳10.7L** |
| F-13 | matrix-এ অস্তিত্বহীন role + negative limit → unlimited | policy GET এখন Asal role list দেয়; UI সেই list ব্যবহার করে; negative limit **400** | role list: Finance/HR-Admin/Owner/Project Manager/Sales-BD/Team Member |
| F-14 | যে কেউ expense delete করতে পারত | `@Roles("Owner","Finance","CONTROL")` — view-only role 403 | HR/Admin delete → **403**, Finance → 200 |
| F-15 | approve না হওয়া expense পেমেন্ট হতো | `payExpense` এখন APPROVED দাবি করে | PENDING-এ payment → **400** |

---

## ৩. P2 — Medium

| # | Finding | অবস্থা |
|---|---|---|
| F-16 | negative/zero expense | ✅ এখন **400** |
| F-17 | negative line price; খালি invoice; FX rate ছাড়া foreign invoice | ✅ সবই **400** (description/qty/rate validation যোগ) |
| F-18 | lists-এ ৫০০-row silent cap | ⚠️ সীমা আছে (ডকুমেন্টেড); server-side pagination ভবিষ্যতের কাজ |
| F-19 | concurrent invoice numbering collision | ✅ P2002 হলে নতুন নম্বর দিয়ে retry → **৬/৬ success** |
| F-20 | search placeholder ভুল বোঝাত | ✅ "Search by invoice # or client…" |
| F-21 | failed receipt upload-এ orphan file | ✅ 404 হলে ফাইল unlink; receipt না থাকলে **404** |
| F-22 | payment মুছার উপায় ছিল না | ✅ নতুন `DELETE /capital/invoices/:id/payments/:paymentId` + detail drawer-ে two-step delete button |
| F-23 | manual income edit/delete ছিল না | ✅ নতুন `DELETE /capital/income/:id` (+ UI button), bank ও ledger reverse করে |
| F-24 | weekly cash-flow ভুল bucketing; cash-flow অসঙ্গতি; collected নিয়ে ভুল গোনা | ✅ payment date-এ bucketing; cash-flow-এ `reconciled` flag; overview শুধু live invoice গোনে |
| F-25 | "18 invoices in view" (draft সহ) | ✅ "15 live invoices" |
| F-26 | Cash position-এর নিচে ভুল সাবলাইন | ✅ "across all bank accounts" |
| F-27 | list বনাম detail status অসঙ্গতি | ✅ money-affecting এডিটের পর status recompute; দুটোই মেলে |
| F-28 | PDF-এ placeholder signer + raw enum method | ✅ signer না থাকলে placeholder বাদ; `BANK_TRANSFER → Bank Transfer` |
| F-29 | delete confirm-এ ভুল কপি | ✅ draft → "Delete draft…cannot be undone"; issued → "Void…stays in ledger"; expense → "ledger.postings reversed and cash returned" |

---

## ৪. নতুন যোগ হয়েছে

- `scripts/backfill-opening-balances.mjs` — বিদ্যমান DB-এর GL cash vs bank মেলায় ও FX inventory ঠিক করে (idempotent)। `seed.ts`-এও একই opening journal যোগ, যাতে fresh DB থেকেই সব মেলে।
- API: `DELETE /capital/invoices/:id/payments/:paymentId`, `DELETE /capital/income/:id`; `GET /capital/approval-policy` এখন `availableRoles` দেয়।
- Ledger: `accountBalance()`, `reverseJournalEntry()`।

## ৫. পরিবর্তিত ফাইল

**Backend:** `finance-kernel.ts` · `ledger.service.ts` · `invoice.service.ts` · `expense.service.ts` · `reporting.service.ts` · `approval-policy.service.ts` · `masters.service.ts` · `dollar.service.ts` · `capital.service.ts` · `capital.controller.ts` · `prisma/seed.ts`
**Frontend:** `lib/invoice-utils.ts` · `lib/invoice-pdf.ts` · `capital/_components/{tabs,modals,capital-context,capital-shell,invoice-detail-modal,approval-policy}.tsx` · `capital/invoices/page.tsx`
**নতুন:** `scripts/backfill-opening-balances.mjs`

## ৬. যাচাই আর্টিফ্যাক্ট

`qa-evidence/finance-audit/` → `api-run-postfix.log` (১১৩ checks, **0 fail**) · `api-run-2-postfix.log` (১৮ probes, **0 fail**) · `probe-4.mjs` (payment delete + installments, **0 fail**) · `ui-17…ui-20-*.png` (reconciliation, statements, approval matrix, invoice detail)।

## ৭. প্রস্তাবিত পরবর্তী ধাপ (নন-ব্লকিং)

- Expense/legacy invoice list-এ server-side pagination (F-18)।
- foreign-currency invoice-এর detail modal-এ `formatMoney(currency)` ব্যবহার (PDF-এ আগেই ঠিক)।
- credit note void/reverse-এর আলাদা UI।
- বেতন-সংক্রান্ত পুনর্মিলন UI-তে auto-match suggestion।

---

## ৮. Dollar Desk → Client File ও Client Portal (নতুন)

**সমস্যা:** ক্লায়েন্ট যখন ডলার কিনত (`DollarSale`), সেই তথ্য শুধু **Capital → Dollar Desk**-এ দেখা যেত। **Accounts → client file** এবং **client portal** — দুটোতেই একেবারে অনুপস্থিত ছিল।

### যা যোগ হয়েছে

- **Shared projection** — `apps/api/src/common/dollar-purchases.ts`। একই সারি থেকে দুটো view: internal (cost rate, profit, margin সহ) এবং client-facing (এগুলো বাদ)।
- **Client file (Accounts)** — `GET /accounts/clients/:id` এখন `dollar: { summary, purchases }` দেয়। Overview ট্যাবে নতুন **USD purchases** কার্ড: USD bought · BDT paid · avg rate · FX margin + সর্বশেষ ৫টি কেনা + Dollar Desk লিংক।
- **Client portal** — `portal-client/invoices` ও `overview` এখন `dollarPurchases` দেয়। Invoices ট্যাবে summary কার্ড + টেবিল (date · reference · USD · rate · BDT paid · method); ড্যাশবোর্ডের “Due this month” কার্ডে compact **USD bought** লাইন।
- **তথ্য সুরক্ষা** — portal projection-এ `costRate / costBdt / profit / marginPct / notes` কখনো পাঠানো হয় না; ক্লায়েন্ট শুধু তাদের কেনা USD, rate আর BDT देखে (agency-র margin তাদের ডেটা নয়)।

### যাচাই

- API: client file-এ summary `{count, totalUsd, totalBdt, totalProfit, averageRate}`; portal-এ একই সংখ্যা কিন্তু profit/cost শূন্য-অনুপস্থিত।
- UI: `qa-evidence/finance-audit/ui-21-portal-dollar.png`, `ui-22-accounts-dollar.png`, `ui-23-portal-dashboard-dollar.png`।
- Regression test: `apps/web/e2e/finance-dollar-portal.spec.ts` — sale তৈরি → client file + portal + overview-এ দেখা যায়, margin leak হয় না, শেষে sale নিজে থেকেই মুছে যায়। **1/1 pass**; সম্পূর্ণ finance e2e **5/5 pass**।
- `npm run typecheck` ✓ · `npm run build` ✓ (48 pages) · console errors 0।
- ডেমো ডেটা baseline-এ ফেরানো: DollarSale 5 · Invoice 18 · Expense 8 · Payment 11 · CreditNote 0 · GL cash == bank == ৳37,79,000 · FX inventory ৳0।

