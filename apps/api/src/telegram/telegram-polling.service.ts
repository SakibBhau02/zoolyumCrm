import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramCommandService } from "./telegram-command.service";

/**
 * Long polling — the dev path.
 *
 * Telegram needs a public HTTPS endpoint for webhooks, which `localhost` is
 * not. When the config says webhook mode is off, this loop calls `getUpdates`
 * so the bot still works on a laptop. Webhook and polling are mutually
 * exclusive by design (Telegram refuses to serve both), so we clear any stale
 * webhook before starting and re-register nothing.
 */
@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("TelegramPolling");
  private running = false;
  private offset = 0;
  private abort: AbortController | null = null;

  constructor(
    private readonly config: TelegramConfigService,
    private readonly commands: TelegramCommandService
  ) {}

  async onModuleInit() {
    // Give the container a beat to finish wiring before the first network call.
    setTimeout(() => void this.sync(), 4000);
  }

  onModuleDestroy() {
    this.running = false;
    this.abort?.abort();
  }

  /** Start/stop the loop to match current config — called after config saves. */
  async sync() {
    const cfg = await this.config.getConfig(true).catch(() => null);
    const shouldRun = !!cfg?.enabled && cfg?.mode === "live" && !!cfg?.botToken && !cfg?.useWebhook;
    if (shouldRun && !this.running) {
      this.running = true;
      this.offset = 0;
      await this.config.api("deleteWebhook", { drop_pending_updates: false }).catch(() => null);
      this.logger.log("long polling started");
      void this.loop();
      return { polling: true };
    }
    if (!shouldRun && this.running) {
      this.running = false;
      this.abort?.abort();
      this.logger.log("long polling stopped");
      return { polling: false };
    }
    return { polling: this.running };
  }

  private async loop() {
    while (this.running) {
      try {
        this.abort = new AbortController();
        const cfg = await this.config.getConfig();
        if (!cfg.botToken) break;
        const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getUpdates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query"] }),
          signal: AbortSignal.any?.([this.abort.signal, AbortSignal.timeout(35000)]) ?? this.abort.signal,
        });
        const data: any = await res.json().catch(() => null);
        if (!data?.ok) {
          if (data?.error_code === 409) {
            // Another instance is polling — back off instead of hammering.
            this.logger.warn("409 conflict: another bot instance is polling");
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        for (const update of data.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.commands.handleUpdate(update);
        }
      } catch (e: any) {
        if (!this.running) break;
        if (e?.name !== "AbortError") this.logger.warn(`poll error: ${e?.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}
