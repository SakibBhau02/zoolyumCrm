import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramConfigService } from "../telegram/telegram-config.service";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Telegram delivery for the **client portal** (PortalUser chats).
 *
 * Transport is owned by `TelegramModule`: this service used to run its own
 * `getUpdates` loop against an env token, which meant two pollers fighting over
 * one bot — Telegram returns 409 and each poller steals the other's updates.
 * Inbound `/start <code>` handling now lives in TelegramCommandService, which
 * asks this service to consume portal codes.
 *
 * Kept as its own service because portal recipients, access scopes and message
 * copy are portal concerns; only the wire is shared.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly envToken: string | null;
  private readonly envBot: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TelegramConfigService
  ) {
    this.envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
    this.envBot = process.env.TELEGRAM_BOT_USERNAME?.trim()?.replace(/^@/, "") || null;
  }

  /** Resolved token: database first, env second. */
  private async token(): Promise<string | null> {
    const cfg = await this.config.getConfig().catch(() => null);
    return cfg?.botToken ?? this.envToken;
  }

  /** Bot username for deep links — DB setting wins over env. */
  async botUsername(): Promise<string | null> {
    const cfg = await this.config.getConfig().catch(() => null);
    return cfg?.botName || this.envBot || null;
  }

  private async call(method: string, body: Record<string, unknown>) {
    const token = await this.token();
    if (!token) throw new BadRequestException("Telegram is not configured");
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    if (!json?.ok) throw new Error(json?.description ?? `Telegram ${method} failed`);
    return json.result;
  }

  // ── Linking ────────────────────────────────────────────────────────────
  /** One-time code + deep link the client taps to connect their chat. */
  async createLink(portalUserId: string) {
    const code = `zl${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    await this.prisma.portalUser.update({
      where: { id: portalUserId },
      data: { telegramLinkCode: code },
    });
    const bot = await this.botUsername();
    const link = bot ? `https://t.me/${bot}?start=${code}` : null;
    return {
      enabled: !!((await this.token()) ?? null),
      code,
      deepLink: link,
      expiresInMinutes: LINK_CODE_TTL_MS / 60000,
    };
  }

  async unlink(portalUserId: string) {
    await this.prisma.portalUser.update({
      where: { id: portalUserId },
      data: { telegramChatId: null, telegramLinkCode: null, telegramLinkedAt: null },
    });
    return { ok: true };
  }

  async status(portalUserId: string) {
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      select: { telegramChatId: true, telegramLinkedAt: true, telegramLinkCode: true },
    });
    return {
      enabled: !!(await this.token()),
      linked: !!pu?.telegramChatId,
      linkedAt: pu?.telegramLinkedAt ?? null,
      pendingCode: pu?.telegramLinkCode ?? null,
      botName: await this.botUsername(),
    };
  }

  /**
   * `/start <code>` for a portal user. Returns the reply text, or null when the
   * code does not belong to a portal account (the caller then tries staff codes).
   */
  async handleStartCode(chatId: number | string, code: string): Promise<string | null> {
    if (!code) return null;
    const pu = await this.prisma.portalUser.findFirst({
      where: { telegramLinkCode: code, isActive: true },
      select: { id: true },
    });
    if (!pu) return null;
    // Codes are single-use: clear it as soon as it is consumed.
    await this.prisma.portalUser.update({
      where: { id: pu.id },
      data: { telegramChatId: String(chatId), telegramLinkCode: null, telegramLinkedAt: new Date() },
    });
    return "✅ Connected. You will now get portal updates here.";
  }

  // ── Sending ────────────────────────────────────────────────────────────
  /**
   * Sends a short, link-only notification. Money details and other people's
   * data never go into the chat — the portal holds the detail.
   */
  async notifyPortalUser(portalUserId: string, text: string) {
    if (!(await this.token())) return { sent: false, reason: "DISABLED" as const };
    const pu = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      select: { telegramChatId: true },
    });
    if (!pu?.telegramChatId) return { sent: false, reason: "NOT_LINKED" as const };
    try {
      await this.call("sendMessage", {
        chat_id: pu.telegramChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      return { sent: true as const };
    } catch (e: any) {
      this.logger.warn(`portal send failed: ${e?.message}`);
      return { sent: false, reason: "ERROR" as const, error: e?.message };
    }
  }

  /** Fan out to every linked contact of a client (optionally filtered). */
  async notifyClient(clientId: string, text: string, opts?: { onlyLinkedToProject?: string }) {
    if (!(await this.token())) return { sent: 0, reason: "DISABLED" as const };
    const users = await this.prisma.portalUser.findMany({
      where: { isActive: true, telegramChatId: { not: null }, clientContact: { clientId } },
      select: { id: true, contactAccess: { select: { scope: true, projectIds: true } } },
    });
    let sent = 0;
    for (const u of users) {
      if (
        opts?.onlyLinkedToProject &&
        u.contactAccess?.scope === "CUSTOM" &&
        !u.contactAccess.projectIds.includes(opts.onlyLinkedToProject)
      ) {
        continue;
      }
      const r = await this.notifyPortalUser(u.id, text);
      if (r.sent) sent++;
    }
    return { sent };
  }
}
