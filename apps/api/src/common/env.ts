/**
 * Boot-time environment contract.
 *
 * The app used to fall back to the literal string "dev-secret" when
 * JWT_SECRET was missing outside NODE_ENV=production. A staging box (or a
 * container started without NODE_ENV) would then accept forged Owner tokens,
 * because the signing key is public knowledge. A missing secret is a deploy
 * mistake, not a runtime condition — refuse to start.
 */
const MIN_SECRET_LENGTH = 32;

export function assertEnv(): void {
  const problems: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const jwt = (process.env.JWT_SECRET ?? "").trim();
  if (!jwt) {
    problems.push("JWT_SECRET is required (generate one with: openssl rand -base64 48)");
  } else if (jwt.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is required");
  }

  if (isProd) {
    if (!(process.env.CORS_ORIGINS ?? "").trim()) {
      problems.push("CORS_ORIGINS is required in production (comma-separated origins)");
    }
    if ((process.env.JWT_SECRET ?? "").includes("dev-secret")) {
      problems.push("JWT_SECRET still contains the development placeholder");
    }
  }

  if (problems.length) {
    // Log without a stack: this is configuration, not a crash.
    console.error("\n[zoolyum] Refusing to start — configuration errors:");
    for (const p of problems) console.error(`  • ${p}`);
    console.error("");
    process.exit(1);
  }

  if (!process.env.TRUST_PROXY && isProd) {
    console.warn(
      "[zoolyum] TRUST_PROXY is not set. If the API runs behind nginx/ALB, set TRUST_PROXY=1 " +
        "or every client will share the proxy IP for rate limiting and the IP allowlist."
    );
  }
  if (!process.env.FILE_URL_SECRET) {
    console.warn("[zoolyum] FILE_URL_SECRET not set — file links are signed with JWT_SECRET.");
  }
}
