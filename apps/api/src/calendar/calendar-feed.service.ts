import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import {
  addDays,
  colorForClient,
  dateOnly,
  dateToDay,
  dayKey,
  dayRange,
  dhakaInstant,
  eachDay,
  isDayKey,
  normalizeTime,
  timeKey,
  todayKey,
} from "./calendar.utils";

export type CalendarSource =
  | "TASK"
  | "CONTENT_POST"
  | "EVENT"
  | "MILESTONE"
  | "DELIVERABLE"
  | "AD_FLIGHT"
  | "INVOICE"
  | "LEAVE"
  | "HOLIDAY";

export type CalendarItem = {
  key: string;
  source: CalendarSource;
  sourceId: string;
  title: string;
  subtitle?: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  clientId?: string;
  clientName?: string;
  clientColor?: string;
  projectId?: string;
  projectName?: string;
  campaignId?: string;
  campaignName?: string;
  platforms: string[];
  assigneeIds: string[];
  assigneeNames: string[];
  status: string;
  statusTone: "neutral" | "info" | "success" | "warning" | "danger";
  approval?: string;
  clientVisible: boolean;
  overdue?: boolean;
  isDone?: boolean;
  href?: string;
  editable: boolean;
  draggable: boolean;
  meta?: Record<string, unknown>;
};

export type FeedParams = {
  from?: string;
  to?: string;
  month?: string;
  clientId?: string;
  projectId?: string;
  campaignId?: string;
  sources?: string;
  platforms?: string;
  status?: string;
  approval?: string;
  assigneeId?: string;
  q?: string;
  mine?: string | boolean;
  limit?: number;
  userId?: string;
};

const DEFAULT_SOURCES: CalendarSource[] = [
  "TASK",
  "CONTENT_POST",
  "EVENT",
  "AD_FLIGHT",
  "MILESTONE",
  "DELIVERABLE",
];

const TASK_TONE: Record<string, CalendarItem["statusTone"]> = {
  TODO: "neutral",
  IN_PROGRESS: "info",
  REVIEW: "warning",
  DONE: "success",
  BLOCKED: "danger",
};

const POST_TONE: Record<string, CalendarItem["statusTone"]> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  PUBLISHED: "success",
  FAILED: "danger",
  MISSED: "danger",
};

const EVENT_TONE: Record<string, CalendarItem["statusTone"]> = {
  PENDING: "info",
  DONE: "success",
  NO_SHOW: "warning",
  CANCELLED: "neutral",
  RESCHEDULED: "warning",
};

