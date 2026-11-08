# Vendor Liabilities (Accounts Payable for Commitments)

> Implemented: 2026-11-05 · module: **Capital → Liabilities** (`/capital/liabilities`)

## Why this is not just an expense

An agency hires a DOP for a full day. The deal is ৳7,000, with ৳3,000 paid
immediately and ৳4,000 on delivery. Three different numbers are true at once:

| Concept | Amount | Meaning |
|---|---|---|
| Commitment | ৳7,000 | What we agreed to pay |
| Advance | ৳3,000 | Cash already out of the bank |
| Liability | ৳4,000 | What we still owe |

Recording it as one ৳3,000 expense loses the ৳4,000 liability and makes the
project look cheaper than it is. Recording ৳7,000 immediately overstates this
month's cost before the work happens. The module keeps the three states
separate and reconciles them with the GL.

## The lifecycle

```
DRAFT / ACTIVE  ── advance ──▶  Prepaid Vendor Costs (1400)
      │                              (asset — work not delivered yet)
      │
      ├─ mark delivered + bill received
      ▼
COMPLETED       ── accrual ──▶  Cost of Services (5010 / 5020 / 5100)
      │                         Accounts Payable  (2000)
      │                         + reclass advance from 1400 → 2000
      │
      └─ remaining payments ──▶  Accounts Payable (2000) → Bank (1200)
```

- **Payments before delivery** debit Prepaid (an asset), not the P&L.
- **Mark delivered** posts the full commitment to cost + AP, and applies the
  advance against AP in one reclass entry.
- **Payments after delivery** clear AP.
- **TDS / VDS** withheld is credited to *TDS / VDS Payable (2200)*; the vendor
  receives the net amount, the liability is settled at gross.
- **Refunds** reverse the cash and the prepaid/AP balance.

All postings go through the existing double-entry `LedgerService`, so the trial
balance, balance sheet and cash-flow reports stay consistent.

## Data model

`VendorEngagement`
- `reference` — `LIA-2026-0001`
- vendor, optional project + client (client derived from the project)
- `title`, `category` (CREW, EQUIPMENT, STUDIO, LOCATION, POST_PRODUCTION,
  TALENT, TRANSPORT, CATERING, FREELANCE, OTHER)
- `totalAmount`, `currency`
- `status` — DRAFT / ACTIVE / COMPLETED / CANCELLED
- `startDate`, `dueDate`, `deliveredAt`, `billNumber`, `billReceivedAt`
- `retentionPct` (holdback until sign-off), `paymentTerms`, `notes`, attachment
- `createdById`, `approvedById`

`VendorPayment`
- engagement, `amount`, `type` (ADVANCE / PARTIAL / FINAL / REFUND)
- `paymentDate`, `paymentMethod`, `referenceId`, `bankAccountId`
- `taxWithheld` (TDS/VDS), `notes`, `recordedById`

Derived per engagement: `paid`, `balance`, `paymentState` (UNPAID /
PARTIALLY_PAID / PAID), `overdue`, `daysOverdue`, `retention`, `taxWithheld`,
`unbilledPaid` (advance not yet matched by delivery).

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/capital/engagements` | list + summary + aging + by-vendor + by-project + other payables |
| GET | `/capital/engagements/summary` | KPIs only (dashboard/tools) |
| GET | `/capital/engagements/:id` | full record with payment history |
| POST | `/capital/engagements` | create (supports `initialPayment` for the advance) |
| PATCH | `/capital/engagements/:id` | edit commercial terms (amount cannot fall below paid) |
| POST | `/capital/engagements/:id/payments` | advance / part / final / refund |
| POST | `/capital/engagements/:id/complete` | mark delivered + bill; post accrual |
| POST | `/capital/engagements/:id/cancel` | cancel an untouched commitment |
| DELETE | `/capital/engagements/:id` | delete only when no cash or cost is attached |

Guards that protect the books:
- overpayment beyond the remaining balance is rejected;
- refunds cannot exceed what was paid;
- deleting an engagement with payments is blocked (record a refund first);
- a completed engagement cannot change its agreed amount;
- completing twice does not double-post the accrual (idempotent source check).

## UI

**Capital → Liabilities** tab:

1. **KPI row** — total owed (contracts + other bills), paid to vendors, overdue,
   due in the next 7 days.
2. **Payables aging** — Current / 1–30 / 31–60 / 61–90 / 90+ with amounts and
   bars, plus advances outstanding, retention held, vendors, other vendor bills
   and the on-time payment rate.
3. **Exposure by vendor** — top five balances.
4. **Filterable table** — reference, vendor, project, agreed, paid, balance,
   due date, status.
5. **Engagement drawer** — agreed / paid / balance, settlement bar, commercial
   terms, bill info, payment timeline, and actions (pay, mark delivered, edit,
   cancel, delete).
6. **New engagement form** — records the full deal and, optionally, the advance
   paid now (amount, method, bank account, TDS) in one step.

Dashboard integration:
- new **Liabilities** module card (paid vs open vs overdue bar);
- alerts: *Vendor payables overdue* and *Vendor payments due this week*;
- **Today's Work → Waiting on you** shows the overdue vendor-payables amount;
- visible to Owner / Admin / Finance only (server-scoped).

## Enterprise roadmap (next steps)

Deliberately out of scope for this pass, but the data model supports them:

- **Approval workflow** — route commitments above a threshold through the
  existing approval-policy engine (currently the creator is recorded as approver).
- **Three-way match** — add a purchase order and a goods/services receipt before
  the bill; today `deliveredAt` + `billReceivedAt` capture the two checkpoints.
- **Retention release** — a "release holdback" action once the project is signed off.
- **Vendor statement PDF / email** — reuse the statement PDF builder.
- **Project budget vs committed cost** — surface commitment burn next to
  `budgetAmount` on the project page and profitability report.
- **Multi-currency settlement** — `currency` is stored; FX gain/loss needs an
  exchange-rate snapshot at payment time.
- **Recurring vendor retainers** — reuse `isRecurring` patterns from expenses.

## Verification

- Migration `20261105134541_vendor_liabilities` applied; Prisma client regenerated.
- API flow tested end-to-end: 7,000 deal + 3,000 advance → paid 3,000, balance
  4,000; final 4,000 → balance 0; deliver → accrual + reclass posted; all QA
  rows, payments, journal entries and the temporary bank account removed after.
- `tsc --noEmit` clean for API and web.
- Role scoping: owner 11 modules, finance 4 (incl. liabilities), manager/sales
  no liabilities; employee dashboard unchanged.
