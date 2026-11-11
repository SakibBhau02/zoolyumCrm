# QA Audit Report — Capital / Finance Module

**Project:** Zoolyum OS (`E:\open code\zoolyumCrm`)
**Module under test:** Capital → Finance (Overview · Invoices · Expenses · Income · Vendors · Liabilities · Dollar Desk · Reports · Profitability · Accounts · Activity + public invoice share + expense receipts)
**Date:** 10 Nov 2026
**Auditor role:** QA / SDET
**Environment:** local dev — API `http://localhost:4000/api` (NestJS + Prisma + PostgreSQL on :5544), Web `http://localhost:3000` (Next.js), seeded demo workspace (18 invoices, 8 expenses, 11 payments, 5 dollar sales).

---

## 1. সারসংক্ষেপ (Summary)

স্কোপের সবকিছু **খুব গভীরভাবে** টেস্ট করা হয়েছে: ১১৪টি live API assertion, ২৪টি targeted probe, ১১টি DB-level ledger-reconciliation query, ৮টি পেজের UI ফ্লো, PDF/CSV ডাউনলোড যাচাই (PDF রেন্ডার করে চোখে দেখা), mobile 390px, এবং پروজেক্টের নিজের e2e + typecheck।

**এক নজরে:**

| ক্ষেত্র | ফল |
|---|---|
| API endpoints (availability, authz, 404/400 handling) | 🟢 বেশিরভাগই শক্ত |
| Invoice টোটাল ম্যাথে (subtotal/tax/discount/shipping/grand) | 🟢 সঠিক |
| Double-entry ledger / GL | 🔴 **গুরুতর সমস্যা** (duplicate posting, ভুল reversal, cash drift) |
| Expense approval matrix | 🟠 নীতিটা কাজ করে, কিন্তু UI দিয়ে expense **তৈরি-ই করা যায় না** |
| Reports / Statements নির্ভরযোগ্যতা | 🔴 **বিশ্বাস করা যায় না** (cash ভুল, tax collected = 0, balanced flag meaningless) |
| UI ফ্লো (list, drawer, modals, filters, pagination, bulk, CSV, PDF) | 🟠 অনেকগুলো কাজ করে, কিন্তু কয়েকটা critical ভাঙা |
| Responsive / console errors / typecheck | 🟢 390px ঠিক, console errors 0, `tsc --noEmit` 0 error, নিজের e2e 3/3 pass |

**মোট:** ৩টি Critical (P0), ১১টি High (P1), ১৪টি Medium (P2), কয়েকটি Low/UX। **সবচেয়ে জরুরি দুটো:** (১) UI থেকে কোনো expense রেকর্ড করা যায় না, (২) একটি invoice/expense এডিট করলে ledger-এ টাকার এন্ট্রি duaplicake/book হয়।

> টেস্টের সময় যা যা তৈরি হয়েছে তা **সম্পূর্ণ পরিষ্কার করা হয়েছে** — GL আবার baseline-এ (debits = credits = ৳38,43,200), bank balance, invoice/expense count সব আগের মতো।

---

## 2. পদ্ধতি (Methodology)

1. **Recon** — capital module-এর ১৩টি backend service, controller, Prisma schema ও frontend tabs/modals পড়ে ফিচার ম্যাপ তৈরি।
2. **Live API testing** — ৫টি seeded রোল (Owner, Finance, Sales/BD, Project Manager, HR/Admin) দিয়ে endpoint matrix + CRUD + negative/edge case। স্ক্রিপ্ট: `qa-evidence/finance-audit/api-audit.mjs`।
3. **Ledger forensics** — প্রতিটি mutation-এর পর DB-তে `JournalEntry/JournalEntryLine` সরাসরি query করে posting count, reversal, ও net amount মিলিয়ে দেখা (Prisma + SQL)।
4. **UI testing** — Playwright দিয়ে আসল ব্রাউজারে login, প্রতিটি ট্যাব, detail drawer, modals, validation, bulk bar, PDF download, 390px। screenshots: `qa-evidence/finance-audit/ui-*.png`।
5. **Regression** — `npm run typecheck`, `apps/web` e2e (`finance-pro-ui.spec.ts`) চালানো।

