import { Body, Controller, Headers, HttpCode, Logger, Post, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { Public } from "../common/decorators/public.decorator";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramCommandService } from "./telegram-command.service";

/**
 * Production transport. Telegram POSTs every update here.
 *
 * Two guards that matter:
 *  - `secret_token` set in setWebhook arrives as `X-Telegram-Bot-Api-Secret-Token`.
 *    Without checking it, anyone who guesses the URL can forge updates and, for
 *    example, approve their own leave.
 *  - We always answer 200 quickly. A non-2xx makes Telegram retry the same
 *    update, which would replay commands.
 */
@Controller("telegram")
export class TelegramWebhookController {
  private readonly logger = new Logger("TelegramWebhook");

  constructor(
    private readonly config: TelegramConfigService,
    private readonly commands: TelegramCommandService
  ) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Body() update: any, @Headers("x-telegram-bot-api-secret-token") secret?: string) {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled) return { ok: false, skipped: "disabled" };
    // Fail closed: an unset secret used to accept every request, which let
    // anyone forge an update and punch attendance or approve leave for a chat
    // that was already linked.
    if (!cfg.webhookSecret) {
      throw new ServiceUnavailableException("Telegram webhook secret is not configured");
    }
    const provided = Buffer.from(String(secret ?? ""));
    const expected = Buffer.from(String(cfg.webhookSecret));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      // Do not leak whether the secret is configured.
      throw new UnauthorizedException();
    }
    // Fire-and-handle so the HTTP response returns instantly; command failures
    // are logged inside the handler instead of surfacing as 5xx (which retries).
    void this.commands.handleUpdate(update).catch((e) => this.logger.warn(e?.message));
    return { ok: true };
  }
}
