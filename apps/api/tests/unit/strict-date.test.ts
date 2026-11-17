import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { parseOptionalDate, parseStrictDate } from "../../src/common/strict-date";

/**
 * Regression guards for audit BUG-002: `new Date("2026-02-31")` silently rolls
 * over to 2026-03-03, which filed expenses in the wrong month.
 */

test("accepts a real day key and returns UTC midnight", () => {
  const d = parseStrictDate("2026-11-14");
  assert.equal(d.toISOString(), "2026-11-14T00:00:00.000Z");
});

test("accepts a leap day", () => {
  assert.equal(parseStrictDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
});

test("rejects an impossible day instead of rolling it over", () => {
  assert.throws(() => parseStrictDate("2026-02-31"), BadRequestException);
});

test("rejects an impossible month", () => {
  assert.throws(() => parseStrictDate("2026-13-01"), BadRequestException);
});

test("rejects garbage", () => {
  assert.throws(() => parseStrictDate("not-a-date"), BadRequestException);
  assert.throws(() => parseStrictDate(""), BadRequestException);
});

test("a full timestamp is kept as an instant (not re-interpreted)", () => {
  const d = parseStrictDate("2026-11-14T10:30:00.000Z");
  assert.equal(d.toISOString(), "2026-11-14T10:30:00.000Z");
});

test("optional variant maps empty input to null and validates real input", () => {
  assert.equal(parseOptionalDate(undefined), null);
  assert.equal(parseOptionalDate(null), null);
  assert.equal(parseOptionalDate(""), null);
  assert.equal(parseOptionalDate("2026-03-01")?.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.throws(() => parseOptionalDate("2026-04-31"), BadRequestException);
});

test("the field name is used in the error message", () => {
  try {
    parseStrictDate("2026-02-31", "Expense date");
    assert.fail("should throw");
  } catch (error: any) {
    assert.match(String(error.message), /Expense date/);
  }
});
