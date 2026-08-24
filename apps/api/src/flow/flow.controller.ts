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
import { extname, join } from "path";
import { ProjectType } from "@prisma/client";
import { FlowService } from "./flow.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";

const UPLOAD_DIR = join(process.cwd(), "uploads");

@Controller("flow")
export class FlowController {
  constructor(private readonly flow: FlowService) {}

  @Get("overview")
  overview() {
    return this.flow.overview();
  }

  @Get("projects")
  list(@Query() query: { q?: string; status?: string; health?: string }) {
    return this.flow.list(query);
  }

  @Get("projects/:id")
  detail(@Param("id") id: string) {
    return this.flow.detail(id);
  }

  @Post("projects")
  create(@Body() body: any) {
    return this.flow.create(body);
  }

  @Patch("projects/:id")
  update(@Param("id") id: string, @Body() body: any) {
    return this.flow.update(id, body);
  }

  @Delete("projects/:id")
  remove(@Param("id") id: string) {
    return this.flow.remove(id);
  }

  @Get("projects/:id/discussions")
  discussions(@Param("id") id: string) {
    return this.flow.discussions(id);
  }

  @Get("export")
  async exportCsv(@Query() query: { q?: string; status?: string; clientId?: string; managerId?: string }, @Res() res: any) {
    const { filename, content } = await this.flow.exportCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + content);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  importCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error("No file uploaded");
    return this.flow.importCsv(file.buffer);
  }

  @Post("projects/:id/discussions")
  addDiscussion(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.flow.addDiscussion(id, { ...body, authorId: user?.sub });
  }

  @Post("projects/:id/milestones")
  addMilestone(@Param("id") id: string, @Body() body: any) {
    return this.flow.addMilestone(id, body);
  }

  @Patch("milestones/:id")
  updateMilestone(@Param("id") id: string, @Body() body: any) {
    return this.flow.updateMilestone(id, body);
  }

  @Delete("milestones/:id")
  deleteMilestone(@Param("id") id: string) {
    return this.flow.deleteMilestone(id);
  }

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}--${file.originalname.replace(/[^\w.\-]/g, "_")}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error("No file uploaded");
    return { fileUrl: `/api/flow/uploads/${file.filename}`, originalName: file.originalname, size: file.size };
  }

  @Public()
  @Get("uploads/:filename")
  serveUpload(@Param("filename") filename: string, @Res() res: any) {
    res.sendFile(join(UPLOAD_DIR, filename));
  }

  @Post("files")
  addFile(@Body() body: any, @CurrentUser() user: any) {
    return this.flow.addFile(body.projectId, { ...body, uploadedById: user?.sub });
  }

  @Patch("files/:id/approval")
  setFileApproval(@Param("id") id: string, @Body() body: { status: string }) {
    return this.flow.setFileApproval(id, body.status as any);
  }

  @Delete("files/:id")
  deleteFile(@Param("id") id: string) {
    return this.flow.deleteFile(id);
  }

  @Get("capacity")
  capacity() {
    return this.flow.capacity();
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