@Injectable()
export class CalendarFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  /** Resolve the caller's employee id once, so "only mine" works everywhere. */
  async employeeIdForUser(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    return user?.employeeId ?? null;
  }

  async feed(params: FeedParams) {
    const { from, to } = this.resolveRange(params);
    const sources = this.resolveSources(params.sources);
    const employeeId = params.mine === "true" || params.mine === true
      ? await this.employeeIdForUser(params.userId)
      : null;
    if (params.mine === "true" || params.mine === true) {
      if (!employeeId) return this.empty(from, to);
    }

    const range = dayRange(from, to);
    const fromDate = dateOnly(from);
    const toDate = dateOnly(to);
    const dayFrom = from;
    const dayTo = to;
    const limit = Math.min(Math.max(Number(params.limit) || 800, 50), 3000);

    const want = (s: CalendarSource) => sources.includes(s);
    const projectFilter = params.projectId ? { projectId: params.projectId } : {};

    const [tasks, posts, events, flights, milestones, deliverables, invoices, leaves, holidays] =
      await Promise.all([
        want("TASK")
          ? this.prisma.task.findMany({
              where: {
                dueDate: range,
                archivedAt: null,
                ...projectFilter,
                ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
                ...(employeeId ? { assignedToId: employeeId } : {}),
              },
              include: {
                project: { include: { client: { select: { id: true, companyName: true, calendarColor: true } } } },
                assignedTo: { select: { id: true, name: true } },
              },
              take: 1200,
            })
          : Promise.resolve([]),
        want("CONTENT_POST")
          ? this.prisma.contentPost.findMany({
              where: {
                scheduledAt: range,
                archivedAt: null,
                ...projectFilter,
                ...(params.clientId ? { clientId: params.clientId } : {}),
                ...(params.campaignId ? { campaignId: params.campaignId } : {}),
                ...(employeeId ? { assigneeId: employeeId } : {}),
              },
              include: {
                client: { select: { id: true, companyName: true, calendarColor: true } },
                project: { select: { id: true, name: true } },
                campaign: { select: { id: true, name: true } },
                assignee: { select: { id: true, name: true } },
                pillar: { select: { id: true, name: true, color: true } },
              },
              take: 1200,
            })
          : Promise.resolve([]),
        want("EVENT")
          ? this.prisma.calendarEvent.findMany({
              where: {
                OR: [{ date: { gte: dayFrom, lte: dayTo } }, { endDate: { gte: dayFrom, lte: dayTo } }],
                ...projectFilter,
                ...(params.clientId ? { clientId: params.clientId } : {}),
                ...(params.campaignId ? { campaignId: params.campaignId } : {}),
              },
              include: {
                client: { select: { id: true, companyName: true, calendarColor: true } },
                project: { select: { id: true, name: true } },
                campaign: { select: { id: true, name: true } },
              },
              take: 800,
            })
          : Promise.resolve([]),
        want("AD_FLIGHT")
          ? this.prisma.adFlight.findMany({
              where: {
                startDate: { lte: toDate },
                endDate: { gte: fromDate },
                ...projectFilter,
                ...(params.clientId ? { clientId: params.clientId } : {}),
                ...(params.campaignId ? { campaignId: params.campaignId } : {}),
              },
              include: {
                client: { select: { id: true, companyName: true, calendarColor: true } },
                campaign: { select: { id: true, name: true } },
              },
              take: 400,
            })
          : Promise.resolve([]),
        want("MILESTONE")
          ? this.prisma.milestone.findMany({
              where: {
                dueDate: range,
                ...projectFilter,
                ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
              },
              include: {
                project: { include: { client: { select: { id: true, companyName: true, calendarColor: true } } } },
              },
              take: 500,
            })
          : Promise.resolve([]),
        want("DELIVERABLE")
          ? this.prisma.projectDeliverable.findMany({
              where: {
                // `dueDate` is a Postgres DATE. Comparing it to an instant
                // truncates the bound to a date, which pulled the previous
                // day into the month — pass date-only bounds instead.
                dueDate: { gte: dateOnly(from), lte: dateOnly(to) },
                ...projectFilter,
                ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
              },
              include: {
                project: { include: { client: { select: { id: true, companyName: true, calendarColor: true } } } },
              },
              take: 500,
            })
          : Promise.resolve([]),
        want("INVOICE")
          ? this.prisma.invoice.findMany({
              where: {
                dueDate: { gte: dateOnly(from), lte: dateOnly(to) },
                status: { notIn: ["DRAFT", "VOID", "CANCELLED", "PAID"] },
                ...(params.clientId ? { clientId: params.clientId } : {}),
                ...projectFilter,
              },
              include: { client: { select: { id: true, companyName: true, calendarColor: true } } },
              take: 300,
            })
          : Promise.resolve([]),
        want("LEAVE")
          ? this.prisma.leaveRequest.findMany({
              where: {
                status: "APPROVED",
                startDate: { lte: dateOnly(to) },
                endDate: { gte: dateOnly(from) },
                ...(employeeId ? { employeeId } : {}),
              },
              include: { employee: { select: { id: true, name: true } } },
              take: 400,
            })
          : Promise.resolve([]),
        want("HOLIDAY")
          ? this.prisma.holiday.findMany({ where: { date: { gte: dayFrom, lte: dayTo } }, take: 200 })
          : Promise.resolve([]),
      ]);

    const items: CalendarItem[] = [];

    for (const t of tasks as any[]) {
      const d = dayKey(t.dueDate);
      items.push({
        key: `task:${t.id}`,
        source: "TASK",
        sourceId: t.id,
        title: t.title,
        subtitle: t.project?.name ?? undefined,
        date: d,
        allDay: true,
        clientId: t.project?.client?.id,
        clientName: t.project?.client?.companyName,
        clientColor: colorForClient(t.project?.client?.id, t.project?.client?.calendarColor),
        projectId: t.projectId ?? undefined,
        projectName: t.project?.name ?? undefined,
        platforms: [],
        assigneeIds: t.assignedToId ? [t.assignedToId] : [],
        assigneeNames: t.assignedTo?.name ? [t.assignedTo.name] : [],
        status: t.status,
        statusTone: TASK_TONE[t.status] ?? "neutral",
        clientVisible: !!t.isClientVisible,
        isDone: t.status === "DONE",
        overdue: t.status !== "DONE" && d < todayKey(),
        href: `/tasks?task=${t.id}`,
        editable: true,
        draggable: true,
        meta: { priority: t.priority, estimatedHours: t.estimatedHours, workflow: "TASK" },
      });
    }

    for (const p of posts as any[]) {
      const d = dayKey(p.scheduledAt);
      const platforms: string[] = Array.isArray(p.platforms) ? p.platforms : [];
      const publish = p.publishStatus ?? p.status ?? "DRAFT";
      items.push({
        key: `post:${p.id}`,
        source: "CONTENT_POST",
        sourceId: p.id,
        title: p.title,
        subtitle: [p.client?.companyName, p.campaign?.name].filter(Boolean).join(" · ") || undefined,
        date: d,
        startTime: timeKey(p.scheduledAt),
        allDay: false,
        clientId: p.clientId ?? p.client?.id,
        clientName: p.client?.companyName,
        clientColor: colorForClient(p.clientId ?? p.client?.id, p.client?.calendarColor),
        projectId: p.projectId ?? undefined,
        projectName: p.project?.name ?? undefined,
        campaignId: p.campaignId ?? undefined,
        campaignName: p.campaign?.name ?? undefined,
        platforms,
        assigneeIds: p.assigneeId ? [p.assigneeId] : [],
        assigneeNames: p.assignee?.name ? [p.assignee.name] : [],
        status: publish,
        statusTone: POST_TONE[publish] ?? "neutral",
        approval: p.approvalStatus,
        clientVisible: p.approvalStatus === "APPROVED",
        overdue: publish !== "PUBLISHED" && p.scheduledAt && p.scheduledAt < new Date(),
        isDone: publish === "PUBLISHED",
        href: `/calendar?view=day&date=${d}&post=${p.id}`,
        editable: true,
        draggable: true,
        meta: {
          format: p.format,
          pillar: p.pillar?.name,
          pillarColor: p.pillar?.color,
          hasImage: p.hasImage,
          hasVideo: p.hasVideo,
          externalUrl: p.externalUrl,
        },
      });
    }

    for (const e of events as any[]) {
      items.push({
        key: `event:${e.id}`,
        source: "EVENT",
        sourceId: e.id,
        title: e.title,
        subtitle: e.client?.companyName ?? undefined,
        date: e.date,
        endDate: e.endDate ?? undefined,
        startTime: e.allDay ? undefined : e.startTime ?? undefined,
        endTime: e.allDay ? undefined : e.endTime ?? undefined,
        allDay: !!e.allDay,
        clientId: e.clientId ?? undefined,
        clientName: e.client?.companyName ?? undefined,
        clientColor: colorForClient(e.clientId, e.client?.calendarColor),
        projectId: e.projectId ?? undefined,
        projectName: e.project?.name ?? undefined,
        campaignId: e.campaignId ?? undefined,
        campaignName: e.campaign?.name ?? undefined,
        platforms: [],
        assigneeIds: e.attendeeIds ?? [],
        assigneeNames: [],
        status: e.outcome,
        statusTone: EVENT_TONE[e.outcome] ?? "info",
        clientVisible: e.visibility === "CLIENT",
        isDone: e.outcome === "DONE",
        href: `/calendar?view=day&date=${e.date}&event=${e.id}`,
        editable: true,
        draggable: true,
        meta: { type: e.type, location: e.location, meetingUrl: e.meetingUrl, notes: e.notes },
      });
    }

    for (const f of flights as any[]) {
      const start = dateToDay(f.startDate)!;
      const end = dateToDay(f.endDate)!;
      items.push({
        key: `flight:${f.id}`,
        source: "AD_FLIGHT",
        sourceId: f.id,
        title: f.name,
        subtitle: `${f.platform} · ${f.campaign?.name ?? "standalone"}`,
        date: start < dayFrom ? dayFrom : start,
        endDate: end > dayTo ? dayTo : end,
        allDay: true,
        clientId: f.clientId,
        clientName: f.client?.companyName,
        clientColor: colorForClient(f.clientId, f.client?.calendarColor),
        projectId: f.projectId ?? undefined,
        campaignId: f.campaignId ?? undefined,
        campaignName: f.campaign?.name ?? undefined,
        platforms: [f.platform],
        assigneeIds: [],
        assigneeNames: [],
        status: f.status,
        statusTone: f.status === "LIVE" ? "success" : f.status === "PAUSED" ? "warning" : f.status === "ENDED" ? "neutral" : "info",
        clientVisible: true,
        href: `/calendar?view=timeline&flight=${f.id}`,
        editable: true,
        draggable: true,
        meta: {
          dailyBudget: Number(f.dailyBudget ?? 0),
          totalBudget: Number(f.totalBudget ?? 0),
          currency: f.currency,
          objective: f.objective,
          startDate: start,
          endDate: end,
        },
      });
    }

    for (const m of milestones as any[]) {
      const d = dateToDay(m.dueDate)!;
      items.push({
        key: `milestone:${m.id}`,
        source: "MILESTONE",
        sourceId: m.id,
        title: m.name,
        subtitle: m.project?.name ?? undefined,
        date: d,
        allDay: true,
        clientId: m.project?.client?.id,
        clientName: m.project?.client?.companyName,
        clientColor: colorForClient(m.project?.client?.id, m.project?.client?.calendarColor),
        projectId: m.projectId,
        projectName: m.project?.name ?? undefined,
        platforms: [],
        assigneeIds: [],
        assigneeNames: [],
        status: m.status,
        statusTone: m.status === "COMPLETED" ? "success" : "info",
        clientVisible: !!m.clientVisible,
        isDone: m.status === "COMPLETED",
        overdue: m.status !== "COMPLETED" && d < todayKey(),
        href: `/flow/${m.projectId}`,
        editable: false,
        draggable: true,
        meta: { workflow: "MILESTONE" },
      });
    }

    for (const d of deliverables as any[]) {
      const day = dateToDay(d.dueDate)!;
      items.push({
        key: `deliverable:${d.id}`,
        source: "DELIVERABLE",
        sourceId: d.id,
        title: d.title,
        subtitle: d.project?.name ?? undefined,
        date: day,
        allDay: true,
        clientId: d.project?.client?.id,
        clientName: d.project?.client?.companyName,
        clientColor: colorForClient(d.project?.client?.id, d.project?.client?.calendarColor),
        projectId: d.projectId,
        projectName: d.project?.name ?? undefined,
        platforms: [],
        assigneeIds: [],
        assigneeNames: [],
        status: d.status,
        statusTone: d.status === "DELIVERED" ? "success" : "info",
        clientVisible: !!d.clientVisible,
        isDone: d.status === "DELIVERED",
        overdue: d.status !== "DELIVERED" && day < todayKey(),
        href: `/flow/${d.projectId}`,
        editable: false,
        draggable: true,
        meta: { workflow: "DELIVERABLE" },
      });
    }

    for (const i of invoices as any[]) {
      const day = dateToDay(i.dueDate)!;
      items.push({
        key: `invoice:${i.id}`,
        source: "INVOICE",
        sourceId: i.id,
        title: `${i.invoiceNumber} · due`,
        subtitle: i.client?.companyName ?? undefined,
        date: day,
        allDay: true,
        clientId: i.clientId,
        clientName: i.client?.companyName,
        clientColor: colorForClient(i.clientId, i.client?.calendarColor),
        projectId: i.projectId ?? undefined,
        platforms: [],
        assigneeIds: [],
        assigneeNames: [],
        status: i.status,
        statusTone: i.status === "OVERDUE" ? "danger" : "warning",
        clientVisible: true,
        overdue: i.status === "OVERDUE",
        href: `/capital/invoices?invoice=${i.id}`,
        editable: false,
        draggable: false,
        meta: { amount: Number(i.total ?? 0), currency: i.currency, workflow: "INVOICE" },
      });
    }

    for (const l of leaves as any[]) {
      const start = dateToDay(l.startDate)!;
      const end = dateToDay(l.endDate) ?? start;
      items.push({
        key: `leave:${l.id}`,
        source: "LEAVE",
        sourceId: l.id,
        title: `${(l.employee?.name ?? "Employee").split(" ")[0]} on leave`,
        subtitle: l.leaveType,
        date: start < dayFrom ? dayFrom : start,
        endDate: end > dayTo ? dayTo : end,
        allDay: true,
        platforms: [],
        assigneeIds: l.employeeId ? [l.employeeId] : [],
        assigneeNames: l.employee?.name ? [l.employee.name] : [],
        status: l.status,
        statusTone: "neutral",
        clientVisible: false,
        href: `/people/leave?request=${l.id}`,
        editable: false,
        draggable: false,
        meta: { workflow: "LEAVE" },
      });
    }

    for (const h of holidays as any[]) {
      items.push({
        key: `holiday:${h.id}`,
        source: "HOLIDAY",
        sourceId: h.id,
        title: h.name,
        date: h.date,
        allDay: true,
        platforms: [],
        assigneeIds: [],
        assigneeNames: [],
        status: h.tentative ? "TENTATIVE" : "HOLIDAY",
        statusTone: "neutral",
        clientVisible: true,
        editable: false,
        draggable: false,
        meta: { workflow: "HOLIDAY" },
      });
    }

    // ── Post-filters that need the mapped shape (arrays / enums in JSON) ──
    const platformFilter = String(params.platforms ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const statusFilter = String(params.status ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const approvalFilter = String(params.approval ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const q = String(params.q ?? "").trim().toLowerCase();

    let filtered = items.filter((it) => {
      if (platformFilter.length && !it.platforms.some((p) => platformFilter.includes(p.toUpperCase()))) return false;
      if (statusFilter.length && !statusFilter.includes(it.status)) return false;
      if (approvalFilter.length && !approvalFilter.includes(String(it.approval ?? ""))) return false;
      if (q && !`${it.title} ${it.subtitle ?? ""} ${it.clientName ?? ""} ${it.projectName ?? ""}`
        .toLowerCase()
        .includes(q)) return false;
      return true;
    });

    filtered.sort((a, b) =>
      a.date === b.date
        ? Number(b.allDay) - Number(a.allDay) || (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99")
        : a.date.localeCompare(b.date)
    );

    const truncated = filtered.length > limit;
    if (truncated) filtered = filtered.slice(0, limit);

    // ── Day buckets (counts + flags) for the grid/heatmap ──
    const days: Record<string, any> = {};
    for (const day of eachDay(from, to)) {
      days[day] = { counts: {}, done: 0, overdue: 0, pendingApproval: 0, hasHoliday: false };
    }
    for (const it of filtered) {
      if (it.date < from || it.date > to) continue;
      const bucket = days[it.date];
      if (!bucket) continue;
      bucket.counts[it.source] = (bucket.counts[it.source] ?? 0) + 1;
      if (it.isDone) bucket.done++;
      if (it.overdue) bucket.overdue++;
      if (it.approval === "INTERNAL_REVIEW") bucket.pendingApproval++;
      if (it.source === "HOLIDAY") bucket.hasHoliday = true;
    }

    const totals = {
      planned: filtered.filter((i) => i.source !== "HOLIDAY" && i.source !== "LEAVE").length,
      done: filtered.filter((i) => i.isDone).length,
      overdue: filtered.filter((i) => i.overdue).length,
      pendingApproval: filtered.filter((i) => i.approval === "INTERNAL_REVIEW").length,
      bySource: filtered.reduce<Record<string, number>>((acc, i) => {
        acc[i.source] = (acc[i.source] ?? 0) + 1;
        return acc;
      }, {}),
      byPlatform: filtered.reduce<Record<string, number>>((acc, i) => {
        for (const p of i.platforms) acc[p] = (acc[p] ?? 0) + 1;
        return acc;
      }, {}),
      byClient: filtered.reduce<Record<string, number>>((acc, i) => {
        const k = i.clientId ?? "unassigned";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    };

    return {
      range: { from, to, timeZone: "Asia/Dhaka" },
      items: filtered,
      days,
      totals,
      truncated,
    };
  }

  /**
   * KPI + close-out numbers. Computed with counts (not the feed payload) so a
   * long range never distorts the totals through the item limit.
   */
  async summary(params: FeedParams) {
    const { from, to } = this.resolveRange(params);
    const range = dayRange(from, to);
    const clientWhere = params.clientId ? { clientId: params.clientId } : {};
    const postClientWhere = params.clientId ? { clientId: params.clientId } : {};
    const today = todayKey();

    const [
      tasksDue,
      tasksDone,
      tasksOverdue,
      postsPlanned,
      postsPublished,
      postsMissed,
      postsPendingApproval,
      meetingsPlanned,
      meetingsDone,
      meetingsNoShow,
      flightsLive,
      flightsPlanned,
      spendRows,
    ] = await Promise.all([
      this.prisma.task.count({
        where: {
          dueDate: range,
          archivedAt: null,
          ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
        },
      }),
      this.prisma.task.count({
        where: {
          dueDate: range,
          status: "DONE",
          ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
        },
      }),
      this.prisma.task.count({
        where: {
          dueDate: { lt: dhakaInstant(today) },
          status: { not: "DONE" },
          archivedAt: null,
          ...(params.clientId ? { project: { clientId: params.clientId } } : {}),
        },
      }),
      this.prisma.contentPost.count({
        where: { scheduledAt: range, archivedAt: null, ...postClientWhere },
      }),
      this.prisma.contentPost.count({
        where: { scheduledAt: range, archivedAt: null, publishStatus: "PUBLISHED", ...postClientWhere },
      }),
      this.prisma.contentPost.count({
        where: {
          scheduledAt: { lt: new Date() },
          archivedAt: null,
          publishStatus: { in: ["DRAFT", "SCHEDULED", "MISSED"] },
          ...postClientWhere,
        },
      }),
      this.prisma.contentPost.count({
        where: { scheduledAt: range, archivedAt: null, approvalStatus: "INTERNAL_REVIEW", ...postClientWhere },
      }),
      this.prisma.calendarEvent.count({
        where: {
          date: { gte: from, lte: to },
          type: "MEETING",
          ...(params.clientId ? { clientId: params.clientId } : {}),
        },
      }),
      this.prisma.calendarEvent.count({
        where: {
          date: { gte: from, lte: to },
          type: "MEETING",
          outcome: "DONE",
          ...(params.clientId ? { clientId: params.clientId } : {}),
        },
      }),
      this.prisma.calendarEvent.count({
        where: {
          date: { gte: from, lte: to },
          type: "MEETING",
          outcome: "NO_SHOW",
          ...(params.clientId ? { clientId: params.clientId } : {}),
        },
      }),
      this.prisma.adFlight.count({
        where: {
          startDate: { lte: dateOnly(to) },
          endDate: { gte: dateOnly(from) },
          status: "LIVE",
          ...clientWhere,
        },
      }),
      this.prisma.adFlight.count({
        where: {
          startDate: { lte: dateOnly(to) },
          endDate: { gte: dateOnly(from) },
          ...clientWhere,
        },
      }),
      this.prisma.adInsight.aggregate({
        where: {
          date: { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) },
          ...(params.clientId ? { clientId: params.clientId } : {}),
        },
        _sum: { spend: true },
      }),
    ]);

    const plannedDays = eachDay(from, to);
    const postDays = await this.prisma.contentPost.findMany({
      where: { scheduledAt: range, archivedAt: null, ...postClientWhere },
      select: { scheduledAt: true },
    });
    const covered = new Set(postDays.map((p) => dayKey(p.scheduledAt!)));
    const gaps = plannedDays.filter((d) => !covered.has(d));

    return {
      range: { from, to, timeZone: "Asia/Dhaka" },
      meetings: { planned: meetingsPlanned, done: meetingsDone, noShow: meetingsNoShow },
      tasks: { due: tasksDue, done: tasksDone, open: Math.max(tasksDue - tasksDone, 0), overdue: tasksOverdue },
      posts: {
        planned: postsPlanned,
        published: postsPublished,
        missed: postsMissed,
        pendingApproval: postsPendingApproval,
        coverageDays: covered.size,
        gapDays: gaps.length,
      },
      ads: { live: flightsLive, planned: flightsPlanned, actualSpend: Number(spendRows._sum.spend ?? 0) },
      gaps: gaps.slice(0, 31),
    };
  }

  /** Everything the Day view needs in one call. */
  async day(date: string, params: FeedParams = {}) {
    if (!isDayKey(date)) throw new BadRequestException("date must be YYYY-MM-DD");
    const [feed, summary] = await Promise.all([
      this.feed({ ...params, from: date, to: date, limit: 400 }),
      this.summary({ ...params, from: date, to: date }),
    ]);
    const logs = await this.prisma.dailyLog.findMany({
      where: { date, ...(params.clientId ? { clientId: params.clientId } : {}) },
      include: { author: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { ...feed, summary, logs };
  }

  /**
   * Content coverage check for the plan builder: per platform, how many posts
   * exist vs the client's monthly target, plus days with nothing planned.
   */
  async gaps(params: { from: string; to: string; clientId?: string }) {
    const { from, to } = this.resolveRange(params);
    const range = dayRange(from, to);
    const posts = await this.prisma.contentPost.findMany({
      where: { scheduledAt: range, archivedAt: null, ...(params.clientId ? { clientId: params.clientId } : {}) },
      select: { scheduledAt: true, platforms: true },
    });
    const days = eachDay(from, to);
    const coveredDays = new Set(posts.map((p) => dayKey(p.scheduledAt!)));
    const byPlatform: Record<string, number> = {};
    for (const p of posts) {
      for (const pl of (p.platforms as string[]) ?? []) {
        const k = String(pl).toUpperCase();
        byPlatform[k] = (byPlatform[k] ?? 0) + 1;
      }
    }
    const targets = params.clientId
      ? ((await this.prisma.client.findUnique({ where: { id: params.clientId }, select: { postingTargets: true } }))
          ?.postingTargets as Record<string, number> | null) ?? {}
      : {};
    return {
      range: { from, to },
      daysWithoutContent: days.filter((d) => !coveredDays.has(d)),
      byPlatform,
      targets,
      underTarget: Object.entries(targets)
        .filter(([platform, target]) => (byPlatform[platform] ?? 0) < Number(target))
        .map(([platform, target]) => ({ platform, target: Number(target), planned: byPlatform[platform] ?? 0 })),
    };
  }

  /** Per-assignee load for the week strip. */
  async workload(params: { from: string; to: string }) {
    const { from, to } = this.resolveRange(params);
    const range = dayRange(from, to);
    const [tasks, posts] = await Promise.all([
      this.prisma.task.findMany({
        where: { dueDate: range, archivedAt: null },
        select: { assignedToId: true, status: true, estimatedHours: true },
      }),
      this.prisma.contentPost.findMany({
        where: { scheduledAt: range, archivedAt: null },
        select: { assigneeId: true },
      }),
    ]);
    const map = new Map<string, { employeeId: string; tasks: number; openTasks: number; hours: number; posts: number }>();
    const row = (id: string) =>
      map.get(id) ?? map.set(id, { employeeId: id, tasks: 0, openTasks: 0, hours: 0, posts: 0 }).get(id)!;
    for (const t of tasks) {
      if (!t.assignedToId) continue;
      const r = row(t.assignedToId);
      r.tasks++;
      if (t.status !== "DONE") r.openTasks++;
      r.hours += Number(t.estimatedHours ?? 0);
    }
    for (const p of posts) {
      if (p.assigneeId) row(p.assigneeId).posts++;
    }
    const ids = [...map.keys()];
    const employees = ids.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, roleTitle: true, weeklyCapacityHours: true },
        })
      : [];
    const byId = new Map(employees.map((e) => [e.id, e]));
    return [...map.values()]
      .map((r) => ({
        ...r,
        name: byId.get(r.employeeId)?.name ?? "Unknown",
        roleTitle: byId.get(r.employeeId)?.roleTitle ?? "",
        capacityHours: Number(byId.get(r.employeeId)?.weeklyCapacityHours ?? 40),
      }))
      .sort((a, b) => b.openTasks - a.openTasks);
  }

  // ── internals ────────────────────────────────────────────────────────
  private resolveRange(params: FeedParams): { from: string; to: string } {
    let from = params.from;
    let to = params.to;
    if ((!from || !to) && params.month && /^\d{4}-\d{2}$/.test(params.month)) {
      const [y, m] = params.month.split("-").map(Number);
      from = `${params.month}-01`;
      to = `${params.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    }
    if (!from || !to) {
      from = `${todayKey().slice(0, 7)}-01`;
      to = addDays(addDays(from, 32).slice(0, 8) + "01", -1);
    }
    if (!isDayKey(from) || !isDayKey(to)) throw new BadRequestException("from/to must be YYYY-MM-DD");
    if (from > to) [from, to] = [to, from];
    const span = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
    if (span > 400) throw new BadRequestException("Range is too large (max 400 days)");
    return { from, to };
  }

  private resolveSources(raw?: string): CalendarSource[] {
    if (!raw) return DEFAULT_SOURCES;
    const list = raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as CalendarSource[];
    const allowed: CalendarSource[] = [
      "TASK",
      "CONTENT_POST",
      "EVENT",
      "MILESTONE",
      "DELIVERABLE",
      "AD_FLIGHT",
      "INVOICE",
      "LEAVE",
      "HOLIDAY",
    ];
    const clean = list.filter((s) => allowed.includes(s));
    return clean.length ? clean : DEFAULT_SOURCES;
  }

  private empty(from: string, to: string) {
    const days: Record<string, any> = {};
    for (const d of eachDay(from, to)) days[d] = { counts: {}, done: 0, overdue: 0, pendingApproval: 0 };
    return {
      range: { from, to, timeZone: "Asia/Dhaka" },
      items: [] as CalendarItem[],
      days,
      totals: { planned: 0, done: 0, overdue: 0, pendingApproval: 0, bySource: {}, byPlatform: {}, byClient: {} },
      truncated: false,
    };
  }
}
