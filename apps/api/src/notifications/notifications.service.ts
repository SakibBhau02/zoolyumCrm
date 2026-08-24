import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Subject } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

interface SsePayload {
  data: string;
}

const DEFAULT_PREF_TYPES = [
  "NEW_LEAD",
  "TASK_REMINDER",
  "TASK_ASSIGNED",
  "INVOICE_PAID",
  "CLIENT_MESSAGE",
  "OVERDUE_PAYMENT",
  "PROJECT_UPDATE",
  "WEEKLY_REPORT",
];
const DEFAULT_PREF_CHANNELS = ["EMAIL", "PUSH", "SMS"];

@Injectable()
export class NotificationsService {
  private subscribers = new Map<string, Subject<SsePayload>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService
  ) {}

  verifyToken(token: string) {
    return this.jwt.verify<{ sub: string }>(token);
  }

  async getForUser(userId: string, limit = 30) {
    return this.cache.wrap(`notif:list:${userId}`, 15, () =>
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
      })
    );
  }

  async getUnreadCount(userId: string) {
    return this.cache.wrap(`notif:count:${userId}`, 5, () =>
      this.prisma.notification.count({ where: { userId, isRead: false } })
    );
  }

  private async invalidateUser(userId: string) {
    await this.cache.del(`notif:count:${userId}`);
    await this.cache.del(`notif:list:${userId}`);
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
    const n = await this.prisma.notification.create({
      data: { userId, type, title, message, link },
    });
    this.push(userId, n);
    await this.invalidateUser(userId);
    return n;
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