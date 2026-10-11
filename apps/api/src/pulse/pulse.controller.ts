import {
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
import { PulseService } from "./pulse.service";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { findUploadedFile, uploadsDir } from "../common/file-storage";

const pulseUploadDir = () => uploadsDir();
import {
  AddActivityDto,
  ConvertLeadDto,
  CreateCategoryDto,
  CreateFollowUpDto,
  CreateLeadDto,
  CreateMeetingDto,
  CreateProposalDto,
  MarkLostDto,
  UpdateFollowUpDto,
  UpdateLeadDto,
  UpdateMeetingDto,
  UpdateProposalDto,
} from "./dto/lead.dto";

@Controller("pulse")
export class PulseController {
  constructor(private readonly pulse: PulseService) {}

  @Get("summary")
  summary() {
    return this.pulse.summary();
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
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: "No file uploaded" };
    return { fileUrl: `/api/pulse/uploads/${file.filename}`, originalName: file.originalname, size: file.size };
  }

  @Get("uploads/:filename")
  @Public()
  serveUpload(@Param("filename") filename: string, @Res() res: any) {
    const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g, "");
    return res.sendFile(findUploadedFile(safe));
  }
}