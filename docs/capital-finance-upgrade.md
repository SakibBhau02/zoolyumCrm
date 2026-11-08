# Capital (Finance) — professional upgrade

কেন্দ্র: **invoice · expense · income** — তিনটি ট্যাব এবং Overview। মূল লক্ষ্য ছিল (১) চোখে পড়া ভাঙা জিনিস ঠিক করা, (২) ইনভয়েস ডাউনলোড/প্রিন্ট সব জায়গা থেকে পাওয়া, (৩) টাকা কোথায় আটকে আছে সেটা এক নজরে বোঝা।

---

## 1. ইনভয়েস PDF — আসল সমস্যা (ডাউনলোড করে যাচাই করা)

`ZLM-2026-0041` ডাউনলোড করে পেজ রেন্ডার করে দেখা হয়েছে। যা ভাঙা ছিল:

| # | সমস্যা | কারণ | সমাধান |
|---|---|---|---|
| 1 | **Project Statement** ডান কলামে চেপে বসে ছিল — Balance Due-এর নিচে, ৭২mm চওড়া কলামে, invoice/payment লাইনগুলো একটার নিচে একটা | PDF কোডে statement-টা totals কলামের ভেতরে (`totalsL`) আঁকা হচ্ছিল | এখন **full-width ব্যান্ড** — ৩টি সারাংশ ফিগার (Project value / Paid to date / Balance due) + নিচে হিস্ট্রি |
| 2 | **"TERMS & CONDITIONS"** হেডিং ছাপা হচ্ছিল কিন্তু নিচে কিছুই নেই | হেডিং সর্বদা আঁকা হতো, টেক্সট থাকুক বা না | এখন কনটেন্ট থাকলেই হেডিং; না থাকলে বাদ (notes থাকলে "NOTES") |
| 3 | মাঝখানে বিশাল সাদা ফাঁকা, ফুটার নিচে চেপে বসানো | ফুটার `PAGE_H - …` এ pin করা ছিল | ফুটার এখন কনটেন্টের পরেই (flow); লম্বা ইনভয়েসে পেজ ব্রেক ঠিক আগের মতোই |
| 4 | **Payment Instructions** এ শুধু "Ref: Invoice #…" — ব্যাংক ডিটেইল সেট না থাকলে ব্লকটা ভাঙা দেখাত | fallback লাইন ছিল না | fallback: "Please transfer the balance and quote the reference below." |
| 5 | Project statement-এ তারিখ `2026-10-16` (ISO) — বাকি পেজে `14 Oct 2026` | `dateOnly()` ব্যবহার | `dateShort()` — পুরো শিটে একই ফরম্যাট |

**নতুন লেআউট (যাচাই করা):** হেডার → Billed to / Payment instructions → items → payment history + totals → **full-width project statement** → in-words → terms/QR/signature → footer।

## 2. ডাউনলোড ও প্রিন্ট — সব এন্ট্রি পয়েন্ট

আগে PDF শুধু invoice detail শিট থেকে পাওয়া যেত, আর **Print preview মোডালে শুধু "Print" ছিল**।

| জায়গা | আগে | এখন |
|---|---|---|
| Invoice list row | ✗ | **Download icon** (প্রতি সারিতে, ব্যাকএন্ড থেকে ফুল পেলোড এনে PDF) |
| Invoice detail | ✓ Download PDF | ✓ |
| **Print preview modal** | শুধু Print | **Download PDF + Print** |
| Public share link `/p/inv/[token]` | ✓ | ✓ (অপরিবর্তিত) |
| List footer | ✗ | **CSV** (ফিল্টার করা লিস্ট) |
| Receipt (payment) | ✓ | ✓ |
| **Payslip** | শুধু Print | **Download PDF** (`lib/payslip-pdf.ts`) |

নতুন হেল্পার: `_components/invoice-download.ts` — detail, project statement, share token (QR-এর জন্য) সব একসাথে এনে একই PDF বানায়, তাই তিন জায়গা থেকেই ফাইল অভিন্ন।

## 3. Overview — data-driven

আগে: ৪টি বড় নম্বর + ট্রেন্ড + ৮টি ইনভয়েস — "তাহলে এখন কী করব?" উত্তর ছিল না।

এখন:

1. **Needs attention** স্ট্রিপ (শুধু প্রযোজ্য হলে):
   - কত ইনভয়েস overdue + কত টাকা
   - কত installment overdue
   - কত expense approval-এ অপেক্ষা করছে
   - কত draft ইনভয়েস ইস্যু হয়নি