---

## 3. 🔴 Critical (P0) — এখনই ঠিক করা দরকার

### F-01. UI থেকে কোনো Expense রেকর্ড করা যায় না (সব রোলের জন্য ভাঙা)
**প্রভাব:** Capital-এর সবচেয়ে বেসিক কাজটা (খরচ এন্ট্রি) UI থেকে অসম্ভব।

**কারণ (chain):**
- `modals.tsx:931` — `canDirect = ["Owner","Finance","Admin","HR/Admin","CONTROL"].includes(user.role)` → Owner/Finance-এর জন্য `true`
- `modals.tsx:1031` — ফলে POST body-তে `approvalStatus: "APPROVED"` পাঠায়
- `expense.service.ts:104-106` — create-path-এ `assertCanApprove({ actorId: submittedById, …, submittedById })` কল করে
- `approval-policy.service.ts:103-105` — submitter নিজেই approver → `403 "You cannot approve an expense you submitted yourself"`

**রিপ্রো (verified):**
1. Owner/Finance দিয়ে login → Expenses → **Record Expense** → যেকোনো amount → Save।
2. রেসপন্স: `403 You cannot approve an expense you submitted yourself` (UI-তে লাল লেখা)।
3. একই রকম API: `POST /capital/expenses {approvalStatus:"APPROVED"}` → 403।

**এভিডেন্স:** `ui-08-expense-save-blocked.png`; API result — `Owner 403`, `Finance 403`।

**সাজেশন:** create-পথে self-approval চেক বাদ দিন (`submittedById` থাকলে OWNER-এর নিজের জন্য exempt), অথবা UI আর `APPROVED` না পাঠিয়ে `PENDING` পাঠাক, অথবা policy-তে `requireDifferentApprover` শুধু APPROVED *transition*-এ প্রয়োগ করুন — creation-এ নয়। পাশাপাশি "Posts … immediately" কপি তখনই দেখান যখন সত্যিই হবে।

---

### F-02. Issued invoice / approved expense এডিট করলে ledger-এ posting duaplicake/book হয়
**প্রভাব:** ভুল revenue, ভুল AR, ভুল expense/AP — প্রতিটি non-financial edit (notes, due date, terms) টাকা দুইবার গুনে।

**কারণ:**
- `invoice.service.ts:519` — `updateInvoice`-এ শর্তহীন `postInvoiceGL(next)` চলে
- রিভার্স হয় শুধু `body.lines/status/tax/…` বদলালে (`:506`)
- তাই শুধু notes এডিট করলে রিভার্স হয় না, কিন্তু আবার পোস্ট হয় → **ডুপ্লিকেট**
- একই প্যাটার্ন expense-এ: `expense.service.ts:267` শর্তহীন `postExpenseGL(next)`, রিভার্স শুধু amount/category/isPayable/accountId বদলালে (`:245`)

**রিপ্রো (verified):**
1. Draft invoice (grand ৳470) → SENT। journal count = **1**।
2. `PATCH /capital/invoices/:id { notes: "x" }` → journal count = **2** (দুটোই same reference, কোনো reversal নেই)।
3. একইভাবে approved expense → `PATCH { notes }` → journal 1 → **2**।

**এভিডেন্স:** `db-evidence.txt` §A — `INVOICE ZLM-2026-0053 ৳510` দুইবার, ১০০ms ব্যবধানে; expense `EXP-l8bmoc91` ৳15,000 দুইবার (মোট ৳30,000, কিন্তু আসল খরচ ৳15,000)।

**সাজেশন:** `updateInvoice`/`updateExpense`—এ শুধু *ledger-affecting* পরিবর্তন থাকলেই reverse + re-post করুন; নাহলে একদম post করবেন না।

---

### F-03. `reverseGL` ভুল journal রিভার্স করে (একই source-এ একাধিক এন্ট্রি)
**প্রভাব:** Invoice-এর payment journal ভুলভাবে রিভার্স হয়; invoice-এর নিজের journal অক্ষত থেকে যায় → AR/revenue এলোমেলো।

