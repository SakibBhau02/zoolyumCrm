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
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename, join } from "path";
import { existsSync } from "fs";
import { PulseService } from "./pulse.service";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { verifyFileAccess } from "../common/signed-url";

/**
 * Lead attachments live in their own bucket. They used to share the Flow
 * uploads directory, which meant the (unauthenticated) pulse route could serve
 * every signed project deliverable.
 */
const pulseUploadDir = () => uploadsDir("pulse");

/**
 * Upload allowlist. Without it an .html/.svg upload is later served from the
 * API origin, which turns a file upload into stored XSS.
 */
const ALLOWED_UPLOAD_EXT = new Set([
  "pdf", "png", "jpg", "jpeg", "webp", "gif",
  "doc", "docx", "xls", "xlsx", "csv", "txt", "zip",
]);
const ALLOWED_UPLOAD_MIME =
  /^(image\/(png|jpe?g|webp|gif)|application\/(pdf|zip|x-zip-compressed|msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/(plain|csv))$/i;

function pulseFileFilter(_req: any, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_UPLOAD_EXT.has(ext) || !ALLOWED_UPLOAD_MIME.test(file.mimetype)) {
    return cb(new BadRequestException(`Unsupported file type: ${ext || file.mimetype}`), false);
  }
  cb(null, true);
}
import {
  AddActivityDto,
  BulkUpdateLeadsDto,
  ConvertLeadDto,
  CreateCategoryDto,
  CreateFollowUpDto,
  CreateLeadDto,
  CreateMeetingDto,
  CreateProposalDto,
  MarkLostDto,
  QuickLogDto,
  SnoozeLeadDto,
  UpdateFollowUpDto,
  UpdateFollowUpStatusDto,
  UpdateLeadDto,
  UpdateMeetingDto,
  UpdateProposalDto,
} from "./dto/lead.dto";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PulseTargetsService } from "./pulse-targets.service";

@RequirePermission("PULSE")
@Controller("pulse")
export class PulseController {
  constructor(
    private readonly pulse: PulseService,
    private readonly targets: PulseTargetsService
  ) {}

  @Get("summary")
  summary() {
    return this.pulse.summary();
  }

  /** Live lead-intake rules (Control → Lead Rules owns the toggles). */
  @Get("rules")
  rules() {
    return this.pulse.getLeadRules();
  }

  /** Duplicate pre-check while the Add Lead form is still open. */
  @Get("duplicates")
  duplicates(
    @Query()
    query: { phone?: string; email?: string; company?: string; name?: string; excludeId?: string }
  ) {
    return this.pulse.checkDuplicates(query);
  }

  /** Re-run the rule engine over every stored lead (retro hygiene). */
  @Post("audit")
  audit() {
    return this.pulse.auditLeads();
  }

  /** Everything that needs a human today, bucketed by urgency. */
  @Get("worklist")
  worklist(@Query() query: { ownerId?: string; mine?: string }, @CurrentUser() user: AuthUser) {
    return this.pulse.worklist(query, user?.sub);
  }

  /** Complete / miss a follow-up straight from the Today queue. */
  @Patch("follow-ups/:id/status")
  setFollowUpStatus(@Param("id") id: string, @Body() dto: UpdateFollowUpStatusDto) {
    return this.pulse.setFollowUpStatus(id, dto.status);
  }

