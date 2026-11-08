import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** No 0/O/1/I — codes get read aloud and typed on phones. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_MINUTES = 30;

/**
 * Turns a Telegram chat into an identified person.
 *
 * Flow: the UI mints a one-time code, the person opens
 * `https://t.me/<bot>?start=<code>`, and the bot's `/start` handler calls
 * `consume()` — which is the only place a chatId is ever attached to a user or
 * employee. Codes are single-use and expire, so a forwarded link is worthless
 * after the first use.
 */
@Injectable()
export class TelegramLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private randomCode(): string {
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return out;
  }

  async createCode(input: { userId?: string; employeeId?: string }) {
    if (!input.userId && !input.employeeId) throw new BadRequestException("userId or employeeId is required");
    // Housekeeping: expired codes are noise, and an unbounded table is a footgun.
    await this.prisma.telegramLinkCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } }).catch(() => null);
    const code = this.randomCode();
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);
    await this.prisma.telegramLinkCode.create({
      data: { code, userId: input.userId ?? null, employeeId: input.employeeId ?? null, expiresAt },
    });
    return { code, expiresAt, ttlMinutes: TTL_MINUTES, deepLink: (botName?: string) => (botName ? `https://t.me/${botName}?start=${code}` : null) };
  }

  async consume(code: string, chat: { id: number | string; username?: string; firstName?: string }) {
    const row = await this.prisma.telegramLinkCode.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!row) return { ok: false as const, reason: "invalid" };
    if (row.usedAt) return { ok: false as const, reason: "used" };
    if (row.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: "expired" };

    const chatId = String(chat.id);

    // A chat can only ever point at one person. Re-linking from a different
    // account replaces the old binding instead of violating the unique index.
    await this.prisma.telegramLink.deleteMany({ where: { chatId } });
    if (row.userId) await this.prisma.telegramLink.deleteMany({ where: { userId: row.userId } });
    if (row.employeeId) await this.prisma.telegramLink.deleteMany({ where: { employeeId: row.employeeId } });

    // Users carry their employee link — bind both so meeting/attendance
    // automation can address either id.
    let employeeId = row.employeeId;
    let userId = row.userId;
    if (!employeeId && row.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { employeeId: true } });
      employeeId = user?.employeeId ?? null;
    }
    if (!userId && employeeId) {
      // HR commonly links an employee record; resolve the staff account behind
      // it so in-app notifications can reach this chat too.
      const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { user: { select: { id: true } } } });
      userId = emp?.user?.id ?? null;
    }

    const link = await this.prisma.telegramLink.create({
      data: {
        chatId,
        userId,
        employeeId,
        username: chat.username ?? null,
        firstName: chat.firstName ?? null,
        isActive: true,
      },
    });
    await this.prisma.telegramLinkCode.update({ where: { code: row.code }, data: { usedAt: new Date() } });
    return { ok: true as const, link };
  }

  async unlink(input: { userId?: string; employeeId?: string }) {
    if (input.userId) await this.prisma.telegramLink.deleteMany({ where: { userId: input.userId } });
    if (input.employeeId) await this.prisma.telegramLink.deleteMany({ where: { employeeId: input.employeeId } });
    return { ok: true };
  }

  async setActive(chatId: string, isActive: boolean) {
    await this.prisma.telegramLink.updateMany({ where: { chatId }, data: { isActive } });
    return { ok: true };
  }

  async findByChat(chatId: string) {
    return this.prisma.telegramLink.findUnique({
      where: { chatId },
      include: { user: { select: { id: true, name: true, role: { select: { name: true } } } }, employee: { select: { id: true, name: true, roleTitle: true } } },
    });
  }

  async list() {
    return this.prisma.telegramLink.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } }, employee: { select: { id: true, name: true, roleTitle: true } } },
    });
  }
}
