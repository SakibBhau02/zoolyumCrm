import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PortalPublic } from "../common/decorators/portal-public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalCtx } from "./portal-ctx.decorator";
import type { PortalScope } from "./portal-access.service";
import { PortalClientService } from "./portal-client.service";
import { PortalAdsService } from "./portal-ads.service";

/**
 * Client-facing API.
 *
 * `@Public()` skips the staff JWT guard; `@UseGuards(PortalAuthGuard)` at the
 * class level makes every route below fail-closed — a newly added handler is
 * protected by default and only `login` opts out via `@PortalPublic()`.
 */
@Public()
@UseGuards(PortalAuthGuard)
@Controller("portal-client")
export class PortalClientController {
  constructor(private readonly portal: PortalClientService, private readonly ads: PortalAdsService) {}

  // ── Session ────────────────────────────────────────────────────────────
  @PortalPublic()
  @RateLimit({ limit: 10, windowSec: 60, name: "portal.login" })
  @Post("login")
  login(@Body() body: { email: string; password: string }) {
    return this.portal.login(body.email, body.password);
  }

  @Get("me")
  me(@PortalCtx() scope: PortalScope) {
    return this.portal.me(scope);
  }

  @Get("branding")
  branding() {
    return this.portal.branding();
  }

  // ── Overview + work ────────────────────────────────────────────────────
  @Get("overview")
  overview(@PortalCtx() scope: PortalScope) {
    return this.portal.overview(scope);
  }

  @Get("tasks")
  tasks(
    @PortalCtx() scope: PortalScope,
    @Query()
    query: {
      projectId?: string;
      status?: string;
      q?: string;
      due?: "week" | "overdue" | "all";
      page?: string;
      pageSize?: string;
    }
  ) {
    return this.portal.tasks(scope, query);
  }

  @Get("projects")
  projects(@PortalCtx() scope: PortalScope) {
    return this.portal.projects(scope);
  }

  @Get("projects/:id")
  projectDetail(@PortalCtx() scope: PortalScope, @Param("id") id: string) {
    return this.portal.projectDetail(scope, id);
  }

  @Get("updates")
  updates(@PortalCtx() scope: PortalScope) {
    return this.portal.updates(scope);
  }

  @Get("updates/:id")
  reportDetail(@PortalCtx() scope: PortalScope, @Param("id") id: string) {
    return this.portal.reportDetail(scope, id);
  }

  // ── Billing ────────────────────────────────────────────────────────────
  @Get("invoices")
  invoices(@PortalCtx() scope: PortalScope) {
    return this.portal.invoices(scope);
  }

  // ── Messaging ──────────────────────────────────────────────────────────
  @Get("threads")
  threads(@PortalCtx() scope: PortalScope) {
    return this.portal.threads(scope);
  }

  @Get("threads/:threadKey/messages")
  threadMessages(@PortalCtx() scope: PortalScope, @Param("threadKey") threadKey: string) {
    return this.portal.messages(scope, threadKey);
  }

  @Post("threads/:threadKey/messages")
  postThreadMessage(
    @PortalCtx() scope: PortalScope,
    @Param("threadKey") threadKey: string,
    @Body() body: { content: string; parentId?: string }
  ) {
    return this.portal.postMessage(scope, threadKey, body.content, body.parentId);
  }

  @Post("threads/:threadKey/read")
  markRead(@PortalCtx() scope: PortalScope, @Param("threadKey") threadKey: string) {
    return this.portal.markThreadRead(scope, threadKey);
  }

  // Legacy per-project endpoints (older portal builds).
  @Get("messages")
  messages(@PortalCtx() scope: PortalScope, @Query("projectId") projectId?: string) {
    return this.portal.messages(scope, projectId);
  }

  @Post("projects/:projectId/messages")
  postProjectMessage(
    @PortalCtx() scope: PortalScope,
    @Param("projectId") projectId: string,
    @Body() body: { content: string }
  ) {
    return this.portal.postMessage(scope, projectId, body.content);
  }

  // ── Deliverables ───────────────────────────────────────────────────────
  @Post("files/:fileId/approval")
  approve(
    @PortalCtx() scope: PortalScope,
    @Param("fileId") fileId: string,
    @Body() body: { decision: "APPROVED" | "REVISION_REQUESTED"; revisionNotes?: string }
  ) {
    return this.portal.approveDeliverable(scope, fileId, body.decision, body.revisionNotes);
  }

  // ── Advertising performance (client-facing) ────────────────────────────
  @Get("ads/summary")
  adsSummary(@PortalCtx() scope: PortalScope, @Query("from") from?: string, @Query("to") to?: string) {
    return this.ads.summary(scope, from, to);
  }

  @Get("ads/trend")
  adsTrend(
    @PortalCtx() scope: PortalScope,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("granularity") granularity?: "day" | "week"
  ) {
    return this.ads.trend(scope, from, to, granularity === "week" ? "week" : "day");
  }

  @Get("ads/campaigns")
  adsCampaigns(@PortalCtx() scope: PortalScope, @Query("from") from?: string, @Query("to") to?: string) {
    return this.ads.campaigns(scope, from, to);
  }

  // ── Notifications + activity ───────────────────────────────────────────
  @Get("activity")
  activity(@PortalCtx() scope: PortalScope) {
    return this.portal.activity(scope);
  }

  @Get("notifications")
  notifications(@PortalCtx() scope: PortalScope, @Query("limit") limit?: string) {
    return this.portal.listNotifications(scope, Number(limit) || 30);
  }

  @Post("notifications/read")
  readNotifications(@PortalCtx() scope: PortalScope) {
    return this.portal.markNotificationsRead(scope);
  }

  // ── Files (ownership-checked download) ─────────────────────────────────
  @Get("files/:fileId/download")
  async downloadFile(
    @PortalCtx() scope: PortalScope,
    @Param("fileId") fileId: string,
    @Res() res: any
  ) {
    const file = await this.portal.fileForDownload(scope, fileId);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    return res.sendFile(file.path);
  }

  // ── Telegram ───────────────────────────────────────────────────────────
  @Get("telegram")
  telegramStatus(@PortalCtx() scope: PortalScope) {
    return this.portal.telegramStatus(scope);
  }

  @Post("telegram/link")
  telegramLink(@PortalCtx() scope: PortalScope) {
    return this.portal.telegramLink(scope);
  }

  @Delete("telegram/link")
  telegramUnlink(@PortalCtx() scope: PortalScope) {
    return this.portal.telegramUnlink(scope);
  }
}
