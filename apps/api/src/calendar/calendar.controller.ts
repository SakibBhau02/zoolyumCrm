import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CalendarFeedService } from "./calendar-feed.service";
import { CalendarService } from "./calendar.service";
import { CalendarPlanService } from "./calendar-plan.service";
import { CalendarAdsService } from "./calendar-ads.service";
import { CalendarExportService } from "./calendar-export.service";

/**
 * The Calendar module API.
 *
 * Reads are merged into `/feed` (one request per view) so the grid never fans
 * out into a dozen calls; writes stay canonical per source — a task created
 * here is still a Task row owned by the Tasks module.
 */
@RequirePermission("CALENDAR")
@Controller("calendar")
export class CalendarController {
  constructor(
    private readonly feed: CalendarFeedService,
    private readonly service: CalendarService,
    private readonly plans: CalendarPlanService,
    private readonly ads: CalendarAdsService,
    private readonly exporter: CalendarExportService
  ) {}

  // ── read models ──────────────────────────────────────────────────────
  @Get("feed")
  getFeed(@Query() q: any, @CurrentUser() user: any) {
    return this.feed.feed({ ...q, userId: user?.sub });
  }

  @Get("summary")
  summary(@Query() q: any, @CurrentUser() user: any) {
    return this.feed.summary({ ...q, userId: user?.sub });
  }

  @Get("day/:date")
  day(@Param("date") date: string, @Query() q: any, @CurrentUser() user: any) {
    return this.feed.day(date, { ...q, userId: user?.sub });
  }

  @Get("gaps")
  gaps(@Query() q: any) {
    return this.feed.gaps(q);
  }

  @Get("workload")
  workload(@Query() q: any) {
    return this.feed.workload(q);
  }

  @Get("conflicts")
  conflicts(@Query() q: any) {
    return this.service.conflicts(q);
  }

  @Get("clients")
  clients() {
    return this.service.clientLookup();
  }

  @Get("people")
  people() {
    return this.service.peopleLookup();
  }

  @Get("clients/:clientId")
  async clientHeader(@Param("clientId") clientId: string) {
    return this.service.clientLookup().then((rows) => rows.find((c) => c.id === clientId) ?? null);
  }

  @Patch("clients/:clientId/appearance")
  appearance(@Param("clientId") clientId: string, @Body() dto: any) {
    return this.service.updateClientAppearance(clientId, dto);
  }

  // ── posts ────────────────────────────────────────────────────────────
  @Post("posts")
  createPost(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.createPost(dto, user?.sub);
  }

  @Get("posts/:id")
  getPost(@Param("id") id: string) {
    return this.service.getPost(id);
  }

  @Post("posts/import")
  importPosts(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.importPosts(dto?.rows ?? [], user?.sub);
  }

  @Patch("posts/:id")
  updatePost(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.service.updatePost(id, dto, user?.sub);
  }

  @Delete("posts/:id")
  archivePost(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.archivePost(id, user?.sub);
  }

  @Post("posts/:id/restore")
  restorePost(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.restorePost(id, user?.sub);
  }

  @Post("posts/:id/submit-review")
  submitReview(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.service.submitForReview(id, dto?.reviewerId, user?.sub);
  }

  @RequirePermission("CALENDAR", "approve")
  @Post("posts/:id/approve")
  approvePost(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.approvePost(id, user?.sub);
  }

  @RequirePermission("CALENDAR", "approve")
  @Post("posts/:id/reject")
  rejectPost(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.service.rejectPost(id, dto?.reason, user?.sub);
  }

  @Post("posts/:id/publish")
  publishPost(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.service.publishPost(id, dto ?? {}, user?.sub);
  }

  // ── events ───────────────────────────────────────────────────────────
  @Post("events")
  createEvent(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.createEvent(dto, user?.sub);
  }

  @Get("events/:id")
  getEvent(@Param("id") id: string) {
    return this.service.getEvent(id);
  }

  @Patch("events/:id")
  updateEvent(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.service.updateEvent(id, dto, user?.sub);
  }

  @Delete("events/:id")
  deleteEvent(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.deleteEvent(id, user?.sub);
  }

  // ── polymorphic writes ───────────────────────────────────────────────
  @Post("quick-add")
  quickAdd(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.quickAdd(dto, user?.sub);
  }

  @Patch("move")
  move(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.move(dto, user?.sub);
  }

  @Post("bulk/move")
  bulkMove(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.bulkMove(dto, user?.sub);
  }

  @Post("bulk/status")
  bulkStatus(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.bulkStatus(dto, user?.sub);
  }

  // ── collaboration ────────────────────────────────────────────────────
  @Get("day-logs")
  dayLogs(@Query() q: any) {
    return this.service.dayLogs(q);
  }

  @Post("day-logs")
  saveDayLog(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.saveDayLog(dto, user?.sub);
  }

  @Get("comments")
  comments(@Query("source") source: string, @Query("sourceId") sourceId: string) {
    return this.service.comments(source, sourceId);
  }

