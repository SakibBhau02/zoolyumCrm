import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret } from "../common/crypto";

export const TG_PROVIDER_NAME = "telegram";

export type TgMode = "mock" | "live";

export type TgAuto = {
  /** Mirror every in-app notification to Telegram. */
  notifications: boolean;
  /** 24h + 60m reminders for scheduled lead meetings. */
  meetingReminder: boolean;
  /** 08:30 personal agenda (meetings, open tasks, leave). */
  dailyAgenda: boolean;
  /** 25th-of-month payroll run reminder to Owner / HR. */
  payrollReminder: boolean;
  /** Weekly owner digest (headcount, attendance, utilisation, cost). */
  weeklyDigest: boolean;
  /** Missing check-in / check-out nudges to the employee and their manager. */
  attendanceNudge: boolean;
};

export type TgSettings = {
  enabled: boolean;
  mode: TgMode;
  /** false on a server without a public HTTPS URL (dev) — the bot long-polls. */
  useWebhook: boolean;
  botName: string;
  auto: TgAuto;
};

export type TgSecrets = {
  botToken?: string;
  webhookSecret?: string;
  defaultChatId?: string;
};

export type TgConfig = TgSettings & TgSecrets;

const DEFAULT_SETTINGS: TgSettings = {
  enabled: false,
  mode: "mock",
  useWebhook: false,
  botName: "",
  auto: {
    notifications: true,
    meetingReminder: true,
    dailyAgenda: true,
    payrollReminder: true,
    weeklyDigest: true,
    attendanceNudge: true,
  },
};

/**
 * Telegram bot credentials + automation switches.
 *
 * Stored in the existing `Integration` row (provider "telegram") with the same
 * AES-256-GCM blob the WhatsApp channel uses, so bot tokens never sit in env
 * files, source or logs. `mock` mode logs every send instead of calling
 * Telegram — the Control panel can be wired up before a token exists.
 */
@Injectable()
export class TelegramConfigService {
  private readonly logger = new Logger("TelegramConfig");
  /** Short-lived cache — the sender reads config on every message. */
  private cached: { at: number; cfg: TgConfig } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private invalidate() {
    this.cached = null;
  }

  async ensureDefaults() {
    let row = await this.prisma.integration.findFirst({ where: { providerName: TG_PROVIDER_NAME } });
    if (!row) {
      row = await this.prisma.integration.create({
        data: {
          providerName: TG_PROVIDER_NAME,
          type: "MESSAGING",
          status: "DISCONNECTED",
          credentialsEnc: encryptSecret(JSON.stringify({ settings: DEFAULT_SETTINGS, secrets: {} })),
        },
      });
    }
    return row;
  }

