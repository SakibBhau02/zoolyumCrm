# Add Income & Add Expense — agency-grade fields

> Implemented: 2026-11-05

Both entry forms were rebuilt around what an agency actually needs to record,
not just "description + amount". The guiding rule: **capture the detail once,
then every report, approval and audit trail uses it.**

---

## Record expense

The modal is now split into four blocks.

### 1. What is it?
- **Project expense vs company overhead** (unchanged toggle)
- Client + project (project list filtered by client)
- Description
- Amount, category, subcategory, expense date

### 2. Vendor & bill
| Field | Why |
|---|---|
| Vendor | links to the vendor ledger and vendor-level spend |
| **Vendor bill no.** | matches the physical bill to the AP record |
| **Vendor bill date** | separates "service date" from "bill date" for audits |
| Payment method + paid-from account | cash/bank reconciliation |
| Receipt URL | proof attached to the entry |

### 3. Recharge, approval & schedule
- **Client billable** + **markup %** → live **client recharge** preview
  (`recharge = amount × (1 + markup/100)`), with the margin shown. The table
  shows the `+15%` marker on billable rows.
- **Unpaid (accounts payable)** + due date → feeds AP aging and liabilities.
- **Recurring expense** + weekly/monthly/quarterly/yearly schedule.
- **Department** for company overhead (Accounts, Creative, Production, Media,
  Strategy, Admin, Tech, Other).
- Currency + exchange rate for foreign-currency bills.
- Notes.

### 4. Approval
Same matrix as before: Owner/Finance/Admin post immediately; everyone else
goes to `PENDING` and the books update on approval.

### Paying an expense — TDS/VDS
The payment modal now has **TDS / VDS withheld** and a live **net cash out**:

```
payable settled  = 2,000        (gross)
TDS withheld     =   100
bank leaves      = 1,900
TDS payable      =   100  → 2200 TDS/VDS Payable
```

The expense's `paidAmount` still advances by the gross amount, so AP clears
correctly while the tax liability is recorded separately.

---

## Record income

### What came in?
- Description
- **Gross amount**
- Category: project payment, retainer, consulting, workshop, commission,
  referral, reimbursement, interest, FX/dollar gain, other
- **Tax withheld (TDS)** with a live **net received** preview

### Who is it from?
- Client and project (both optional; project filtered by client). Linking makes
  the income table, client profitability and project P&L accurate. Manual income
  used to lose this attribution entirely.

### How was it received?
- Date, method, received-into account (filtered by method)
- Reference / cheque no.
- Currency + exchange rate

### Backup
- Attachment URL
- Notes

### Accounting for TDS
`amount` is the gross income; the client pays net and the withheld part becomes
an asset:

```
Dr Bank (1200)                    9,500
Dr Tax Withheld Receivable (1150)   500
    Cr Other Income (4200)         10,000
```

Income totals stay gross; the bank balance reflects the cash actually received.
Existing rows default `taxWithheld = 0`, so nothing changes for them.

---

## Data model

`Expense` gained:
`vendorBillNumber`, `vendorBillDate`, `notes`, `department`, `markupPct`.

`ManualIncome` gained:
`clientId`, `projectId`, `referenceId`, `attachmentUrl`, `taxWithheld`
(+ relations to Client and Project).

`Payment` gained:
`taxWithheld` (used by expense payments, safe for invoice payments too).

Migration: `2026110514*_richer_income_expense`.

## API

- `POST /capital/income` — accepts client/project/reference/attachment/tax and
  posts the gross/net/tax journal atomically.
- `GET /capital/income` — manual rows now include client, project, reference,
  notes, attachment, `taxWithheld`, `netAmount`.
- `POST /capital/expenses` — persists bill number/date, notes, department,
  markup; unchanged approval logic.
- `PATCH /capital/expenses/:id` — edits the new fields too.
- `POST /capital/expenses/:id/payment` — accepts `taxWithheld`, credits TDS
  payable and debits only the net cash.

## Verification

- Income recorded as gross ৳10,000 with ৳500 TDS → net ৳9,500; GL showed
  bank +9,500, tax receivable +500, income 10,000.
- Expense with bill `QA-BILL-9`, department, markup and notes persisted; payment
  of ৳2,000 with ৳100 TDS moved ৳1,900 from the bank and posted ৳100 to TDS
  payable while clearing the full ৳2,000 payable.
- Income row returned client `BanglaMart`, reference `QA-REF-1`, notes and
  net amount.
- All QA records and journal entries removed afterwards; `tsc --noEmit` clean
  for API and web.
