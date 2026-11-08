import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { BulkTaskDto, ChecklistItemDto, SavedViewDto, SprintDto, UpdateChecklistItemDto } from "./dto/task-ops.dto";
import { normalizeTaskStatus } from "./task-status";
import { RequirePermission, SkipPermission } from "../common/decorators/require-permission.decorator";

@RequirePermission("TASKS")
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("stats")
  stats() {
    return this.tasks.stats();
  }

  @SkipPermission()
  @Get("my-day")
  myDay(@CurrentUser() user: any) {
    // controller resolves the caller's employee; service refuses to run unscoped
    return this.tasks.myDayForUser(user?.sub);
  }

  // ── Sprints ──────────────────────────────────────────────────────────
  @Get("sprints")
  listSprints(@Query() query: any) {
    return this.tasks.listSprints(query);
  }

  @Post("sprints")
  createSprint(@Body() body: SprintDto, @CurrentUser() user: any) {
    return this.tasks.createSprint(body, user);
  }

  @Patch("sprints/:id")
  updateSprint(@Param("id") id: string, @Body() body: Partial<SprintDto>, @CurrentUser() user: any) {
    return this.tasks.updateSprint(id, body, user);
  }

  @Delete("sprints/:id")
  deleteSprint(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.deleteSprint(id, user);
  }

  @Post("sprints/:id/tasks")
  assignSprintTasks(@Param("id") id: string, @Body() body: { taskIds: string[] }, @CurrentUser() user: any) {
    return this.tasks.assignTasksToSprint(id, body.taskIds ?? [], user);
  }

  @Delete("sprints/:id/tasks/:taskId")
  removeSprintTask(@Param("id") id: string, @Param("taskId") taskId: string) {
    return this.tasks.removeTaskFromSprint(id, taskId);
  }

  @Get("sprints/:id/burndown")
  sprintBurndown(@Param("id") id: string) {
    return this.tasks.sprintBurndown(id);
  }

  @Post("sprints/:id/snapshot")
  captureSnapshot(@Param("id") id: string) {
    return this.tasks.captureSprintSnapshot(id);
  }

  // ── Saved views ──────────────────────────────────────────────────────
  @Get("views")
  listViews(@CurrentUser() user: any) {
    return this.tasks.listSavedViews(user);
  }

  @Post("views")
  createView(@Body() body: SavedViewDto, @CurrentUser() user: any) {
    return this.tasks.createSavedView(body, user);
  }

  @Patch("views/:id")
  updateView(@Param("id") id: string, @Body() body: Partial<SavedViewDto>, @CurrentUser() user: any) {
    return this.tasks.updateSavedView(id, body, user);
  }

  @Delete("views/:id")
  deleteView(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.deleteSavedView(id, user);
  }

  // ── Estimation accuracy report ───────────────────────────────────────
  @Get("reports/estimation")
  estimationReport(@Query() query: any) {
    return this.tasks.estimationReport(query);
  }

  // ── Timer ────────────────────────────────────────────────────────────
  @SkipPermission()
  @Get("timers/running")
  runningTimer(@CurrentUser() user: any) {
    return this.tasks.runningTimer(user);
  }

  @Get("templates")
  templates() {
    return this.tasks.listTemplates();
  }

  @Post("templates")
  createTemplate(@Body() body: any, @CurrentUser() user: any) {
    return this.tasks.createTemplate(body, user);
  }

  @Delete("templates/:id")
  deleteTemplate(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.deleteTemplate(id, user);
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
  createAutomation(@Body() body: any, @CurrentUser() user: any) {
    return this.tasks.createAutomation(body, user);
  }

  @Patch("automation/:id")
  updateAutomation(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.updateAutomation(id, body, user);
  }

  @Delete("automation/:id")
  deleteAutomation(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.deleteAutomation(id, user);
  }

  @Get("workload")
  workload() {
    return this.tasks.workload();
  }

  @Get()
  list(@Query() query: any, @CurrentUser() user: any) {
    return this.tasks.list(query, user);
  }

  // ── Bulk ─────────────────────────────────────────────────────────────
  @Post("bulk")
  bulk(@Body() body: BulkTaskDto, @CurrentUser() user: any) {
    return this.tasks.bulk(body, user);
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.detail(id, user);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    // reporter is derived server-side from the caller; strip any client claim
    const { reporterId: _ignored, ...rest } = body ?? {};
    return this.tasks.create({ ...rest, createdById: user?.sub, createdByName: user?.name });
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
    // Legacy clients still send IN_REVIEW / BACKLOG — fold them onto the enum
    // instead of letting Prisma throw a validation error at the user.
    return this.tasks.updateStatus(id, normalizeTaskStatus(body.status) as any, user);
  }

  // ── Checklist ────────────────────────────────────────────────────────
  // ── Project context (files / research for the project this task belongs to) ──
  @Get(":id/project-context")
  projectContext(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.projectContextForTask(id, user);
  }

  @Get(":id/checklist")
  listChecklist(@Param("id") id: string) {
    return this.tasks.listChecklist(id);
  }

  @Post(":id/checklist")
  addChecklistItem(@Param("id") id: string, @Body() body: ChecklistItemDto, @CurrentUser() user: any) {
    return this.tasks.addChecklistItem(id, body, user);
  }

  @Put(":id/checklist/reorder")
  reorderChecklist(@Param("id") id: string, @Body() body: { ids: string[] }, @CurrentUser() user: any) {
    return this.tasks.reorderChecklist(id, body.ids ?? [], user);
  }

  @Patch(":id/checklist/:itemId")
  updateChecklistItem(@Param("id") id: string, @Param("itemId") itemId: string, @Body() body: UpdateChecklistItemDto, @CurrentUser() user: any) {
    return this.tasks.updateChecklistItem(id, itemId, body, user);
  }

  @Delete(":id/checklist/:itemId")
  removeChecklistItem(@Param("id") id: string, @Param("itemId") itemId: string, @CurrentUser() user: any) {
    return this.tasks.removeChecklistItem(id, itemId, user);
  }

  // ── Timer ────────────────────────────────────────────────────────────
  @Post(":id/timer/start")
  startTimer(@Param("id") id: string, @Body() body: { notes?: string }, @CurrentUser() user: any) {
    return this.tasks.startTimer(id, body ?? {}, user);
  }

  @Post(":id/timer/stop")
  stopTimer(@Param("id") id: string, @CurrentUser() user: any) {
    return this.tasks.stopTimer(id, user);
  }

  // ── Sprint assignment on task ────────────────────────────────────────
  @Patch(":id/sprint")
  setSprint(@Param("id") id: string, @Body() body: { sprintId: string | null }, @CurrentUser() user: any) {
    return this.tasks.setTaskSprint(id, body?.sprintId ?? null, user);
  }

  @Post(":id/comments")
  addComment(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.tasks.addComment(id, { ...body, authorId: user?.sub }, user);
  }

  @Patch(":id/comments/:commentId/reactions")
  toggleReaction(@Param("id") id: string, @Param("commentId") commentId: string, @Body() body: { emoji: string; userId: string }, @CurrentUser() user: any) {
    return this.tasks.toggleReaction(id, commentId, body, user);
  }

  @Delete(":id/comments/:commentId")
  deleteComment(@Param("id") id: string, @Param("commentId") commentId: string, @CurrentUser() user: any) {
    return this.tasks.deleteComment(id, commentId, user);
  }

  @Post(":id/dependencies")
  addDependency(@Param("id") id: string, @Body() body: { dependsOnTaskId: string; type?: string }, @CurrentUser() user: any) {
    return this.tasks.addDependency(id, body.dependsOnTaskId, body.type, user);
  }

  @Delete(":id/dependencies/:depId")
  removeDependency(@Param("id") id: string, @Param("depId") depId: string, @CurrentUser() user: any) {
    return this.tasks.removeDependency(id, depId, user);
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