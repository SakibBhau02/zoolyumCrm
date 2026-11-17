import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotals, isReceivable, outstandingOf } from "../../src/capital/finance-kernel";

/**
 * Regression guards for the money maths every finance screen and ledger posting
 * depends on. These are pure functions â€” no DB, no Nest boot â€” so they run in
 * milliseconds and can gate every PR.
 */

const invoice = (over: Record<string, any> = {}) => ({
  status: "SENT",
  taxApplicable: false,
  taxRate: 0,
  discountRate: 0,
  shippingFee: 0,
  exchangeRate: 1,
  lineItems: [{ amount: 1000 }, { amount: 500 }],
  payments: [],
  creditNotes: [],
  ...over,
});

test("subtotal sums line items and grand is subtotal when no tax/discount/shipping", () => {
  const t = invoiceTotals(invoice());
  assert.equal(t.subtotal, 1500);
  assert.equal(t.grand, 1500);
  assert.equal(t.balance, 1500);
});

test("tax and discount are percentages of the subtotal, shipping is added once", () => {
  const t = invoiceTotals(invoice({ taxApplicable: true, taxRate: 15, discountRate: 10, shippingFee: 50 }));
  assert.equal(t.tax, 225); // 15% of 1500
  assert.equal(t.discount, 150); // 10% of 1500
  assert.equal(t.grand, 1625); // 1500 + 225 - 150 + 50
});

test("a refund reduces collected money instead of increasing it", () => {
  const t = invoiceTotals(
    invoice({
      payments: [
        { type: "IN", amount: 1500 },
        { type: "REFUND", amount: 200 },
      ],
    })
  );
  assert.equal(t.paidIn, 1500);
  assert.equal(t.refunded, 200);
  assert.equal(t.paid, 1300);
  assert.equal(t.balance, 200);
});

test("a payment row without a type counts as money received", () => {
  const t = invoiceTotals(invoice({ payments: [{ amount: 500 }] }));
  assert.equal(t.paidIn, 500);
  assert.equal(t.balance, 1000);
});

test("issued credit notes reduce the balance; draft ones do not", () => {
  const issued = invoiceTotals(invoice({ creditNotes: [{ type: "CREDIT_NOTE", amount: 500, status: "ISSUED" }] }));
  assert.equal(issued.credits, 500);
  assert.equal(issued.balance, 1000);

  const draft = invoiceTotals(invoice({ creditNotes: [{ type: "CREDIT_NOTE", amount: 500, status: "DRAFT" }] }));
  assert.equal(draft.credits, 0);
  assert.equal(draft.balance, 1500);
});

test("balance never goes negative when overpaid", () => {
  const t = invoiceTotals(invoice({ payments: [{ type: "IN", amount: 5000 }] }));
  assert.equal(t.balance, 0);
});

test("BDT figures follow the invoice exchange rate", () => {
  const t = invoiceTotals(invoice({ exchangeRate: 120 }));
  assert.equal(t.grandBdt, 180000);
  assert.equal(t.balanceBdt, 180000);
});

test("a missing/zero exchange rate falls back to 1 instead of producing NaN", () => {
  const t = invoiceTotals(invoice({ exchangeRate: 0 }));
  assert.equal(t.exchangeRate, 1);
  assert.equal(t.grandBdt, t.grand);
});

test("isReceivable is false for DRAFT and VOID, true once sent", () => {
  assert.equal(isReceivable("DRAFT"), false);
  assert.equal(isReceivable("VOID"), false);
  assert.equal(isReceivable("SENT"), true);
  assert.equal(isReceivable("PARTIALLY_PAID"), true);
});

test("outstandingOf only applies to receivable statuses", () => {
  assert.equal(outstandingOf(invoice({ status: "DRAFT" })), 0);
  assert.equal(outstandingOf(invoice({ status: "SENT" })), 1500);
});