**কারণ:** `ledger.service.ts:76-95` — `reverseGL(sourceId)` খুঁজে newest un-reversed entry। কিন্তু invoice-এর invoice-journal, প্রতিটি payment-journal, refund—সবগুলো `sourceId = invoiceId` (`invoice.service.ts:692`)। অর্থাৎ payment-ই newest হলে payment রিভার্স হয়।

**রিপ্রো (verified):** invoice-এ ২টি payment দেওয়ার পর lines এডিট → GL-তে `PAYMENT … (reversed)` দেখা গেল, কোনো `INVOICE … (reversed)` নেই। Net AR debit ৳3,370 অথচ invoice grand ৳2,150।

**এভিডেন্স:** `db-evidence.txt` §A (6 rows)।

**সাজেশন:** reversal-এ `entryType` (বা নির্দিষ্ট `entryId`) দিয়ে scope করুন; অথবা payment-এর `sourceId` আলাদা করুন (`payment.id`)।

---

## 4. 🟠 High (P1)

### F-04. Refund collect-করা টাকার চেয়ে বেশি দেওয়া যায় → bank/P&L ধ্বংস
Invoice-এ collected ৳1,100 থাকলেও **৳99,999 refund** গ্রহণ করা হয় (API 201)। ফল: net paid = −৳98,899, bank থেকে ৯৯,৯৯৯ টাকা বেরিয়ে গেল, আর invoice-এ ৳1,01,049-এর ভুতুড়ে receivable দেখায় (status `SENT`)। UI-এর amount ইনপুটেও `max` নেই (default শুধু collected)। credit note-ও invoice-এর balance কমায় না — শুধু GL/AR সরে।
**Repro:** PO #5 credit-notes REFUND amount > collected → 201. **Evidence:** api-run log `CREDIT | refund larger than amount collected … 99999`; `db-evidence.txt` §C।
**Fix:** `amount ≤ paid − alreadyRefunded` server-side enforce করুন + UI max + credit note-কে receivable হিসাবেও নামান।

### F-05. Payment-সহ approved expense delete করলে cash ফেরে না + journal অসম্পূর্ণ থাকে
`expense.service.ts:311-334` — payable হলে bank restore-ই হয় না; `reverseGL` শুধু newest (payment) journal রিভার্স করে। যাচাই: delete-এর পর EXPENSE ৳30,000 + payment ৳5,000 un-reversed রইল, bank-এ ৳14,500 ফেরেনি। **Evidence:** `db-evidence.txt` §B।

### F-06. Approved expense-এর amount এডিট করলে bank adjust হয় না
৳1,000 → ৳5,000 (non-payable, অনুমোদিত): GL cash ৳4,000 বেশি ডেবিট হলো, কিন্তু `BankAccount.currentBalance` বদলাল **0**। GL-cash vs bank drift তৈরি হয়। **Evidence:** api-audit-2 result — `GL cash changed by 4000 but BankAccount changed by 0`।

### F-07. Bank Reconciliation UI কখনো ডেটা লোড করে না
`tabs.tsx:1391` — `useState(bankAccounts[0]?.id ?? "")`; `bankAccounts` প্রথমে খালি, তাই state `""`-তে আটকে যায়, `useEffect` (`:1405`) early-return করে। UI-তে "No transactions / No statement entries" দেখায়, অথচ API `GET /capital/bank-accounts/:id/transactions` ৯টি transaction + ৩টি record দেয়। Overview/Income-এর "reconcile →" লিংকও তাই dead-end। **Evidence:** `ui-13-reconciliation.png` + API result।
**Fix:** bankAccounts লোড হলে `useEffect` দিয়ে `reconAccount` set করুন।

### F-08. Invoice list create/delete-এর পর refresh হয় না
`tabs.tsx:399` — paged query key শুধু `qs`; `doDelete`/create শুধু context `refreshKey` বাড়ায়, tab-এর নিজের `mutate` ডাকে না। যাচাই: draft invoice UI থেকে delete করার পর row + footer "1–1 of 1 invoices" রয়ে গেল; ম্যানুয়াল reload-এ গায়েব। **Evidence:** invoices page finding (DB-তে row delete হয়েছিল, তবু UI-তে ছিল)।
**Fix:** `qs`-এ `refreshKey` যোগ করুন বা delete/create-এ tab-এর `reload()` কল করুন।

