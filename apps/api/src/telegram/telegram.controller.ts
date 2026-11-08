import { Body, BadRequestException, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramPollingService } from "./telegram-polling.service";
import { TelegramSenderService } from "./telegram-sender.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

const ADMIN_ROLES = ["Owner", "CONTROL"];

/**
 * Control-panel surface for the Telegram channel. Mirrors the WhatsApp tab:
 * credentials live server-side, the UI only ever learns whether they are set.
 */
@RequirePermission("CONTROL")
@Controller("control/telegram")
export class TelegramController {
  constructor(
    private readonly config: TelegramConfigService,
    private readonly links: TelegramLinkService,
    private readonly sender: TelegramSenderService,
    private readonly polling: TelegramPollingService,
    private readonly prisma: PrismaService
  ) {}

  @Get("config")
  @Roles(...ADMIN_ROLES)
  getConfig() {
    return this.config.getPublicConfig();
  }

  @Patch("config")
  @Roles(...ADMIN_ROLES)
  async updateConfig(@Body() body: any, @CurrentUser() user: any) {
    const cfg = await this.config.updateConfig(body, user?.sub);
    // Apply transport changes without a restart.
    const transport = await this.polling.sync().catch(() => null);
    return { ...cfg, transport };
  }

  @Post("test-connection")
  @Roles(...ADMIN_ROLES)
  testConnection() {
    return this.config.testConnection();
  }

  @Post("test-send")
  @Roles(...ADMIN_ROLES)
  async testSend(@Body() body: { chatId?: string; text?: string }) {
    const cfg = await this.config.getConfig();
    const chatId = body?.chatId?.trim() || cfg.defaultChatId || "";
    if (!chatId) return { ok: false, detail: "No chat id — link a chat first or set a default chat id." };
    const r = await this.sender.send({
      chatId,
      kind: "test",
      title: "Test message",
      text: body?.text?.trim() || "✅ <b>Zoolyum OS</b> — Telegram channel is working.",
    });
    return r.ok ? { ok: true, detail: r.mock ? "Mock mode — logged, not delivered to Telegram." : "Message sent." } : { ok: false, detail: r.error ?? r.skipped ?? "Send failed" };
  }

  @Post("webhook")
  @Roles(...ADMIN_ROLES)
  setWebhook(@Body() body: { publicUrl: string }) {
    return this.config.setWebhook(body?.publicUrl ?? "");
  }

  @Delete("webhook")
  @Roles(...ADMIN_ROLES)
  async deleteWebhook() {
    const r = await this.config.deleteWebhook();
    await this.polling.sync().catch(() => null);
    return r;
  }

  @Get("webhook-info")
  @Roles(...ADMIN_ROLES)
  webhookInfo() {
    return this.config.webhookInfo();
  }

  @Post("polling/sync")
  @Roles(...ADMIN_ROLES)
  syncPolling() {
    return this.polling.sync();
  }

  /**
   * Mint a one-time deep link for a person. HR is allowed here (not just
   * Owner/CONTROL) because onboarding staff is an HR task.
   */
  @Post("link-code")
  @Roles("Owner", "HR/Admin", "CONTROL")
  async linkCode(@Body() body: { employeeId?: string; userId?: string }) {
    const code = await this.links.createCode({ employeeId: body?.employeeId, userId: body?.userId });
    const cfg = await this.config.getConfig();
    const bot = cfg.botName?.replace(/^@/, "") ?? "";
    return {
      code: code.code,
      expiresAt: code.expiresAt,
      ttlMinutes: code.ttlMinutes,
      deepLink: bot ? `https://t.me/${bot}?start=${code.code}` : null,
      botName: bot || null,
    };
  }

  @Get("link")
  @Roles("Owner", "HR/Admin", "CONTROL")
  async linkFor(@Query("employeeId") employeeId: string) {
    if (!employeeId) throw new BadRequestException("employeeId is required");
    const link = await this.prisma.telegramLink.findUnique({
      where: { employeeId },
      select: { id: true, chatId: true, username: true, firstName: true, isActive: true, createdAt: true },
    });
    return link ?? null;
  }

  @Get("links")
  @Roles(...ADMIN_ROLES)
  listLinks() {
    return this.links.list();
  }

  @Delete("links/:id")
  @Roles(...ADMIN_ROLES)
  removeLink(@Param("id") id: string) {
    return this.prisma.telegramLink.delete({ where: { id } }).then(() => ({ ok: true })).catch(() => ({ ok: false }));
  }

  @Get("logs")
  @Roles(...ADMIN_ROLES)
  logs(@Query("take") take?: string) {
    const n = Math.min(Math.max(Number(take) || 30, 1), 200);
    return this.prisma.telegramMessageLog.findMany({ orderBy: { createdAt: "desc" }, take: n });
  }
}
