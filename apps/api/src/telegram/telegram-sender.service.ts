import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramConfigService } from "./telegram-config.service";

export type TgButton = { text: string; url?: string; data?: string };
export type TgSendResult = { ok: boolean; skipped?: string; messageId?: string; error?: string; mock?: boolean };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Telegram rejects messages over 4096 chars; keep headroom for HTML tags. */
const MAX_CHUNK = 3800;

/**
 * Every outbound Telegram call goes through here.
 *
 * Why a queue instead of calling fetch inline:
 *  - Telegram's documented limits are ~1 message/second per chat, 20/minute per
 *    group and ~30/second overall. A broadcast loop that fires in parallel gets
 *    HTTP 429 and, worse, silently dropped messages.
 *  - A single serialised tail plus per-chat spacing stays inside all three
 *    limits at agency scale (tens of chats) without pulling in BullMQ.
 *  - 429 responses are retried using the `retry_after` the API returns — that
 *    value is the actual contract, the published numbers are only guidance.
 */
@Injectable()
export class TelegramSenderService {
  private readonly logger = new Logger("TelegramSender");
  private tail: Promise<unknown> = Promise.resolve();
  private lastGlobalAt = 0;
  private readonly lastByChat = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TelegramConfigService
  ) {}

  /** Escape dynamic text for parse_mode=HTML. Always wrap user data with this. */
  static h(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private split(text: string): string[] {
    if (text.length <= MAX_CHUNK) return [text];
    const out: string[] = [];
    let rest = text;
    while (rest.length > MAX_CHUNK) {
      // Prefer a newline boundary so we never cut an HTML tag in half.
      let cut = rest.lastIndexOf("\n", MAX_CHUNK);
      if (cut < MAX_CHUNK * 0.5) cut = MAX_CHUNK;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n+/, "");
    }
    if (rest) out.push(rest);
    return out;
  }

  private enqueue<T>(chatId: string, job: () => Promise<T>): Promise<T> {
    const run = this.tail.catch(() => undefined).then(async () => {
      const now = Date.now();
      const chatWait = 1100 - (now - (this.lastByChat.get(chatId) ?? 0));
      const globalWait = 40 - (now - this.lastGlobalAt);
      const wait = Math.max(0, chatWait, globalWait);
      if (wait > 0) await sleep(wait);
      this.lastGlobalAt = Date.now();
      this.lastByChat.set(chatId, this.lastGlobalAt);
      return job();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async log(chatId: string, kind: string, title: string | null, body: string, status: string, messageId?: string, error?: string) {
    await this.prisma.telegramMessageLog
      .create({ data: { chatId, kind, title, body: body.slice(0, 1200), status, messageId: messageId ?? null, error: error ?? null } })
      .catch(() => null);
  }

  /** Send one message (auto-split when long). Returns the first message id. */
  async send(opts: {
    chatId: string;
    text: string;
    kind?: string;
    title?: string;
    buttons?: TgButton[][];
    disablePreview?: boolean;
  }): Promise<TgSendResult> {
    const kind = opts.kind ?? "notification";
    const cfg = await this.config.getConfig();
    if (!cfg.enabled) {
      await this.log(opts.chatId, kind, opts.title ?? null, opts.text, "skipped", undefined, "channel disabled");
      return { ok: false, skipped: "disabled" };
    }
    if (!opts.chatId) {
      await this.log(opts.chatId ?? "-", kind, opts.title ?? null, opts.text, "skipped", undefined, "no chat id");
      return { ok: false, skipped: "no-chat" };
    }
    if (cfg.mode === "mock" || !cfg.botToken) {
      await this.log(opts.chatId, kind, opts.title ?? null, opts.text, "mock");
      return { ok: true, mock: true };
    }

    return this.enqueue(opts.chatId, async () => {
      const chunks = this.split(opts.text);
      let firstId: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const payload: Record<string, any> = {
          chat_id: opts.chatId,
          text: chunks[i],
          parse_mode: "HTML",
          link_preview_options: { is_disabled: opts.disablePreview ?? true },
        };
        // Buttons ride on the last chunk so a split message still has its CTA.
        if (opts.buttons?.length && i === chunks.length - 1) {
          payload.reply_markup = {
            inline_keyboard: opts.buttons.map((row) =>
              row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "noop" }))
            ),
          };
        }
        let attempt = 0;
        let sent: { ok: boolean; result?: any; error?: string; retryAfter?: number } = { ok: false };
        while (attempt < 3) {
          sent = await this.config.api<any>("sendMessage", payload);
          if (sent.ok) break;
          if (sent.retryAfter && sent.retryAfter > 0) {
            await sleep(Math.min(sent.retryAfter, 30) * 1000);
            attempt++;
            continue;
          }
          // "message is not modified" and friends are not worth retrying.
          if (/blocked|chat not found|deactivated|kicked/i.test(sent.error ?? "")) break;
          attempt++;
          if (attempt < 3) await sleep(400 * attempt);
        }
        if (!sent.ok) {
          this.logger.warn(`send failed chat=${opts.chatId} kind=${kind}: ${sent.error}`);
          await this.log(opts.chatId, kind, opts.title ?? null, chunks[i], "failed", undefined, sent.error);
          return { ok: false, error: sent.error };
        }
        firstId = firstId ?? String(sent.result?.message_id ?? "");
      }
      await this.log(opts.chatId, kind, opts.title ?? null, opts.text, "sent", firstId);
      return { ok: true, messageId: firstId };
    });
  }

  /** Send to a staff user (resolves their linked chat, if any). */
  async sendToUser(userId: string, opts: { text: string; kind?: string; title?: string; buttons?: TgButton[][]; disablePreview?: boolean }) {
    const chat = await this.chatForUser(userId);
    if (!chat) return { ok: false, skipped: "not-linked" } as TgSendResult;
    return this.send({ ...opts, chatId: chat });
  }

  /** Send to an employee, preferring their linked user account. */
  async sendToEmployee(employeeId: string, opts: { text: string; kind?: string; title?: string; buttons?: TgButton[][]; disablePreview?: boolean }) {
    const chat = await this.chatForEmployee(employeeId);
    if (!chat) return { ok: false, skipped: "not-linked" } as TgSendResult;
    return this.send({ ...opts, chatId: chat });
  }

  /** Fallback group chat (from config) when a person has not linked yet. */
  async sendToDefaultChat(opts: { text: string; kind?: string; title?: string; buttons?: TgButton[][] }) {
    const cfg = await this.config.getConfig();
    if (!cfg.defaultChatId) return { ok: false, skipped: "no-default-chat" } as TgSendResult;
    return this.send({ ...opts, chatId: cfg.defaultChatId });
  }

  async chatForUser(userId: string): Promise<string | null> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId }, select: { chatId: true, isActive: true } });
    if (link?.isActive) return link.chatId;
    // The chat may have been linked from the employee record instead of the
    // staff account — follow the User → Employee hop before giving up.
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
    if (!user?.employeeId) return null;
    const byEmp = await this.prisma.telegramLink.findUnique({ where: { employeeId: user.employeeId }, select: { chatId: true, isActive: true } });
    return byEmp?.isActive ? byEmp.chatId : null;
  }

  async chatForEmployee(employeeId: string): Promise<string | null> {
    const link = await this.prisma.telegramLink.findUnique({ where: { employeeId }, select: { chatId: true, isActive: true } });
    if (link?.isActive) return link.chatId;
    // An employee may be linked only through their user account.
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { user: { select: { id: true } } } });
    return emp?.user?.id ? this.chatForUser(emp.user.id) : null;
  }
}
