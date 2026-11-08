# Client Portal — Billing & Report Downloads

> Implemented: 2026-11-05

## 1. Billing model shown to the client

The portal answers three questions immediately after login:

| Question | Where |
|---|---|
| How much have I paid? | **Paid** tile + `Total paid` |
| How much is still pending? | **Pending** tile (outstanding balance) |
| Is anything overdue? | **Overdue** tile (balance past due date) |
| What is due this month? | **Due this month** tile (recurring projects only) |

### One-time projects
Full billing is shown:

- contract value (project amount / budget)
- paid vs contract progress bar
- balance due
- every invoice line item is downloadable as PDF

### Monthly / recurring projects
Only what matters for the month:

- **Monthly fee**
- **Due this month** (`monthlyRate − paid this month`, never negative)
- next billing date

No “months paid” counter is displayed.

### Where it appears
- **Dashboard**: billing overview hero + “Billing by project” cards.
- **Invoices tab**: four summary tiles (Paid / Pending / Overdue / Due this month), per-project billing cards, then the invoice table.
- **Project cards**: each card shows `Due ৳…` (one-time) or `Monthly due ৳…` (recurring).

### API
`GET /portal-client/overview` → `billing` now includes:

```json
{
  "totalInvoiced": 0,
  "totalCollected": 0,
  "totalOutstanding": 0,
  "overdueAmount": 0,
  "totalMonthlyDue": 0,
  "byProject": [
    {
      "projectId": "…",
      "projectName": "…",
      "status": "ACTIVE",
      "billingType": "ONE_TIME | RECURRING",
      "contractValue": 0,
      "totalInvoiced": 0,
      "totalPaid": 0,
      "outstanding": 0,
      "invoiceCount": 0,
      "monthlyRate": 0,
      "monthlyDue": 0,
      "nextBillingDate": null
    }
  ]
}
```

`GET /portal-client/invoices` returns `summary` (same headline fields) + `byProject` + invoice rows. Drafts, voids and cancelled invoices are excluded everywhere.

## 2. Report downloads

- A **Reports & updates** section now renders inside every project (previously the reports were only reachable as “latest update”).
- Each report has a **PDF** button.
- The dashboard’s “Latest update” card also has **Download PDF**.
- New endpoint: `GET /portal-client/updates/:id` (SENT reports only, scoped to the client).

PDF (`apps/web/src/lib/portal-report-pdf.ts`, A4):

- Branded header (logo / company / period / generated date)
- Report title, project and client
- Summary cards: completed, pending, invoiced, outstanding
- Completed deliverables list (task counts)
- Pending / in-progress list (status)
- Billing snapshot
- PM notes
- Page footer with client sharing note

## 3. UI refresh

- Billing-first dashboard: the old “pending value” stat was replaced by a proper billing hero + per-project cards.
- Project cards are clickable from the dashboard (fetches the detail, so reports/files load).
- Fixed stale portal data: `pfetch` now uses `cache: "no-store"`; opening a project always fetches the full detail (the list row used to overwrite it and hide reports).
- Invoices tab is now a billing dashboard rather than a bare table.

## 4. Verification

- `tsc --noEmit` clean (web + api).
- BanglaMart portal: one-time project (৳2.4L contract, ৳2.4L due) + monthly retainer (৳1.2L fee, ৳1.2L due this month) render correctly.
- Generated a SENT report for the D2C project → portal showed it and downloaded `Progress-report-October-2026.pdf` (A4, 595×842 pt).
- No console errors in the portal.
