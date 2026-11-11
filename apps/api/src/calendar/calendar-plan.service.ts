import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { CalendarFeedService } from "./calendar-feed.service";
import { addDays, dateOnly, dateToDay, dayKey, isDayKey, monthBounds, todayKey, weekBounds } from "./calendar.utils";

@Injectable()
export class CalendarPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly feed: CalendarFeedService
  ) {}

  private include = {
    client: { select: { id: true, companyName: true, calendarColor: true } },
    project: { select: { id: true, name: true } },
  } as const;

  async list(params: { clientId?: string; from?: string; to?: string }) {
    return this.prisma.calendarPlan.findMany({
      where: {
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(isDayKey(params.from) ? { periodStart: { gte: dateOnly(params.from) } } : {}),
        ...(isDayKey(params.to) ? { periodEnd: { lte: dateOnly(params.to) } } : {}),
      },
      include: this.include,
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }, { version: "desc" }],
      take: 100,
    });
  }

  async get(id: string) {
    const plan = await this.prisma.calendarPlan.findUnique({ where: { id }, include: this.include });
    if (!plan) throw new NotFoundException("Plan not found");
    return plan;
  }

  /** Build the immutable snapshot every report renders from. */
  private async buildPayload(params: {
    clientId?: string;
    projectId?: string;
    from: string;
    to: string;
  }) {
    const feed = await this.feed.feed({
      from: params.from,
      to: params.to,
      clientId: params.clientId,
      projectId: params.projectId,
      sources: "CONTENT_POST,EVENT,AD_FLIGHT,TASK,MILESTONE,DELIVERABLE",
      limit: 3000,
    });

    const items = feed.items.map((i) => ({
      key: i.key,
      source: i.source,
      sourceId: i.sourceId,
      date: i.date,
      endDate: i.endDate ?? null,
      time: i.startTime ?? null,
      title: i.title,
      platforms: i.platforms,
      status: i.status,
      approval: i.approval ?? null,
      type: (i.meta as any)?.type ?? null,
      pillar: (i.meta as any)?.pillar ?? null,
      owner: i.assigneeNames.join(", "),
      clientName: i.clientName ?? null,
      projectName: i.projectName ?? null,
      campaignName: i.campaignName ?? null,
      clientId: i.clientId ?? null,
      clientVisible: i.clientVisible,
    }));

    const byPlatform: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const i of items) {
      bySource[i.source] = (bySource[i.source] ?? 0) + 1;
      for (const p of i.platforms) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
    }

    const client = params.clientId
      ? await this.prisma.client.findUnique({
          where: { id: params.clientId },
          select: { id: true, companyName: true, calendarColor: true, postingTargets: true },
        })
      : null;

    // Content mix (P3): actual share per pillar vs the client's declared target.
    const pillars = params.clientId
      ? await this.prisma.contentPillar.findMany({ where: { clientId: params.clientId } })
      : [];
    const pillared = items.filter((i) => i.source === "CONTENT_POST" && i.pillar);
    const mix = pillars.map((p) => {
      const planned = pillared.filter((i) => i.pillar === p.name).length;
      const pct = pillared.length ? Math.round((planned / pillared.length) * 100) : 0;
      return { name: p.name, color: p.color, targetPct: p.targetPct, planned, pct, delta: pct - p.targetPct };
    });

    return {
      meta: {
        clientId: params.clientId ?? null,
        clientName: client?.companyName ?? null,
        projectId: params.projectId ?? null,
        from: params.from,
        to: params.to,
        generatedAt: new Date().toISOString(),
        postingTargets: (client?.postingTargets as Record<string, number>) ?? {},
      },
      items,
      totals: {
        planned: items.length,
        posts: items.filter((i) => i.source === "CONTENT_POST").length,
        published: items.filter((i) => i.status === "PUBLISHED").length,
        pendingApproval: items.filter((i) => i.approval === "INTERNAL_REVIEW").length,
        tasks: items.filter((i) => i.source === "TASK").length,
        meetings: items.filter((i) => i.source === "EVENT" && i.type === "MEETING").length,
        ads: items.filter((i) => i.source === "AD_FLIGHT").length,
        deliverables: items.filter((i) => i.source === "DELIVERABLE" || i.source === "MILESTONE").length,
        byPlatform,
        bySource,
      },
      mix,
    };
  }

  async create(dto: any, userId?: string) {
    const scope = (dto.scope ?? "MONTH").toUpperCase();
    let from = dto.from;
    let to = dto.to;
    if (scope === "MONTH") {
      const month = dto.month ?? todayKey().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException("month must be YYYY-MM");
      ({ from, to } = monthBounds(month));
    } else if (scope === "WEEK") {
      const day = isDayKey(dto.date) ? dto.date : todayKey();
      ({ from, to } = weekBounds(day));
    }
    if (!isDayKey(from) || !isDayKey(to)) throw new BadRequestException("A valid period is required");

    const payload = await this.buildPayload({
      clientId: dto.clientId || undefined,
      projectId: dto.projectId || undefined,
      from,
      to,
    });

    const clientName = payload.meta.clientName ?? "Agency";
    const title =
      String(dto.title ?? "").trim() ||
      `${clientName} — ${from.slice(0, 7) === to.slice(0, 7) ? new Date(`${from}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : `${from} → ${to}`} plan`;

    const plan = await this.prisma.calendarPlan.create({
      data: {
        clientId: dto.clientId || null,
        projectId: dto.projectId || null,
        scope: scope as any,
        periodStart: dateOnly(from),
        periodEnd: dateOnly(to),
        title,
        payload: payload as any,
        totals: payload.totals as any,
        notes: dto.notes ?? null,
        language: dto.language === "BN" ? "BN" : "EN",
        createdById: userId ?? null,
      },
      include: this.include,
    });
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    return plan;
  }

  async update(id: string, dto: any) {
    const plan = await this.get(id);
    return this.prisma.calendarPlan.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? String(dto.title).trim() : undefined,
        notes: dto.notes !== undefined ? dto.notes : undefined,
        language: dto.language === "BN" || dto.language === "EN" ? dto.language : undefined,
        status: dto.status ?? undefined,
      },
      include: this.include,
    });
  }

  /** Soft lock: editing stays possible, the UI warns and the reason is audited. */
  async lock(id: string, userId?: string) {
    const plan = await this.get(id);
    // Soft lock is a snapshot, not a state machine step: locking an already
    // locked plan must not inflate the version.
    if (plan.status === "LOCKED") return plan;
    const from = dateToDay(plan.periodStart)!;
    const to = dateToDay(plan.periodEnd)!;
    const payload = await this.buildPayload({ clientId: plan.clientId ?? undefined, projectId: plan.projectId ?? undefined, from, to });
    const updated = await this.prisma.calendarPlan.update({
      where: { id },
      data: {
        status: "LOCKED",
        lockedAt: new Date(),
        payload: payload as any,
        totals: payload.totals as any,
        version: plan.version,
      },
      include: this.include,
    });
    await this.prisma.calendarAuditLog.create({
      data: { source: "PLAN", sourceId: id, action: "lock", actorId: userId ?? null, after: { version: updated.version } },
    });
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    return updated;
  }

  async unlock(id: string, reason: string, userId?: string) {
    if (!String(reason ?? "").trim()) throw new BadRequestException("An unlock reason is required");
    const plan = await this.get(id);
    const updated = await this.prisma.calendarPlan.update({
      where: { id },
      data: { status: "DRAFT", lockedAt: null, version: plan.version + 1 },
      include: this.include,
    });
    await this.prisma.calendarAuditLog.create({
      data: {
        source: "PLAN",
        sourceId: id,
        action: "unlock",
        actorId: userId ?? null,
        reason: String(reason).trim(),
        before: { version: plan.version },
        after: { version: updated.version },
      },
    });
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    return updated;
  }

  async publish(id: string, userId?: string) {
    const plan = await this.get(id);
    const token = plan.shareToken ?? randomUUID().replace(/-/g, "");
    const updated = await this.prisma.calendarPlan.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date(), shareToken: token },
      include: this.include,
    });
    if (plan.clientId) {
      const portalUsers = await this.prisma.portalUser.findMany({
        where: { isActive: true, clientContact: { clientId: plan.clientId } },
        select: { id: true },
      });
      if (portalUsers.length) {
        await this.prisma.notification.createMany({
          data: portalUsers.map((u) => ({
            portalUserId: u.id,
            type: "CALENDAR_PLAN",
            title: "New content plan",
            message: `${plan.title} is ready to review.`,
            link: `/portal-client?tab=calendar`,
          })),
        });
      }
    }
    await this.prisma.calendarAuditLog.create({
      data: { source: "PLAN", sourceId: id, action: "publish", actorId: userId ?? null, after: { token } },
    });
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    return updated;
  }

  async share(id: string, dto: { expiresInDays?: number }) {
    const plan = await this.get(id);
    const token = plan.shareToken ?? randomUUID().replace(/-/g, "");
    const expiresAt = dto?.expiresInDays ? new Date(Date.now() + Number(dto.expiresInDays) * 86_400_000) : null;
    // Idempotent: pressing “Share link” twice returns the same link instead of
    // failing on the unique token (and can extend the expiry).
    await this.prisma.calendarShareLink.upsert({
      where: { token },
      create: { clientId: plan.clientId, planId: plan.id, token, scope: "PLAN", expiresAt },
      update: {
        planId: plan.id,
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
    const updated = await this.prisma.calendarPlan.update({ where: { id }, data: { shareToken: token } });
    return { token, url: `/share/calendar/${token}`, plan: updated };
  }

  async versions(clientId?: string, periodStart?: string) {
    return this.prisma.calendarPlan.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(isDayKey(periodStart) ? { periodStart: dateOnly(periodStart) } : {}),
      },
      include: this.include,
      orderBy: { version: "desc" },
      take: 50,
    });
  }

  /**
   * Plan vs actual. The snapshot is immutable, so the delta is a real
   * accountability number rather than a recomputed guess.
   */
  async variance(id: string) {
    const plan = await this.get(id);
    const payload: any = plan.payload ?? {};
    const items: any[] = Array.isArray(payload.items) ? payload.items : [];
    const postIds = items.filter((i) => i.source === "CONTENT_POST").map((i) => i.sourceId);
    const taskIds = items.filter((i) => i.source === "TASK").map((i) => i.sourceId);
    const eventIds = items.filter((i) => i.source === "EVENT").map((i) => i.sourceId);

    const [posts, tasks, events] = await Promise.all([
      postIds.length
        ? this.prisma.contentPost.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true, scheduledAt: true, publishStatus: true, approvalStatus: true },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, status: true } })
        : Promise.resolve([]),
      eventIds.length
        ? this.prisma.calendarEvent.findMany({
            where: { id: { in: eventIds } },
            select: { id: true, title: true, date: true, outcome: true },
          })
        : Promise.resolve([]),
    ]);

    const postById = new Map(posts.map((p) => [p.id, p]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const eventById = new Map(events.map((e) => [e.id, e]));

    const slipped: any[] = [];
    let published = 0;
    let missed = 0;
    let moved = 0;
    let approved = 0;
    let duePosts = 0;
    let dueSlipped = 0;
    const today = dayKey(new Date());

    for (const it of items) {
      if (it.source === "CONTENT_POST") {
        const p = postById.get(it.sourceId);
        if (!p) {
          slipped.push({ ...it, actual: "deleted", reason: "removed" });
          missed++;
          if (it.date <= today) {
            duePosts++;
            dueSlipped++;
          }
          continue;
        }
        if (p.publishStatus === "PUBLISHED") published++;
        if (p.publishStatus === "MISSED" || p.publishStatus === "FAILED") {
          missed++;
          slipped.push({ ...it, actual: p.publishStatus, reason: "not published" });
        }
        if (p.approvalStatus === "APPROVED") approved++;
        if (it.date <= today) {
          duePosts++;
          if (p.publishStatus !== "PUBLISHED") dueSlipped++;
        }
        const actualDay = p.scheduledAt ? dayKey(p.scheduledAt) : null;
        if (actualDay && actualDay !== it.date) {
          moved++;
          slipped.push({ ...it, actual: actualDay, reason: "rescheduled" });
        }
      } else if (it.source === "TASK") {
        const t = taskById.get(it.sourceId);
        if (!t) {
          slipped.push({ ...it, actual: "deleted", reason: "removed" });
          continue;
        }
        if (t.status !== "DONE") slipped.push({ ...it, actual: t.status, reason: "not done" });
      } else if (it.source === "EVENT") {
        const e = eventById.get(it.sourceId);
        if (!e) {
          slipped.push({ ...it, actual: "deleted", reason: "removed" });
          continue;
        }
        if (e.outcome === "NO_SHOW" || e.outcome === "CANCELLED") {
          slipped.push({ ...it, actual: e.outcome, reason: "meeting did not happen" });
        }
        if (e.date !== it.date) moved++;
      }
    }

    const plannedPosts = items.filter((i) => i.source === "CONTENT_POST").length;
    return {
      plan: { id: plan.id, title: plan.title, version: plan.version, status: plan.status, periodStart: plan.periodStart, periodEnd: plan.periodEnd },
      planned: {
        total: items.length,
        posts: plannedPosts,
        tasks: items.filter((i) => i.source === "TASK").length,
        meetings: items.filter((i) => i.source === "EVENT").length,
        ads: items.filter((i) => i.source === "AD_FLIGHT").length,
      },
      actual: {
        published,
        missed,
        moved,
        approved,
        duePosts,
        dueSlipped,
        onTimePct: duePosts ? Math.round(((duePosts - dueSlipped) / duePosts) * 100) : 100,
      },
      slipped: slipped.slice(0, 200),
    };
  }

  async remove(id: string) {
    await this.prisma.calendarPlan.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Plan not found");
    });
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    return { ok: true };
  }

  /** Public, login-free view of a shared plan. */
  async byShareToken(token: string) {
    const plan = await this.prisma.calendarPlan.findUnique({ where: { shareToken: token }, include: this.include });
    if (plan) {
      const link = await this.prisma.calendarShareLink.findFirst({ where: { token } });
      if (link?.expiresAt && link.expiresAt < new Date()) throw new NotFoundException("This link has expired");

      // A shared plan is client-facing. Plans snapshot internal work too
      // (tasks, internal meetings, milestones), so the public view keeps only
      // approved content and explicitly client-visible records.
      const payload: any = plan.payload ?? {};
      const items: any[] = Array.isArray(payload.items) ? payload.items : [];
      const visible = items.filter(
        (i) =>
          (i.source === "CONTENT_POST" && (i.approval === "APPROVED" || i.status === "PUBLISHED")) ||
          i.source === "AD_FLIGHT" ||
          (["EVENT", "MILESTONE", "DELIVERABLE"].includes(i.source) && i.clientVisible)
      );
      const byPlatform: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const i of visible) {
        bySource[i.source] = (bySource[i.source] ?? 0) + 1;
        for (const p of i.platforms ?? []) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
      }
      const publicTotals = {
        ...(payload.totals ?? {}),
        planned: visible.length,
        posts: visible.filter((i) => i.source === "CONTENT_POST").length,
        tasks: 0,
        meetings: visible.filter((i) => i.source === "EVENT" && i.type === "MEETING").length,
        ads: visible.filter((i) => i.source === "AD_FLIGHT").length,
        deliverables: visible.filter((i) => i.source === "DELIVERABLE" || i.source === "MILESTONE").length,
        pendingApproval: 0,
        byPlatform,
        bySource,
      };
      return {
        type: "plan" as const,
        plan: { ...plan, payload: { ...payload, items: visible, totals: publicTotals }, totals: publicTotals },
      };
    }
    const link = await this.prisma.calendarShareLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException("Link not found");
    if (link.expiresAt && link.expiresAt < new Date()) throw new NotFoundException("This link has expired");
    // A link that points at a deleted plan must not silently fall back to a
    // client calendar — that would change what the recipient is looking at.
    if (link.planId) throw new NotFoundException("This plan is no longer available");
    if (link.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: link.clientId },
        select: { id: true, companyName: true, calendarColor: true },
      });
      const feed = await this.feed.feed({
        clientId: link.clientId,
        from: todayKey(),
        to: addDays(todayKey(), 45),
        sources: "CONTENT_POST,EVENT,AD_FLIGHT",
        approval: "APPROVED",
        limit: 500,
      });
      return { type: "client" as const, client, ...feed };
    }
    throw new NotFoundException("Link not found");
  }
}

