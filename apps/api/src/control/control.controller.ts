import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename } from "path";
import { ControlService } from "./control.service";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UpdateBrandingDto } from "./dto/update-branding.dto";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

const brandingDir = () => uploadsDir("branding");

/** Roles that may open the admin workspace. */
const ADMIN = ["Owner", "CONTROL"] as const;

@RequirePermission("CONTROL")
@Controller("control")
export class ControlController {
  constructor(private readonly control: ControlService) {}

  // ── Branding ─────────────────────────────────────────────────────────
  // GET stays available to every signed-in user: the whole UI reads it for the
  // app name, colours and logos. Mutations are admin-only.
  @Get("branding")
  branding() {
    return this.control.branding();
  }

  /**
   * Public display branding for the client portal / login pages. No auth, no
   * invoice configuration, no payment details — only what a logo header needs.
   */
  @Public()
  @Get("branding/public")
  async publicBranding() {
    const b: any = await this.control.branding();
    if (!b) return null;
    return {
      appName: b.appName,
      logoUrl: b.logoUrl,
      logoDarkUrl: b.logoDarkUrl,
      logoLightUrl: b.logoLightUrl,
      primaryColor: b.primaryColor,
      secondaryColor: b.secondaryColor,
      tagline: b.tagline,
      email: b.email,
      phone: b.phone,
      address: b.address,
      city: b.city,
      country: b.country,
      website: b.website,
      defaultCurrency: b.defaultCurrency,
    };
  }

  @Patch("branding")
  @Roles(...ADMIN)
  updateBranding(@Body() dto: UpdateBrandingDto, @CurrentUser("sub") actorId: string) {
    return this.control.updateBranding(dto, actorId);
  }

  @Post("branding/upload")
  @Roles(...ADMIN)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, brandingDir());
        },
        filename: (_req, file, cb) => cb(null, `${randomUUID()}-${sanitizeFilename(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
        cb(ok ? null : new BadRequestException("Only image files are allowed (png, jpeg, webp)"), ok);
      },
    }),
  )
  async uploadBrandingLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    return { url: `/api/control/branding/uploads/${file.filename}` };
  }

  @Get("branding/uploads/:filename")
  @Public()
  serveBrandingFile(@Param("filename") filename: string, @Res() res: any) {
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new BadRequestException("Invalid filename");
    }
    const safe = basename(sanitizeFilename(filename));
    return res.sendFile(findUploadedFile("branding", safe));
  }

  // ── Roles ────────────────────────────────────────────────────────────
  @Get("roles")
  @Roles(...ADMIN)
  roles() {
    return this.control.roles();
  }

  @Post("roles")
  @Roles("Owner")
  createRole(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.createRole(body, actorId);
  }

  @Patch("roles/:id")
  @Roles("Owner")
  updateRole(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.updateRole(id, body, actorId);
  }

  @Delete("roles/:id")
  @Roles("Owner")
  deleteRole(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.control.deleteRole(id, actorId);
  }

  // ── Integrations ─────────────────────────────────────────────────────
  @Get("integrations")
  @Roles(...ADMIN)
  integrations() {
    return this.control.integrations();
  }

  @Post("integrations")
  @Roles(...ADMIN)
  createIntegration(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.createIntegration(body, actorId);
  }

  @Patch("integrations/:id")
  @Roles(...ADMIN)
  updateIntegration(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.updateIntegration(id, body, actorId);
  }

  @Delete("integrations/:id")
  @Roles("Owner")
  deleteIntegration(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.control.deleteIntegration(id, actorId);
  }

  @Post("integrations/:id/test")
  @Roles(...ADMIN)
  testIntegration(@Param("id") id: string) {
    return this.control.testIntegration(id);
  }

  // ── Audit trail ──────────────────────────────────────────────────────
  @Get("audit-logs")
  @Roles(...ADMIN)
  auditLogs(@Query() query: any) {
    return this.control.auditLogs(query);
  }

  // ── Settings ─────────────────────────────────────────────────────────
  // Read is available to every signed-in user (Accounts reads client tiers),
  // but only admins receive security / SMTP / system fields. Writes stay admin.
  @Get("settings")
  getSettings(@CurrentUser() user: any) {
    return this.control.getSettings(user?.role);
  }

  @Patch("settings")
  @Roles(...ADMIN)
  updateSettings(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.updateSettings(body, actorId);
  }

  // ── System health ────────────────────────────────────────────────────
  @Get("health")
  @Roles(...ADMIN)
  health() {
    return this.control.health();
  }

  // ── Users ────────────────────────────────────────────────────────────
  @Post("users")
  @Roles(...ADMIN)
  createUser(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.createUser(body, actorId);
  }

  @Patch("users/:id")
  @Roles(...ADMIN)
  updateUser(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.updateUser(id, body, actorId);
  }

  @Post("users/:id/reset-password")
  @Roles(...ADMIN)
  resetPassword(
    @Param("id") id: string,
    @Body() body: { newPassword?: string },
    @CurrentUser("sub") actorId: string
  ) {
    return this.control.resetPassword(id, body?.newPassword, actorId);
  }

  /**
   * Self-service password change. No role gate: the current password is proof
   * of identity, and the service verifies it before changing anything.
   */
  @Post("users/:id/change-password")
  changePassword(
    @Param("id") id: string,
    @Body() body: { oldPassword: string; newPassword: string },
    @CurrentUser("sub") actorId: string
  ) {
    return this.control.changePassword(id, body?.oldPassword, body?.newPassword, actorId);
  }

  @Delete("users/:id")
  @Roles("Owner")
  deleteUser(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.control.deleteUser(id, actorId);
  }

  // ── Pipeline stages ──────────────────────────────────────────────────
  @Get("pipeline-stages")
  @Roles(...ADMIN)
  pipelineStages() {
    return this.control.pipelineStages();
  }

  @Post("pipeline-stages")
  @Roles(...ADMIN)
  createPipelineStage(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.createPipelineStage(body, actorId);
  }

  @Patch("pipeline-stages/:id")
  @Roles(...ADMIN)
  updatePipelineStage(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.control.updatePipelineStage(id, body, actorId);
  }

  @Delete("pipeline-stages/:id")
  @Roles("Owner")
  deletePipelineStage(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.control.deletePipelineStage(id, actorId);
  }

  // ── Data management ──────────────────────────────────────────────────
  @Get("export")
  @Roles(...ADMIN)
  exportAll(@CurrentUser("sub") actorId: string) {
    return this.control.exportAllData(actorId);
  }

  @Post("delete-all")
  @Roles("Owner")
  deleteAll(@CurrentUser("sub") actorId: string) {
    return this.control.deleteAllData(actorId);
  }
}
