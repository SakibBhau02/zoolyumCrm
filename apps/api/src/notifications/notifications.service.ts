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
  "LEAD_ASSIGNED",
  "MEETING_SCHEDULED",
  "FOLLOWUP_SCHEDULED",
  "TASK_REMINDER",
  "TASK_ASSIGNED",
  "TASK_COMMENT",
  "TASK_MENTION",
  "TASK_OVERDUE",
  "TASK_DUE_SOON",
  "INVOICE_CREATED",
  "INVOICE_PAID",
  "CLIENT_MESSAGE",
  "OVERDUE_PAYMENT",
  "PROJECT_UPDATE",
  "PROJECT_ASSIGNED",
  "LEAVE_REQUEST",
  "LEAVE_STATUS",
  "REPORT_READY",
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
    return n;
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