import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring access to an uploaded project file.
 *
 * The uploads route has to stay reachable without an Authorization header
 * (the browser opens it as a plain download link), so the URL itself carries
 * proof: an expiry plus an HMAC over the filename. A leaked link stops working
 * when it expires, and rotating the secret invalidates every outstanding link.
 */
const PREFIX = "/api/flow/uploads/";

function secret(): string {
  return (
    process.env.FILE_URL_SECRET ??
    process.env.JWT_SECRET ??
    "zoolyum-os-dev-secret-change-in-prod"
  );
}

function ttlSeconds(): number {
  const raw = Number(process.env.FILE_URL_TTL_SEC ?? 900);
  return Number.isFinite(raw) && raw >= 60 ? raw : 900;
}

function signature(filename: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${filename}:${exp}`).digest("base64url");
}

export function signFileAccess(filename: string, ttl = ttlSeconds()): string {
  const exp = Date.now() + ttl * 1000;
  return `${PREFIX}${encodeURIComponent(filename)}?exp=${exp}&sig=${signature(filename, exp)}`;
}

export function verifyFileAccess(
  filename: string,
  expRaw: unknown,
  sigRaw: unknown
): boolean {
  const exp = Number(expRaw);
  const sig = String(sigRaw ?? "");
  if (!Number.isFinite(exp) || exp <= Date.now() || !sig) return false;
  const expected = signature(filename, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Turn a stored upload path into a freshly signed URL. External links
 * (Drive/Notion/Figma) pass through untouched.
 */
export function signStoredFileUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  if (!fileUrl.startsWith(PREFIX)) return fileUrl;
  return signFileAccess(decodeURIComponent(fileUrl.slice(PREFIX.length)));
}

/** Extract the on-disk filename from a stored upload path, or null for external links. */
export function uploadedFilename(fileUrl: string | null | undefined): string | null {
  if (!fileUrl || !fileUrl.startsWith(PREFIX)) return null;
  const name = decodeURIComponent(fileUrl.slice(PREFIX.length).split("?")[0]);
  return name && !name.includes("/") && !name.includes("\\") && !name.includes("..") ? name : null;
}
