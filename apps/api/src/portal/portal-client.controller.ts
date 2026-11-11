import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PortalPublic } from "../common/decorators/portal-public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalCtx } from "./portal-ctx.decorator";
import type { PortalScope } from "./portal-access.service";
import { PortalClientService } from "./portal-client.service";
import { PortalAdsService } from "./portal-ads.service";
import {
  PortalAdsQueryDto,
  PortalApprovalDto,
  PortalChangePasswordDto,
  PortalLoginDto,
  PortalMessageQueryDto,
  PortalNotificationQueryDto,
  PortalPostMessageDto,
  PortalTaskQueryDto,
} from "./dto/portal.dto";

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

  private ip(req: any): string {
    return String(req?.ip || req?.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
  }

  // ── Session ────────────────────────────────────────────────────────────
  @PortalPublic()
  @RateLimit({ limit: 10, windowSec: 60, name: "portal.login" })
  @HttpCode(200)
  @Post("login")
  login(@Body() body: PortalLoginDto, @Req() req: any) {
    return this.portal.login(body.email, body.password, this.ip(req));
  }

  @Get("me")
  me(@PortalCtx() scope: PortalScope) {
    return this.portal.me(scope);
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Req() req: any) {
    return this.portal.logout(req.portalUser);
  }

  @Post("password")
  @RateLimit({ limit: 5, windowSec: 60, name: "portal.password" })
  @HttpCode(200)
  changePassword(@PortalCtx() scope: PortalScope, @Body() body: PortalChangePasswordDto) {
    return this.portal.changePassword(scope, body.currentPassword, body.newPassword);
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
  tasks(@PortalCtx() scope: PortalScope, @Query() query: PortalTaskQueryDto) {
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
  threadMessages(
    @PortalCtx() scope: PortalScope,
    @Param("threadKey") threadKey: string,
    @Query() query: PortalMessageQueryDto
  ) {
    return this.portal.messages(scope, threadKey, { before: query.before, limit: query.limit });
  }

  @Post("threads/:threadKey/messages")
  @RateLimit({ limit: 30, windowSec: 60, name: "portal.message.post" })
  postThreadMessage(
    @PortalCtx() scope: PortalScope,
    @Param("threadKey") threadKey: string,
    @Body() body: PortalPostMessageDto
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
    @Body() body: PortalPostMessageDto
  ) {
    return this.portal.postMessage(scope, projectId, body.content, body.parentId);
  }

  // ── Deliverables ───────────────────────────────────────────────────────
  @Get("files")
  files(@PortalCtx() scope: PortalScope) {
    return this.portal.files(scope);
  }

  @Post("files/:fileId/approval")
  @RateLimit({ limit: 20, windowSec: 3600, name: "portal.approval" })
  approve(
    @PortalCtx() scope: PortalScope,
    @Param("fileId") fileId: string,
    @Body() body: PortalApprovalDto
  ) {
    return this.portal.approveDeliverable(scope, fileId, body.decision, body.revisionNotes);
  }

  // ── Advertising performance (client-facing) ────────────────────────────
  @Get("ads/summary")
  adsSummary(@PortalCtx() scope: PortalScope, @Query() query: PortalAdsQueryDto) {
    return this.ads.summary(scope, query.from, query.to);
  }

  @Get("ads/trend")
  adsTrend(@PortalCtx() scope: PortalScope, @Query() query: PortalAdsQueryDto) {
    return this.ads.trend(scope, query.from, query.to, query.granularity === "week" ? "week" : "day");
  }

  @Get("ads/campaigns")
  adsCampaigns(@PortalCtx() scope: PortalScope, @Query() query: PortalAdsQueryDto) {
    return this.ads.campaigns(scope, query.from, query.to);
  }

  // ── Notifications + activity ───────────────────────────────────────────
  @Get("activity")
  activity(@PortalCtx() scope: PortalScope) {
    return this.portal.activity(scope);
  }

  @Get("notifications")
  notifications(@PortalCtx() scope: PortalScope, @Query() query: PortalNotificationQueryDto) {
    return this.portal.listNotifications(scope, query.limit ?? 30);
  }

  @Post("notifications/read")
  readNotifications(@PortalCtx() scope: PortalScope) {
    return this.portal.markNotificationsRead(scope);
  }

  // ── Files (ownership-checked download) ─────────────────────────────────
  @Get("files/:fileId/download")
  @RateLimit({ limit: 60, windowSec: 60, name: "portal.download" })
  async downloadFile(
    @PortalCtx() scope: PortalScope,
    @Param("fileId") fileId: string,
    @Res() res: any
  ) {
    const file = await this.portal.fileForDownload(scope, fileId);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
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
