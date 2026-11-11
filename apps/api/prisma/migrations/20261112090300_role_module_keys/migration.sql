-- Rename the permission-module keys to the names the API guards enforce.
-- The editor used to advertise CLIENTS/LEADS/PROJECTS/FINANCE/INSIGHTS while
-- every @RequirePermission() asked for ACCOUNTS/PULSE/FLOW/CAPITAL/INSIGHT, so
-- saving the matrix revoked nothing. Roles are canonicalised here; the runtime
-- also accepts the legacy labels so tokens issued before this migration keep
-- working until they expire.
UPDATE "Role"
SET "modulePermissions" = jsonb_set("modulePermissions", '{ACCOUNTS}', "modulePermissions"->'CLIENTS', true) - 'CLIENTS'
WHERE "modulePermissions" ? 'CLIENTS' AND NOT ("modulePermissions" ? 'ACCOUNTS');

UPDATE "Role"
SET "modulePermissions" = "modulePermissions" - 'CLIENTS'
WHERE "modulePermissions" ? 'CLIENTS';

UPDATE "Role"
SET "modulePermissions" = jsonb_set("modulePermissions", '{PULSE}', "modulePermissions"->'LEADS', true) - 'LEADS'
WHERE "modulePermissions" ? 'LEADS' AND NOT ("modulePermissions" ? 'PULSE');

UPDATE "Role"
SET "modulePermissions" = "modulePermissions" - 'LEADS'
WHERE "modulePermissions" ? 'LEADS';

UPDATE "Role"
SET "modulePermissions" = jsonb_set("modulePermissions", '{FLOW}', "modulePermissions"->'PROJECTS', true) - 'PROJECTS'
WHERE "modulePermissions" ? 'PROJECTS' AND NOT ("modulePermissions" ? 'FLOW');

UPDATE "Role"
SET "modulePermissions" = "modulePermissions" - 'PROJECTS'
WHERE "modulePermissions" ? 'PROJECTS';

UPDATE "Role"
SET "modulePermissions" = jsonb_set("modulePermissions", '{CAPITAL}', "modulePermissions"->'FINANCE', true) - 'FINANCE'
WHERE "modulePermissions" ? 'FINANCE' AND NOT ("modulePermissions" ? 'CAPITAL');

UPDATE "Role"
SET "modulePermissions" = "modulePermissions" - 'FINANCE'
WHERE "modulePermissions" ? 'FINANCE';

UPDATE "Role"
SET "modulePermissions" = jsonb_set("modulePermissions", '{INSIGHT}', "modulePermissions"->'INSIGHTS', true) - 'INSIGHTS'
WHERE "modulePermissions" ? 'INSIGHTS' AND NOT ("modulePermissions" ? 'INSIGHT');

UPDATE "Role"
SET "modulePermissions" = "modulePermissions" - 'INSIGHTS'
WHERE "modulePermissions" ? 'INSIGHTS';