  @Get("export")
  async exportCsv(@Query() query: { q?: string; stage?: string; assignedToId?: string }, @Res() res: any) {
    const { filename, content } = await this.pulse.exportCsv(query);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    res.send(content);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  importCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: "No file uploaded" };
    return this.pulse.importCsv(file.buffer);
  }

  @Get("leads")
  list(
    @Query()
    query: {
      q?: string;
      stage?: string;
      assignedToId?: string;
      source?: string;
      vertical?: string;
      priority?: string;
      temperature?: string;
      categoryId?: string;
      starred?: string;
      followUpDue?: string;
      createdAfter?: string;
      minScore?: string;
    }
  ) {
    return this.pulse.list(query);
  }

  @Get("leads/:id")
  detail(@Param("id") id: string) {
    return this.pulse.detail(id);
  }

  @Post("leads")
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.pulse.create(dto, user?.sub);
  }

  /** Bulk stage / owner / priority / tag changes from the pipeline. */
  @Post("leads/bulk")
  bulkUpdate(@Body() dto: BulkUpdateLeadsDto, @CurrentUser() user: AuthUser) {
    return this.pulse.bulkUpdate(dto, user?.sub);
  }

  /** The primary write path from Today: one touch + its outcome + next step. */
  @Post("leads/:id/quick-log")
  quickLog(@Param("id") id: string, @Body() dto: QuickLogDto, @CurrentUser() user: AuthUser) {
    return this.pulse.quickLog(id, dto, user?.sub);
  }

  /** Push the open follow-up forward N days. */
  @Post("leads/:id/snooze")
  snooze(@Param("id") id: string, @Body() dto: SnoozeLeadDto) {
    return this.pulse.snooze(id, dto.days);
  }

  @Patch("leads/:id")
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto, @CurrentUser() user: AuthUser) {
    return this.pulse.update(id, dto, user?.sub);
  }

  @Delete("leads/:id")
  remove(@Param("id") id: string) {
    return this.pulse.remove(id);
  }

  @Post("leads/:id/convert")
  convert(@Param("id") id: string, @Body() dto: ConvertLeadDto) {
    return this.pulse.convert(id, dto);
  }

  @Post("leads/:id/lost")
  markLost(@Param("id") id: string, @Body() dto: MarkLostDto) {
    return this.pulse.markLost(id, dto);
  }

  @Post("leads/:id/reopen")
  reopen(@Param("id") id: string) {
    return this.pulse.reopen(id);
  }

  @Post("leads/:id/activities")
  addActivity(@Param("id") id: string, @Body() dto: AddActivityDto, @CurrentUser() user: AuthUser) {
    return this.pulse.addActivity(id, dto, user?.sub);
  }

  // ── Meetings ────────────────────────────────────────────────────────────
  @Post("leads/:id/meetings")
  addMeeting(@Param("id") id: string, @Body() dto: CreateMeetingDto, @CurrentUser() user: AuthUser) {
    return this.pulse.addMeeting(id, dto, user?.sub);
  }

  @Patch("leads/:id/meetings/:meetingId")
  updateMeeting(
    @Param("id") id: string,
    @Param("meetingId") meetingId: string,
    @Body() dto: UpdateMeetingDto
  ) {
    return this.pulse.updateMeeting(id, meetingId, dto);
  }

  @Delete("leads/:id/meetings/:meetingId")
  removeMeeting(@Param("id") id: string, @Param("meetingId") meetingId: string) {
    return this.pulse.removeMeeting(id, meetingId);
  }

  /** Mark one invitee as ATTENDED / NO_SHOW — feeds per-employee meeting stats. */
  @Patch("meetings/:meetingId/attendees/:employeeId")
  setMeetingAttendance(
    @Param("meetingId") meetingId: string,
    @Param("employeeId") employeeId: string,
    @Body() body: { status: "INVITED" | "ATTENDED" | "NO_SHOW" }
  ) {
    return this.pulse.setMeetingAttendance(meetingId, employeeId, body.status);
  }

  // ── Proposals ───────────────────────────────────────────────────────────
  @Post("leads/:id/proposals")
  addProposal(@Param("id") id: string, @Body() dto: CreateProposalDto) {
    return this.pulse.addProposal(id, dto);
  }

  @Patch("leads/:id/proposals/:proposalId")
  updateProposal(
    @Param("id") id: string,
    @Param("proposalId") proposalId: string,
    @Body() dto: UpdateProposalDto
  ) {
    return this.pulse.updateProposal(id, proposalId, dto);
  }

  @Post("leads/:id/proposals/:proposalId/viewed")
  markProposalViewed(@Param("id") id: string, @Param("proposalId") proposalId: string) {
    return this.pulse.markProposalViewed(id, proposalId);
  }

  // ── Follow-ups (v0-crm subsystem) ───────────────────────────────────────
  @Get("leads/:id/follow-ups")
  getFollowUps(@Param("id") id: string) {
    return this.pulse.getFollowUps(id);
  }

  @Post("leads/:id/follow-ups")
  addFollowUp(@Param("id") id: string, @Body() dto: CreateFollowUpDto) {
    return this.pulse.addFollowUp(id, dto);
  }

  @Patch("leads/:id/follow-ups/:followUpId")
  updateFollowUp(
    @Param("id") id: string,
    @Param("followUpId") followUpId: string,
    @Body() dto: UpdateFollowUpDto
  ) {
    return this.pulse.updateFollowUp(id, followUpId, dto);
  }

  @Delete("leads/:id/follow-ups/:followUpId")
  removeFollowUp(@Param("id") id: string, @Param("followUpId") followUpId: string) {
    return this.pulse.removeFollowUp(id, followUpId);
  }

  // ── Notes (v0-crm note history) ─────────────────────────────────────────
  @Post("leads/:id/notes")
  addNote(@Param("id") id: string, @Body() body: { content: string }, @CurrentUser() user: AuthUser) {
    return this.pulse.addNote(id, body.content, user?.sub);
  }

  @Patch("leads/:id/notes/:noteId")
  updateNote(@Param("id") id: string, @Param("noteId") noteId: string, @Body() body: { content: string }) {
    return this.pulse.updateNote(id, noteId, body.content);
  }

  @Delete("leads/:id/notes/:noteId")
  removeNote(@Param("id") id: string, @Param("noteId") noteId: string) {
    return this.pulse.removeNote(id, noteId);
  }

  // ── Attachments (reference files) ───────────────────────────────────────
  @Post("leads/:id/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, pulseUploadDir()),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
          cb(null, `${randomUUID()}--${safe}`);
        },
      }),
      fileFilter: pulseFileFilter,
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  addAttachment(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string },
    @CurrentUser() user: AuthUser
  ) {
    return this.pulse.addAttachment(id, file, body?.title, user?.sub);
  }

  @Delete("leads/:id/attachments/:attachmentId")
  removeAttachment(@Param("id") id: string, @Param("attachmentId") attachmentId: string) {
    return this.pulse.removeAttachment(id, attachmentId);
  }

  // ── Categories (user-defined) ───────────────────────────────────────────
  @Get("categories")
  listCategories() {
    return this.pulse.listCategories();
  }

  @Post("categories")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.pulse.createCategory(dto.name, dto.color);
  }

  @Delete("categories/:id")
  deleteCategory(@Param("id") id: string) {
    return this.pulse.deleteCategory(id);
  }

  // ── File upload (proposals, attachments) ────────────────────────────────
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, pulseUploadDir()),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
          cb(null, `${randomUUID()}--${safe}`);
        },
      }),
      fileFilter: pulseFileFilter,
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: "No file uploaded" };
    return this.pulse.storeUpload(file);
  }

  /**
   * Signed-URL file server. The route stays `@Public` because browsers load it
   * as a plain <img>/download (no Authorization header), but the URL itself
   * must carry a valid, unexpired HMAC over bucket + filename.
   */
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
    if (!verifyFileAccess(safe, exp, sig, "pulse")) {
      throw new ForbiddenException("This file link is invalid or has expired");
    }
    // New uploads live in uploads/pulse; files from older builds are still in
    // the shared uploads root, so fall back once before 404ing.
    const scoped = findUploadedFile(join("pulse", safe));
    const filePath = existsSync(scoped) ? scoped : findUploadedFile(safe);
    const isImage = /\.(png|jpe?g|webp|gif)$/i.test(safe);
    res.setHeader("Content-Disposition", `${isImage ? "inline" : "attachment"}; filename="${safe}"`);
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.sendFile(filePath);
  }

  // ── Period targets (moved from the Calendar module) ──────────────────
  @Get("targets")
  listTargets(@Query() query: any) {
    return this.targets.list(query);
  }

  @Get("targets/summary")
  targetSummary(@Query("period") period?: string) {
    return this.targets.summary(period);
  }

  @Post("targets")
  createTarget(@Body() dto: any) {
    return this.targets.create(dto);
  }

  @Patch("targets/:id")
  updateTarget(@Param("id") id: string, @Body() dto: any) {
    return this.targets.update(id, dto);
  }

  @Delete("targets/:id")
  deleteTarget(@Param("id") id: string) {
    return this.targets.remove(id);
  }
}