### F-09. Overdue status একদিন দেরিতে হয় (timezone off-by-one)
`invoice.service.ts:58-59` — `today = new Date(); setHours(0,0,0,0)` (local midnight, Dhaka +6) Prisma-তে `@db.Date` column-এর সাথে UTC-তে তুলনা হয় → `today` হয়ে যায় আগের UTC দিন। যাচাই: `ZLM-2026-0045` due ৯ Nov, আজ ১০ Nov — status এখনো `SENT`; অথচ সে "Overdue 5" চিপে আছে আর overview-তে overdue গোনা হচ্ছে। আবার Overview-এর Ageing কলাম "—" দেখায়, Invoices টেবিলে "1d late" (দুই স্ক্রিনে অসঙ্গতি)। **Evidence:** `ui-03`, filter result rows, probe-overdue output (`today: 2026-11-09T18:00Z` → 0 match)।
**Fix:** date-only compare UTC-তে করুন (`Date.UTC(y,m,d)`) বা `@db.Date`-এর সাথে `startOfDay` ধারাবাহিক রাখুন।

### F-10. Multi-currency শুধু সাজসজ্জা — GL/totals-এ কনভার্ট হয় না
UI-তে USD/EUR/GBP/INR চয়েস আছে; কিন্তু `invoiceTotals`/`postInvoiceGL` `currency`/`exchangeRate` সম্পূর্ণ تجاهل করে। USD 100 @110 invoice → ledger-এ AR debit **৳100** (১১,০০০ নয়)।

### F-11. Baseline-এই GL ও Bank মেলে না; Statement-গুলোর ওপর ভরসা করা যায় না
- GL Cash & Bank (1200) = **৳7.18L**, অথচ Bank accounts মোট **৳37.8L** → পার্থক্য ≈ **৳30.6L** (opening balance GL-তে পোস্ট করা হয়নি)।
- `USD / FX Inventory (1250)` = **−৳40,300** (negative asset), `VAT Payable` negative।
- `balanceSheet.balanced` সর্বদা `true` — কারণ `equity = assets − liabilities` সেট করে আবার সেটাই চেক করা হয় (`reporting.service.ts:327-334`) → কখনো imbalance ধরবে না।
**Evidence:** `ui-11-gl-statements.png`, `ui-10-reports.png` stats।

### F-12. Tax Report-এ Collected সবসময় ৳0
`reporting.service.ts:514` — `collected: 0` hard-coded; quarterly + totals সবই ৳0, অথচ ৳10.7L collect হয়েছে। **Evidence:** `ui-12-tax.png`।

### F-13. Approval matrix-এ অস্তিত্বহীন/অক্ষম রোল
মডালের ড্রপডাউনে "Manager", "Admin", "CONTROL" আছে; আসল seeded রোল: Sales/BD, Project Manager, Team Member, HR/Admin, Finance, Owner। অর্থাৎ HR/Admin ও "Admin" সিলেক্ট করলে কোনো কাজ করবে না (HR/Admin-এর CAPITAL view-only → approve endpoint-এই 403)। "Manager" ≠ "Project Manager" (name mismatch)। **Evidence:** `ui-07-approval-matrix.png`; API — HR/Admin approve → 403।
**অতিরিক্ত:** negative limit `Math.max(0, Number(x)||0)` → **−5000 হলে 0 = unlimited**; টাইপো একটাই সীমা তুলে দিতে পারে।

### F-14. যেকোনো CAPITAL-edit ইউজার যেকোনো expense delete করতে পারে
`DELETE /capital/expenses/:id`-এ কোনো role/ownership চেক নেই; Finance, Owner-এর সাবমিট করা expense delete করে ফেলল (২০০)।

### F-15. Approve না হওয়া (PENDING) expense-ও পেমেন্ট করা যায়
`payExpense` (`expense.service.ts:339`) `approvalStatus` চেক করে না → PENDING expense-এ vendor payment 201।