2. **KPI** — Total invoiced · Collected (**collection rate %**) · Outstanding (**% overdue**) · **Cash position** (ব্যাংক ব্যালান্স)
3. **Receivables ageing** — CURRENT / 1–30 / 31–60 / 61–90 / 90+ বার + **Top exposures** (কোন ক্লায়েন্টের কাছে কত, ৯০+ আলাদা করে)
4. **Recent invoices** টেবিলে নতুন **Ageing কলাম** (`42d late`, ৩০/৬০ দিনে রঙ বদলায়) — কোনটা তাড়া করতে হবে এক নজরে
5. Recent expenses আগের মতোই, কিন্তু "this month" সংখ্যা শূন্য হলে ভিন্ন ভাষায়

## 4. Invoices ট্যাব

- **KPI স্ট্রিপ**: Issued · Collected (% of issued) · Outstanding (৭ দিনে কত due) · **Overdue** (কত ইনভয়েস, কত টাকা)
- **কুইক চিপস** (কাউন্ট সহ): All · **Overdue** · **Due ≤ 7 days** · **Drafts** · **Paid**
- তালিকায় **days-late** ইঙ্গিত (`due 31 Oct · 5d late`), ৩০/৬০ দিনে রঙ
- প্রতি সারিতে **PDF ডাউনলোড**, সাথে View / Duplicate / Delete
- ফুটারে মোট: issued + due + **CSV**

## 5. Expenses ট্যাব

- **KPI**: Spend in view · **Client-billable** (% recoverable) · **Awaiting approval** (টাকা + সংখ্যা) · **Still payable**
- **কুইক চিপস**: All · Pending · Approved · Unpaid · This month
- **CSV export** (ফিল্টার করা লিস্ট)
- ফুটারে মোট spend + payable

## 6. Income ট্যাব

- **সার্চ** (client / project / invoice / description)
- **Method ফিল্টার** + **সময়সীমা** (All · This month · Last month · This year)
- "In view" লাইভ টোটাল, ফুটারে `rows of total` + **CSV**
- আগের KPI + By Method / By Source চার্ট অপরিবর্তিত

## 7. যাচাই

```
apps/web tsc --noEmit → 0
npm run build        → PASS (44 pages)

Invoice PDF: ZLM-2026-0041 ডাউনলোড → ১ পেজ
  ✓ full-width project statement (৩টি সারাংশ ফিগার + হিস্ট্রি)
  ✓ খালি "TERMS & CONDITIONS" হেডিং নেই
  ✓ payment instructions fallback
  ✓ সব তারিখ এক ফরম্যাটে (16 Oct 2026)
  → artifacts/invoice-0041-v3.png

Payslip PDF: payslip-2026-07-fahim-chowdhury.pdf
  ✓ কোম্পানি ওয়ার্ডমার্ক, নেট পে ব্যান্ড, attendance বক্স
  ✓ "No deductions this period" — আর লাইন টেক্সটের ওপর পড়ছে না
  → artifacts/payslip-2026-07-v2.png

Overview → Needs attention (4 overdue / 2 approvals / 4 drafts)
         → KPI + ageing buckets + top exposures + "5d late" ইঙ্গিত
Invoices → KPI (৳15.7L issued · 49% collected · ৳4.91L overdue)
         → চিপস (14/4/2/4/3) → row download কাজ করছে
Expenses → KPI (৳4.00L · 80% billable · 2 pending · ৳0 payable) + চিপস
Income   → সার্চ + method + সময়সীমা + "In view ৳7.73L" + CSV
console errors → 0
```

## 8. বাকি (পরের ধাপ)

- Invoice list-এ server-side pagination
- Expense receipt attachment (রসিদ আপলোড)
- Income → bank reconciliation UI-তে সরাসরি লিংক

---

# পরের ধাপ — bulk, paging, receipts, reconciliation

## 9. Invoice pagination

- `usePaged(list, 12)` — প্রতি পেজে **১২টি** সারি, ফুটারে `1–12 of 14 · 1/2` + Prev/Next
- আগে সব সারি (প্রতিটির ৩-৪টি অ্যাকশন বাটন) একসাথে mount হতো; এখন DOM বাউন্ডেড
- ফিল্টার/সার্চ বদলালে পেজ নিজে থেকে clamp হয়

## 10. Bulk actions (invoices)

সারি সিলেক্ট করলে উপরে অ্যাকশন বার আসে:

| অ্যাকশন | কী করে | শর্ত |
|---|---|---|
| **Mark as sent** | নির্বাচিত DRAFT → `SENT` | শুধু draft |
| **Send reminder** | প্রতিটির জন্য reminder log + Finance নোটিফিকেশন | draft বাদে সব |
| **PDFs** | নির্বাচিত সব ইনভয়েসের PDF একে একে ডাউনলোড | সব |
| Clear | সিলেকশন মুছুন | — |

হেডারে "select all on this page"; বার-এ দেখায় `X draft · Y collectable` এবং ফলাফল (`3/4 marked as sent`)।

