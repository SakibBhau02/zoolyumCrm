import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // ── Content posts ────────────────────────────────────────────────────
  async listPosts(month?: string) {
    return this.cache.wrap(`cal:posts:${month ?? "all"}`, 30, () =>
      this.prisma.contentPost.findMany({
        where: month ? { scheduledDate: { startsWith: month } } : undefined,
        orderBy: [{ scheduledDate: "asc" }, { scheduledTime: "asc" }],
        include: { project: { select: { id: true, name: true, client: { select: { companyName: true } } } } },
      })
    );
  }

  async postStats() {
    return this.cache.wrap("cal:post-stats", 30, async () => {
      const [scheduled, published, drafts, failed, all] = await Promise.all([
        this.prisma.contentPost.count({ where: { status: "SCHEDULED" } }),
        this.prisma.contentPost.count({ where: { status: "PUBLISHED" } }),
        this.prisma.contentPost.count({ where: { status: "DRAFT" } }),
        this.prisma.contentPost.count({ where: { status: "FAILED" } }),
        this.prisma.contentPost.count(),
      ]);
      return { scheduled, published, drafts, failed, total: all };
    });
  }

  private async invalidatePosts() {
    await this.cache.delPattern("cal:posts:*");
    await this.cache.del("cal:post-stats");
  }

  async createPost(dto: {
    title: string;
    content?: string;
    platforms?: string[];
    scheduledDate: string;
    scheduledTime?: string;
    status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
    projectId?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
  }) {
    const result = await this.prisma.contentPost.create({
      data: {
        title: dto.title,
        content: dto.content ?? "",
        platforms: dto.platforms ?? [],
        scheduledDate: dto.scheduledDate,
        scheduledTime: dto.scheduledTime ?? "10:00",
        status: dto.status ?? "DRAFT",
        projectId: dto.projectId ?? null,
        hasImage: dto.hasImage ?? false,
        hasVideo: dto.hasVideo ?? false,
      },
    });
    await this.invalidatePosts();
    return result;
  }

  async updatePost(id: string, dto: Partial<{
    title: string;
    content: string;
    platforms: string[];
    scheduledDate: string;
    scheduledTime: string;
    status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
    projectId: string | null;
    hasImage: boolean;
    hasVideo: boolean;
  }>) {
    const exists = await this.prisma.contentPost.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Post not found");
    const result = await this.prisma.contentPost.update({ where: { id }, data: dto as any });
    await this.invalidatePosts();
    return result;
  }

  async deletePost(id: string) {
    await this.prisma.contentPost.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Post not found");
    });
    await this.invalidatePosts();
    return { ok: true };
  }

  // ── Planner events ───────────────────────────────────────────────────
  async listEvents(month?: string) {
    return this.cache.wrap(`cal:events:${month ?? "all"}`, 30, () =>
      this.prisma.calendarEvent.findMany({
        where: month ? { date: { startsWith: month } } : undefined,
        orderBy: { date: "asc" },
        include: { client: { select: { id: true, companyName: true } } },
      })
    );
  }

  async createEvent(dto: { title: string; type: string; date: string; clientId?: string }) {
    const result = await this.prisma.calendarEvent.create({
      data: { title: dto.title, type: dto.type as any, date: dto.date, clientId: dto.clientId ?? null },
      include: { client: { select: { id: true, companyName: true } } },
    });
    await this.cache.delPattern("cal:events:*");
    return result;
  }

  async deleteEvent(id: string) {
    await this.prisma.calendarEvent.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Event not found");
    });
    await this.cache.delPattern("cal:events:*");
    return { ok: true };
  }

  // ── Daily targets ────────────────────────────────────────────────────
  async listTargets(period: string) {
    return this.cache.wrap(`cal:targets:${period}`, 30, () =>
      this.prisma.dailyTarget.findMany({
        where: { period },
        orderBy: { createdAt: "asc" },
      })
    );
  }

  private async invalidateTargets() {
    await this.cache.delPattern("cal:targets:*");
  }

  async createTarget(dto: { title: string; target: number; unit: string; category: string; period: string }) {
    const result = await this.prisma.dailyTarget.create({
      data: {
        title: dto.title,
        target: dto.target,
        current: 0,
        unit: dto.unit ?? "",
        category: dto.category ?? "sales",
        period: dto.period,
      },
    });
    await this.invalidateTargets();
    return result;
  }

  async updateTarget(id: string, dto: { current?: number; target?: number; title?: string }) {
    const result = await this.prisma.dailyTarget.update({ where: { id }, data: dto });
    await this.invalidateTargets();
    return result;
  }

  async deleteTarget(id: string) {
    await this.prisma.dailyTarget.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Target not found");
    });
    await this.invalidateTargets();
    return { ok: true };
  }
}