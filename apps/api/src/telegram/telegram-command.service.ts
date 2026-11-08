import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "../people/attendance.service";
import { LeaveService } from "../people/leave.service";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramSenderService as S } from "./telegram-sender.service";

const h = S.h;

/**
 * Everything the bot can *answer*. Both transports (webhook and long polling)
 * funnel into `handleUpdate`, so commands behave identically in dev and prod.
 */
@Injectable()
export class TelegramCommandService {
  private readonly logger = new Logger("TelegramCommands");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TelegramConfigService,
    private readonly links: TelegramLinkService,
    private readonly sender: S,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly moduleRef: ModuleRef
  ) {}

  async handleUpdate(update: any) {
    try {
      if (update?.callback_query) return await this.onCallback(update.callback_query);
      const msg = update?.message;
      if (!msg?.text) return;
      const chatId = String(msg.chat?.id ?? "");
      if (!chatId) return;
      const text: string = msg.text.trim();
      if (!text.startsWith("/")) return;

      // "/start@MyBot payload" → command "start", arg "payload"
      const [rawCmd, ...rest] = text.split(/\s+/);
      const cmd = rawCmd.replace(/^\//, "").split("@")[0].toLowerCase();
      const arg = rest.join(" ").trim();

      switch (cmd) {
        case "start":
          return await this.onStart(chatId, arg, msg.from);
        case "help":
          return await this.reply(chatId, HELP_TEXT);
        case "today":
          return await this.onToday(chatId);
        case "in":
        case "checkin":
          return await this.onPunch(chatId, "in");
        case "out":
        case "checkout":
          return await this.onPunch(chatId, "out");
        case "who":
          return await this.onWho(chatId);
        case "pause":
          return await this.onPause(chatId, true);
        case "resume":
          return await this.onPause(chatId, false);
        default:
          return await this.reply(chatId, "Unknown command. Send /help for the list.");
      }
    } catch (e: any) {
      this.logger.warn(`update failed: ${e?.message}`);
    }
  }

  private async reply(chatId: string, text: string, buttons?: { text: string; url?: string; data?: string }[][]) {
    return this.sender.send({ chatId, text, kind: "command", buttons });
  }

  // ── /start ────────────────────────────────────────────────────────────
  private async onStart(chatId: string, code: string, from: any) {
    if (!code) {
      const existing = await this.links.findByChat(chatId);
      if (existing?.isActive) {
        return this.reply(chatId, `You are already linked as <b>${h(existing.employee?.name ?? existing.user?.name ?? "staff")}</b>.\n\n${HELP_TEXT}`);
      }
      return this.reply(
        chatId,
        "👋 <b>Zoolyum OS</b>\n\nThis bot sends your attendance, meeting and payroll updates.\n\nTo connect your account, ask HR for your personal link (People → your profile → <b>Connect Telegram</b>), then tap it."
      );
    }
    const res = await this.links.consume(code, { id: chatId, username: from?.username, firstName: from?.first_name });
    if (!res.ok) {
      // The code may belong to a client-portal user — those chats are bound by
      // the same bot, so this is the only place both link tables get consulted.
      try {
        const { TelegramService } = await import("../portal/telegram.service");
        const portal = this.moduleRef.get(TelegramService, { strict: false });
        const portalReply = portal ? await portal.handleStartCode(chatId, code) : null;
        if (portalReply) return this.reply(chatId, portalReply);
      } catch {
        /* portal module not loaded */
      }
      const why = res.reason === "expired" ? "That link has expired — ask HR for a new one." : res.reason === "used" ? "That link was already used. Ask HR for a new one." : "That link is not valid. Ask HR for a new one.";
      return this.reply(chatId, `❌ ${why}`);
    }
    const emp = res.link.employeeId ? await this.prisma.employee.findUnique({ where: { id: res.link.employeeId }, select: { name: true } }) : null;
    return this.reply(
      chatId,
      `✅ <b>Connected</b>${emp?.name ? ` — ${h(emp.name)}` : ""}\n\nYou will now get your work updates here.\n\n${HELP_TEXT}`
    );
  }

  // ── /help ─────────────────────────────────────────────────────────────
  private async onToday(chatId: string) {
    const link = await this.links.findByChat(chatId);
    if (!link?.employeeId) return this.reply(chatId, "Your account is not linked to an employee yet. Ask HR to set it up.");

    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);

    const [meetings, tasks, leaves, att] = await Promise.all([
      this.prisma.leadMeetingAttendee.findMany({
        where: { employeeId: link.employeeId, meeting: { scheduledAt: { gte: start, lt: end } } },
        include: { meeting: { select: { title: true, scheduledAt: true, durationMins: true, status: true, lead: { select: { company: true } } } } },
        orderBy: { meeting: { scheduledAt: "asc" } },
      }),
      this.prisma.task.findMany({
        where: { assignedToId: link.employeeId, status: { not: "DONE" }, archivedAt: null, dueDate: { lt: end } },
        select: { title: true, dueDate: true, priority: true },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: link.employeeId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
        select: { leaveType: true },
      }),
      this.prisma.attendance.findFirst({
        where: { employeeId: link.employeeId, date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) },
        select: { status: true, checkInTime: true, checkOutTime: true },
      }),
    ]);

    const lines: string[] = [`📅 <b>Your day</b> — ${new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`];

    if (leaves.length) lines.push(`\n🌴 On leave today (${h(leaves[0].leaveType.toLowerCase())}).`);
    else if (att?.checkInTime) {
      const inT = new Date(att.checkInTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const outT = att.checkOutTime ? new Date(att.checkOutTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
      lines.push(`\n🕘 Checked in <b>${inT}</b>${outT ? ` · out ${outT}` : " · still inside"}`);
    } else {
      lines.push(`\n⚪ No check-in yet — send /in when you start.`);
    }

    lines.push(`\n<b>Meetings</b> (${meetings.length})`);
    if (!meetings.length) lines.push("• none today");
    for (const m of meetings.slice(0, 6)) {
      const t = new Date(m.meeting.scheduledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      lines.push(`• ${t} — ${h(m.meeting.title)}${m.meeting.lead?.company ? ` <i>(${h(m.meeting.lead.company)})</i>` : ""}`);
    }

    lines.push(`\n<b>Due / overdue tasks</b> (${tasks.length})`);
    if (!tasks.length) lines.push("• nothing due");
    for (const t of tasks) {
      const due = t.dueDate ? new Date(t.dueDate) : null;
      const late = due && due.getTime() < start.getTime();
      lines.push(`• ${late ? "🔴" : "•"} ${h(t.title)}${due ? ` — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`);
    }

    return this.reply(chatId, lines.join("\n"));
  }

  private async onPunch(chatId: string, action: "in" | "out") {
    const link = await this.links.findByChat(chatId);
    if (!link?.userId) return this.reply(chatId, "Link your account first (ask HR for your personal link).");
    try {
      await this.attendance.kioskPunch({ sub: link.userId }, action, "self");
      return this.reply(chatId, action === "in" ? "✅ Checked in. Have a good day!" : "✅ Checked out. Nice work today!");
    } catch (e: any) {
      return this.reply(chatId, `⚠️ ${h(e?.message ?? "Could not record that")}`);
    }
  }

  private async onWho(chatId: string) {
    const live = await this.attendance.liveBoard();
    const inside = (live.rows ?? []).filter((r: any) => r.state === "inside");
    const lines = [`🏢 <b>In the office now</b> — ${inside.length}/${live.total ?? 0}`];
    if (!inside.length) lines.push("Nobody has checked in yet today.");
    for (const r of inside.slice(0, 20)) {
      const mins = r.hoursSoFarMinutes;
      lines.push(`• ${h(r.name)}${mins != null ? ` — ${Math.floor(mins / 60)}h ${mins % 60}m` : ""}`);
    }
    return this.reply(chatId, lines.join("\n"));
  }

  private async onPause(chatId: string, pause: boolean) {
    await this.links.setActive(chatId, !pause);
    return this.reply(chatId, pause ? "🔕 Notifications paused. Send /resume to turn them back on." : "🔔 Notifications resumed.");
  }

  // ── inline buttons ────────────────────────────────────────────────────
  private async onCallback(cq: any) {
    const chatId = String(cq.message?.chat?.id ?? "");
    const data: string = cq.data ?? "";
    // Always acknowledge or the client keeps spinning.
    await this.config.api("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => null);

    const [kind, action, id] = data.split(":");
    if (kind === "leave" && (action === "approve" || action === "reject") && id) {
      const link = await this.links.findByChat(chatId);
      if (!link?.userId) {
        return this.sender.send({ chatId, kind: "leave", text: "Your Telegram is not linked to a staff account." });
      }
      // Authorisation: only Owner / HR/Admin may decide leave from chat.
      const user = await this.prisma.user.findUnique({
        where: { id: link.userId },
        select: { id: true, role: { select: { name: true } } },
      });
      const role = user?.role?.name ?? "";
      if (!/owner|hr|admin/i.test(role)) {
        return this.sender.send({ chatId, kind: "leave", text: "⛔ Only Owner or HR/Admin can approve leave." });
      }
      try {
        await this.leave.approveLeave(id, action === "approve", { sub: user!.id }, `Decided from Telegram by ${link.firstName ?? "staff"}`);
        return this.sender.send({
          chatId,
          kind: "leave-decision",
          text: action === "approve" ? "✅ Leave approved." : "❌ Leave rejected.",
        });
      } catch (e: any) {
        return this.sender.send({ chatId, kind: "leave-decision", text: `⚠️ ${h(e?.message ?? "Could not decide this request")}` });
      }
    }
    if (kind === "noop") return;
  }
}

const HELP_TEXT = [
  "<b>Commands</b>",
  "/today — your meetings, tasks and check-in state",
  "/in — check in",
  "/out — check out",
  "/who — who is in the office now",
  "/pause — mute notifications",
  "/resume — unmute",
].join("\n");
