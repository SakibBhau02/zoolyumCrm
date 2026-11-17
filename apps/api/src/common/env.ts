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

/**
 * A secret that is long enough can still be a phrase ("zoolyum-dev-secret…").
 * HS256 forgery needs only the key, so production rejects anything that looks
 * like human text: known words, low character diversity, or repeated runs.
 */
const WEAK_SECRET_WORDS = ["zoolyum", "dev", "secret", "password", "changeme", "test", "example"];

export function assessSecret(secret: string): string | null {
  const s = secret.trim();
  if (!s) return "is required (generate one with: openssl rand -base64 48)";
  if (s.length < MIN_SECRET_LENGTH) return `must be at least ${MIN_SECRET_LENGTH} characters`;
  const lower = s.toLowerCase();
  const hit = WEAK_SECRET_WORDS.find((w) => lower.includes(w));
  if (hit) return `contains the guessable word "${hit}" — generate a random value instead`;
  const unique = new Set(s).size;
  if (unique < 16) return "has too little character variety — generate a random value instead";
  const longestRun = /(.)\1{3,}/.test(s);
  if (longestRun) return "contains a long repeated run — generate a random value instead";
  return null;
}

export function assertEnv(): void {
  const problems: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const jwt = (process.env.JWT_SECRET ?? "").trim();
  // Strict entropy rules are enforced in production only: the checked-in dev
  // .env uses a readable phrase on purpose, and refusing to boot a laptop would
  // just teach people to disable the check.
  const jwtProblem = isProd
    ? assessSecret(jwt)
    : !jwt
      ? "is required (generate one with: openssl rand -base64 48)"
      : jwt.length < MIN_SECRET_LENGTH
        ? `must be at least ${MIN_SECRET_LENGTH} characters`
        : null;
  if (jwtProblem) problems.push(`JWT_SECRET ${jwtProblem}`);

  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is required");
  }

  if (isProd) {
    if (!(process.env.CORS_ORIGINS ?? "").trim()) {
      problems.push("CORS_ORIGINS is required in production (comma-separated origins)");
    }
    // File links must not be signed with the session key: rotating the JWT
    // secret would silently invalidate every download link, and a leaked link
    // key would let an attacker mint session tokens with the same secret.
    const fileSecret = (process.env.FILE_URL_SECRET ?? "").trim();
    const fileProblem = assessSecret(fileSecret);
    if (fileProblem) problems.push(`FILE_URL_SECRET ${fileProblem}`);
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
  if (!isProd && assessSecret(jwt)) {
    console.warn("[zoolyum] JWT_SECRET would be rejected in production (phrasal / low entropy). Generate one with: openssl rand -base64 48");
  }
}
