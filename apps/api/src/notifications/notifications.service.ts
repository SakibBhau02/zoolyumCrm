import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Subject } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

interface SsePayload {
  data: string;
}

const DEFAULT_PREF_TYPES = [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "MEETING_SCHEDULED",
  "MEETING_INVITE",
  "FOLLOWUP_SCHEDULED",
  "TASK_REMINDER",
  "TASK_ASSIGNED",
  "TASK_COMMENT",
  "TASK_MENTION",
  "TASK_OVERDUE",
  "TASK_DUE_SOON",
  "INVOICE_CREATED",
  "INVOICE_PAID",
  "INSTALLMENT_DUE",
  "CLIENT_MESSAGE",
  "OVERDUE_PAYMENT",
  "PROJECT_UPDATE",
  "PROJECT_ASSIGNED",
  "LEAVE_REQUEST",
  "LEAVE_STATUS",
  "REPORT_READY",
  "WEEKLY_REPORT",
  "PEOPLE_DIGEST",
  "ATTENDANCE_NUDGE",
  "PAYROLL_REMINDER",
  "DOCUMENT_EXPIRY",
  "ONBOARDING_STALE",
];
const DEFAULT_PREF_CHANNELS = ["EMAIL", "PUSH", "SMS", "TELEGRAM"];

/** Notification types grouped into the categories the UI filters by. */
const CATEGORY_PREFIXES: Record<string, string[]> = {
  tasks: ["TASK_"],
  finance: ["INVOICE_", "OVERDUE_PAYMENT", "PAYMENT_", "REPORT_READY", "WEEKLY_REPORT", "INSTALLMENT_DUE"],
  people: ["LEAVE_", "PAYROLL_", "ATTENDANCE_", "PEOPLE_", "DOCUMENT_", "ONBOARDING_"],
  business: ["NEW_LEAD", "LEAD_", "MEETING_", "FOLLOWUP_", "CLIENT_", "PROJECT_"],
  system: [],
};

export function categoryForType(type: string): keyof typeof CATEGORY_PREFIXES {
  for (const [category, prefixes] of Object.entries(CATEGORY_PREFIXES)) {
    if (prefixes.some((p) => (p.endsWith("_") ? type.startsWith(p) : type === p))) {
      return category as keyof typeof CATEGORY_PREFIXES;
    }
  }
  return "system";
}

interface ListOptions {
  limit?: number;
  skip?: number;
  unread?: boolean;
  category?: string;
}


