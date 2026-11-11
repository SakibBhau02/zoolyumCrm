/**
 * Backfill opening balances so the GL agrees with reality.
 *
 * The demo seed creates bank accounts with a starting `currentBalance` and then
 * posts the invoices/payments/expenses to the ledger, but never posts the
 * opening capital those balances came from. As a result `Cash & Bank (1200)` in
 * the GL is far below the sum of the bank accounts, and the USD/FX inventory
 * account went negative. This script posts the missing opening journals once:
 *
 *   • bring Cash & Bank (1200) up/down to the sum of the bank accounts
 *   • bring USD / FX Inventory (1250) up to zero when it is negative
 *   • the counterpart is Retained Earnings (3000), which the balance sheet
 *     presents as equity
 *
 * Idempotent: re-running when everything already agrees does nothing.
 *
 * Run from the repo root:  node scripts/backfill-opening-balances.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const r2 = (n) => Math.round(Number(n) * 100) / 100;

async function accountByCode(code) {
  const a = await prisma.account.findFirst({ where: { code } });
  if (!a) throw new Error(`GL account ${code} not found`);
  return a;
}

async function postOpening(reference, memo, lines) {
  const rounded = lines.map((l) => ({ ...l, debit: r2(l.debit), credit: r2(l.credit) }));
  const diff = r2(rounded.reduce((s, l) => s + l.debit - l.credit, 0));
  if (Math.abs(diff) > 0.01) throw new Error(`Unbalanced opening entry: ${diff}`);
  if (!rounded.some((l) => l.debit || l.credit)) return null;
  return prisma.journalEntry.create({
    data: {
      entryType: "OPENING",
      reference,
      entryDate: new Date(Date.UTC(2026, 0, 1)),
      sourceId: null,
      notes: memo,
      lines: { create: rounded },
    },
  });
}

async function balance(accountId) {
  const agg = await prisma.journalEntryLine.aggregate({ where: { accountId }, _sum: { debit: true, credit: true } });
  return r2(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
}

const cashAcct = await accountByCode("1200");
const fxAcct = await accountByCode("1250");
const equityAcct = await accountByCode("3000");

const bankSum = r2((await prisma.bankAccount.aggregate({ _sum: { currentBalance: true } }))._sum.currentBalance);
const cashGl = await balance(cashAcct.id);
const fxGl = await balance(fxAcct.id);

console.log(`Bank accounts total : ${bankSum}`);
console.log(`GL Cash & Bank (1200): ${cashGl}  (difference ${r2(bankSum - cashGl)})`);
console.log(`GL USD/FX (1250)     : ${fxGl}`);

const cashGap = r2(bankSum - cashGl);
if (Math.abs(cashGap) > 0.01) {
  const lines =
    cashGap > 0
      ? [{ accountId: cashAcct.id, debit: cashGap, credit: 0, memo: "Opening bank balances" }, { accountId: equityAcct.id, debit: 0, credit: cashGap, memo: "Opening capital" }]
      : [{ accountId: cashAcct.id, debit: 0, credit: -cashGap, memo: "Opening bank balances" }, { accountId: equityAcct.id, debit: -cashGap, credit: 0, memo: "Opening capital" }];
  await postOpening("OPENING-BANK", "Opening cash to match bank accounts", lines);
  console.log(`→ posted opening cash journal for ${cashGap}`);
} else {
  console.log("→ cash already matches, nothing to post");
}

if (fxGl < -0.01) {
  await postOpening("OPENING-FX", "Opening USD inventory purchase", [
    { accountId: fxAcct.id, debit: -fxGl, credit: 0, memo: "Opening FX inventory" },
    { accountId: equityAcct.id, debit: 0, credit: -fxGl, memo: "Opening capital" },
  ]);
  console.log(`→ posted opening FX journal for ${-fxGl}`);
}

const after = {
  cash: await balance(cashAcct.id),
  fx: await balance(fxAcct.id),
  bankSum,
};
const tb = await prisma.$queryRaw`SELECT sum(debit)::float8 d, sum(credit)::float8 c FROM "JournalEntryLine"`;
console.log("after:", after, "GL balanced:", r2(tb[0].d) === r2(tb[0].c), tb[0]);
await prisma.$disconnect();
