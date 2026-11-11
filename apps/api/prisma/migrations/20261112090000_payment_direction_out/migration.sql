-- Money direction for the shared Payment table.
--
-- Rows with an expenseId are cash paid OUT to a vendor; before this enum value
-- they inherited the IN default and were aggregated as client income.
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'OUT';
