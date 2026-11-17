#!/usr/bin/env node
/**
 * Finance integrity check — the invariants that must hold for the books to be
 * trustworthy. Run it after any finance change, and in CI:
 *
 *   npm run test:finance
 *
 * Exits non-zero when any invariant breaks, so a regression fails the build
 * instead of silently drifting the ledger.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

async function main() {
  // 1. Every journal entry balances on its own, and the whole ledger balances.
  const unbalanced = await prisma.$queryRaw`
    SELECT "entryId", (SUM(debit) - SUM(credit))::float8 AS diff
    FROM "JournalEntryLine" GROUP BY "entryId" HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
  `;
  check("every journal entry is balanced", unbalanced.length === 0, `${unbalanced.length} unbalanced`);

  const totals = await prisma.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } });
  const tbDiff = r2(Number(totals._sum.debit ?? 0) - Number(totals._sum.credit ?? 0));
  check("trial balance is balanced", Math.abs(tbDiff) < 0.01, `debit − credit = ${tbDiff}`);

  // 2. GL cash must equal the operational bank balances.
  const cashLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1200" } },
    select: { debit: true, credit: true },
  });
  const glCash = r2(cashLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  const banks = await prisma.bankAccount.aggregate({ _sum: { currentBalance: true } });
  const bankTotal = r2(banks._sum.currentBalance ?? 0);
  check("GL cash equals the bank accounts", Math.abs(glCash - bankTotal) < 0.01, `GL ${glCash} vs bank ${bankTotal}`);

  // 3. No journal entry may reference a document that no longer exists.
  const entries = await prisma.journalEntry.findMany({ select: { id: true, sourceId: true, reversedEntryId: true } });
  const known = new Set();
  for (const rows of await Promise.all([
    prisma.invoice.findMany({ select: { id: true } }),
    prisma.payment.findMany({ select: { id: true } }),
    prisma.expense.findMany({ select: { id: true } }),
    prisma.creditNote.findMany({ select: { id: true } }),
    prisma.manualIncome.findMany({ select: { id: true } }),
    prisma.vendorEngagement.findMany({ select: { id: true } }),
    prisma.vendorPayment.findMany({ select: { id: true } }),
    prisma.dollarSale.findMany({ select: { id: true } }),
    prisma.payrollRecord.findMany({ select: { id: true } }),
    prisma.manualJournal.findMany({ select: { id: true } }),
    prisma.fixedAsset.findMany({ select: { id: true } }),
    prisma.depreciationRun.findMany({ select: { id: true } }),
    prisma.fxRevaluation.findMany({ select: { id: true } }),
  ])) {
    for (const row of rows) known.add(row.id);
  }
  const reversedTargets = new Set(entries.filter((e) => e.reversedEntryId).map((e) => e.reversedEntryId));
  const orphans = entries.filter(
    (e) =>
      e.sourceId &&
      !e.reversedEntryId &&
      !reversedTargets.has(e.id) &&
      !/^(OPENING|SYSTEM)[-_]/i.test(e.sourceId.replace(/:opening$/, "")) &&
      !known.has(e.sourceId.replace(/:opening$/, ""))
  );
  check("no orphan journal entries", orphans.length === 0, `${orphans.length} orphan(s)`);

  // 4. AR in the GL must equal the open balance of the invoices.
  const invoices = await prisma.invoice.findMany({
    include: { lineItems: true, payments: true, creditNotes: { select: { type: true, amount: true, status: true } } },
  });
  let open = 0;
  for (const inv of invoices) {
    if (!["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(inv.status)) continue;
    const subtotal = inv.lineItems.reduce((s, l) => s + Number(l.amount), 0);
    const tax = inv.taxApplicable && inv.taxRate ? (subtotal * Number(inv.taxRate)) / 100 : 0;
    const discount = inv.discountRate ? (subtotal * Number(inv.discountRate)) / 100 : 0;
    const grand = Math.max(0, subtotal + tax - discount + Number(inv.shippingFee ?? 0));
    const paid = inv.payments
      .filter((p) => !p.type || p.type === "IN" || p.type === "REFUND")
      .reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
    const credits = inv.creditNotes
      .filter((c) => (!c.status || c.status === "ISSUED") && (c.type === "CREDIT_NOTE" || c.type === "WRITE_OFF"))
      .reduce((s, c) => s + Number(c.amount), 0);
    open += Math.max(grand - paid - credits, 0);
  }
  const arLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1100" } },
    select: { debit: true, credit: true },
  });
  const glAr = r2(arLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  check("GL receivable equals the open invoices", Math.abs(glAr - r2(open)) < 1, `GL ${glAr} vs invoices ${r2(open)}`);

  // 5. AP must equal the unpaid remainder of payable expenses.
  const apLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "2000" } },
    select: { debit: true, credit: true },
  });
  const glAp = r2(apLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
  const payable = await prisma.expense.findMany({
    where: { isPayable: true, approvalStatus: "APPROVED" },
    select: { amount: true, paidAmount: true },
  });
  const openPayables = r2(payable.reduce((s, e) => s + Number(e.amount) - Number(e.paidAmount ?? 0), 0));
  check("GL payable equals the open vendor bills", Math.abs(glAp - openPayables) < 1, `GL ${glAp} vs bills ${openPayables}`);

  // 6. A FINALIZED payroll record must have produced a salary expense.
  const payroll = await prisma.payrollRecord.findMany({
    where: { status: "FINALIZED" },
    select: { id: true, netPay: true, salaryExpense: { select: { id: true, amount: true } } },
  });
  const missing = payroll.filter((p) => !p.salaryExpense);
  check("finalized payroll is posted to finance", missing.length === 0, `${missing.length} of ${payroll.length} unposted`);

  // 7. Customer advances must sit in the GL, never as a negative receivable.
  const creditRows = await prisma.creditBalance.aggregate({ _sum: { amount: true } });
  const advLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "2400" } },
    select: { debit: true, credit: true },
  });
  const glAdvances = r2(advLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
  const credits = r2(creditRows._sum.amount ?? 0);
  check("customer advances are carried as a liability", credits === 0 || Math.abs(glAdvances - credits) < 1, `advances ${credits} vs GL 2400 ${glAdvances}`);

  // 8. Fixed assets: the GL cost account must equal the active register.
  const assets = await prisma.fixedAsset.findMany({ select: { cost: true, status: true } });
  const activeCost = r2(assets.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + Number(a.cost), 0));
  const assetLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1500" } },
    select: { debit: true, credit: true },
  });
  const glAssets = r2(assetLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  check("fixed-asset register matches the GL", Math.abs(glAssets - activeCost) < 1, `GL ${glAssets} vs register ${activeCost}`);

  // 9. Depreciation: accumulated runs must equal the register's accumulated figure.
  const runs = await prisma.depreciationRun.groupBy({ by: ["assetId"], _sum: { amount: true } });
  const runTotal = r2(runs.reduce((s, r) => s + Number(r._sum.amount ?? 0), 0));
  const accumRows = await prisma.fixedAsset.findMany({ select: { accumulatedDepreciation: true } });
  const accumTotal = r2(accumRows.reduce((s, a) => s + Number(a.accumulatedDepreciation ?? 0), 0));
  check("depreciation runs equal accumulated depreciation", Math.abs(runTotal - accumTotal) < 1, `runs ${runTotal} vs register ${accumTotal}`);

  // 10. Input VAT: the GL receivable must equal the recoverable VAT on bills.
  const vatBills = await prisma.expense.findMany({
    where: { vatRecoverable: true, approvalStatus: "APPROVED" },
    select: { inputVatAmount: true },
  });
  const billVat = r2(vatBills.reduce((s, e) => s + Number(e.inputVatAmount ?? 0), 0));
  const inputVatLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1300" } },
    select: { debit: true, credit: true },
  });
  const glInputVat = r2(inputVatLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  check("input VAT receivable matches the bills", Math.abs(glInputVat - billVat) < 1, `GL ${glInputVat} vs bills ${billVat}`);

  // 11. Deferred revenue: GL 2500 must equal what is still unrecognised.
  const schedules = await prisma.deferredRevenue.findMany({ where: { status: "ACTIVE" }, select: { totalAmount: true, recognizedAmount: true } });
  const deferredRemaining = r2(schedules.reduce((s, d) => s + Number(d.totalAmount) - Number(d.recognizedAmount), 0));
  const deferredLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "2500" } },
    select: { debit: true, credit: true },
  });
  const glDeferred = r2(deferredLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
  check("deferred revenue matches the schedules", Math.abs(glDeferred - deferredRemaining) < 1, `GL ${glDeferred} vs schedules ${deferredRemaining}`);

  // 12. Bad-debt allowance: GL 1515 credit must equal the sum of provision runs.
  const provisionRuns = await prisma.provisionRun.aggregate({ _sum: { amount: true } });
  const provisionTotal = r2(provisionRuns._sum.amount ?? 0);
  const allowanceLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1515" } },
    select: { debit: true, credit: true },
  });
  const glAllowance = r2(allowanceLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));
  check("bad-debt allowance matches the provision runs", Math.abs(glAllowance - provisionTotal) < 1, `GL ${glAllowance} vs runs ${provisionTotal}`);

  // 13. Petty cash: the float must equal IN − OUT.
  const petty = await prisma.pettyCashEntry.findMany({ select: { direction: true, amount: true } });
  const pettyBook = r2(petty.reduce((s, e) => s + (e.direction === "IN" ? 1 : -1) * Number(e.amount), 0));
  const pettyLines = await prisma.journalEntryLine.findMany({
    where: { account: { code: "1010" } },
    select: { debit: true, credit: true },
  });
  const glPetty = r2(pettyLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  check("petty cash float matches the register", Math.abs(glPetty - pettyBook) < 1, `GL ${glPetty} vs register ${pettyBook}`);

  // ── report ──
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} finance invariants hold`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error("finance-check failed to run:", error.message);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
