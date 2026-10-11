import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { Priority, TaskStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { WhatsappTriggersService } from "../whatsapp/whatsapp-triggers.service";

const STATUS_ORDER: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"];

const RECURRENCE_OFFSETS: Record<string, (d: Date) => Date> = {
  daily: (d) => { const x = new Date(d); x.setDate(x.getDate() + 1); return x; },
  weekly: (d) => { const x = new Date(d); x.setDate(x.getDate() + 7); return x; },
  monthly: (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 1); return x; },
  quarterly: (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 3); return x; },
  yearly: (d) => { const x = new Date(d); x.setFullYear(x.getFullYear() + 1); return x; },
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
    private readonly wa: WhatsappTriggersService
  ) {}

  // ── Permission helpers (enterprise field-level) ──────────────────────────
  private isAdmin(role?: string) {
    return role === "Owner" || role === "HR/Admin" || role === "Admin";
  }
  private isPM(role?: string) {
    return role === "Owner" || role === "Project Manager" || role === "Admin" || role === "HR/Admin";
  }
  private async getEmployeeIdByUserId(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
    return (u as any)?.employeeId ?? null;
  }
  private async canViewTask(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (!user?.sub) return false; // unauthenticated handled by guard, but safe
    if (this.isAdmin(user.role) || this.isPM(user.role)) return true;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    if (!empId) return false;
    if (task.assignedToId === empId || task.reporterId === empId) return true;
    // also check assignees JSON array
    const assignees = (task.assignees ?? []) as any[];
    if (assignees.some((a: any) => a.id === empId)) return true;
    return false;
  }
  private async canEditFull(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (!user?.sub) return false;
    if (this.isAdmin(user.role) || this.isPM(user.role)) return true;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    if (!empId) return false;
    if (task.reporterId === empId) return true; // creator (reporter) owns task
    return false;
  }
  private async canEditProgress(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (await this.canEditFull(task, user)) return true;
    if (!user?.sub) return false;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    if (!empId) return false;
    if (task.assignedToId === empId) return true;
    const assignees = (task.assignees ?? []) as any[];
    if (assignees.some((a: any) => a.id === empId)) return true;
    return false;
  }

  async stats() {
    return this.cache.wrap("tasks:stats", 30, async () => {
      const [tasks, timeLogs] = await Promise.all([
        this.prisma.task.findMany({ select: { id: true, status: true, dueDate: true, priority: true, archivedAt: true } }),
        this.prisma.timeLog.findMany({ select: { hours: true, date: true } }),
      ]);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const open = tasks.filter((t) => t.status !== "DONE" && !t.archivedAt);
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const hoursThisWeek = timeLogs.filter((l) => l.date >= weekStart).reduce((s, l) => s + Number(l.hours), 0);
      return {
        total: tasks.length,
        open: open.length,
        dueToday: open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < new Date(today.getTime() + 86400000)).length,
        overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
        blocked: tasks.filter((t) => t.status === "BLOCKED").length,
        inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
        review: tasks.filter((t) => t.status === "REVIEW").length,
        done: tasks.filter((t) => t.status === "DONE").length,
        highPriority: tasks.filter((t) => t.priority === "URGENT" || t.priority === "HIGH").length,
        hoursThisWeek: Math.round(hoursThisWeek * 10) / 10,
      };
    });
  }

  private async invalidateTasks() {
    await this.cache.del("tasks:stats");
    await this.cache.delPattern("tasks:list:*");
    await this.cache.del("flow:overview");
    await this.cache.del("dashboard:overview");
  }

  async myDay(employeeId?: string) {
    const tasks = await this.prisma.task.findMany({
      where: { status: { not: "DONE" }, archivedAt: null, ...(employeeId ? { assignedToId: employeeId } : {}) },
      include: { project: { select: { id: true, name: true, healthStatus: true, riskScore: true } } },
      orderBy: [{ dueDate: "asc" }],
      take: 15,
    });
    const score = (t: any) =>
      (t.dueDate ? Math.max(0, 5 - Math.floor((t.dueDate.getTime() - Date.now()) / 86400000)) : 0) +
      (t.priority === "URGENT" ? 5 : t.priority === "HIGH" ? 3 : t.priority === "MEDIUM" ? 1 : 0) +
      (t.project?.healthStatus === "AT_RISK" ? 2 : t.project?.healthStatus === "DELAYED" ? 3 : 0) +
      (t.status === "BLOCKED" ? -2 : t.status === "REVIEW" ? 1 : 0);
    return tasks.map((t) => ({ ...t, priorityScore: score(t) })).sort((a, b) => b.priorityScore - a.priorityScore);
  }

  async list(query: { status?: string; priority?: string; taskType?: string; assignee?: string; projectId?: string; q?: string; parent?: string; mine?: boolean; sort?: string; archived?: string; employeeId?: string }) {
    return this.cache.wrapQuery("tasks:list", query, 30, async () => {
      const sort = query.sort ?? "due";
    const orderBy: any =
      sort === "priority" ? [{ priority: "desc" }, { dueDate: "asc" }]
        : sort === "title" ? { title: "asc" }
          : sort === "created" ? { createdAt: "desc" }
            : sort === "status" ? [{ status: "asc" }, { dueDate: "asc" }]
              : [{ dueDate: "asc" }, { priority: "desc" }];
    const [tasks, childCounts] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          ...(query.archived === "true" ? {} : { archivedAt: null }),
          ...(query.status ? { status: query.status as TaskStatus } : {}),
          ...(query.priority ? { priority: query.priority as Priority } : {}),
          ...(query.taskType ? { taskType: query.taskType } : {}),
          ...(query.assignee ? { assignedToId: query.assignee } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.parent ? { parentTaskId: query.parent } : { parentTaskId: null }),
          ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { tags: { has: query.q } }] } : {}),
          ...(query.mine && query.employeeId ? { assignedToId: query.employeeId } : {}),
        },
        include: {
          project: { select: { id: true, name: true, healthStatus: true } },
          assignedTo: { select: { id: true, name: true } },
          reporter: { select: { id: true, name: true } },
          _count: { select: { timeLogs: true, comments: true } },
        },
        orderBy,
      }),
      this.prisma.task.groupBy({ by: ["parentTaskId"], where: { parentTaskId: { not: null } }, _count: { _all: true } }),
    ]);
    const counts = new Map(childCounts.map((c) => [c.parentTaskId!, c._count._all]));
    return tasks.map((t) => ({ ...t, subtaskCount: counts.get(t.id) ?? 0 }));
    });
  }

  async detail(id: string, user?: any) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, client: { select: { id: true, companyName: true } } } },
        assignedTo: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        timeLogs: { include: { employee: { select: { id: true, name: true } } }, orderBy: { date: "desc" } },
        comments: {
          include: { author: { select: { id: true, name: true } }, replies: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } } },
          orderBy: { createdAt: "asc" },
        },
        dependencies: { include: { dependsOnTask: { select: { id: true, title: true, status: true } } } },
        dependents: { include: { task: { select: { id: true, title: true, status: true } } } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(task, user))) {
      throw new ForbiddenException("You don't have permission to view this task");
    }
    const subtasks = await this.prisma.task.findMany({
      where: { parentTaskId: id },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    // also compute permissions for frontend
    const canEditFull = user ? await this.canEditFull(task, user) : false;
    const canEditProgress = user ? await this.canEditProgress(task, user) : false;
    const canView = user ? await this.canViewTask(task, user) : true;
    return { ...task, subtasks, _permissions: { canView, canEditFull, canEditProgress } };
  }

  async create(body: {
    title: string;
    description?: string;
    projectId?: string;
    assignedToId?: string;
    reporterId?: string;
    priority?: Priority;
    dueDate?: string;
    startDate?: string;
    taskType?: string;
    estimatedHours?: number;
    isClientVisible?: boolean;
    parentTaskId?: string;
    status?: TaskStatus;
    tags?: string[];
    referenceLinks?: any[];
    attachments?: any[];
    assignees?: any[];
    customFields?: any[];
    isBlocked?: boolean;
    isRecurring?: boolean;
    recurrenceSchedule?: string;
    createdById?: string;
    createdByName?: string;
  }) {
    const status = body.status ?? "TODO";
    let sortOrder = 0;
    if (body.parentTaskId) {
      const siblings = await this.prisma.task.findMany({ where: { parentTaskId: body.parentTaskId }, select: { sortOrder: true } });
      sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
    }
    // enterprise: auto-set reporter to creator's employee if not provided
    let reporterId = body.reporterId as string | undefined;
    if (!reporterId && body.createdById) {
      reporterId = (await this.getEmployeeIdByUserId(body.createdById)) ?? undefined;
    }
    const activityLog = [
      {
        action: "created",
        field: "task",
        from: null,
        to: status,
        at: new Date().toISOString(),
        by: body.createdByName ?? "System",
      },
    ];
    const task = await this.prisma.task.create({
      data: {
        title: body.title,
        description: body.description,
        projectId: body.projectId,
        assignedToId: body.assignedToId,
        reporterId: reporterId as string | undefined,
        priority: body.priority ?? "MEDIUM",
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        taskType: body.taskType ?? "general",
        estimatedHours: body.estimatedHours ?? undefined,
        isClientVisible: body.isClientVisible ?? false,
        parentTaskId: body.parentTaskId,
        sortOrder,
        status,
        tags: body.tags ?? [],
        referenceLinks: body.referenceLinks ?? [],
        attachments: body.attachments ?? [],
        assignees: body.assignees ?? [],
        customFields: body.customFields ?? [],
        isBlocked: body.isBlocked ?? false,
        isRecurring: body.isRecurring ?? false,
        recurrenceSchedule: body.recurrenceSchedule,
        activityLog,
      },
    });
    await this.notifyAssignee(body.assignedToId, task.id, task.title);
    void this.wa.notifyTaskAssigned(task.id).catch(() => {});
    await this.invalidateTasks();
    return task;
  }

  async update(id: string, body: any, actor?: any) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Task not found");
    const actorName = actor?.name ?? actor ?? "System";
    const actorUser = typeof actor === "object" && actor?.sub ? actor : { sub: actor, role: undefined, name: actorName };
    const canFull = await this.canEditFull(existing, actorUser);
    const canProgress = await this.canEditProgress(existing, actorUser);
    if (!canFull && !canProgress) throw new ForbiddenException("You don't have permission to edit this task");
    if (!canFull && canProgress) {
      const allowed = ["status"];
      const keys = Object.keys(body).filter((k) => body[k] !== undefined);
      const disallowed = keys.filter((k) => !allowed.includes(k));
      if (disallowed.length) throw new ForbiddenException(`Assignee can only edit: ${allowed.join(", ")} (tried: ${disallowed.join(", ")})`);
    }

    const data: any = {};
    const log: any[] = [];
    const push = (field: string, from: any, to: any) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        log.push({ action: "updated", field, from: from ?? null, to: to ?? null, at: new Date().toISOString(), by: actorName ?? "System" });
      }
    };
    if (body.title !== undefined) push("title", existing.title, body.title), (data.title = body.title);
    if (body.description !== undefined) push("description", existing.description, body.description), (data.description = body.description);
    if (body.status !== undefined) push("status", existing.status, body.status), (data.status = body.status);
    if (body.priority !== undefined) push("priority", existing.priority, body.priority), (data.priority = body.priority);
    if (body.taskType !== undefined) push("taskType", existing.taskType, body.taskType), (data.taskType = body.taskType);
    if (body.assignedToId !== undefined) push("assignee", existing.assignedToId, body.assignedToId), (data.assignedToId = body.assignedToId);
    if (body.reporterId !== undefined) push("reporter", existing.reporterId, body.reporterId), (data.reporterId = body.reporterId);
    if (body.dueDate !== undefined) push("dueDate", existing.dueDate?.toISOString().slice(0, 10), body.dueDate), (data.dueDate = body.dueDate ? new Date(body.dueDate) : null);
    if (body.startDate !== undefined) push("startDate", existing.startDate?.toISOString().slice(0, 10), body.startDate), (data.startDate = body.startDate ? new Date(body.startDate) : null);
    if (body.estimatedHours !== undefined) push("estimatedHours", existing.estimatedHours ? Number(existing.estimatedHours) : null, body.estimatedHours), (data.estimatedHours = body.estimatedHours ?? null);
    if (body.isClientVisible !== undefined) push("isClientVisible", existing.isClientVisible, body.isClientVisible), (data.isClientVisible = body.isClientVisible);
    if (body.isBlocked !== undefined) push("isBlocked", existing.isBlocked, body.isBlocked), (data.isBlocked = body.isBlocked);
    if (body.projectId !== undefined) push("project", existing.projectId, body.projectId), (data.projectId = body.projectId);
    if (body.parentTaskId !== undefined) data.parentTaskId = body.parentTaskId;
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.referenceLinks !== undefined) data.referenceLinks = body.referenceLinks;
    if (body.attachments !== undefined) data.attachments = body.attachments;
    if (body.assignees !== undefined) data.assignees = body.assignees;
    if (body.customFields !== undefined) data.customFields = body.customFields;
    if (body.isRecurring !== undefined) data.isRecurring = body.isRecurring;
    if (body.recurrenceSchedule !== undefined) data.recurrenceSchedule = body.recurrenceSchedule;
    if (body.archivedAt !== undefined) push("archived", existing.archivedAt ?? null, body.archivedAt), (data.archivedAt = body.archivedAt ? new Date() : null);

    const currentLog = (existing.activityLog ?? []) as any[];
    data.activityLog = [...log.reverse(), ...currentLog].slice(0, 100);

    const updated = await this.prisma.task.update({ where: { id }, data });
    if (body.assignedToId && body.assignedToId !== existing.assignedToId) {
      await this.notifyAssignee(body.assignedToId, id, updated.title);
      void this.wa.notifyTaskAssigned(id).catch(() => {});
    }
    await this.applyAutomation({
      type: "status", taskId: id, title: updated.title, prev: existing.status, next: updated.status, actorName,
    });
    await this.applyAutomation({
      type: "priority", taskId: id, title: updated.title, prev: existing.priority, next: updated.priority, actorName,
    });
    await this.applyAutomation({
      type: "assignee", taskId: id, title: updated.title, prev: existing.assignedToId, next: updated.assignedToId, actorName,
    });
    if (body.status === "DONE" && existing.status !== "DONE") void this.wa.notifyTaskClientUpdate(id).catch(() => {});
    await this.invalidateTasks();
    return updated;
  }

  async remove(id: string, user?: any) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditFull(existing, user))) throw new ForbiddenException("Only creator/PM/Admin can delete task");
    await this.prisma.task.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Task not found");
    });
    await this.invalidateTasks();
    return { ok: true };
  }

  async clone(id: string, user?: any) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(t, user))) throw new ForbiddenException("You don't have permission to clone this task");
    const cloned = await this.prisma.task.create({
      data: {
        title: `${t.title} (Copy)`,
        description: t.description,
        projectId: t.projectId,
        assignedToId: t.assignedToId,
        reporterId: t.reporterId,
        priority: t.priority,
        dueDate: t.dueDate,
        startDate: t.startDate,
        taskType: t.taskType,
        estimatedHours: t.estimatedHours,
        isClientVisible: t.isClientVisible,
        status: "TODO",
        tags: t.tags,
        referenceLinks: (t.referenceLinks as any) ?? [],
        attachments: (t.attachments as any) ?? [],
        assignees: (t.assignees as any) ?? [],
        customFields: (t.customFields as any) ?? [],
        isBlocked: false,
        isRecurring: t.isRecurring,
        recurrenceSchedule: t.recurrenceSchedule,
        activityLog: [],
      },
    });
    await this.invalidateTasks();
    return cloned;
  }

  async updateStatus(id: string, status: TaskStatus, actor?: any) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Task not found");
    const actorName = actor?.name ?? actor ?? "System";
    const actorUser = typeof actor === "object" && actor?.sub ? actor : { sub: actor, name: actorName };
    if (!(await this.canEditProgress(existing, actorUser))) throw new ForbiddenException("You don't have permission to change status");
    const t = await this.prisma.task.update({
      where: { id },
      data: {
        status,
        activityLog: [
          { action: "updated", field: "status", from: null, to: status, at: new Date().toISOString(), by: actorName ?? "System" },
          ...(((existing.activityLog ?? []) as any[])),
        ].slice(0, 100),
      },
    });
    await this.applyAutomation({ type: "status", taskId: t.id, title: t.title, prev: existing.status, next: status, actorName });
    if (status === "DONE") void this.wa.notifyTaskClientUpdate(t.id).catch(() => {});
    if (status === "DONE" && t.isRecurring && t.recurrenceSchedule && RECURRENCE_OFFSETS[t.recurrenceSchedule]) {
      const nextDue = RECURRENCE_OFFSETS[t.recurrenceSchedule](t.dueDate ?? new Date());
      await this.prisma.task.create({
        data: {
          title: t.title,
          description: t.description,
          projectId: t.projectId,
          assignedToId: t.assignedToId,
          reporterId: t.reporterId,
          priority: t.priority,
          dueDate: nextDue,
          startDate: t.startDate,
          taskType: t.taskType,
          estimatedHours: t.estimatedHours,
          tags: t.tags,
          referenceLinks: (t.referenceLinks as any) ?? [],
          attachments: (t.attachments as any) ?? [],
          assignees: (t.assignees as any) ?? [],
          customFields: (t.customFields as any) ?? [],
          isClientVisible: t.isClientVisible,
          isRecurring: true,
          recurrenceSchedule: t.recurrenceSchedule,
          activityLog: [
            { action: "created", field: "task", from: null, to: "TODO", at: new Date().toISOString(), by: "Recurring schedule" },
            { action: "updated", field: "note", from: null, to: `Next occurrence of recurring task after "${t.title}" was completed`, at: new Date().toISOString(), by: "Recurring schedule" },
          ],
        },
      });
    }
    await this.invalidateTasks();
    return t;
  }

  // ── Comments ─────────────────────────────────────────────────────────
  async addComment(taskId: string, body: { content: string; authorId?: string; parentId?: string; mentionedUserIds?: string[] }, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(task, user)) && !(await this.canEditProgress(task, user))) {
      throw new ForbiddenException("You don't have permission to comment on this task");
    }
    return this.prisma.taskComment.create({
      data: {
        taskId,
        content: body.content,
        authorId: body.authorId,
        parentId: body.parentId,
        mentionedUserIds: body.mentionedUserIds ?? [],
      },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async toggleReaction(taskId: string, commentId: string, body: { emoji: string; userId: string }) {
    const c = await this.prisma.taskComment.findFirst({ where: { id: commentId, taskId } });
    if (!c) throw new NotFoundException("Comment not found");
    const reactions = ((c.reactions ?? []) as any[]);
    const existing = reactions.find((r) => r.emoji === body.emoji);
    let next: any[];
    if (existing) {
      const has = (existing.userIds ?? []).includes(body.userId);
      next = reactions
        .map((r) => (r.emoji === body.emoji ? { ...r, userIds: has ? r.userIds.filter((u: string) => u !== body.userId) : [...r.userIds, body.userId] } : r))
        .filter((r) => r.userIds.length > 0);
    } else {
      next = [...reactions, { emoji: body.emoji, userIds: [body.userId] }];
    }
    return this.prisma.taskComment.update({
      where: { id: commentId },
      data: { reactions: next },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async deleteComment(taskId: string, commentId: string) {
    await this.prisma.taskComment.deleteMany({ where: { id: commentId, taskId } });
    return { ok: true };
  }

  // ── Dependencies ─────────────────────────────────────────────────────
  async addDependency(taskId: string, dependsOnTaskId: string, type = "blocked-by") {
    if (taskId === dependsOnTaskId) throw new Error("Cannot depend on itself");
    return this.prisma.taskDependency.upsert({
      where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
      create: { taskId, dependsOnTaskId, type },
      update: { type },
    });
  }

  async removeDependency(taskId: string, dependsOnTaskId: string) {
    await this.prisma.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId } });
    return { ok: true };
  }

  // ── Time logs ────────────────────────────────────────────────────────
  private async recomputeActualHours(taskId: string) {
    const agg = await this.prisma.timeLog.aggregate({ where: { taskId }, _sum: { hours: true } });
    await this.prisma.task.update({ where: { id: taskId }, data: { actualHours: agg._sum.hours ?? 0 } });
  }

  async logTime(taskId: string, body: { hours: number; date?: string; notes?: string; employeeId?: string; loggedVia?: "MANUAL" | "TIMER"; isBillable?: boolean }, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to log time on this task");
    const log = await this.prisma.timeLog.create({
      data: {
        taskId,
        employeeId: body.employeeId,
        hours: body.hours,
        date: body.date ? new Date(body.date) : new Date(),
        notes: body.notes,
        loggedVia: body.loggedVia ?? "MANUAL",
        isBillable: body.isBillable ?? true,
      },
    });
    await this.recomputeActualHours(taskId);
    await this.invalidateTasks();
    return log;
  }

  async removeTimeLog(taskId: string, logId: string, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user)) && !(await this.canEditFull(task, user))) throw new ForbiddenException("You don't have permission to remove time log");
    await this.prisma.timeLog.deleteMany({ where: { id: logId, taskId } });
    await this.recomputeActualHours(taskId);
    await this.invalidateTasks();
    return { ok: true };
  }

  // ── Templates ────────────────────────────────────────────────────────
  async listTemplates() {
    return this.prisma.taskTemplate.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createTemplate(body: { name: string; description?: string; category?: string; benchmarkDurationDays?: number; benchmarkHours?: number; defaultTasks: any[] }) {
    return this.prisma.taskTemplate.create({
      data: {
        name: body.name,
        description: body.description,
        category: body.category,
        benchmarkDurationDays: body.benchmarkDurationDays,
        benchmarkHours: body.benchmarkHours,
        defaultTasks: body.defaultTasks,
      },
    });
  }

  async deleteTemplate(id: string) {
    await this.prisma.taskTemplate.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Template not found");
    });
    return { ok: true };
  }

  async useTemplate(id: string, body: { projectId?: string; assigneeId?: string; createdById?: string; createdByName?: string }) {
    const tpl = await this.prisma.taskTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException("Template not found");
    const tasks = (tpl.defaultTasks as any[]) ?? [];
    const created = [];
    for (const t of tasks) {
      const task = await this.prisma.task.create({
        data: {
          title: t.title,
          description: t.description,
          projectId: body.projectId,
          assignedToId: body.assigneeId,
          priority: t.priority ?? "MEDIUM",
          status: "TODO",
          estimatedHours: t.estimatedHours,
          dueDate: new Date(Date.now() + 7 * 86400000),
          tags: t.tags ?? [],
          referenceLinks: t.referenceLinks ?? [],
          isClientVisible: t.isClientVisible ?? false,
          taskType: t.taskType ?? "general",
          activityLog: [
            { action: "created", field: "task", from: null, to: "TODO", at: new Date().toISOString(), by: body.createdByName ?? "System" },
            { action: "updated", field: "note", from: null, to: `Created from template "${tpl.name}"`, at: new Date().toISOString(), by: body.createdByName ?? "System" },
          ],
        },
      });
      created.push(task);
      if (t.subtasks?.length) {
        for (const st of t.subtasks) {
          await this.prisma.task.create({
            data: {
              title: st.title,
              parentTaskId: task.id,
              projectId: body.projectId,
              status: "TODO",
              priority: st.priority ?? "MEDIUM",
              assignedToId: body.assigneeId,
              taskType: st.taskType ?? "general",
            },
          });
        }
      }
    }
    await this.invalidateTasks();
    return created;
  }

  // ── Automation rules ─────────────────────────────────────────────────
  async listAutomation() {
    return this.prisma.automationRule.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createAutomation(body: { name: string; trigger: string; action: string; config: any; enabled?: boolean }) {
    return this.prisma.automationRule.create({
      data: {
        name: body.name,
        trigger: body.trigger,
        action: body.action,
        config: body.config ?? {},
        enabled: body.enabled ?? true,
      },
    });
  }

  async updateAutomation(id: string, body: any) {
    return this.prisma.automationRule.update({ where: { id }, data: body }).catch(() => {
      throw new NotFoundException("Rule not found");
    });
  }

  async deleteAutomation(id: string) {
    await this.prisma.automationRule.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Rule not found");
    });
    return { ok: true };
  }

  private async applyAutomation(event: { type: "status" | "priority" | "assignee"; taskId: string; title: string; prev: any; next: any; actorName?: string }) {
    if (JSON.stringify(event.prev) === JSON.stringify(event.next)) return;
    const rules = await this.prisma.automationRule.findMany({ where: { enabled: true } });
    for (const rule of rules) {
      const cfg = (rule.config ?? {}) as any;
      const matches =
        rule.trigger === "status-changed" && event.type === "status"
          ? (!cfg.fromStatus || cfg.fromStatus === event.prev) && (!cfg.toStatus || cfg.toStatus === event.next)
          : rule.trigger === "priority-changed" && event.type === "priority"
            ? (!cfg.fromPriority || cfg.fromPriority === event.prev) && (!cfg.toPriority || cfg.toPriority === event.next)
            : rule.trigger === "assigned" && event.type === "assignee"
              ? (!cfg.assigneeId || cfg.assigneeId === event.next)
              : false;
      if (!matches) continue;
      const task = await this.prisma.task.findUnique({ where: { id: event.taskId } });
      if (!task) continue;
      switch (rule.action) {
        case "assign-to":
          if (cfg.assignToId) {
            await this.prisma.task.update({ where: { id: event.taskId }, data: { assignedToId: cfg.assignToId } });
            await this.notifyAssignee(cfg.assignToId, event.taskId, event.title);
          }
          break;
        case "set-priority":
          if (cfg.priority) await this.prisma.task.update({ where: { id: event.taskId }, data: { priority: cfg.priority } });
          break;
        case "change-status":
          if (cfg.toStatus) await this.prisma.task.update({ where: { id: event.taskId }, data: { status: cfg.toStatus } });
          break;
        case "change-priority":
          if (cfg.toPriority) await this.prisma.task.update({ where: { id: event.taskId }, data: { priority: cfg.toPriority } });
          break;
        case "notify":
          await this.notifyAssignee(task.assignedToId, event.taskId, event.title);
          break;
        case "create-task":
          {
            const due = new Date();
            due.setDate(due.getDate() + (cfg.dueOffsetDays ?? 0));
            await this.prisma.task.create({
              data: {
                title: cfg.title ?? `Follow-up: ${event.title}`,
                projectId: task.projectId,
                assignedToId: cfg.assignToId ?? task.assignedToId,
                priority: cfg.priority ?? task.priority,
                dueDate: due,
                taskType: cfg.taskType ?? "general",
                activityLog: [
                  { action: "created", field: "task", from: null, to: "TODO", at: new Date().toISOString(), by: `Automation "${rule.name}"` },
                  { action: "updated", field: "note", from: null, to: `Auto-created by rule "${rule.name}"`, at: new Date().toISOString(), by: `Automation "${rule.name}"` },
                ],
              },
            });
          }
          break;
        case "archive":
          await this.prisma.task.update({ where: { id: event.taskId }, data: { archivedAt: new Date() } });
          break;
      }
    }
  }

  private async notifyAssignee(employeeId: string | null | undefined, taskId: string, title: string) {
    if (!employeeId) return;
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: { select: { id: true } } },
    });
    if (emp?.user) {
      await this.notifications.create(
        emp.user.id,
        "task_assigned",
        "New Task Assigned",
        `"${title}" has been assigned to you.`,
        `/tasks`
      );
    }
  }

  // ── Workload ─────────────────────────────────────────────────────────
  async workload() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, name: true, roleTitle: true, department: true },
    });
    const openTasks = await this.prisma.task.findMany({
      where: { status: { notIn: ["DONE"] }, archivedAt: null },
      select: { assignedToId: true, estimatedHours: true, dueDate: true, priority: true, title: true },
    });
    const now = Date.now();
    const rows = employees.map((e) => {
      const tasks = openTasks.filter((t) => t.assignedToId === e.id);
      const allocated = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);
      const capacity = 40; // weekly capacity in hours
      return {
        ...e,
        taskCount: tasks.length,
        allocated,
        utilization: Math.min(1, allocated / capacity),
        overbooked: allocated > capacity,
        urgent: tasks.filter((t) => t.priority === "URGENT").length,
        overdue: tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now).length,
        tasks: tasks.map((t) => ({ title: t.title, hours: Number(t.estimatedHours ?? 0), priority: t.priority, due: t.dueDate })),
      };
    });
    const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
    return {
      rows,
      totalAllocated,
      teamUtilization: rows.length ? Math.round((rows.reduce((s, r) => s + r.utilization, 0) / rows.length) * 100) : 0,
      overbookedCount: rows.filter((r) => r.overbooked).length,
    };
  }
}