---

## 5. 🟡 Medium (P2)

| # | Findings | এভিডেন্স/নোট |
|---|---|---|
| F-16 | Negative (−500) ও zero (0) amount-এর expense accepted; শুধু missing/NaN আটকায় | probe-2 `negative expense amount accepted` |
| F-17 | Negative invoice line price accepted; server-এ ≥1 line বা amount>0 validation নেই (শুধু UI-তে) | api-audit `negative line price accepted` |
| F-18 | `/capital/expenses` ও legacy `/capital/invoices`-এ `take: 500` silent truncation, total/cursor নেই → ৫০০+ হলে UI total/CSV ভুল | `expense.service.ts:41`, `invoice.service.ts:128` |
| F-19 | Concurrent invoice creation-এ collision: ৬টি parallel create → ১ success, ৫× **409** (retry/sequence নেই) | api-audit `concurrent invoice numbering created=1/6` |
| F-20 | Invoice search placeholder "Search invoices…" কিন্তু server শুধু number + client name খোঁজে (line description/notes নয়) | api-audit `text search filters server-side total=0` |
| F-21 | Non-existent expense-এ receipt upload করলে ফাইল disk-এ লেখা হয়ে তারপর 404 → orphan files | probe-2 `receipt upload writes the file before checking` |
| F-22 | Payment/expense journal একই sourceId শেয়ার; payment মুছে ফেলার কোনো endpoint নেই (শুধু refund) | schema/`invoice.service.ts` |
| F-23 | Manual income-এ update/delete endpoint নেই → ভুল এন্ট্রি DB ছাড়া ঠিক করা যায় না | api-audit `DELETE /capital/income/:id` 404 |
| F-24 | Reports inconsistency: weekly cash-flow invoice *issue date*-এ bucket হয় (payment date-এ নয়); cash-flow statement-এ `netOperating` (GL) ≠ `closingBalance` (bank); overview `collected` non-active invoice-এর payment-ও গোনে (collection rate >100% হতে পারে) | reporting.service.ts |
| F-25 | Invoices KPI: "Issued ৳18.1L / **18 invoices in view**" — amount শুধু issued (১৫), गणना সব row (draft সহ) | `ui-03` |
| F-26 | Overview "Cash position" কার্ডের নিচে ভুল সাবলাইন "no spend this month" | `ui-01` |
| F-27 | Invoice status staleness: PAID invoice-এর lines বদলালে **list-এ PAID** থাকে, **detail** self-heal করে PARTIALLY_PAID — list ও detail অসঙ্গত | api-audit `list=PAID detail=PARTIALLY_PAID` |
| F-28 | PDF-এ signer placeholder ছাপা হয় ("Authorized Representative"/"Authorized Signature"); payment method raw enum (`BANK_TRANSFER`); ছোট invoice-এ বড় ফাঁকা জায়গা | `ui-16-invoice-pdf.png` |
| F-29 | Delete confirm সবসময় "This cannot be undone" বলে, অথচ issued invoice আসলে **void** হয় (রেকর্ড থাকে) | `ui-15`-এর পাশের dialog |

---

## 6. 🟢 যা ঠিকমতো কাজ করছে (Verified Pass)

