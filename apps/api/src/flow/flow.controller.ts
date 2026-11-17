import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename, extname, join } from "path";
import { FlowService } from "./flow.service";
import { FlowShootService } from "./flow-shoot.service";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { CreateReferenceDto } from "./dto/create-reference.dto";
import {
  AddDeliverableDto,
  AddDiscussionDto,
  AddFileDto,
  AddMilestoneDto,
  AddShootCrewDto,
  AssignDeliverableTasksDto,
  BulkAddDeliverablesDto,
  BulkAssignTasksDto,
  CreateShootDto,
  GenerateReportDto,
  SetFileApprovalDto,
  UpdateDeliverableDto,
  UpdateMilestoneDto,
  UpdateReportDto,
  UpdateShootCrewDto,
  UpdateShootDto,
  UpsertProjectProposalDto,
} from "./dto/flow-mutations.dto";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { imageUploadOptions, isConvertibleImage, optimizeUploadedImage } from "../common/image-pipeline";
import { signFileAccess, verifyFileAccess } from "../common/signed-url";
import { RequirePermission, SkipPermission } from "../common/decorators/require-permission.decorator";

const flowUploadDir = () => uploadsDir();

/**
 * Project workspace API.
 *
 * Access is the FLOW module permission: reads need `view`, every mutating verb
 * needs `edit` (derived by PermissionsGuard). Destructive operations ask for an
 * additional Owner/CONTROL role. File downloads are the one unauthenticated
 * route; they carry a short-lived HMAC signature instead of a session.
 */
@RequirePermission("FLOW")
@Controller("flow")
export class FlowController {
  constructor(
    private readonly flow: FlowService,
    private readonly shoots: FlowShootService
  ) {}

  @Get("overview")
  overview() {
    return this.flow.overview();
  }

  @Get("projects")
  list(@Query() query: { q?: string; status?: string; health?: string }) {
    return this.flow.list(query);
  }

  /**
   * Minimal id/name list for pickers in Capital and other modules whose roles
   * do not have the Flow workspace (e.g. HR recording a project expense).
   * Exposes no budget, client or health data.
   */
  @Get("project-lookup")
  @SkipPermission()
  async projectLookup() {
    return this.flow.projectLookup();
  }

  @Get("projects/:id")
  detail(@Param("id") id: string) {
    return this.flow.detail(id);
  }