  private parseBlob(blob: string | null): { settings: TgSettings; secrets: TgSecrets } {
    const raw = decryptSecret(blob);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings ?? {}),
            auto: { ...DEFAULT_SETTINGS.auto, ...(parsed.settings?.auto ?? {}) },
          },
          secrets: parsed.secrets ?? {},
        };
      } catch {
        // fall through to defaults
      }
    }
    return { settings: { ...DEFAULT_SETTINGS, auto: { ...DEFAULT_SETTINGS.auto } }, secrets: {} };
  }

  async getConfig(force = false): Promise<TgConfig> {
    if (!force && this.cached && Date.now() - this.cached.at < 15_000) return this.cached.cfg;
    const row = await this.ensureDefaults();
    const { settings, secrets } = this.parseBlob(row.credentialsEnc);
    // Env fallback keeps the pre-existing portal bot working: an install that
    // only ever set TELEGRAM_BOT_TOKEN must not need a database edit. The DB
    // value always wins when both exist.
    const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
    const envBot = process.env.TELEGRAM_BOT_USERNAME?.trim()?.replace(/^@/, "") || undefined;
    const cfg: TgConfig = {
      ...settings,
      botName: settings.botName || envBot || "",
      ...secrets,
      botToken: secrets.botToken || envToken,
      webhookSecret: secrets.webhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    };
    this.cached = { at: Date.now(), cfg };
    return cfg;
  }

  /** Owner-facing view — secrets are never returned, only "is it set". */
  async getPublicConfig() {
    const cfg = await this.getConfig(true);
    const [links, logs] = await Promise.all([
      this.prisma.telegramLink.count({ where: { isActive: true } }),
      this.prisma.telegramMessageLog.count(),
    ]);
    return {
      enabled: cfg.enabled,
      mode: cfg.mode,
      useWebhook: cfg.useWebhook,
      botName: cfg.botName ?? "",
      auto: cfg.auto,
      botTokenSet: !!cfg.botToken,
      webhookSecretSet: !!cfg.webhookSecret,
      defaultChatId: cfg.defaultChatId ?? "",
      linkedChats: links,
      messagesSent: logs,
    };
  }

  async updateConfig(body: Partial<TgConfig>, actorId?: string) {
    const row = await this.ensureDefaults();
    const current = this.parseBlob(row.credentialsEnc);
    const settings: TgSettings = {
      enabled: body.enabled ?? current.settings.enabled,
      mode: body.mode ?? current.settings.mode,
      useWebhook: body.useWebhook ?? current.settings.useWebhook,
      botName: body.botName ?? current.settings.botName,
      auto: { ...current.settings.auto, ...(body as any).auto },
    };
    const secrets: TgSecrets = { ...current.secrets };
    // An untouched masked input submits "" — keep the stored secret in that case.
    for (const k of ["botToken", "webhookSecret", "defaultChatId"] as const) {
      const v = (body as any)[k];
      if (typeof v === "string" && v.trim().length > 0) secrets[k] = v.trim();
      if (v === null) delete secrets[k];
    }
    await this.prisma.integration.update({
      where: { id: row.id },
      data: {
        credentialsEnc: encryptSecret(JSON.stringify({ settings, secrets })),
        status: settings.enabled ? "CONNECTED" : "DISCONNECTED",
        connectedById: actorId ?? row.connectedById,
        connectedAt: settings.enabled ? new Date() : row.connectedAt,
      },
    });
    this.invalidate();
    return this.getPublicConfig();
  }

  /** Raw Bot API call — the only place the token is concatenated into a URL. */
  async api<T = any>(method: string, payload?: Record<string, any>): Promise<{ ok: boolean; result?: T; error?: string; retryAfter?: number }> {
    const cfg = await this.getConfig();
    if (!cfg.botToken) return { ok: false, error: "Bot token not configured" };
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        return {
          ok: false,
          error: data?.description ?? `Telegram responded ${res.status}`,
          retryAfter: data?.parameters?.retry_after,
        };
      }
      return { ok: true, result: data.result as T };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Network error reaching Telegram" };
    }
  }

  async testConnection() {
    const cfg = await this.getConfig(true);
    if (cfg.mode === "mock") {
      return { ok: true, mode: "mock" as const, detail: "Mock mode — no Telegram call made. Sends are logged, not delivered." };
    }
    if (!cfg.botToken) return { ok: false, mode: "live" as const, detail: "Bot token is required for live mode." };
    const r = await this.api<{ username: string; first_name: string }>("getMe");
    if (!r.ok) return { ok: false, mode: "live" as const, detail: r.error ?? "getMe failed" };
    return { ok: true, mode: "live" as const, detail: `Connected as @${r.result?.username ?? "bot"} (${r.result?.first_name ?? ""})` };
  }

  /**
   * Register the webhook. Telegram only accepts public HTTPS on 443/80/88/8443,
   * so this is a production-only path; the polling loop covers local dev.
   */
  async setWebhook(publicUrl: string) {
    const cfg = await this.getConfig(true);
    if (!publicUrl.startsWith("https://")) {
      return { ok: false, detail: "Webhook URL must be public HTTPS (Telegram rejects http/localhost)." };
    }
    const payload: Record<string, any> = { url: `${publicUrl.replace(/\/$/, "")}/api/telegram/webhook`, allowed_updates: ["message", "callback_query"], drop_pending_updates: true };
    if (cfg.webhookSecret) payload.secret_token = cfg.webhookSecret;
    const r = await this.api("setWebhook", payload);
    if (!r.ok) return { ok: false, detail: r.error ?? "setWebhook failed" };
    await this.updateConfig({ useWebhook: true } as any);
    return { ok: true, detail: "Webhook registered." };
  }

  async deleteWebhook() {
    const r = await this.api("deleteWebhook", { drop_pending_updates: false });
    if (r.ok) await this.updateConfig({ useWebhook: false } as any);
    return r;
  }

  async webhookInfo() {
    const r = await this.api<any>("getWebhookInfo");
    return r.ok ? r.result : { error: r.error };
  }

  /** Safe for log lines: never echoes the token. */
  mask(): string {
    return "••••••";
  }
}
