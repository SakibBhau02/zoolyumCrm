import crypto from "crypto";

/**
 * Real AES-256-GCM secret encryption for integration credentials
 * (the older base64 `encryptMaybe` helpers are obfuscation only — do not
 * use them for WhatsApp tokens). Key derives from JWT_SECRET, so rotating
 * JWT_SECRET invalidates stored blobs (re-enter credentials after rotation).
 */
function key(): Buffer {
  const secret = process.env.JWT_SECRET ?? "zoolyum-os-dev-secret-change-in-prod";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [ivH, tagH, dataH] = blob.split(":");
    if (!ivH || !tagH || !dataH) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivH, "hex"));
    decipher.setAuthTag(Buffer.from(tagH, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataH, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Unguessable public share token (256-bit, hex). */
export function randomShareToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
