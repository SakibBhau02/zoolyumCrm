import { existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Uploaded-file storage anchored to the API package directory instead of
 * process.cwd() (which differs depending on where `npm run` was launched
 * from — repo root vs apps/api — silently orphaning previously uploaded
 * files and 404ing every consumer).
 *
 * At runtime __dirname is <api>/dist/<module> (or <api>/src/<module> under
 * ts-node), so ../../uploads always resolves to <api>/uploads in both dev
 * and prod. Reads additionally fall back to the legacy cwd-based location
 * so files uploaded by older builds keep working.
 */
export function uploadsRoot(): string {
  return join(__dirname, "..", "..", "uploads");
}

export function uploadsDir(...sub: string[]): string {
  const dir = join(uploadsRoot(), ...sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve an uploaded file, checking the anchored dir first, then legacy cwd dir. */
export function findUploadedFile(...parts: string[]): string {
  const primary = join(uploadsRoot(), ...parts);
  if (existsSync(primary)) return primary;
  const legacy = join(process.cwd(), "uploads", ...parts);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "");
}
