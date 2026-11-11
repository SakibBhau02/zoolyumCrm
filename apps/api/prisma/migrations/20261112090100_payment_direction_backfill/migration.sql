-- Backfill the direction for every historical vendor payout, so reports are
-- correct for data created before the enum value existed.
UPDATE "Payment"
SET "type" = 'OUT'
WHERE "expenseId" IS NOT NULL
  AND "type" <> 'OUT';
