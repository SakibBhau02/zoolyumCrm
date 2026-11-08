import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramCommandService } from "./telegram-command.service";
import { TelegramSenderService as S } from "./telegram-sender.service";

const h = S.h;
const MIN = 60_000;

/**
 * Scheduled Telegram traffic. Two rules keep it from becoming spam:
 *  1. Everything is opt-in per install (`auto.*` toggles in Control).
 *  2. Every send is deduped against `TelegramMessageLog` by a stable `kind`
 *     key, so a restart or an overlapping cron tick cannot re-send.
 */
@Injectable()
export class TelegramTriggersService {
  private readonly logger = new Logger("TelegramTriggers");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TelegramConfigService,
    private readonly sender: S,
    private readonly commands: TelegramCommandService
  ) {}

  private async alreadySent(chatId: string, kind: string) {
    const hit = await this.prisma.telegramMessageLog.findFirst({ where: { chatId, kind, status: { in: ["sent", "mock"] } }, select: { id: true } });
    return !!hit;
  }

  /** 08:30 personal agenda for everyone who linked their chat. */
  @Cron("30 8 * * *")
  async dailyAgenda() {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || !cfg.auto.dailyAgenda) return { ran: false };
    const links = await this.prisma.telegramLink.findMany({ where: { isActive: true, employeeId: { not: null } } });
    let sent = 0;
    for (const link of links) {
      const kind = `agenda:${new Date().toISOString().slice(0, 10)}`;
      if (await this.alreadySent(link.chatId, kind)) continue;
      // Reuse the /today renderer so the scheduled message and the on-demand
      // command can never drift apart.
      await this.commands.handleUpdate({ message: { text: "/today", chat: { id: link.chatId }, from: { id: link.chatId } } });
      await this.prisma.telegramMessageLog.create({ data: { chatId: link.chatId, kind, title: "Daily agenda", status: cfg.mode === "mock" ? "mock" : "sent" } }).catch(() => null);
      sent++;
    }
    return { links: links.length, sent };
  }

  /**
   * Meeting reminders at T-24h and T-60m. Runs every 5 minutes and looks at a
   * ±5 minute window, so a slow tick or a restart still catches the reminder.
   */
  @Cron("*/5 * * * *")
  async meetingReminders() {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || !cfg.auto.meetingReminder) return { ran: false };
    const now = Date.now();
    const windows = [
      { key: "24h", from: now + 24 * 60 * MIN - 5 * MIN, to: now + 24 * 60 * MIN + 5 * MIN, label: "tomorrow" },
      { key: "60m", from: now + 60 * MIN - 5 * MIN, to: now + 60 * MIN + 5 * MIN, label: "in an hour" },
    ];
    let sent = 0;
    for (const w of windows) {
      const meetings = await this.prisma.leadMeeting.findMany({
        where: { status: "SCHEDULED", scheduledAt: { gte: new Date(w.from), lte: new Date(w.to) } },
        include: {
          lead: { select: { name: true, company: true } },
          attendeeLinks: { select: { employeeId: true, employee: { select: { name: true } } } },
        },
      });
      for (const m of meetings) {
        for (const a of m.attendeeLinks) {
          if (!a.employeeId) continue;
          const chatId = await this.sender.chatForEmployee(a.employeeId);
          if (!chatId) continue;
          const kind = `meeting:${m.id}:${w.key}`;
          if (await this.alreadySent(chatId, kind)) continue;
          const when = new Date(m.scheduledAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          const text = [
            `🗓 <b>Meeting ${w.label}</b>`,
            `<b>${h(m.title)}</b>`,
            `${when} · ${m.durationMins}m`,
            m.lead?.company ? `Client: ${h(m.lead.company)}` : m.lead?.name ? `Lead: ${h(m.lead.name)}` : "",
            m.meetingLink ? `\n<a href="${h(m.meetingLink)}">Join link</a>` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const r = await this.sender.send({
            chatId,
            text,
            kind,
            title: m.title,
            buttons: m.meetingLink ? [[{ text: "Join meeting", url: m.meetingLink }]] : undefined,
          });
          if (r.ok) sent++;
        }
      }
    }
    return { sent };
  }
}
