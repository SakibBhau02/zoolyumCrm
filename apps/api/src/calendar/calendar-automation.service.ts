import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { addDays, dateOnly, dayKey, dhakaInstant, monthBounds, todayKey, weekBounds } from "./calendar.utils";

/**
 * Calendar automations. Deliberately few and idempotent: every job checks for
 * an existing notification of the same type/link created today, so a restart
 * or a second API instance cannot spam the team.
 */
@Injectable()
export class CalendarAutomationService {
  private readonly logger = new Logger(CalendarAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService
  ) {}

  private async notifyOnce(userId: string, type: string, title: string, message: string, link?: string) {
    const start = dhakaInstant(dayKey());
    const existing = await this.prisma.notification.findFirst({
      where: { userId, type, link: link ?? null, createdAt: { gte: start } },
      select: { id: true },
    });
    if (existing) return;
    await this.notifications.create(userId, type, title, message, link);
  }

  private async managers() {
    return this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ["Owner", "Project Manager"] } } },
      select: { id: true, name: true },
    });
  }

  /** 09:00 — a committed post whose slot passed without publishing becomes MISSED. */
  @Cron("0 9 * * *")
  async sweepMissedPosts() {
    const stale = await this.prisma.contentPost.findMany({
      where: {
        scheduledAt: { lt: new Date() },
        archivedAt: null,
        publishStatus: "SCHEDULED",
      },
      include: {
        client: { select: { id: true, companyName: true } },
        assignee: { select: { id: true, name: true } },
        project: { select: { assignedPmId: true } },
      },
      take: 200,
    });
    if (!stale.length) return;

    await this.prisma.contentPost.updateMany({
      where: { id: { in: stale.map((p) => p.id) } },
      data: { publishStatus: "MISSED", status: "FAILED" },
    });
    await this.cache.delPattern("cal:*");

    for (const post of stale) {
      const employeeUser = post.assignee
        ? await this.prisma.user.findFirst({ where: { employeeId: post.assignee.id }, select: { id: true } })
        : null;
      const targets = new Set<string>();
      if (employeeUser) targets.add(employeeUser.id);
      if (post.project?.assignedPmId) targets.add(post.project.assignedPmId);
      for (const userId of targets) {
        await this.notifyOnce(
          userId,
          "CALENDAR_POST_MISSED",
          "Post missed its slot",
          `${post.title}${post.client ? ` · ${post.client.companyName}` : ""} was scheduled but never published.`,
          `/calendar?view=day&date=${dayKey(post.scheduledAt!)}`
        ).catch(() => null);
      }
    }
    this.logger.log(`calendar: marked ${stale.length} posts as missed`);
  }

  /** 10:00 — internal review sitting for more than a day. */
  @Cron("0 10 * * *")
  async chaseApprovals() {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const pending = await this.prisma.contentPost.findMany({
      where: { approvalStatus: "INTERNAL_REVIEW", archivedAt: null, updatedAt: { lt: cutoff } },
      include: {
        client: { select: { companyName: true } },
        reviewer: { select: { id: true, name: true } },
        assignee: { select: { id: true } },
      },
      take: 100,
    });
    if (!pending.length) return;
    const managers = await this.managers();
    for (const post of pending) {
      let reviewerUserId: string | null = null;
      if (post.reviewer) {
        const u = await this.prisma.user.findFirst({ where: { employeeId: post.reviewer.id }, select: { id: true } });
        reviewerUserId = u?.id ?? null;
      }
      const targets = new Set<string>(managers.map((m) => m.id));
      if (reviewerUserId) targets.add(reviewerUserId);
      for (const userId of targets) {
        await this.notifyOnce(
          userId,
          "CALENDAR_APPROVAL_PENDING",
          "Content waiting for review",
          `${post.title}${post.client ? ` · ${post.client.companyName}` : ""} has been in review for over 24 hours.`,
          `/calendar?view=day&date=${dayKey(post.scheduledAt ?? new Date())}`
        ).catch(() => null);
      }
    }
  }

  /** Sunday 18:00 — next week's plan is still a draft. */
  @Cron("0 18 * * 0")
  async weeklyPlanReminder() {
    const next = weekBounds(addDays(todayKey(), 7));
    const locked = await this.prisma.calendarPlan.count({
      where: {
        status: { in: ["LOCKED", "PUBLISHED"] },
        periodStart: { gte: dateOnly(next.from), lte: dateOnly(next.to) },
      },
    });
    if (locked > 0) return;
    for (const m of await this.managers()) {
      await this.notifyOnce(
        m.id,
        "CALENDAR_PLAN_REMINDER",
        "Next week's plan is not locked",
        `The week of ${next.from} has no locked plan yet. Build it from the calendar.`,
        `/calendar?view=plans`
      ).catch(() => null);
    }
  }

  /** 25th, 10:00 — next month's plan is still a draft. */
  @Cron("0 10 25 * *")
  async monthlyPlanReminder() {
    const nextMonth = addDays(`${todayKey().slice(0, 7)}-01`, 32).slice(0, 7);
    const { from, to } = monthBounds(nextMonth);
    const locked = await this.prisma.calendarPlan.count({
      where: {
        status: { in: ["LOCKED", "PUBLISHED"] },
        periodStart: { gte: dateOnly(from), lte: dateOnly(to) },
      },
    });
    if (locked > 0) return;
    for (const m of await this.managers()) {
      await this.notifyOnce(
        m.id,
        "CALENDAR_PLAN_REMINDER",
        "Next month's plan is not locked",
        `No locked plan exists for ${nextMonth}. Lock it before the month starts.`,
        `/calendar?view=plans`
      ).catch(() => null);
    }
  }
}

