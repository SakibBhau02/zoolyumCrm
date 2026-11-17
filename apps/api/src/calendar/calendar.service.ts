import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { CalendarFeedService } from "./calendar-feed.service";
import {
  addDays,
  dateOnly,
  dateToDay,
  dayKey,
  dayRange,
  dhakaInstant,
  isDayKey,
  isRealDay,
  isValidTime,
  normalizeTime,
  safeHttpUrl,
  timeKey,
  todayKey,
} from "./calendar.utils";

const LEGACY_STATUS: Record<string, "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED"> = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  MISSED: "FAILED",
};

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly feed: CalendarFeedService
  ) {}

  // ── shared plumbing ──────────────────────────────────────────────────
  private async invalidate() {
    await this.cache.delPattern("cal:*");
    // Calendar writes change the dashboard's today/next-7 numbers; a 30s stale
    // window looked like "my new meeting disappeared".
    await this.cache.del("dashboard:overview");
  }

  private async audit(
    source: string,
    sourceId: string,
    action: string,
    before: any,
    after: any,
    actorId?: string,
    reason?: string
  ) {
    await this.prisma.calendarAuditLog
      .create({ data: { source, sourceId, action, before: before ?? undefined, after: after ?? undefined, actorId, reason } })
      .catch(() => null);
  }

  private async resolveClient(projectId?: string | null, clientId?: string | null) {
    if (clientId) return clientId;
    if (!projectId) return null;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { clientId: true } });
    return project?.clientId ?? null;
  }

  private postInclude = {
    client: { select: { id: true, companyName: true, calendarColor: true } },
    project: { select: { id: true, name: true } },
    campaign: { select: { id: true, name: true } },
    assignee: { select: { id: true, name: true } },
    reviewer: { select: { id: true, name: true } },
    pillar: { select: { id: true, name: true, color: true } },
  } as const;

  private eventInclude = {
    client: { select: { id: true, companyName: true, calendarColor: true } },
    project: { select: { id: true, name: true } },
    campaign: { select: { id: true, name: true } },
  } as const;

  // ── content posts ────────────────────────────────────────────────────
  private buildPostData(dto: any) {
    const rawDate = dto.date ?? dto.scheduledDate;
    const hasDate = typeof rawDate === "string" && rawDate.trim() !== "";
    // A missing date used to fall back to "today", and an impossible date such
    // as 2026-02-30 rolled over silently — both put posts on the wrong day.
    if (hasDate && !isRealDay(rawDate)) {
      throw new BadRequestException("Date must be a real YYYY-MM-DD day");
    }
    const date = hasDate ? rawDate : dto.scheduledAt ? dayKey(new Date(dto.scheduledAt)) : null;
    if (!date) throw new BadRequestException("A schedule date is required");

    if (dto.time !== undefined && dto.time !== "" && !isValidTime(dto.time)) {
      throw new BadRequestException("Time must be HH:MM (24-hour)");
    }
    const time = normalizeTime(dto.time ?? dto.scheduledTime, "10:00");
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : dhakaInstant(date, time);
    if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException("Invalid schedule date");

    const publishStatus: string =
      dto.publishStatus ??
      (dto.status ? LEGACY_STATUS[String(dto.status).toUpperCase()] ?? "DRAFT" : "DRAFT");
    const legacyStatus = LEGACY_STATUS[publishStatus] ?? "DRAFT";

    return {
      day: dayKey(scheduledAt),
      time: timeKey(scheduledAt),
      scheduledAt,
      data: {
        title: String(dto.title ?? "").trim(),
        content: typeof dto.content === "string" ? dto.content : dto.caption ?? "",
        platforms: Array.isArray(dto.platforms) ? dto.platforms : [],
        scheduledDate: dayKey(scheduledAt),
        scheduledTime: timeKey(scheduledAt),
        scheduledAt,
        timeZone: dto.timeZone ?? "Asia/Dhaka",
        publishStatus: publishStatus as any,
        status: legacyStatus as any,
        format: (dto.format ?? "STATIC") as any,
        contentType: dto.contentType ?? null,
        campaignId: dto.campaignId ?? null,
        pillarId: dto.pillarId ?? null,
        assigneeId: dto.assigneeId ?? null,
        reviewerId: dto.reviewerId ?? null,
        accountIds: Array.isArray(dto.accountIds) ? dto.accountIds : [],
        hashtags: Array.isArray(dto.hashtags)
          ? dto.hashtags
          : String(dto.hashtags ?? "")
              .split(/[\s,]+/)
              .map((h) => h.replace(/^#/, "").trim())
              .filter(Boolean),
        linkUrl: safeHttpUrl(dto.linkUrl),
        firstComment: dto.firstComment ?? null,
        altText: dto.altText ?? null,
        notesInternal: dto.notesInternal ?? null,
        assetUrls: Array.isArray(dto.assetUrls)
          ? dto.assetUrls.map((u: unknown) => safeHttpUrl(u)).filter(Boolean)
          : [],
        hasImage: !!dto.hasImage || (Array.isArray(dto.assetUrls) && dto.assetUrls.some((u: string) => /\.(png|jpe?g|webp|gif)/i.test(u))),
        hasVideo: !!dto.hasVideo || (Array.isArray(dto.assetUrls) && dto.assetUrls.some((u: string) => /\.(mp4|mov|webm)/i.test(u))),
        isRecurring: !!dto.isRecurring,
        recurrenceRule: dto.recurrenceRule ?? null,
        externalUrl: safeHttpUrl(dto.externalUrl),
      } as any,
    };
  }

  async createPost(dto: any, userId?: string) {
    if (!String(dto.title ?? "").trim()) throw new BadRequestException("Title is required");
    const built = this.buildPostData(dto);
    // Publishing is an explicit, approved action — not a create-time flag.
    if (built.data.publishStatus === "PUBLISHED" && !dto.__import) {
      throw new BadRequestException("Create the post first, then approve and publish it");
    }
    const clientId = await this.resolveClient(dto.projectId, dto.clientId);
    const created = await this.prisma.contentPost.create({
      data: {
        ...built.data,
        clientId,
        ...(dto.__import && built.data.publishStatus === "PUBLISHED"
          ? { approvalStatus: "APPROVED" as any, approvedAt: new Date(), publishedAt: built.scheduledAt }
          : {}),
      },
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", created.id, "create", null, { title: created.title }, userId);
    await this.invalidate();
    return created;
  }

  async updatePost(id: string, dto: any, userId?: string) {
    const existing = await this.prisma.contentPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Post not found");
    const data: any = {};
    const dateTouched = dto.date || dto.scheduledDate || dto.time || dto.scheduledTime || dto.scheduledAt;
    if (dateTouched) {
      const built = this.buildPostData({
        ...existing,
        ...dto,
        publishStatus: dto.publishStatus ?? existing.publishStatus,
      });
      Object.assign(data, built.data);
    } else {
      if (dto.title !== undefined) data.title = String(dto.title).trim();
      if (dto.content !== undefined) data.content = dto.content;
      if (dto.caption !== undefined) data.content = dto.caption;
      if (dto.platforms !== undefined) data.platforms = dto.platforms;
      if (dto.status !== undefined && dto.publishStatus === undefined) {
        data.status = LEGACY_STATUS[String(dto.status).toUpperCase()] ?? "DRAFT";
        data.publishStatus = String(dto.status).toUpperCase();
      }
      if (dto.publishStatus !== undefined) {
        data.publishStatus = dto.publishStatus;
        data.status = LEGACY_STATUS[String(dto.publishStatus).toUpperCase()] ?? "DRAFT";
      }
      const passthrough = [
        "format",
        "contentType",
        "campaignId",
        "pillarId",
        "assigneeId",
        "reviewerId",
        "accountIds",
        "hashtags",
        "firstComment",
        "altText",
        "notesInternal",
        "hasImage",
        "hasVideo",
        "isRecurring",
        "recurrenceRule",
        "timeZone",
      ];
      for (const k of passthrough) if (dto[k] !== undefined) data[k] = dto[k];
      // Link-bearing fields are sanitised on every path, not just create.
      if (dto.externalUrl !== undefined) data.externalUrl = safeHttpUrl(dto.externalUrl);
      if (dto.linkUrl !== undefined) data.linkUrl = safeHttpUrl(dto.linkUrl);
      if (dto.assetUrls !== undefined) {
        data.assetUrls = Array.isArray(dto.assetUrls)
          ? dto.assetUrls.map((u: unknown) => safeHttpUrl(u)).filter(Boolean)
          : [];
      }
      if (dto.hashtags !== undefined) {
        data.hashtags = Array.isArray(dto.hashtags)
          ? dto.hashtags
          : String(dto.hashtags)
              .split(/[\s,]+/)
              .map((h) => h.replace(/^#/, "").trim())
              .filter(Boolean);
      }
    }
    if (dto.projectId !== undefined) {
      data.projectId = dto.projectId || null;
      data.clientId = await this.resolveClient(dto.projectId, dto.clientId);
    } else if (dto.clientId !== undefined) {
      data.clientId = dto.clientId || null;
    }
    if (data.publishStatus === "PUBLISHED" && existing.publishStatus !== "PUBLISHED" && existing.approvalStatus !== "APPROVED") {
      throw new BadRequestException("Approve this post before publishing it");
    }
    if (data.publishStatus === "PUBLISHED" && !existing.publishedAt) data.publishedAt = new Date();
    if (data.publishStatus === "PUBLISHED" && dto.status === undefined && dto.publishStatus === undefined) {
      data.status = "PUBLISHED";
    }

    const updated = await this.prisma.contentPost.update({
      where: { id },
      data,
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", id, "update", existing, data, userId);
    await this.invalidate();
    return updated;
  }

  async archivePost(id: string, userId?: string) {
    const existing = await this.prisma.contentPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Post not found");
    await this.prisma.contentPost.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit("CONTENT_POST", id, "archive", { archivedAt: null }, { archivedAt: new Date() }, userId);
    await this.invalidate();
    return { ok: true };
  }

  async restorePost(id: string, userId?: string) {
    await this.prisma.contentPost.update({ where: { id }, data: { archivedAt: null } });
    await this.audit("CONTENT_POST", id, "restore", null, null, userId);
    await this.invalidate();
    return { ok: true };
  }

  async submitForReview(id: string, reviewerId: string | undefined, userId?: string) {
    const post = await this.prisma.contentPost.update({
      where: { id },
      data: {
        approvalStatus: "INTERNAL_REVIEW",
        reviewerId: reviewerId ?? undefined,
        rejectionReason: null,
      },
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", id, "submit_review", null, { reviewerId }, userId);
    await this.invalidate();
    return post;
  }

  async approvePost(id: string, userId?: string) {
    const post = await this.prisma.contentPost.update({
      where: { id },
      data: {
        approvalStatus: "APPROVED",
        approvedById: userId ?? null,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", id, "approve", null, { approvedById: userId }, userId);
    await this.invalidate();
    return post;
  }

  async rejectPost(id: string, reason: string, userId?: string) {
    if (!String(reason ?? "").trim()) throw new BadRequestException("A rejection reason is required");
    const post = await this.prisma.contentPost.update({
      where: { id },
      data: { approvalStatus: "REJECTED", rejectionReason: String(reason).trim(), approvedById: null, approvedAt: null },
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", id, "reject", null, { reason }, userId);
    await this.invalidate();
    return post;
  }

  async publishPost(id: string, dto: { url?: string; publishedAt?: string }, userId?: string) {
    const target = await this.prisma.contentPost.findUnique({
      where: { id },
      select: { approvalStatus: true, title: true },
    });
    if (!target) throw new NotFoundException("Post not found");
    if (target.approvalStatus !== "APPROVED") {
      throw new BadRequestException("Approve this post before publishing it");
    }
    const post = await this.prisma.contentPost.update({
      where: { id },
      data: {
        publishStatus: "PUBLISHED",
        status: "PUBLISHED",
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
        externalUrl: safeHttpUrl(dto.url) ?? undefined,
      },
      include: this.postInclude,
    });
    await this.audit("CONTENT_POST", id, "publish", null, { url: dto.url }, userId);
    await this.invalidate();
    return post;
  }

  async getPost(id: string) {
    const post = await this.prisma.contentPost.findUnique({ where: { id }, include: this.postInclude });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  async getEvent(id: string) {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id }, include: this.eventInclude });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  // ── events ───────────────────────────────────────────────────────────
  async createEvent(dto: any, userId?: string) {
    if (!String(dto.title ?? "").trim()) throw new BadRequestException("Title is required");
    if (!isRealDay(dto.date)) throw new BadRequestException("A valid date is required");
    const allDay = !!dto.allDay;
    const endDate = isRealDay(dto.endDate) ? dto.endDate : null;
    if (endDate && endDate < dto.date) {
      throw new BadRequestException("End date cannot be before the start date");
    }
    const startTime = allDay ? null : normalizeTime(dto.startTime ?? dto.time, "10:00");
    const endTime = allDay ? null : normalizeTime(dto.endTime, "11:00");
    if (startTime && endTime && endTime <= startTime && !endDate) {
      throw new BadRequestException("End time must be after the start time");
    }
    const created = await this.prisma.calendarEvent.create({
      data: {
        title: String(dto.title).trim(),
        type: dto.type ?? "MEETING",
        date: dto.date,
        endDate,
        startTime,
        endTime,
        allDay,
        location: dto.location ?? null,
        meetingUrl: safeHttpUrl(dto.meetingUrl),
        notes: dto.notes ?? null,
        attendeeIds: Array.isArray(dto.attendeeIds) ? dto.attendeeIds : [],
        clientContactIds: Array.isArray(dto.clientContactIds) ? dto.clientContactIds : [],
        reminderMinutes: Array.isArray(dto.reminderMinutes) ? dto.reminderMinutes : [1440, 60],
        visibility: dto.visibility ?? "INTERNAL",
        clientId: dto.clientId || null,
        projectId: dto.projectId || null,
        campaignId: dto.campaignId || null,
        createdById: userId ?? null,
      },
      include: this.eventInclude,
    });
    await this.audit("EVENT", created.id, "create", null, { title: created.title }, userId);
    await this.invalidate();
    return created;
  }

  async updateEvent(id: string, dto: any, userId?: string) {
    const existing = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");
    const data: any = {};
    const fields = [
      "title",
      "type",
      "date",
      "endDate",
      "startTime",
      "endTime",
      "allDay",
      "location",
      "meetingUrl",
      "notes",
      "attendeeIds",
      "clientContactIds",
      "reminderMinutes",
      "visibility",
      "clientId",
      "projectId",
      "campaignId",
      "outcome",
      "taskId",
    ];
    for (const k of fields) if (dto[k] !== undefined) data[k] = dto[k] === "" ? null : dto[k];
    if (data.meetingUrl !== undefined) data.meetingUrl = safeHttpUrl(data.meetingUrl);
    if (data.date !== undefined && !isRealDay(data.date)) throw new BadRequestException("Invalid date");
    if (data.endDate !== undefined && data.endDate !== null && !isRealDay(data.endDate)) {
      throw new BadRequestException("Invalid end date");
    }
    // Validate the merged state, not just the submitted fields: moving only
    // `date` past `endDate` must fail even though endDate was not in the body.
    const nextDate = (data.date !== undefined ? data.date : existing.date) as string;
    const nextEndDate = (data.endDate !== undefined ? data.endDate : existing.endDate) as string | null;
    if (nextEndDate && nextEndDate < nextDate) {
      throw new BadRequestException("End date cannot be before the start date");
    }
    const nextStart = data.startTime !== undefined ? data.startTime : existing.startTime;
    const nextEnd = data.endTime !== undefined ? data.endTime : existing.endTime;
    const nextAllDay = data.allDay !== undefined ? !!data.allDay : existing.allDay;
    if (!nextAllDay && nextStart && nextEnd && nextEnd <= nextStart && !nextEndDate) {
      throw new BadRequestException("End time must be after the start time");
    }
    if (data.startTime !== undefined && data.startTime !== null && !isValidTime(data.startTime)) {
      throw new BadRequestException("Invalid start time (expected HH:MM)");
    }
    if (data.endTime !== undefined && data.endTime !== null && !isValidTime(data.endTime)) {
      throw new BadRequestException("Invalid end time (expected HH:MM)");
    }
    const updated = await this.prisma.calendarEvent.update({ where: { id }, data, include: this.eventInclude });
    await this.audit("EVENT", id, "update", existing, data, userId);
    await this.invalidate();
    return updated;
  }

  async deleteEvent(id: string, userId?: string) {
    const existing = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");
    await this.prisma.calendarEvent.delete({ where: { id } });
    await this.audit("EVENT", id, "delete", existing, null, userId);
    await this.invalidate();
    return { ok: true };
  }

  // ── drag & drop / bulk ───────────────────────────────────────────────
  async move(dto: { source: string; id: string; date: string; time?: string; duration?: number }, userId?: string) {
    if (!isDayKey(dto.date)) throw new BadRequestException("Invalid target date");
    const source = String(dto.source ?? "").toUpperCase();

    if (source === "TASK") {
      const task = await this.prisma.task.findUnique({ where: { id: dto.id } });
      if (!task) throw new NotFoundException("Task not found");
      await this.prisma.task.update({
        where: { id: dto.id },
        data: { dueDate: dhakaInstant(dto.date, dto.time ?? (task.dueDate ? timeKey(task.dueDate) : "10:00")) },
      });
      await this.audit("TASK", dto.id, "move", { dueDate: task.dueDate }, { date: dto.date }, userId);
    } else if (source === "CONTENT_POST") {
      const post = await this.prisma.contentPost.findUnique({ where: { id: dto.id } });
      if (!post) throw new NotFoundException("Post not found");
      const time = normalizeTime(dto.time, post.scheduledAt ? timeKey(post.scheduledAt) : post.scheduledTime);
      const at = dhakaInstant(dto.date, time);
      await this.prisma.contentPost.update({
        where: { id: dto.id },
        data: { scheduledAt: at, scheduledDate: dto.date, scheduledTime: time },
      });
      await this.audit("CONTENT_POST", dto.id, "move", { date: post.scheduledDate }, { date: dto.date, time }, userId);
    } else if (source === "EVENT") {
      const event = await this.prisma.calendarEvent.findUnique({ where: { id: dto.id } });
      if (!event) throw new NotFoundException("Event not found");
      const delta = Math.round(
        (new Date(`${dto.date}T00:00:00Z`).getTime() - new Date(`${event.date}T00:00:00Z`).getTime()) / 86_400_000
      );
      await this.prisma.calendarEvent.update({
        where: { id: dto.id },
        data: {
          date: dto.date,
          endDate: event.endDate ? addDays(event.endDate, delta) : null,
          startTime: dto.time ? normalizeTime(dto.time, event.startTime ?? "10:00") : event.startTime,
        },
      });
      await this.audit("EVENT", dto.id, "move", { date: event.date }, { date: dto.date }, userId);
    } else if (source === "MILESTONE") {
      await this.prisma.milestone.update({ where: { id: dto.id }, data: { dueDate: dateOnly(dto.date) } });
      await this.audit("MILESTONE", dto.id, "move", null, { date: dto.date }, userId);
    } else if (source === "DELIVERABLE") {
      await this.prisma.projectDeliverable.update({ where: { id: dto.id }, data: { dueDate: dateOnly(dto.date) } });
      await this.audit("DELIVERABLE", dto.id, "move", null, { date: dto.date }, userId);
    } else if (source === "AD_FLIGHT") {
      const flight = await this.prisma.adFlight.findUnique({ where: { id: dto.id } });
      if (!flight) throw new NotFoundException("Flight not found");
      const delta = Math.round(
        (new Date(`${dto.date}T00:00:00Z`).getTime() - new Date(dateToDay(flight.startDate) + "T00:00:00Z").getTime()) / 86_400_000
      );
      await this.prisma.adFlight.update({
        where: { id: dto.id },
        data: {
          startDate: dateOnly(dto.date),
          endDate: dateOnly(addDays(dateToDay(flight.endDate)!, delta)),
        },
      });
      await this.audit("AD_FLIGHT", dto.id, "move", null, { date: dto.date, delta }, userId);
    } else {
      throw new BadRequestException(`${source} items cannot be moved from the calendar`);
    }

    await this.invalidate();
    return { ok: true };
  }

  async bulkMove(dto: { items: { source: string; id: string }[]; date: string; mode?: "set" | "shift" }, userId?: string) {
    const items = Array.isArray(dto.items) ? dto.items.slice(0, 200) : [];
    if (!isDayKey(dto.date)) throw new BadRequestException("Invalid date");
    const results: any[] = [];
    for (const it of items) {
      results.push(await this.move({ ...it, date: dto.date }, userId));
    }
    return { moved: results.length };
  }

  async bulkStatus(dto: { items: { source: string; id: string }[]; status: string }, userId?: string) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    let updated = 0;
    for (const it of items) {
      if (it.source === "TASK") {
        await this.prisma.task.update({ where: { id: it.id }, data: { status: dto.status as any } });
        updated++;
      } else if (it.source === "CONTENT_POST") {
        await this.prisma.contentPost.update({
          where: { id: it.id },
          data: { publishStatus: dto.status as any, status: (LEGACY_STATUS[dto.status] ?? "DRAFT") as any },
        });
        updated++;
      } else if (it.source === "EVENT") {
        await this.prisma.calendarEvent.update({ where: { id: it.id }, data: { outcome: dto.status as any } });
        updated++;
      }
    }
    await this.invalidate();
    return { updated };
  }

  /**
   * Polymorphic create used by the quick-add menu: one request, one source.
   */
  async quickAdd(dto: any, userId?: string) {
    const source = String(dto.source ?? "").toUpperCase();
    if (source === "CONTENT_POST") return { source, item: await this.createPost(dto, userId) };
    if (source === "EVENT") return { source, item: await this.createEvent(dto, userId) };
    if (source === "TASK") {
      if (!String(dto.title ?? "").trim()) throw new BadRequestException("Title is required");
      const task = await this.prisma.task.create({
        data: {
          title: String(dto.title).trim(),
          description: dto.description ?? null,
          projectId: dto.projectId || null,
          assignedToId: dto.assigneeId || null,
          dueDate: dto.date ? dhakaInstant(dto.date, dto.time ?? "17:00") : null,
          priority: dto.priority ?? "MEDIUM",
          createdById: undefined,
        } as any,
      });
      await this.invalidate();
      return { source, item: task };
    }
    if (source === "DELIVERABLE") {
      if (!dto.projectId) throw new BadRequestException("A project is required for a deliverable");
      const d = await this.prisma.projectDeliverable.create({
        data: {
          projectId: dto.projectId,
          title: String(dto.title ?? "Deliverable").trim(),
          dueDate: dto.date ? dateOnly(dto.date) : null,
          status: "PENDING",
        },
      });
      await this.invalidate();
      return { source, item: d };
    }
    if (source === "NOTE") {
      const log = await this.prisma.dailyLog.create({
        data: {
          date: dto.date ?? todayKey(),
          clientId: dto.clientId || null,
          authorId: userId ?? null,
          summary: String(dto.summary ?? dto.title ?? "").trim() || "—",
          misses: Array.isArray(dto.misses) ? dto.misses : [],
        },
      });
      return { source, item: log };
    }
    throw new BadRequestException("Unsupported quick-add source");
  }

  // ── conflicts / gaps ─────────────────────────────────────────────────
  async conflicts(params: { from?: string; to?: string; clientId?: string }) {
    const from = isDayKey(params.from) ? params.from : todayKey();
    const to = isDayKey(params.to) ? params.to : addDays(from, 30);
    const posts = await this.prisma.contentPost.findMany({
      where: {
        scheduledAt: dayRange(from, to),
        archivedAt: null,
        ...(params.clientId ? { clientId: params.clientId } : {}),
      },
      select: { id: true, title: true, clientId: true, scheduledAt: true, platforms: true, accountIds: true },
      orderBy: { scheduledAt: "asc" },
    });
    const out: any[] = [];
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        const a = posts[i];
        const b = posts[j];
        if (!a.scheduledAt || !b.scheduledAt) continue;
        if (a.clientId !== b.clientId) continue;
        const diff = Math.abs(a.scheduledAt.getTime() - b.scheduledAt.getTime());
        if (diff > 30 * 60_000) continue;
        const shared = (a.platforms as string[]).filter((p) => (b.platforms as string[]).includes(p));
        if (!shared.length) continue;
        out.push({
          a: { id: a.id, title: a.title, at: a.scheduledAt, platforms: a.platforms },
          b: { id: b.id, title: b.title, at: b.scheduledAt, platforms: b.platforms },
          platforms: shared,
          minutesApart: Math.round(diff / 60_000),
          severity: diff <= 15 * 60_000 ? "high" : "warning",
        });
      }
    }
    return { from, to, conflicts: out.slice(0, 100) };
  }

  // ── bulk import ──────────────────────────────────────────────────────
  async importPosts(rows: any[], userId?: string) {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException("No rows supplied");
    if (rows.length > 500) throw new BadRequestException("Import is limited to 500 rows at a time");
    const clients = await this.prisma.client.findMany({ select: { id: true, companyName: true } });
    const clientByName = new Map(clients.map((c) => [c.companyName.toLowerCase(), c.id]));
    const created: string[] = [];
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.title || !isDayKey(r.date)) throw new Error("title and date (YYYY-MM-DD) are required");
        let clientId = r.clientId ?? null;
        if (!clientId && r.client) clientId = clientByName.get(String(r.client).toLowerCase()) ?? null;
        const platforms = Array.isArray(r.platforms)
          ? r.platforms
          : String(r.platforms ?? "")
              .split(/[,|]/)
              .map((p) => p.trim().toUpperCase())
              .filter(Boolean);
        const status = String(r.status ?? "DRAFT").toUpperCase();
        const allowed = ["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED", "MISSED"];
        const post = await this.createPost(
          {
            ...r,
            clientId,
            platforms,
            publishStatus: allowed.includes(status) ? status : "DRAFT",
            __import: true,
          },
          userId
        );
        created.push(post.id);
      } catch (e: any) {
        errors.push({ row: i + 1, message: e?.message ?? "Invalid row" });
      }
    }
    return { created: created.length, errors };
  }

  // ── day logs / comments / audit trail ────────────────────────────────
  async dayLogs(params: { date?: string; clientId?: string; from?: string; to?: string }) {
    const where: any = {};
    if (isDayKey(params.date)) where.date = params.date;
    else if (isDayKey(params.from) && isDayKey(params.to)) where.date = { gte: params.from, lte: params.to };
    if (params.clientId) where.clientId = params.clientId;
    return this.prisma.dailyLog.findMany({
      where,
      include: { author: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async saveDayLog(dto: any, userId?: string) {
    if (!isDayKey(dto.date)) throw new BadRequestException("Invalid date");
    const summary = String(dto.summary ?? "").trim();
    if (!summary) throw new BadRequestException("Write a line about the day first");
    return this.prisma.dailyLog.create({
      data: {
        date: dto.date,
        clientId: dto.clientId || null,
        authorId: userId ?? null,
        summary,
        misses: Array.isArray(dto.misses) ? dto.misses : [],
      },
    });
  }

  async comments(source: string, sourceId: string) {
    return this.prisma.calendarComment.findMany({
      where: { source, sourceId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addComment(dto: any, userId?: string) {
    if (!dto.source || !dto.sourceId || !String(dto.content ?? "").trim()) {
      throw new BadRequestException("source, sourceId and content are required");
    }
    return this.prisma.calendarComment.create({
      data: {
        source: String(dto.source).toUpperCase(),
        sourceId: dto.sourceId,
        content: String(dto.content).trim(),
        isInternal: dto.isInternal !== false,
        authorId: userId ?? null,
      },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async auditTrail(source: string, sourceId: string) {
    return this.prisma.calendarAuditLog.findMany({
      where: { source, sourceId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  // ── settings: platform accounts, pillars, saved views, appearance ────
  async platformAccounts(clientId?: string) {
    return this.prisma.clientPlatformAccount.findMany({
      where: clientId ? { clientId } : undefined,
      orderBy: [{ clientId: "asc" }, { platform: "asc" }],
    });
  }

  async savePlatformAccount(dto: any) {
    if (!dto.clientId || !dto.platform || !dto.handle) {
      throw new BadRequestException("clientId, platform and handle are required");
    }
    const handle = String(dto.handle).trim();
    return this.prisma.clientPlatformAccount.upsert({
      where: { clientId_platform_handle: { clientId: dto.clientId, platform: dto.platform, handle } },
      create: {
        clientId: dto.clientId,
        platform: dto.platform,
        handle,
        profileUrl: dto.profileUrl ?? null,
        isPrimary: !!dto.isPrimary,
        followers: dto.followers ? Number(dto.followers) : null,
      },
      update: {
        profileUrl: dto.profileUrl ?? undefined,
        isActive: dto.isActive ?? undefined,
        isPrimary: dto.isPrimary ?? undefined,
        followers: dto.followers !== undefined ? Number(dto.followers) : undefined,
      },
    });
  }

  async deletePlatformAccount(id: string) {
    await this.prisma.clientPlatformAccount.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Account not found");
    });
    return { ok: true };
  }

  async pillars(clientId?: string) {
    return this.prisma.contentPillar.findMany({
      where: clientId ? { clientId } : undefined,
      orderBy: { name: "asc" },
    });
  }

  async savePillar(dto: any) {
    if (!dto.clientId || !String(dto.name ?? "").trim()) {
      throw new BadRequestException("clientId and name are required");
    }
    return this.prisma.contentPillar.upsert({
      where: { clientId_name: { clientId: dto.clientId, name: String(dto.name).trim() } },
      create: {
        clientId: dto.clientId,
        name: String(dto.name).trim(),
        color: dto.color ?? "#7C3AED",
        targetPct: Number(dto.targetPct ?? 0),
      },
      update: { color: dto.color ?? undefined, targetPct: dto.targetPct !== undefined ? Number(dto.targetPct) : undefined },
    });
  }

  async deletePillar(id: string) {
    await this.prisma.contentPillar.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Pillar not found");
    });
    return { ok: true };
  }

  async savedViews(userId?: string) {
    return this.prisma.savedCalendarView.findMany({
      where: userId ? { OR: [{ ownerId: userId }, { isShared: true }] } : { isShared: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async saveView(dto: any, userId?: string) {
    if (!String(dto.name ?? "").trim()) throw new BadRequestException("Name is required");
    return this.prisma.savedCalendarView.create({
      data: {
        name: String(dto.name).trim(),
        ownerId: userId ?? null,
        filters: dto.filters ?? {},
        view: dto.view ?? "month",
        isShared: !!dto.isShared,
      },
    });
  }

  async deleteView(id: string, userId?: string) {
    const view = await this.prisma.savedCalendarView.findUnique({ where: { id } });
    if (!view) throw new NotFoundException("View not found");
    if (view.ownerId && userId && view.ownerId !== userId) throw new BadRequestException("Not your view");
    await this.prisma.savedCalendarView.delete({ where: { id } });
    return { ok: true };
  }

  async updateClientAppearance(clientId: string, dto: { calendarColor?: string; postingTargets?: any }) {
    return this.prisma.client.update({
      where: { id: clientId },
      data: {
        calendarColor: dto.calendarColor ?? undefined,
        postingTargets: dto.postingTargets ?? undefined,
      },
      select: { id: true, companyName: true, calendarColor: true, postingTargets: true },
    });
  }

  /** Client list with the bits the calendar needs (colour + volume). */
  async clientLookup() {
    return this.prisma.client.findMany({
      select: {
        id: true,
        companyName: true,
        calendarColor: true,
        healthLevel: true,
        category: true,
        accountOwner: { select: { id: true, name: true } },
        postingTargets: true,
      },
      orderBy: { companyName: "asc" },
    });
  }

  /** Employee picker for assignees/attendees. */
  async peopleLookup() {
    return this.prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, name: true, roleTitle: true, department: true },
      orderBy: { name: "asc" },
    });
  }
}

