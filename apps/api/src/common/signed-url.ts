import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring access to an uploaded file.
 *
 * The uploads routes have to stay reachable without an Authorization header
 * (the browser opens them as a plain <img>/download), so the URL itself carries
 * proof: an expiry plus an HMAC over the bucket + filename. A leaked link stops
 * working when it expires, and rotating the secret invalidates every
 * outstanding link.
 *
 * Two buckets exist — `flow` (project files) and `pulse` (lead attachments).
 * The bucket is part of the signed payload, so a signature minted for one
 * bucket can never be replayed against the other.
 */
export type FileBucket = "flow" | "pulse";

const PREFIXES: Record<FileBucket, string> = {
  flow: "/api/flow/uploads/",
  pulse: "/api/pulse/uploads/",
};

function secret(): string {
  const s = process.env.FILE_URL_SECRET ?? process.env.JWT_SECRET;
  if (!s) throw new Error("FILE_URL_SECRET or JWT_SECRET is required to sign file URLs");
  return s;
}

function ttlSeconds(): number {
  const raw = Number(process.env.FILE_URL_TTL_SEC ?? 900);
  return Number.isFinite(raw) && raw >= 60 ? raw : 900;
}

function signature(bucket: FileBucket, filename: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${bucket}:${filename}:${exp}`).digest("base64url");
}

export function signFileAccess(
  filename: string,
  ttl = ttlSeconds(),
  bucket: FileBucket = "flow"
): string {
  const exp = Date.now() + ttl * 1000;
  return `${PREFIXES[bucket]}${encodeURIComponent(filename)}?exp=${exp}&sig=${signature(bucket, filename, exp)}`;
}

export function verifyFileAccess(
  filename: string,
  expRaw: unknown,
  sigRaw: unknown,
  bucket: FileBucket = "flow"
): boolean {
  const exp = Number(expRaw);
  const sig = String(sigRaw ?? "");
  if (!Number.isFinite(exp) || exp <= Date.now() || !sig) return false;
  const expected = signature(bucket, filename, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Which bucket (if any) a stored upload path belongs to. */
export function bucketOf(fileUrl: string | null | undefined): FileBucket | null {
  if (!fileUrl) return null;
  if (fileUrl.startsWith(PREFIXES.flow)) return "flow";
  if (fileUrl.startsWith(PREFIXES.pulse)) return "pulse";
  return null;
}

/**
 * Turn a stored upload path into a freshly signed URL. External links
 * (Drive/Notion/Figma) pass through untouched.
 */
export function signStoredFileUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const bucket = bucketOf(fileUrl);
  if (!bucket) return fileUrl;
  const name = uploadedFilename(fileUrl);
  if (!name) return fileUrl;
  return signFileAccess(name, ttlSeconds(), bucket);
}

/** Extract the on-disk filename from a stored upload path, or null for external links. */
export function uploadedFilename(fileUrl: string | null | undefined): string | null {
  const bucket = bucketOf(fileUrl);
  if (!bucket || !fileUrl) return null;
  const name = decodeURIComponent(fileUrl.slice(PREFIXES[bucket].length).split("?")[0]);
  return name && !name.includes("/") && !name.includes("\\") && !name.includes("..") ? name : null;
}