## 11. Expense receipts

- `Expense.receiptUrl` আগেই ছিল — এখন সত্যিই ব্যবহার হচ্ছে
- **`POST /capital/expenses/:id/receipt`** — PNG/JPEG/WebP/PDF, সর্বোচ্চ ৮MB, `uploads/receipts/`-এ UUID নামে
- **`GET /api/capital/receipts/:filename`** — public but unguessable (নামই capability), তাই `<img>/<a>` সরাসরি কাজ করে
- টেবিলে প্রতি সারিতে 📎 — রসিদ থাকলে view link (sky), না থাকলে upload (ধূসর)
- যাচাই: আপলোড → `receiptUrl` সেট → `GET` 200 image/png → UI-তে লিংক

## 12. Unreconciled bank entries

- `capital/overview`-তে নতুন `unreconciledCount` (`ReconciliationRecord.matchStatus = UNMATCHED`)
- Overview-এর **Needs attention**-এ কার্ড: "N bank entries unreconciled — cash position can drift until statements are matched" → Reports
- ডেমোতে ২টি unmatched রেকর্ড রাখা হয়েছে যাতে কার্ডটি দেখা যায়

## 13. যাচাই (এই ধাপ)

```
apps/api tsc --noEmit → 0    apps/web tsc --noEmit → 0
npm run build        → PASS
paginator  → "1–12 of 14 invoices · 1 / 2", DOM rows = 12
bulk       → ২টি সিলেক্ট → PDFs → ZLM-2026-0048.pdf + ZLM-2026-0047.pdf
receipt    → curl upload → {"url":"/api/capital/receipts/…png"} → GET 200 image/png
           → expenses টেবিলে "View receipt" লিংক (1) + "Attach receipt" (7)
overview   → "2 bank entries unreconciled" কার্ড
```

---

# ধাপ ৩ — সত্যিকারের server-side paging + reconciliation লিংক

## 14. Invoice list এখন server-side

আগের ধাপে শুধু **রেন্ডার** বাউন্ড করা ছিল; ফেচ এখনো পুরো লিস্ট আনত। এখন ফিল্টার, কাউন্ট, টোটাল আর পেজ-স্লাইস — সব সার্ভারে:

```
GET /capital/invoices?page=2&pageSize=12&status=&clientId=&q=&quick=overdue&min=&max=
→ { items, total, page, pageSize, pages,
    sums:   { billed, paid, due, drafts, draftValue },
    counts: { all, overdue, due7, draft, paid },
    values: { overdue, due7, draft } }
```

- `page`/`quick` না দিলে **পুরনো অ্যারে রেসপন্স** — context ও অন্য কলার ভাঙে না
- চিপ-কাউন্ট ও হেডলাইন টোটাল unfiltered সেট থেকে সার্ভারে গোনা হয়, তাই কোনো চিপে ঢুকে থাকলেও সংখ্যা সত্যি থাকে
- ব্যালেন্স-নির্ভর শর্ত (`quick`, min/max) কোয়েরির পরে মানে ইন-মেমোরি — কারণ `balance` একটি ডেরাইভড মান, কলাম নয়; বাকি সব Prisma `where`-এ
- UI: `useApi` দিয়ে পেজ-পার-রিকোয়েস্ট; ফিল্টার বদলালেই page 0-এ রিসেট

## 15. Expenses ও Income-এ পেজিনেশন

- Expenses: `usePaged(list, 15)` + ফুটারে Pager
- Income: `usePaged(rows, 15)` + Pager
- দুটোতেই DOM বাউন্ডেড; টোটাল/CSV পুরো ফিল্টার করা সেটের উপরেই চলে

## 16. Income → bank reconciliation

- API এখন প্রতি ইনকাম সারিতে `bankAccount` (কোন ব্যাংক/ওয়ালেটে জমা) আর `reconciled` (ব্যাংক স্টেটমেন্ট লাইনে মিলেছে কি না) দেয়
- টেবিলে নতুন **Bank** কলাম:
  - মিলে গেলে সবুজ **matched**
  - না মিললে amber **reconcile →** (Reports-এ নিয়ে যায়)
- **টেস্ট:** প্রথম পেমেন্টটিকে একটি `MATCHED` reconciliation রেকর্ডের সাথে জোড়া দেওয়া হয়েছে → ১টি `matched`, বাকি ৩টিতে `reconcile →`

## 17. যাচাই (ধাপ ৩)

