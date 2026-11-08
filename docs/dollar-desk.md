# Dollar Desk (Client FX Sales)

> Implemented: 2026-11-05 · module: **Capital → Dollar Desk** (`/capital/dollar`)

## The idea

We buy dollars at a cost rate and sell them to clients at a higher BDT rate.
The client pays BDT directly; no project is involved.

```
cost      = USD × cost rate          (30 × 130 = 3,900)
received  = BDT the client pays      (4,500)
profit    = received − cost          (600)
sell rate = received ÷ USD           (150.00)
margin    = profit ÷ received        (13.33%)
```

The cost rate is configured once in **Control → Settings → Finance → Dollar desk**.
It defaults to **৳130 / $1** if nobody has set it.

## The non-negotiable rule: rate snapshot

Every sale stores the cost rate that was in force **at the time of the sale**.
Changing the rate afterwards never rewrites historical profit, margins, reports
or the GL. Verified by changing the rate 130 → 140 and creating a new sale:
the old sale stayed at 130, the new one used 140.

## Data model

`DollarSale`

| Field | Meaning |
|---|---|
| `reference` | `FXS-2026-0001` |
| `clientId` | the client buying dollars (required) |
| `usdAmount` | dollars handed over |
| `bdtAmount` | BDT received |
| `costRate` | **snapshot** of the configured rate |
| `effectiveRate` | actual sell rate (BDT ÷ USD) |
| `costBdt` | USD × cost rate |
| `profit` | BDT received − cost |
| `marginPct` | profit ÷ BDT received |
| `date`, `paymentMethod`, `bankAccountId`, `notes`, `recordedById` | audit trail |

The rate itself lives in `Settings.financeConfig.dollarCostRate` (JSON), so the
Control panel remains the single place that owns it.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/capital/dollar/rate` | current cost rate (+ whether it is configured or defaulting) |
| GET | `/capital/dollar/sales` | rows, summary, by-client, 6-month profit series, rate |
| GET | `/capital/dollar/summary` | compact KPIs for dashboard/tools |
| POST | `/capital/dollar/sales` | record a sale and post the ledger |
| DELETE | `/capital/dollar/sales/:id` | reverse the journal + bank receipt (Owner / Finance / Control) |

## Accounting

Sale of $30 for ৳4,500 at cost ৳130:

```
Dr  Cash & Bank (1200)                 4,500
    Cr  USD / FX Inventory (1250)      3,900   ← cost of the dollars sold
    Cr  FX Gain on Dollar Sales (4400)   600
```

- Loss-making sale: debit **FX Loss (6600)** instead of the gain.
- The bank account's `currentBalance` increases by the full BDT received.
- Deleting a sale reverses the journal and debits the bank, so cash and P&L
  return to the previous state.
- Service revenue is **not** inflated: only the spread hits the P&L, while the
  received BDT is visible as volume in the module.

> **USD inventory note:** `1250` tracks the cost of dollars sold. Until dollar
> purchases / opening USD balances are recorded, this account can go negative —
> it is the cost basis, not a bank account. Recording USD acquisitions is the
> next accounting step (see roadmap).

## UI

**Capital → Dollar Desk**

1. **KPI row** — profit this month, USD sold, BDT received, all-time profit.
2. **Record a sale** — client, USD, BDT, date, method, bank, notes. The profit
   panel updates live: cost, sell rate, margin, loss warning. The submit button
   stays disabled until client + both amounts are valid.
3. **Profit trend** — last six months.
4. **Sales table** — reference, client, USD, BDT, sell rate, cost rate, profit,
   margin, date, with a two-step delete that reverses the accounting.

**Capital → Income** — every dollar sale contributes one row with source
**DOLLAR**, showing the FX gain as the income amount (with “on ৳4,500” context),
an `Auto (FX ledger)` bank note, and no reconcile prompt. Income totals and the
“By source” breakdown include dollar profit automatically.

**Control → Settings → Finance** — “Dollar desk” block: `USD cost rate (৳ per $1)`
with a worked example.

Dashboard: new **Dollar Desk** module card (profit MTD, monthly bars, margin,
rate) and an alert when a sale is recorded below cost.

## Validation & guards

- client is required and must exist;
- USD and BDT must both be > 0;
- cost rate falls back to 130 when unset or invalid;
- loss-making sales are allowed but flagged in the UI, dashboard and alert queue;
- delete is restricted to Owner / Finance / Control and always reverses the GL;
- every create/delete is written to the system audit log.

## Roadmap

- **USD acquisitions / opening balance** so `1250` never goes negative.
- **Rate history table** (currently snapshots exist on sales; config history is
  only in the audit log).
- **Optional invoice link** for clients who want the FX sale on a formal invoice.
- **Rate guardrails** (warn if sell rate deviates > X% from the cost rate).
- **Client-level FX statement** (total USD bought, BDT paid, average rate).

## Verification

- Migration `20261105140420_dollar_sales` applied; Prisma client regenerated.
- API: $30 → ৳4,500 at 130 produced cost ৳3,900, sell rate ৳150, profit ৳600,
  margin 13.33%.
- Rate snapshot: rate changed to 140 → new sale used 140; earlier sales stayed 130.
- Ledger: bank +4,500, inventory −3,900, gain +600; deletion reversed all three
  and restored the bank balance exactly (verified ৳7,500 across three test sales).
- Income: the sale appears as a **DOLLAR** row worth ৳600, and the Income total
  moved from ৳773,200 to ৳773,800 with `dollar` in the source split.
- Control field renders and saves; `tsc --noEmit` clean for API and web.
- Dashboard: 12 module cards, Dollar Desk shows ৳600 profit / $30 / 13.3%.
