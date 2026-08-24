import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename, join } from "path";
import { mkdirSync } from "fs";
import { ControlService } from "./control.service";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UpdateBrandingDto } from "./dto/update-branding.dto";

const BRANDING_UPLOADS_DIR = join(process.cwd(), "uploads/branding");

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("control")
export class ControlController {
  constructor(private readonly control: ControlService) {}

  @Get("roles")
  roles() {
    return this.control.roles();
  }

  @Get("integrations")
  integrations() {
    return this.control.integrations();
  }

  @Get("branding")
  branding() {
    return this.control.branding();
  }

  @Patch("branding")
  @Roles("Owner", "CONTROL")
  updateBranding(@Body() dto: UpdateBrandingDto) {
    return this.control.updateBranding(dto);
  }

  @Post("branding/upload")
  @Roles("Owner", "CONTROL")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(BRANDING_UPLOADS_DIR, { recursive: true });
          cb(null, BRANDING_UPLOADS_DIR);
        },
        filename: (_req, file, cb) => cb(null, `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "")}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.mimetype);
        cb(ok ? null : new BadRequestException("Only image files are allowed"), ok);
      },
    }),
  )
  async uploadBrandingLogo(@UploadedFile() file: Express.Multer.File) {
    return { url: `/api/control/branding/uploads/${file.filename}` };
  }

  @Get("branding/uploads/:filename")
  @Public()
  serveBrandingFile(@Param("filename") filename: string, @Res() res: any) {
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new BadRequestException("Invalid filename");
    }
    const sanitized = filename.replace(/[^a-zA-Z0-9.\-_]/g, "");
    const safe = basename(sanitized);
    return res.sendFile(join(BRANDING_UPLOADS_DIR, safe));
  }

  @Get("audit-logs")
  auditLogs() {
    return this.control.auditLogs();
  }

  @Patch("integrations/:id")
  updateIntegration(@Param("id") id: string, @Body() body: { status?: string }) {
    return this.control.updateIntegration(id, body);
  }

  // ── Settings ─────────────────────────────────────────────────────────
  @Get("settings")
  getSettings() {
    return this.control.getSettings();
  }

  @Patch("settings")
  updateSettings(@Body() body: any) {
    return this.control.updateSettings(body);
  }

  // ── Users ────────────────────────────────────────────────────────────
  @Post("users")
  createUser(@Body() body: any) {
    return this.control.createUser(body);
  }

  @Patch("users/:id")
  updateUser(@Param("id") id: string, @Body() body: any) {
    return this.control.updateUser(id, body);
  }

  @Post("users/:id/reset-password")
  resetPassword(@Param("id") id: string, @Body() body: { newPassword: string }) {
    return this.control.resetPassword(id, body.newPassword ?? "password123");
  }

  @Post("users/:id/change-password")
  changePassword(@Param("id") id: string, @Body() body: { oldPassword: string; newPassword: string }) {
    return this.control.changePassword(id, body.oldPassword, body.newPassword);
  }

  @Delete("users/:id")
  deleteUser(@Param("id") id: string) {
    return this.control.deleteUser(id);
  }

  // ── Pipeline stages ──────────────────────────────────────────────────
  @Get("pipeline-stages")
  pipelineStages() {
    return this.control.pipelineStages();
  }

  @Post("pipeline-stages")
  createPipelineStage(@Body() body: any) {
    return this.control.createPipelineStage(body);
  }

  @Patch("pipeline-stages/:id")
  updatePipelineStage(@Param("id") id: string, @Body() body: any) {
    return this.control.updatePipelineStage(id, body);
  }

  @Delete("pipeline-stages/:id")
  deletePipelineStage(@Param("id") id: string) {
    return this.control.deletePipelineStage(id);
  }

  // ── Data management ──────────────────────────────────────────────────
  @Get("export")
  exportAll() {
    return this.control.exportAllData();
  }

  @Post("delete-all")
  deleteAll() {
    return this.control.deleteAllData();
  }
}