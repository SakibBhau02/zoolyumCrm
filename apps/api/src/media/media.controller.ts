import { BadRequestException, Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { existsSync } from "fs";
import { basename } from "path";
import { Public } from "../common/decorators/public.decorator";
import { findUploadedFile, sanitizeFilename } from "../common/file-storage";
import { imageContentType } from "../common/image-pipeline";

/**
 * Public binary route for images the browser loads without an auth header
 * (logos, staff photos). Every filename is a UUID, so the URL itself is the
 * capability — same trade-off as the existing receipt/branding routes, but
 * shared so Accounts, Flow and People all store one URL shape.
 *
 * Buckets are an allowlist: nothing here can reach arbitrary upload folders.
 */
const BUCKETS = new Set(["logos", "people"]);

@Controller("media")
export class MediaController {
  @Public()
  @Get(":bucket/:filename")
  serve(@Param("bucket") bucket: string, @Param("filename") filename: string, @Res() res: any) {
    if (!BUCKETS.has(bucket)) throw new NotFoundException("Not found");
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new BadRequestException("Invalid filename");
    }
    const safe = basename(sanitizeFilename(filename));
    const path = findUploadedFile(bucket, safe);
    if (!existsSync(path)) throw new NotFoundException("Image not found");
    res.setHeader("Content-Type", imageContentType(safe));
    // Names are UUID-based and content never changes in place — cache hard.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(path);
  }
}
