-- Control admin hardening:
--   * token revocation for deactivated users / password resets
--   * last login IP for the admin user list
--   * admin-only config (security policy, system flags, SMTP)

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginIp" TEXT;

ALTER TABLE "Settings" ADD COLUMN "adminConfig" JSONB NOT NULL DEFAULT '{}';