@Injectable()
export class NotificationsService {
  private subscribers = new Map<string, Subject<SsePayload>>();
  private readonly logger = new Logger("Notifications");

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly moduleRef: ModuleRef
  ) {}

  verifyToken(token: string) {
    return this.jwt.verify<{ sub: string; scope?: string }>(token, { algorithms: ["HS256"] });
  }

  /**
   * EventSource cannot send an Authorization header, so the stream carries a
   * token in the query string. Issue a dedicated 2-minute token instead of the
   * 12-hour session token: a leaked URL then expires almost immediately and
   * cannot be replayed against the rest of the API.
   */
  signSseToken(userId: string) {
    return this.jwt.sign({ sub: userId, scope: "sse" }, { expiresIn: "2m" });
  }

  verifySseToken(token: string) {
    const payload = this.jwt.verify<{ sub: string; scope?: string }>(token, { algorithms: ["HS256"] });
    if (payload.scope !== "sse") throw new Error("Not an SSE token");
    return payload;
  }

  async getForUser(userId: string, opts: number | ListOptions = {}) {
    const o: ListOptions = typeof opts === "number" ? { limit: opts } : opts;
    const limit = Math.min(200, Math.max(1, o.limit ?? 30));
    const skip = Math.max(0, o.skip ?? 0);
    const where: any = { userId };
    if (o.unread) where.isRead = false;
    const prefixes = o.category ? CATEGORY_PREFIXES[o.category] : undefined;
    if (prefixes && prefixes.length) {
      where.OR = prefixes.map((p) => (p.endsWith("_") ? { type: { startsWith: p } } : { type: p }));
    }
    const key = `notif:list:${userId}:${limit}:${skip}:${o.unread ? 1 : 0}:${o.category ?? ""}`;
    return this.cache.wrap(key, 15, () =>
      this.prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip })
    );
  }

  /**
   * Counts for the inbox header and category chips. Derived from a single
   * lightweight projection so it stays correct regardless of how the list is
   * filtered or paginated.
   */
  async getSummary(userId: string) {
    return this.cache.wrap(`notif:summary:${userId}`, 10, async () => {
      const rows = await this.prisma.notification.findMany({
        where: { userId },
        select: { type: true, isRead: true, createdAt: true },
      });
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const categories: Record<string, { total: number; unread: number }> = {
        all: { total: 0, unread: 0 },
        tasks: { total: 0, unread: 0 },
        finance: { total: 0, unread: 0 },
        people: { total: 0, unread: 0 },
        business: { total: 0, unread: 0 },
        system: { total: 0, unread: 0 },
      };
      let today = 0;
      let thisWeek = 0;
      for (const r of rows) {
        const cat = categoryForType(r.type);
        categories.all.total++;
        categories[cat].total++;
        if (!r.isRead) {
          categories.all.unread++;
          categories[cat].unread++;
        }
        if (r.createdAt >= startOfDay) today++;
        if (r.createdAt >= weekAgo) thisWeek++;
      }
      return { total: rows.length, unread: categories.all.unread, today, thisWeek, categories };
    });
  }


  async getUnreadCount(userId: string) {
    return this.cache.wrap(`notif:count:${userId}`, 5, () =>
      this.prisma.notification.count({ where: { userId, isRead: false } })
    );
  }

  private async invalidateUser(userId: string) {
    await this.cache.del(`notif:count:${userId}`);
    await this.cache.del(`notif:summary:${userId}`);
    await this.cache.del(`notif:list:${userId}`);
    await this.cache.delPattern(`notif:list:${userId}:*`);
  }

  async markRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    await this.invalidateUser(userId);
    return result;
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({ where: { userId }, data: { isRead: true } });
    await this.invalidateUser(userId);
    return result;
  }

  async deleteOne(userId: string, id: string) {
    const result = await this.prisma.notification.deleteMany({ where: { id, userId } });
    await this.invalidateUser(userId);
    return result;
  }

  async clearAll(userId: string) {
    const result = await this.prisma.notification.deleteMany({ where: { userId } });
    await this.invalidateUser(userId);
    return result;
  }

  async create(userId: string, type: string, title: string, message: string, link?: string) {
    // preference gate — skip if user muted this type (PUSH channel doubles as in-app gate)
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel: "PUSH" } },
    });
    if (pref && !pref.enabled) return null;
    const n = await this.prisma.notification.create({
      data: { userId, type, title, message, link },
    });
    this.push(userId, n);
    await this.invalidateUser(userId);
    // Mirror to Telegram off the request path — a slow/failed bot call must
    // never delay or fail the business action that produced the notification.
    void this.fanoutTelegram(n).catch(() => null);
    return n;
  }

  /**
   * Telegram mirror of an in-app notification.
   *
   * Resolved through ModuleRef instead of a constructor dependency: the
   * Telegram module imports PeopleModule, and PeopleModule imports this one, so
   * a direct import would close the cycle Notifications → Telegram → People →
   * Notifications. `strict: false` looks the provider up in the root container.
   */
  private async fanoutTelegram(n: { userId?: string | null; type: string; title: string; message: string; link?: string | null }) {
    if (!n.userId) return;
    let sender: any;
    try {
      const { TelegramSenderService } = await import("../telegram/telegram-sender.service");
      sender = this.moduleRef.get(TelegramSenderService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`telegram fanout skipped: ${e?.message ?? e}`);
      return; // Telegram module not loaded — nothing to mirror to.
    }
    if (!sender) return;

    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId: n.userId, type: n.type, channel: "TELEGRAM" } },
    });
    if (pref && !pref.enabled) return;

    const chatId = await sender.chatForUser(n.userId);
    if (!chatId) return;

    const base = (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const text = `<b>${esc(n.title)}</b>\n${esc(n.message)}`;

    // Leave requests get decisions inline — the whole point of a phone channel.
    let buttons: { text: string; url?: string; data?: string }[][] | undefined;
    const requestId = n.link?.match(/[?&]request=([^&]+)/)?.[1];
    if (n.type === "LEAVE_REQUEST" && requestId) {
      buttons = [
        [
          { text: "✅ Approve", data: `leave:approve:${requestId}` },
          { text: "❌ Reject", data: `leave:reject:${requestId}` },
        ],
        [{ text: "Open in Zoolyum", url: `${base}/people/leave?request=${requestId}` }],
      ];
    } else if (n.link) {
      buttons = [[{ text: "Open in Zoolyum", url: `${base}${n.link}` }]];
    }

    await sender.send({ chatId, kind: "notification", title: n.title, text, buttons });
  }

  /** Targeted notify: all active users whose role name matches (case-insensitive, partial). */
  async notifyRole(roleMatch: string, type: string, title: string, message: string, link?: string, excludeUserId?: string) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { contains: roleMatch, mode: "insensitive" } } },
      select: { id: true },
    });
    let sent = 0;
    for (const u of users) {
      if (u.id === excludeUserId) continue;
      const n = await this.create(u.id, type, title, message, link);
      if (n) sent++;
    }
    return sent;
  }

  /** Resolve a User id from an Employee id (tasks/leaves link employees, notifications link users). */
  async userIdForEmployee(employeeId: string | null | undefined): Promise<string | null> {
    if (!employeeId) return null;
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: { select: { id: true } } },
    });
    return emp?.user?.id ?? null;
  }

  async broadcast(type: string, title: string, message: string, link?: string, excludeUserId?: string) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      select: { id: true },
    });
    if (!users.length) return 0;
    await this.prisma.notification.createMany({
      data: users.map((u) => ({ userId: u.id, type, title, message, link })),
    });
    for (const u of users) {
      this.push(u.id, { type, title, message, link, isRead: false, createdAt: new Date() } as any);
      await this.invalidateUser(u.id);
    }
    return users.length;
  }

  subscribe(userId: string) {
    let sub = this.subscribers.get(userId);
    if (!sub) {
      sub = new Subject<SsePayload>();
      this.subscribers.set(userId, sub);
    }
    return sub;
  }

  private push(userId: string, notification: unknown) {
    const sub = this.subscribers.get(userId);
    if (sub) {
      sub.next({ data: JSON.stringify({ type: "notification", notification }) });
    }
  }

  // ── Preferences ──────────────────────────────────────────────────────
  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    if (rows.length) return rows;
    await this.prisma.notificationPreference.createMany({
      data: DEFAULT_PREF_TYPES.flatMap((type) =>
        DEFAULT_PREF_CHANNELS.map((channel) => ({ userId, type, channel, enabled: true }))
      ),
    });
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async updatePreference(userId: string, type: string, channel: string, enabled: boolean) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type_channel: { userId, type, channel } },
      create: { userId, type, channel, enabled },
      update: { enabled },
    });
  }
}