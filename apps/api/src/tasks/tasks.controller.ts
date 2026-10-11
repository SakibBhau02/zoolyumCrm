import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("stats")
  stats() {
    return this.tasks.stats();
  }

  @Get("my-day")
  myDay() {
    return this.tasks.myDay();
  }

  @Get("templates")
  templates() {
    return this.tasks.listTemplates();
  }

  @Post("templates")
  createTemplate(@Body() body: any) {
    return this.tasks.createTemplate(body);
  }

  @Delete("templates/:id")
  deleteTemplate(@Param("id") id: string) {
    return this.tasks.deleteTemplate(id);
  }

  @Post("templates/:id/use")
  useTemplate(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.useTemplate(id, {
      ...body,
      createdById: user?.sub,
      createdByName: user?.name,
    });
  }

  @Get("automation")
  automation() {
    return this.tasks.listAutomation();
  }

  @Post("automation")
  createAutomation(@Body() body: any) {
    return this.tasks.createAutomation(body);
  }

  @Patch("automation/:id")
  updateAutomation(@Param("id") id: string, @Body() body: any) {
    return this.tasks.updateAutomation(id, body);
  }

  @Delete("automation/:id")
  deleteAutomation(@Param("id") id: string) {
    return this.tasks.deleteAutomation(id);
  }

  @Get("workload")
  workload() {
    return this.tasks.workload();
  }

  @Get()
  list(@Query() query: any) {
    return this.tasks.list(query);
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.detail(id, user);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.tasks.create({ ...body, createdById: user?.sub, createdByName: user?.name });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.update(id, body, user);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.remove(id, user);
  }

  @Post(":id/clone")
  clone(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.clone(id, user);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() body: { status: string }, @CurrentUser() user: any) {
    return this.tasks.updateStatus(id, body.status as any, user);
  }

  @Post(":id/comments")
  addComment(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.addComment(id, { ...body, authorId: user?.sub }, user);
  }

  @Patch(":id/comments/:commentId/reactions")
  toggleReaction(@Param("id") id: string, @Param("commentId") commentId: string, @Body() body: { emoji: string; userId: string }) {
    return this.tasks.toggleReaction(id, commentId, body);
  }

  @Delete(":id/comments/:commentId")
  deleteComment(@Param("id") id: string, @Param("commentId") commentId: string) {
    return this.tasks.deleteComment(id, commentId);
  }

  @Post(":id/dependencies")
  addDependency(@Param("id") id: string, @Body() body: { dependsOnTaskId: string; type?: string }) {
    return this.tasks.addDependency(id, body.dependsOnTaskId, body.type);
  }

  @Delete(":id/dependencies/:depId")
  removeDependency(@Param("id") id: string, @Param("depId") depId: string) {
    return this.tasks.removeDependency(id, depId);
  }

  @Post(":id/time-logs")
  logTime(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.logTime(id, body, user);
  }

  @Delete(":id/time-logs/:logId")
  removeTimeLog(@Param("id") id: string, @Param("logId") logId: string, @CurrentUser() user: any) {
    return this.tasks.removeTimeLog(id, logId, user);
  }

  @Post(":id/time-log")
  logTimeLegacy(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.logTime(id, body, user);
  }

  @Delete(":id/time-log/:logId")
  removeTimeLogLegacy(@Param("id") id: string, @Param("logId") logId: string, @CurrentUser() user: any) {
    return this.tasks.removeTimeLog(id, logId, user);
  }
}