- **Authz matrix সঠিক:** Sales/BD → 403; PM ও HR/Admin → read-only (write 403); Finance/Owner full। ৪০৩ মেসেজ পরিষ্কার।
- **Invoice ম্যাথ:** `unitPrice × quantity`, tax (applicable হলে), discount, shipping, grand — সব সঠিক; UI live preview API-র সাথে মেলে।
- **Guards:** DRAFT-এ payment refused; VOID-এ payment refused; payment থাকলে delete refused; credit note থাকলে delete refused; cross-client project mismatch 400; void সঠিকভাবে journal reverse করে; overpayment → CreditBalance।
- **Public share:** `/public/invoices/by-token/:token` 200 (login ছাড়া), QR PDF-এ ঠিক।
- **Receipt:** PNG/JPEG/WebP/PDF সীমা, 8MB, path-traversal blocked, unguessable নামে public serve — কাজ করছে।
- **Approval policy:** GET/PATCH কাজ করে, save করলে বাকি `financeConfig` অক্ষত থাকে; matrix limit ও self-approval server-side সত্যিই enforce হয়; capability map UI-তে সৎ (button ধূসর + কারণ)।
- **Aggregates মিলে:** `overview.outstanding == aging.totalOutstanding`; ageing buckets ↔ total; page `sums.billed == overview.totalInvoiced`; Trial Balance debits == credits; AP ageing buckets == payable।
- **UI:** pagination clamp (pageSize 100, page 999→last), overdue chip 5 rows ↔ "1–5 of 5", bulk bar (Mark as sent paid-row-এ disabled), CSV/pager, filters, mobile 390px কোনো horizontal overflow নেই, **console errors 0**।
- **Tooling:** `npm run typecheck` → 0 error (api+web); `apps/web` e2e `finance-pro-ui.spec.ts` → **3/3 pass**।

> নোট: e2e টেস্টগুলো শুধু modal **খোলে ও Cancel** করে, কখনো Save করে না — তাই F-01 ধরতে পারেনি। টেস্ট কভারেজ গ্যাপ।

---

## 7. অগ্রাধিকারভিত্তিক ফিক্স-প্ল্যান

| ক্রম | আইটেম | ধরণ | আনুমানিক পরিশ্রম |
|---|---|---|---|
| 1 | F-01 expense creation (UI + server) | Backend+Frontend | ছোট |
| 2 | F-02 duplicate GL posting on edit | Backend | ছোট |
| 3 | F-03 reverseGL wrong journal | Backend | ছোট |
| 4 | F-04 refund cap + credit note ↔ receivable | Backend+Frontend | মাঝারি |
| 5 | F-05/F-06 expense delete/edit cash ও reversal | Backend | মাঝারি |
| 6 | F-07 reconciliation UI state | Frontend | ছোট |
| 7 | F-08 invoice list refresh | Frontend | ছোট |
| 8 | F-09 timezone overdue | Backend+Frontend | ছোট |
| 9 | F-11/F-12/F-13 statements + matrix | Backend | মাঝারি |
| 10 | F-10 multi-currency, F-14…F-29 | — | ব্যাচে |

**নতুন টেস্ট যোগ করার পরামর্শ:** (ক) “create → edit notes → ledger count অপরিবর্তিত”, (খ) “create invoice → list-এ দেখা যায়”, (গ) “refund > collected → 400”, (ঘ) “delete approved expense → bank ও GL মেলে”, (ঙ) “UI দিয়ে expense save → 201” — এই পাঁচটা থাকলেই উপরের P0/P1 পুনরাবৃত্তি আটকাবে।

---

## 8. আর্টিফ্যাক্ট (Evidence)

সব ফাইল `qa-evidence/finance-audit/`-এ (repo gitignore-কৃত):

| ফাইল | কী |
|---|---|
| `api-audit.mjs` / `api-results.json` / `api-run.log` | ১১৪টি API assertion-এর ফল |
| `api-audit-2.mjs` / `api-results-2.json` / `api-run-2.log` | ১৮টি targeted probe |
| `probe-3.mjs`, `probe-overdue.mjs` | edge case + timezone প্রমাণ |
| `db-evidence.txt` | ledger forensics (duplicate/reversal/cash) |
| `ui-01…ui-16-*.png` | প্রতিটি পেজ, modal, mobile, PDF/reconciliation |
| `sample-invoice.pdf` | ডাউনলোড করা invoice PDF |
| `cleanup.mjs` | টেস্ট ডেটা রিমুভ (state baseline-এ ফেরানো) |

**পরিবেশ পুনরুদ্ধার যাচাই:** GL `debits = credits = ৳38,43,200`; Invoice 18, Expense 8, Payment 11, DollarSale 5, CreditNote 0; bank: DBBL ৳26,89,000 · Nagad ৳3,20,000 · bKash ৳6,80,000 · Petty Cash ৳90,000 — সব baseline-এর সমান।