```
GET /invoices?page=1&pageSize=5 → items=5, total=14, pages=3,
   counts {14,4,2,4,3}, sums {৳15.7L, ৳7.73L, ৳7.97L, 4 drafts}
GET /invoices?page=2&pageSize=5 → first ZLM-2026-0043, page=2
GET /invoices?...&quick=overdue  → total=4, values.overdue=৳4.91L
UI  → "1–12 of 14 invoices · 1 / 2"; Next → "13–14 of 14 · 2 / 2"
    → Overdue চিপ → 4 রো
Income → BANK কলাম: "Nagad Business / matched" + 3× "reconcile →"
overview → unreconciledCount=2 → Needs attention কার্ড
apps/api tsc → 0 · apps/web tsc → 0 · npm run build → PASS
```

## 18. এখনো বাকি

- Reconciliation UI-তে auto-match suggestion (amount+date মিলিয়ে)
- Invoice retainer/recurring রিমাইন্ডার ক্যালেন্ডার

---

# ধাপ ৪ — Expense approval matrix

## 19. সমস্যা

আগে **যে কেউ** (`PATCH /capital/expenses/:id`) যেকোনো অঙ্কের expense `APPROVED` করতে পারত — **নিজের সাবমিট করা expense-ও**। এজেন্সিতে টাকা এভাবেই সবচেয়ে সহজে নীরবে বেরিয়ে যায়। শুধু role-নামের একটা চেক ছিল (`Owner/Finance/Admin...`), কোনো limit বা maker-checker ছিল না।

## 20. নিয়ম (সার্ভারে, UI-তে নয়)

```
who (role)  ×  how much (amount)  ×  নিজের সাবমিশন কি না
```

- **role limit**: `Finance ≤ ৳20,000` · `HR/Admin ≤ ৳50,000` · `Admin ≤ ৳1,00,000` · `Owner` unlimited · `0` = unlimited
- **no self-approval**: যে সাবমিট করেছে সে অনুমোদন করতে পারবে না
- **toggle**: `Enforce limits` বন্ধ করলে পুরনো আচরণ (যেকোনো finance role যেকোনো অঙ্ক)
- চেক হয় **প্রতিটি APPROVED transition-এ** — নতুন রেকর্ড, edit, আর pre-approved creation, তিনটেতেই
- স্টোরেজ: `Settings.financeConfig.approvalPolicy` — **কোনো মাইগ্রেশন নেই**, আর merge করার সময় বাকি financeConfig (`taxConfigs`, `latePaymentFee`, `paymentMethods`, `defaultPaymentTerms`) অক্ষত থাকে

## 21. UI

- Expenses ট্যাবে নতুন **“Approval matrix”** বাটন → মডাল: limits টগল, self-approval টগল, প্রতি role-এর limit (0 = unlimited), role যোগ/মুছা
- ট্যাবেই ছোট সারাংশ: `Finance ≤ ৳20,000 · HR/Admin ≤ ৳50,000 · Admin ≤ ৳1,00,000 · Owner unlimited · no self-approval`
- **প্রতিটি PENDING সারিতে Approve বাটন সত্যি কথা বলে** — যে সারি অনুমোদন করা যাবে না সেটির বাটন ধূসর, hover-এ কারণ: *"Cannot approve — You submitted this expense"* / *"Above your limit of ৳20,000"*
  (আগে বাটন সবুজ থাকত, ক্লিক করলে সার্ভার 403 দিত — এখন ক্লিকের আগেই বোঝা যায়)

## 22. যাচাই (আসল ৩টি ইউজার দিয়ে)

| পরীক্ষা | ফল |
|---|---|
| Finance (Sadia) নিজের সাবমিট করা ৳45,000 → approve | **403** + UI-তে "You submitted this expense" |
| Owner-এর সাবমিট করা ৳45,000, Finance approve (limit ৳20,000) | **403**, কারণ *"Above your limit of ৳20,000"* |
| একই ৳45,000, HR/Admin approve (limit ৳50,000) | **200**, `approvedById` সেট |
| Project Manager (matrix-এ নেই) approve | **403** |
| Owner (unlimited) | সব PENDING-এ বাটন সবুজ (2/2) |
| Finance-এর ভিউ | 1টি সক্রিয় (৳15,000) + 1টি ধূসর (নিজের ৳45,000) |
| মডাল → Save policy | `{"toast":"Approval policy saved"}`; DB-তে নিয়ম সেভ, বাকি financeConfig অক্ষত |
| টেস্ট ডেটা | পরীক্ষার ৳45,000 expense delete + GL/bank reversal হয়ে পরিষ্কার (৮টি expense আগের মতো) |

```
apps/api tsc → 0    apps/web tsc → 0
npm run build → PASS (api + web, 44 pages)
```

## 23. এখনো বাকি (Capital)

- Approval **ট্রেইল** UI — কে কখন কী অনুমোদন করল (`FinanceAuditLog` আছে, আলাদা পেজ নেই)
- Over-limit হলে **উর্ধ্বতনকে escalation notification**
- Reconciliation auto-match suggestion