  @Post("projects")
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.flow.create(dto, user?.sub);
  }

  @Patch("projects/:id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.update(id, dto, user?.sub);
  }

  @Delete("projects/:id")
  @Roles("Owner", "CONTROL")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.remove(id, user?.sub);
  }

  // ── References & Research ──────────────────────────────────────────
  @Post("projects/:id/references")
  createReference(
    @Param("id") id: string,
    @Body() dto: CreateReferenceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.flow.createReference(id, dto, user.sub);
  }

  @Get("projects/:id/references")
  listReferences(@Param("id") id: string) {
    return this.flow.listReferences(id);
  }

  @Patch("references/:id")
  updateReference(@Param("id") id: string, @Body() dto: CreateReferenceDto) {
    return this.flow.updateReference(id, dto);
  }

  @Delete("references/:id")
  removeReference(@Param("id") id: string) {
    return this.flow.deleteReference(id);
  }

  // ── Project logo (WebP + JPEG XL) ───────────────────────────────────
  @Post("projects/:id/logo")
  @UseInterceptors(FileInterceptor("file", imageUploadOptions("logos")))
  async uploadLogo(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    const image = await optimizeUploadedImage(file, { kind: "logo", urlPrefix: "/api/media/logos" });
    const saved = await this.flow.setLogo(id, image.url, image.jxlUrl);
    return { ...saved, width: image.width, height: image.height, size: image.size };
  }

  @Delete("projects/:id/logo")
  removeLogo(@Param("id") id: string) {
    return this.flow.removeLogo(id);
  }

  // ── Final proposal (hard limit: one per project) ────────────────────  @Get("projects/:id/proposal")
  getProposal(@Param("id") id: string) {
    return this.flow.projectProposal(id);
  }

  @Put("projects/:id/proposal")
  saveProposal(
    @Param("id") id: string,
    @Body() dto: UpsertProjectProposalDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.upsertProjectProposal(id, dto, user?.sub);
  }

  @Delete("projects/:id/proposal")
  removeProposal(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.deleteProjectProposal(id, user?.sub);
  }

  @Post("projects/:id/tasks/bulk")
  bulkTasks(
    @Param("id") id: string,
    @Body() dto: BulkAssignTasksDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.bulkAssignTasks(id, dto.taskIds, user?.sub);
  }

  // ── Deliverables (proposal commitments) ─────────────────────────────
  @Post("projects/:id/deliverables")
  addDeliverable(
    @Param("id") id: string,
    @Body() dto: AddDeliverableDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.addDeliverable(id, dto, user?.sub);
  }

  /** Paste mode — "8 graphics + 4 videos" in one request. */
  @Post("projects/:id/deliverables/bulk")
  bulkAddDeliverables(
    @Param("id") id: string,
    @Body() dto: BulkAddDeliverablesDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.bulkAddDeliverables(id, dto, user?.sub);
  }

  /** One-click: turn selected deliverables into tasks for one assignee. */
  @Post("projects/:id/deliverables/assign-tasks")
  assignDeliverableTasks(
    @Param("id") id: string,
    @Body() dto: AssignDeliverableTasksDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.assignDeliverableTasks(id, dto as any, user?.sub);
  }

  @Patch("deliverables/:id")
  updateDeliverable(
    @Param("id") id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.updateDeliverable(id, dto, user?.sub);
  }

  @Delete("deliverables/:id")
  removeDeliverable(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.removeDeliverable(id, user?.sub);
  }

  // ── Shoots (production call-sheets) ──────────────────────────────────
  @Get("projects/:id/shoots")
  listShoots(@Param("id") id: string) {
    return this.shoots.list(id);
  }

  @Post("projects/:id/shoots")
  createShoot(
    @Param("id") id: string,
    @Body() dto: CreateShootDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.shoots.create(id, dto, user?.sub);
  }

  @Get("shoots/:id")
  getShoot(@Param("id") id: string) {
    return this.shoots.detail(id);
  }

  @Patch("shoots/:id")
  updateShoot(
    @Param("id") id: string,
    @Body() dto: UpdateShootDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.shoots.update(id, dto, user?.sub);
  }

  @Delete("shoots/:id")
  removeShoot(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.shoots.remove(id, user?.sub);
  }

  @Post("shoots/:id/crew")
  addShootCrew(
    @Param("id") id: string,
    @Body() dto: AddShootCrewDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.shoots.addCrew(id, dto, user?.sub);
  }

  @Patch("shoots/:id/crew/:crewId")
  updateShootCrew(
    @Param("id") id: string,
    @Param("crewId") crewId: string,
    @Body() dto: UpdateShootCrewDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.shoots.updateCrew(id, crewId, dto, user?.sub);
  }

  @Delete("shoots/:id/crew/:crewId")
  removeShootCrew(
    @Param("id") id: string,
    @Param("crewId") crewId: string,
    @CurrentUser() user: AuthUser
  ) {
    return this.shoots.removeCrew(id, crewId, user?.sub);
  }

  // ── Reports (auto-populated from deliverables) ──────────────────────
  @Post("projects/:id/reports/generate")
  generateReport(
    @Param("id") id: string,
    @Body() dto: GenerateReportDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.generateReport(id, dto, user?.sub);
  }

  @Get("projects/:id/reports")
  listReports(@Param("id") id: string) {
    return this.flow.listReports(id);
  }

  @Patch("reports/:id")
  updateReport(
    @Param("id") id: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.updateReport(id, dto, user?.sub);
  }

  @Delete("reports/:id")
  removeReport(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.removeReport(id, user?.sub);
  }

  @Get("projects/:id/discussions")
  discussions(@Param("id") id: string) {
    return this.flow.discussions(id);
  }

  @Get("export")
  async exportCsv(
    @Query() query: { q?: string; status?: string; clientId?: string; managerId?: string },
    @Res() res: any
  ) {
    const { filename, content } = await this.flow.exportCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + content);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  importCsv(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.flow.importCsv(file.buffer, user?.sub);
  }

  @Post("projects/:id/discussions")
  addDiscussion(
    @Param("id") id: string,
    @Body() dto: AddDiscussionDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.addDiscussion(id, { ...dto, authorId: user?.sub });
  }

  @Post("projects/:id/milestones")
  addMilestone(
    @Param("id") id: string,
    @Body() dto: AddMilestoneDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.addMilestone(id, dto, user?.sub);
  }

  @Patch("milestones/:id")
  updateMilestone(
    @Param("id") id: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.updateMilestone(id, dto, user?.sub);
  }

  @Delete("milestones/:id")
  deleteMilestone(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.deleteMilestone(id, user?.sub);
  }

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, flowUploadDir());
        },
        filename: (_req, file, cb) => cb(null, `${randomUUID()}--${file.originalname.replace(/[^\w.\-]/g, "_")}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // SVG is deliberately excluded: it can carry script and is served from
        // the API origin. Convert to PNG instead.
        const allowed = [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/webp",
          "application/zip",
          "application/x-zip-compressed",
        ];
        const ok = allowed.includes(file.mimetype);
        cb(ok ? null : new BadRequestException("Only pdf/image/zip files are allowed"), ok);
      },
    })
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    // Images are re-encoded on the way in (WebP + optional JXL). PDFs and zips
    // are stored untouched.
    if (isConvertibleImage(file.mimetype)) {
      const image = await optimizeUploadedImage(file, { kind: "document", urlPrefix: "/api/flow/uploads" });
      return {
        fileUrl: image.url,
        jxlUrl: image.jxlUrl,
        downloadUrl: signFileAccess(image.fileName),
        originalName: file.originalname,
        fileName: file.originalname,
        size: image.size,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
      };
    }
    return {
      fileUrl: `/api/flow/uploads/${file.filename}`,
      downloadUrl: signFileAccess(file.filename),
      originalName: file.originalname,
      fileName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  @Public()
  @Get("uploads/:filename")
  serveUpload(
    @Param("filename") filename: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: any
  ) {
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new BadRequestException("Invalid filename");
    }
    const safe = basename(sanitizeFilename(filename));
    if (!verifyFileAccess(safe, exp, sig)) {
      throw new ForbiddenException("This file link is invalid or has expired");
    }
    const dir = flowUploadDir();
    const filePath = findUploadedFile(safe);
    // defense-in-depth: ensure resolved path stays inside an uploads dir
    if (!filePath.startsWith(dir) && !filePath.startsWith(join(process.cwd(), "uploads"))) {
      throw new BadRequestException("Invalid filename");
    }
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.sendFile(filePath);
  }

  /** Current contract: the project id lives in the path. */
  @Post("projects/:id/files")
  addProjectFile(
    @Param("id") projectId: string,
    @Body() dto: AddFileDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.flow.addFile(projectId, dto, user?.sub);
  }

  /** Kept for older callers that still pass projectId in the body. */
  @Post("files")
  addFile(
    @Body() dto: AddFileDto & { projectId?: string },
    @CurrentUser() user: AuthUser
  ) {
    if (!dto.projectId) throw new BadRequestException("projectId is required");
    return this.flow.addFile(dto.projectId, dto, user?.sub);
  }

  @Patch("files/:id/approval")
  setFileApproval(
    @Param("id") id: string,
    @Body() dto: SetFileApprovalDto,
    @CurrentUser() user: AuthUser
  ) {
    const status = dto.status ?? dto.approvalStatus;
    if (!status) throw new BadRequestException("status is required");
    return this.flow.setFileApproval(id, status, user?.sub);
  }

  @Delete("files/:id")
  deleteFile(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.flow.deleteFile(id, user?.sub);
  }

  @Get("capacity")
  capacity(@Query("from") from?: string, @Query("to") to?: string) {
    return this.flow.capacity({ from, to });
  }

  @Get("templates")
  templates() {
    return this.flow.templates();
  }

  @Get("managers")
  managers() {
    return this.flow.managers();
  }
}
