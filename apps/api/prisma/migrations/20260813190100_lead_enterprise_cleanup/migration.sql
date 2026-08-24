-- Remove Client.leadId (redundant — FK lives on Lead.convertedClientId)
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_leadId_fkey";
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_leadId_key";
ALTER TABLE "Client" DROP COLUMN IF EXISTS "leadId";