  @Post("comments")
  addComment(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.addComment(dto, user?.sub);
  }

  @Get("audit")
  audit(@Query("source") source: string, @Query("sourceId") sourceId: string) {
    return this.service.auditTrail(source, sourceId);
  }

  // ── plans & reports ──────────────────────────────────────────────────
  @Get("plans")
  listPlans(@Query() q: any) {
    return this.plans.list(q);
  }

  @Get("plans/versions")
  planVersions(@Query() q: any) {
    return this.plans.versions(q.clientId, q.periodStart);
  }

  @Post("plans")
  createPlan(@Body() dto: any, @CurrentUser() user: any) {
    return this.plans.create(dto, user?.sub);
  }

  @Get("plans/:id")
  getPlan(@Param("id") id: string) {
    return this.plans.get(id);
  }

  @Patch("plans/:id")
  updatePlan(@Param("id") id: string, @Body() dto: any) {
    return this.plans.update(id, dto);
  }

  @Delete("plans/:id")
  deletePlan(@Param("id") id: string) {
    return this.plans.remove(id);
  }

  @RequirePermission("CALENDAR", "approve")
  @Post("plans/:id/lock")
  lockPlan(@Param("id") id: string, @CurrentUser() user: any) {
    return this.plans.lock(id, user?.sub);
  }

  @RequirePermission("CALENDAR", "approve")
  @Post("plans/:id/unlock")
  unlockPlan(@Param("id") id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.plans.unlock(id, dto?.reason, user?.sub);
  }

  @RequirePermission("CALENDAR", "approve")
  @Post("plans/:id/publish")
  publishPlan(@Param("id") id: string, @CurrentUser() user: any) {
    return this.plans.publish(id, user?.sub);
  }

  @Post("plans/:id/share")
  sharePlan(@Param("id") id: string, @Body() dto: any) {
    return this.plans.share(id, dto ?? {});
  }

  @Get("plans/:id/variance")
  planVariance(@Param("id") id: string) {
    return this.plans.variance(id);
  }

  // ── campaigns & ad flights ───────────────────────────────────────────
  @Get("campaigns")
  campaigns(@Query() q: any) {
    return this.ads.campaigns(q);
  }

  @Post("campaigns")
  createCampaign(@Body() dto: any) {
    return this.ads.createCampaign(dto);
  }

  @Patch("campaigns/:id")
  updateCampaign(@Param("id") id: string, @Body() dto: any) {
    return this.ads.updateCampaign(id, dto);
  }

  @Delete("campaigns/:id")
  deleteCampaign(@Param("id") id: string) {
    return this.ads.deleteCampaign(id);
  }

  @Get("flights")
  flights(@Query() q: any) {
    return this.ads.flights(q);
  }

  @Post("flights")
  createFlight(@Body() dto: any) {
    return this.ads.createFlight(dto);
  }

  @Patch("flights/:id")
  updateFlight(@Param("id") id: string, @Body() dto: any) {
    return this.ads.updateFlight(id, dto);
  }

  @Delete("flights/:id")
  deleteFlight(@Param("id") id: string) {
    return this.ads.deleteFlight(id);
  }

  @Get("timeline")
  timeline(@Query() q: any) {
    return this.ads.timeline(q);
  }

  // ── settings ─────────────────────────────────────────────────────────
  @Get("settings/platform-accounts")
  platformAccounts(@Query("clientId") clientId?: string) {
    return this.service.platformAccounts(clientId);
  }

  @Post("settings/platform-accounts")
  savePlatformAccount(@Body() dto: any) {
    return this.service.savePlatformAccount(dto);
  }

  @Delete("settings/platform-accounts/:id")
  deletePlatformAccount(@Param("id") id: string) {
    return this.service.deletePlatformAccount(id);
  }

  @Get("settings/pillars")
  pillars(@Query("clientId") clientId?: string) {
    return this.service.pillars(clientId);
  }

  @Post("settings/pillars")
  savePillar(@Body() dto: any) {
    return this.service.savePillar(dto);
  }

  @Delete("settings/pillars/:id")
  deletePillar(@Param("id") id: string) {
    return this.service.deletePillar(id);
  }

  @Get("views")
  savedViews(@CurrentUser() user: any) {
    return this.service.savedViews(user?.sub);
  }

  @Post("views")
  saveView(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.saveView(dto, user?.sub);
  }

  @Delete("views/:id")
  deleteView(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.deleteView(id, user?.sub);
  }

  // ── exports ──────────────────────────────────────────────────────────
  @Get("export/csv")
  exportCsv(@Query() q: any, @CurrentUser() user: any) {
    return this.exporter.csv({ ...q, userId: user?.sub });
  }

  @Get("export/ics")
  exportIcs(@Query() q: any, @CurrentUser() user: any) {
    return this.exporter.ics({ ...q, userId: user?.sub });
  }
}
