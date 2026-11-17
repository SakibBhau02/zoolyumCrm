import { spawn } from "child_process";
import { unlink, writeFile } from "fs/promises";
import { extname, join } from "path";
import { randomUUID } from "crypto";
import { BadRequestException } from "@nestjs/common";
import { diskStorage } from "multer";
import sharp from "sharp";
import { uploadsDir } from "./file-storage";

/**
 * Upload pipeline for raster images.
 *
 * Every image is normalised with sharp (EXIF-rotate, strip metadata, cap the
 * long edge) and written as WebP — the format every browser renders, so lists,
 * PDFs and portal pages never break. Alongside it we try to write a JPEG XL
 * sibling with ffmpeg+libjxl: JXL is ~30% smaller at the same quality and is
 * natively decoded by Chrome 155+, Firefox 158+ and Safari 17+, and the UI
 * offers it through <picture type="image/jxl"> with the WebP as fallback.
 *
 * JXL is strictly best-effort: if ffmpeg is missing or fails, the upload still
 * succeeds with WebP only (jxlUrl = null). Set IMAGE_JXL=off to skip it.
 */

/** What the image is used for — decides the size cap and quality. */
export type ImageKind = "logo" | "avatar" | "photo" | "document";

/** Directory used by logo/photo uploads (created on demand). */
export const mediaDir = (bucket: "logos" | "people") => uploadsDir(bucket);

const PROFILES: Record<ImageKind, { max: number; webpQuality: number; jxlDistance: number }> = {
  // Wordmarks with fine text need a high quality + a generous cap.
  logo: { max: 1200, webpQuality: 92, jxlDistance: 2 },
  // Staff photos render at ~40-96 px in avatars.
  avatar: { max: 720, webpQuality: 86, jxlDistance: 2 },
  photo: { max: 1800, webpQuality: 84, jxlDistance: 3 },
  // Attachments/receipts: keep detail readable when zoomed.
  document: { max: 2400, webpQuality: 86, jxlDistance: 3 },
};

const CONVERTIBLE = /^image\/(jpe?g|png|webp|gif|bmp|tiff|avif|heic|heif)$/i;

/** True when the mime type is a raster image we can re-encode. */
export function isConvertibleImage(mimetype?: string | null): boolean {
  return !!mimetype && CONVERTIBLE.test(mimetype);
}

export interface OptimizedImage {
  /** WebP URL (path the caller asked for). */
  url: string;
  /** JPEG XL sibling URL, or null when the encoder is unavailable. */
  jxlUrl: string | null;
  /** Stored WebP filename (basename). */
  fileName: string;
  /** Stored JXL filename (basename), or null. */
  jxlFileName: string | null;
  width: number;
  height: number;
  /** Byte size of the WebP file. */
  size: number;
  mimeType: "image/webp";
}

// JXL encoding shells out to ffmpeg. Probe once, cache the answer, and let the
// environment disable it entirely.
let ffmpegProbe: Promise<boolean> | null = null;
function hasJxlEncoder(): Promise<boolean> {
  if (process.env.IMAGE_JXL === "off") return Promise.resolve(false);
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise<boolean>((resolve) => {
      try {
        const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-version"], { stdio: "ignore" });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
  return ffmpegProbe;
}

function encodeJxl(input: string, output: string, distance: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", input,
      "-c:v", "libjxl",
      "-distance", String(distance),
      // One still frame; `-update 1` stops ffmpeg 7+ warning about image2.
      "-frames:v", "1", "-update", "1",
      "-y", output,
    ]);
    let stderr = "";
    p.stderr?.on("data", (d) => { stderr += String(d); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
  });
}

/**
 * Rewrite `file` (already on disk from multer) as `<base>.webp` and, when
 * possible, `<base>.jxl`. The original upload is removed once WebP exists.
 *
 * `urlPrefix` is the public route that serves the directory, e.g.
 * `/api/media/logos`.
 */
export async function optimizeUploadedImage(
  file: Express.Multer.File,
  opts: { kind: ImageKind; urlPrefix: string }
): Promise<OptimizedImage> {
  const profile = PROFILES[opts.kind];
  const dir = join(file.path, "..");
  const base = file.filename.replace(/\.[^.]+$/, "");
  const webpName = `${base}.webp`;
  const jxlName = `${base}.jxl`;
  const webpPath = join(dir, webpName);
  const jxlPath = join(dir, jxlName);
  const normalizedPath = join(dir, `${base}.src.png`);

  let normalized: Buffer;
  let width = 0;
  let height = 0;
  try {
    const res = await sharp(file.path)
      .rotate()
      // Keep the original alpha channel: logos are usually transparent PNGs.
      .resize({ width: profile.max, height: profile.max, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true });
    normalized = res.data;
    width = res.info.width;
    height = res.info.height;

    const written = await sharp(normalized)
      .webp({ quality: profile.webpQuality, effort: 4, alphaQuality: 100 })
      .toFile(webpPath);

    let jxlFileName: string | null = null;
    if (await hasJxlEncoder()) {
      try {
        // ffmpeg reads the normalised PNG so JXL does not inherit a second
        // round of WebP compression.
        await writeFile(normalizedPath, normalized);
        await encodeJxl(normalizedPath, jxlPath, profile.jxlDistance);
        jxlFileName = jxlName;
      } catch {
        // Best effort only — WebP is already saved.
        jxlFileName = null;
      } finally {
        await unlink(normalizedPath).catch(() => null);
      }
    }

    return {
      url: `${opts.urlPrefix}/${webpName}`,
      jxlUrl: jxlFileName ? `${opts.urlPrefix}/${jxlFileName}` : null,
      fileName: webpName,
      jxlFileName,
      width,
      height,
      size: written.size,
      mimeType: "image/webp",
    };
  } finally {
    // multer's original (often a 5 MB phone photo) is never served.
    await unlink(file.path).catch(() => null);
  }
}

/** Best-effort delete of both variants given stored WebP/JXL names. */
export async function removeOptimizedImage(dir: string, ...filenames: (string | null | undefined)[]) {
  for (const name of filenames) {
    if (!name) continue;
    const safe = name.split("/").pop();
    if (!safe || safe.includes("..")) continue;
    await unlink(join(dir, safe)).catch(() => null);
  }
}

/** The stored filename of an uploaded URL, or null when it points elsewhere. */export function uploadFilename(url?: string | null): string | null {
  if (!url) return null;
  const name = url.split("?")[0].split("/").pop();
  if (!name || name.includes("..")) return null;
  return name;
}

/** Content type for the media route, including the ones express may not know. */
export function imageContentType(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".jxl") return "image/jxl";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".avif") return "image/avif";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

/** `FileInterceptor` options for an image-only upload into a media bucket. */
export function imageUploadOptions(bucket: "logos" | "people", maxBytes = 10 * 1024 * 1024) {
  return {
    storage: diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, mediaDir(bucket)),
      filename: (_req: any, file: any, cb: any) =>
        cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".img"}`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req: any, file: any, cb: any) => {
      const ok = /^image\/(jpe?g|png|webp|gif|bmp|tiff|avif|heic|heif)$/i.test(file.mimetype);
      cb(ok ? null : new BadRequestException("Only image files are allowed (jpg, png, webp, gif)"), ok);
    },
  };
}
