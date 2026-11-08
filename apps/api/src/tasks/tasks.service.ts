import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { Priority, TaskStatus } from "@prisma/client";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { WhatsappTriggersService } from "../whatsapp/whatsapp-triggers.service";
import { ScoringService } from "../scoring/scoring.service";
import { normalizeTaskStatus } from "./task-status";
import { recomputeProjectStats } from "../common/project-stats";

/**
 * Folds legacy/loose status strings onto the real enum. Old saved views and
 * bookmarks still carry `BACKLOG` / `IN_REVIEW`, which used to reach Prisma and
 * throw a validation error; now they simply mean TODO / REVIEW.
 */
function toTaskStatus(value?: string | null): TaskStatus | null {
  if (!value) return null;
  return normalizeTaskStatus(value) as TaskStatus;
}

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
    private readonly wa: WhatsappTriggersService,
    private readonly scoring: ScoringService
  ) {}

  /**
   * Task moves change the project's quality/schedule factors, so rescore the
   * project (and its client) after the write. Never allowed to fail the edit.
   */
  private async rescoreProject(projectId?: string | null) {
    if (!projectId) return;
    // Derived counters (progress / spend) share a source with the board and the
    // portal, so refresh them in the same pass as the health score.
    await recomputeProjectStats(this.prisma, projectId).catch(() => {});
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { clientId: true },
      });
      await this.scoring.recomputeProject(projectId);
      if (project?.clientId) await this.scoring.recomputeClient(project.clientId);
    } catch {
      /* scoring must never fail a task write */
    }
  }

  // ── Permission helpers (enterprise field-level) ──────────────────────────
  //
  // Three levels, from narrowest to widest:
  //   canViewTask      — see the task at all
  //   canWorkOnTask    — assignee-side actions: status, checklist, timer, comments
  //   canEditFull      — change content: title, description, project, assignee...
  //
  // The assignee deliberately does NOT get canEditFull: once someone hands you
  // a task you execute it, you do not rewrite its brief. Only the assigner
  // (reporter) and PM/Admin can change what the task says.
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

  /**
   * Departments can restrict which task types their people may file
   * (`Settings.departmentTaskTypes`, edited at /tasks/setup).
   *
   * Assigned task  → must match that employee's department rule.
   * Unassigned     → no department exists yet, so the type must be allowed by
   *                  *at least one* department. Otherwise the task could never
   *                  be handed to anybody, which is a mistake worth catching at
   *                  creation instead of at assignment time.
   *
   * No rules configured at all means "everything allowed", so an unconfigured
   * install behaves exactly as before.
   */
  private async assertTaskTypeAllowed(assignedToId?: string | null, taskType?: string | null) {
    const settings = await this.prisma.settings
      .findUnique({ where: { id: "default" }, select: { departmentTaskTypes: true } })
      .catch(() => null);
    const rules = ((settings?.departmentTaskTypes as any[]) ?? []).filter(
      (r) => Array.isArray(r?.taskTypes) && r.taskTypes.length > 0
    );
    if (!rules.length) return;
    const wanted = String(taskType ?? "general").toLowerCase();
    const allows = (types: string[]) => types.map((t) => String(t).toLowerCase()).includes(wanted);

    if (!assignedToId) {
      if (rules.some((r: any) => allows(r.taskTypes))) return;
      const union = [...new Set(rules.flatMap((r: any) => r.taskTypes.map((t: string) => String(t).toLowerCase())))];
      throw new BadRequestException(
        `No department allows the "${wanted}" task type — permitted anywhere: ${union.join(", ")}`
      );
    }

    const emp = await this.prisma.employee.findUnique({
      where: { id: assignedToId },
      select: { department: true, name: true },
    });
    if (!emp?.department) return;
    const rule = rules.find((r: any) => String(r.department).toLowerCase() === emp.department!.toLowerCase());
    if (!rule) return;
    if (!allows(rule.taskTypes)) {
      throw new BadRequestException(
        `${emp.name}'s department (${emp.department}) only allows: ${rule.taskTypes.join(", ")} — "${wanted}" is not permitted`
      );
    }
  }
  private isAssignee(task: any, empId: string | null) {
    if (!empId) return false;
    if (task.assignedToId === empId) return true;
    const assignees = (task.assignees ?? []) as any[];
    return assignees.some((a: any) => a.id === empId);
  }
  private async canViewTask(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (!user?.sub) return false; // unauthenticated handled by guard, but safe
    if (this.isAdmin(user.role) || this.isPM(user.role)) return true;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    if (!empId) return false;
    if (this.isAssignee(task, empId)) return true;
    if (task.reporterId === empId || task.assignedById === empId) return true;
    return false;
  }
  /** Content edits (title/description/project/assignee/dates/links). */
  private async canEditFull(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (!user?.sub) return false;
    if (this.isAdmin(user.role) || this.isPM(user.role)) return true;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    if (!empId) return false;
    // the person who raised it, and the person who assigned it, own the brief
    return task.reporterId === empId || task.assignedById === empId;
  }
  /**
   * Assignee-side actions. An assignee may drive their own work forward
   * (status, checklist, timer, time logs) but may not rewrite the brief.
   */
  private async canWorkOnTask(task: any, user?: { sub?: string; role?: string }): Promise<boolean> {
    if (await this.canEditFull(task, user)) return true;
    if (!user?.sub) return false;
    const empId = await this.getEmployeeIdByUserId(user.sub);
    return this.isAssignee(task, empId);
  }
  /** @deprecated alias — kept so existing call sites read clearly as "progress" */
  private canEditProgress(task: any, user?: { sub?: string; role?: string }) {
    return this.canWorkOnTask(task, user);
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

  /** Resolve employee id for a user id (assignee checks are employee-based). */
  private async empId(userId?: string): Promise<string | null> {
    return this.getEmployeeIdByUserId(userId);
  }

  // ── Checklist (lightweight sub-items) ─────────────────────────────────
  async listChecklist(taskId: string) {
    return this.prisma.taskChecklistItem.findMany({
      where: { taskId },
      include: { doneBy: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async addChecklistItem(taskId: string, body: { content: string }, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to edit this task");
    const last = await this.prisma.taskChecklistItem.findFirst({ where: { taskId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    return this.prisma.taskChecklistItem.create({
      data: { taskId, content: body.content, sortOrder: (last?.sortOrder ?? -1) + 1 },
      include: { doneBy: { select: { id: true, name: true } } },
    });
  }

  async updateChecklistItem(taskId: string, itemId: string, body: { content?: string; done?: boolean }, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to edit this task");
    const existing = await this.prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
    if (!existing) throw new NotFoundException("Checklist item not found");
    const data: any = {};
    if (body.content !== undefined) data.content = body.content;
    if (body.done !== undefined) {
      data.done = body.done;
      // stamp who/when for done transitions (cleared on un-done)
      const empId = body.done ? await this.empId(user?.sub) : null;
      data.doneById = body.done ? empId : null;
      data.doneAt = body.done ? new Date() : null;
    }
    return this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data,
      include: { doneBy: { select: { id: true, name: true } } },
    });
  }

  async removeChecklistItem(taskId: string, itemId: string, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to edit this task");
    await this.prisma.taskChecklistItem.deleteMany({ where: { id: itemId, taskId } });
    return { ok: true };
  }

  async reorderChecklist(taskId: string, ids: string[], user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to edit this task");
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.taskChecklistItem.updateMany({ where: { id, taskId }, data: { sortOrder: i } }))
    );
    return this.listChecklist(taskId);
  }

  // ── Timer (one running timer per employee) ────────────────────────────
  async runningTimer(user: any) {
    const empId = await this.empId(user?.sub);
    if (!empId) return null;
    return this.prisma.taskTimer.findFirst({
      where: { employeeId: empId, stoppedAt: null },
      include: { task: { select: { id: true, title: true, projectId: true } } },
      orderBy: { startedAt: "desc" },
    });
  }

  async startTimer(taskId: string, body: { notes?: string }, user: any, allowAutoStop = true) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (!(await this.canEditProgress(task, user))) throw new ForbiddenException("You don't have permission to log time on this task");
    const empId = await this.empId(user?.sub);
    if (!empId) throw new BadRequestException("No employee profile linked to your user");

    // auto-stop any other running timer so hours aren't double-counted
    const running = await this.prisma.taskTimer.findFirst({ where: { employeeId: empId, stoppedAt: null } });
    if (running) {
      if (!allowAutoStop) throw new BadRequestException(`Timer already running on another task (${running.taskId})`);
      await this.stopTimerRecord(running);
    }
    return this.prisma.taskTimer.create({
      data: { taskId, employeeId: empId, notes: body.notes },
      include: { task: { select: { id: true, title: true } } },
    });
  }

  async stopTimer(taskId: string, user: any) {
    const empId = await this.empId(user?.sub);
    if (!empId) throw new BadRequestException("No employee profile linked to your user");
    const running = await this.prisma.taskTimer.findFirst({ where: { taskId, employeeId: empId, stoppedAt: null } });
    if (!running) throw new NotFoundException("No running timer for this task");
    const { timer, hours } = await this.stopTimerRecord(running);
    await this.invalidateTasks();
    return { timer, hoursLogged: hours };
  }

  /** Close a timer and write the corresponding TimeLog (loggedVia TIMER). */
  private async stopTimerRecord(timer: { id: string; taskId: string; employeeId: string | null; startedAt: Date; notes: string | null }) {
    const now = new Date();
    const ms = now.getTime() - timer.startedAt.getTime();
    // round to 2dp hours, minimum 0.01 so a quick toggle still records
    const hours = Math.max(0.01, Math.round((ms / 3600000) * 100) / 100);
    const [updated] = await this.prisma.$transaction([
      this.prisma.taskTimer.update({ where: { id: timer.id }, data: { stoppedAt: now } }),
      this.prisma.timeLog.create({
        data: {
          taskId: timer.taskId,
          employeeId: timer.employeeId,
          hours,
          date: now,
          loggedVia: "TIMER",
          notes: timer.notes ?? null,
        },
      }),
    ]);
    await this.recomputeActualHours(timer.taskId);
    return { timer: updated, hours };
  }

  // ── Bulk actions ─────────────────────────────────────────────────────
  async bulk(body: { ids: string[]; op: string; value?: any }, user: any) {
    if (!body.ids?.length) throw new BadRequestException("No task ids provided");
    const tasks = await this.prisma.task.findMany({ where: { id: { in: body.ids } } });
    if (!tasks.length) throw new NotFoundException("No matching tasks");

    // permission: full-edit for structural ops, progress for status
    const needFull = ["assign", "priority", "dueDate", "archive", "unarchive", "delete"].includes(body.op);
    const allowed: string[] = [];
    for (const t of tasks) {
      const ok = needFull ? await this.canEditFull(t, user) : await this.canEditProgress(t, user);
      if (ok) allowed.push(t.id);
    }
    if (!allowed.length) throw new ForbiddenException("You don't have permission to modify these tasks");
    const skipped = tasks.length - allowed.length;

    const now = new Date();
    let count = 0;
    switch (body.op) {
      case "status": {
        if (!body.value) throw new BadRequestException("status value required");
        const nextStatus = normalizeTaskStatus(body.value) as TaskStatus;
        const idsToSpawn: string[] = [];
        for (const id of allowed) {
          const task = tasks.find((t) => t.id === id)!;
          if (task.status === nextStatus) continue;
          await this.prisma.task.update({
            where: { id },
            data: {
              status: nextStatus,
              ...(nextStatus === "DONE" ? { completedAt: task.completedAt ?? now } : { completedAt: null }),
              activityLog: [
                { action: "updated", field: "status", from: task.status, to: nextStatus, at: now.toISOString(), by: user?.name ?? "Bulk update" },
                ...(((task.activityLog ?? []) as any[]).slice(0, 99)),
              ] as any,
            },
          });
          if (nextStatus === "DONE" && task.status !== "DONE") idsToSpawn.push(id);
          count++;
        }
        for (const id of idsToSpawn) await this.spawnRecurrence(id).catch(() => {});
        break;
      }
      case "assign": {
        const actorEmpId = await this.empId(user?.sub);
        // per-task update (not updateMany) so each task keeps its own
        // handover entry — "who gave it to whom" must survive bulk ops.
        for (const id of allowed) {
          const task = tasks.find((t) => t.id === id)!;
          if (task.assignedToId === (body.value ?? null)) continue;
          await this.prisma.task.update({
            where: { id },
            data: {
              assignedToId: body.value ?? null,
              assignedById: body.value ? actorEmpId : null,
              assignedAt: body.value ? now : null,
              activityLog: [
                { action: "assigned", field: "assignedTo", from: task.assignedToId, to: body.value ?? null, at: now.toISOString(), by: user?.name ?? "Bulk update" },
                ...(((task.activityLog ?? []) as any[]).slice(0, 99)),
              ] as any,
            },
          });
          count++;
        }
        if (body.value) for (const id of allowed) await this.notifyAssignee(body.value, id, tasks.find((t) => t.id === id)?.title ?? "").catch(() => {});
        break;
      }
      case "priority": {
        if (!body.value) throw new BadRequestException("priority value required");
        const res = await this.prisma.task.updateMany({ where: { id: { in: allowed } }, data: { priority: body.value as Priority } });
        count = res.count;
        break;
      }
      case "dueDate": {
        const res = await this.prisma.task.updateMany({
          where: { id: { in: allowed } },
          data: { dueDate: body.value ? new Date(body.value) : null },
        });
        count = res.count;
        break;
      }
      case "archive": {
        const res = await this.prisma.task.updateMany({ where: { id: { in: allowed } }, data: { archivedAt: now } });
        count = res.count;
        break;
      }
      case "unarchive": {
        const res = await this.prisma.task.updateMany({ where: { id: { in: allowed } }, data: { archivedAt: null } });
        count = res.count;
        break;
      }
      case "delete": {
        const res = await this.prisma.task.deleteMany({ where: { id: { in: allowed } } });
        count = res.count;
        break;
      }
      default:
        throw new BadRequestException(`Unknown bulk op: ${body.op}`);
    }
    await this.invalidateTasks();
    return { ok: true, affected: count, skipped };
  }

  // ── Sprint / cycle ───────────────────────────────────────────────────
  // Reading sprints is open to the team; creating, editing, deleting or
  // filling them reshapes everyone's plan, so those need PM/Admin.
  private requirePlanner(user?: { sub?: string; role?: string }) {
    if (!user?.sub) throw new ForbiddenException("Login required");
    if (!this.isPM(user.role)) throw new ForbiddenException("Only Project Manager or Admin can manage sprints, templates and automation rules");
  }

  async listSprints(query: { projectId?: string; status?: string; includeCompleted?: string } = {}) {
    return this.prisma.sprint.findMany({
      where: {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status ? { status: query.status as any } : query.includeCompleted === "true" ? {} : { status: { not: "COMPLETED" } }),
      },
      include: { project: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
      orderBy: [{ startDate: "desc" }],
    });
  }

  async createSprint(body: any, user?: any) {
    this.requirePlanner(user);
    if (!body.name?.trim()) throw new BadRequestException("Sprint name is required");
    if (!body.startDate || !body.endDate) throw new BadRequestException("startDate and endDate are required");
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (end < start) throw new BadRequestException("endDate must be after startDate");
    return this.prisma.sprint.create({
      data: {
        name: body.name.trim(),
        goal: body.goal ?? null,
        projectId: body.projectId ?? null,
        startDate: start,
        endDate: end,
        status: body.status ?? "PLANNED",
        capacityHours: body.capacityHours ?? null,
      },
    });
  }

  async updateSprint(id: string, body: any, user?: any) {
    this.requirePlanner(user);
    const existing = await this.prisma.sprint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Sprint not found");
    const data: any = {};
    for (const k of ["name", "goal"]) if (body[k] !== undefined) data[k] = body[k];
    if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
    if (body.endDate !== undefined) data.endDate = new Date(body.endDate);
    if (body.status !== undefined) data.status = body.status;
    if (body.projectId !== undefined) data.projectId = body.projectId || null;
    if (body.capacityHours !== undefined) data.capacityHours = body.capacityHours;
    // keep the window valid when both ends are known after the edit
    const start = data.startDate ?? existing.startDate;
    const end = data.endDate ?? existing.endDate;
    if (end < start) throw new BadRequestException("endDate must be after startDate");
    return this.prisma.sprint.update({ where: { id }, data });
  }

  async deleteSprint(id: string, user?: any) {
    this.requirePlanner(user);
    const existing = await this.prisma.sprint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Sprint not found");
    // detach tasks rather than cascade-delete them
    await this.prisma.$transaction([
      this.prisma.task.updateMany({ where: { sprintId: id }, data: { sprintId: null } }),
      this.prisma.sprint.delete({ where: { id } }),
    ]);
    await this.invalidateTasks();
    return { ok: true };
  }

  async assignTasksToSprint(id: string, taskIds: string[], user?: any) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundException("Sprint not found");
    if (!taskIds?.length) return { ok: true, affected: 0 };
    // per-task full-edit check (same rule as POST /tasks/bulk) plus the
    // cross-project guard from setTaskSprint — a sprint scoped to project A
    // must not silently absorb project B's tasks.
    const tasks = await this.prisma.task.findMany({ where: { id: { in: taskIds } } });
    const allowed: string[] = [];
    for (const t of tasks) {
      if (!(await this.canEditFull(t, user))) continue;
      if (t.projectId && sprint.projectId && sprint.projectId !== t.projectId) continue;
      allowed.push(t.id);
    }
    if (!allowed.length) throw new ForbiddenException("You don't have permission to move these tasks");
    const res = await this.prisma.task.updateMany({ where: { id: { in: allowed } }, data: { sprintId: id } });
    await this.invalidateTasks();
    return { ok: true, affected: res.count, skipped: tasks.length - allowed.length };
  }

  async removeTaskFromSprint(id: string, taskId: string) {
    await this.prisma.task.updateMany({ where: { id: taskId, sprintId: id }, data: { sprintId: null } });
    await this.invalidateTasks();
    return { ok: true };
  }

  async setTaskSprint(taskId: string, sprintId: string | null, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditFull(task, user))) throw new ForbiddenException("You don't have permission to move this task");
    if (sprintId) {
      const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
      if (!sprint) throw new NotFoundException("Sprint not found");
      if (task.projectId && sprint.projectId && sprint.projectId !== task.projectId) {
        throw new BadRequestException("Task project does not match sprint project");
      }
    }
    const updated = await this.prisma.task.update({ where: { id: taskId }, data: { sprintId } });
    await this.invalidateTasks();
    return updated;
  }

  /**
   * Everything an assignee needs to actually start work, in one call:
   * the project brief, its research/reference links and its files.
   *
   * Exists so the task form and detail drawer can show project context without
   * pulling the whole Flow module — and so it can be permission-checked against
   * the task rather than assuming the caller can read every project.
   */
  async projectContextForTask(taskId: string, user?: any) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, deliverableId: true, assignedToId: true, reporterId: true, assignedById: true, assignees: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(task, user))) {
      throw new ForbiddenException("You don't have permission to view this task");
    }
    if (!task.projectId) return { project: null, references: [], files: [], deliverables: [], reports: [] };
    return this.projectContext(task.projectId, task.deliverableId);
  }

  /** Project brief + research + files, shaped for the task UI. */
  async projectContext(projectId: string, deliverableId?: string | null) {
    const [project, references, files, deliverables, reports] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true, name: true, description: true, status: true, healthStatus: true,
          category: true, priority: true, progress: true,
          startDate: true, targetEndDate: true,
          projectLink: true, websiteUrl: true, briefLink: true, driveLink: true, researchLink: true,
          socialLinks: true,
          client: {
            select: {
              id: true,
              companyName: true,
              contacts: {
                select: { id: true, name: true, roleTitle: true, email: true, phone: true, isPrimary: true },
                orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
                take: 2,
              },
            },
          },
          assignedPm: { select: { id: true, name: true } },
          _count: { select: { tasks: true } },
        },
      }),
      this.prisma.projectReference.findMany({
        where: { projectId },
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.projectFile.findMany({
        where: { projectId },
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { uploadedAt: "desc" },
        take: 50,
      }),
      this.prisma.projectDeliverable.findMany({
        where: { projectId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.projectReport.findMany({
        where: { projectId },
        orderBy: { periodEnd: "desc" },
        take: 10,
      }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    return {
      project,
      // the project's own brief links, flattened so the UI can list them
      briefLinks: [
        { label: "Brief", url: project.briefLink },
        { label: "Drive", url: project.driveLink },
        { label: "Research", url: project.researchLink },
        { label: "Project link", url: project.projectLink },
        { label: "Website", url: project.websiteUrl },
      ].filter((l) => !!l.url),
      references,
      files,
      deliverables,
      reports,
      focusedDeliverableId: deliverableId ?? null,
    };
  }

  /**
   * Burndown from daily snapshots.
   *
   * Snapshots are the source of truth for days already recorded; for any day
   * without one (today, or days before snapshots existed) we fall back to the
   * reconstructed estimate, and mark the point so the UI can show it as less
   * trustworthy. `source` per point: "snapshot" | "estimated".
   */
  async sprintBurndown(id: string) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundException("Sprint not found");
    const tasks = await this.prisma.task.findMany({
      where: { sprintId: id },
      select: { id: true, status: true, createdAt: true, completedAt: true, estimatedHours: true, actualHours: true, priority: true },
    });

    // capture today's row so the chart always has a live anchor
    await this.captureSprintSnapshot(id).catch(() => {});

    const snapshots = await this.prisma.sprintDailySnapshot.findMany({
      where: { sprintId: id },
      orderBy: { date: "asc" },
    });
    const snapByDay = new Map(snapshots.map((s) => [s.date.toISOString().slice(0, 10), s]));

    const day = 86400000;
    const start = new Date(sprint.startDate);
    const end = new Date(Math.max(sprint.endDate.getTime(), Date.now()));
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / day));
    const total = tasks.length;

    // reconstructed fallback series
    const days: {
      date: string;
      remaining: number;
      ideal: number;
      completed: number;
      source: "snapshot" | "estimated";
      estimatedHours?: number;
      actualHours?: number;
    }[] = [];
    let cumulativeDone = 0;
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(start.getTime() + i * day);
      const dEnd = new Date(d.getTime() + day);
      const key = d.toISOString().slice(0, 10);
      const ideal = Math.round(((totalDays - i) / totalDays) * total);
      const snap = snapByDay.get(key);
      if (snap) {
        days.push({
          date: key,
          remaining: snap.remaining,
          completed: snap.done,
          ideal,
          source: "snapshot",
          estimatedHours: Number(snap.estimatedHours),
          actualHours: Number(snap.actualHours),
        });
        cumulativeDone = snap.done;
        continue;
      }
      const doneByThen = tasks.filter((t) => t.completedAt && t.completedAt >= start && t.completedAt < dEnd && t.status === "DONE").length;
      const createdAfter = tasks.filter((t) => t.createdAt >= dEnd).length;
      cumulativeDone += doneByThen;
      days.push({
        date: key,
        remaining: Math.max(0, total - cumulativeDone - createdAfter),
        ideal,
        completed: cumulativeDone,
        source: "estimated",
      });
    }

    const done = tasks.filter((t) => t.status === "DONE").length;
    const estimated = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);
    const actual = tasks.reduce((s, t) => s + Number(t.actualHours ?? 0), 0);
    return {
      sprint,
      summary: {
        total,
        done,
        open: total - done,
        estimatedHours: Math.round(estimated * 10) / 10,
        actualHours: Math.round(actual * 10) / 10,
        capacityHours: sprint.capacityHours ? Number(sprint.capacityHours) : null,
        completionPct: total ? Math.round((done / total) * 100) : 0,
        snapshotDays: snapshots.length,
      },
      days,
    };
  }

  /**
   * Write (or refresh) today's snapshot row for one sprint.
   * Idempotent via the [sprintId, date] unique key — safe to call repeatedly.
   */
  async captureSprintSnapshot(sprintId: string) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException("Sprint not found");
    const tasks = await this.prisma.task.findMany({
      where: { sprintId },
      select: { status: true, estimatedHours: true, actualHours: true },
    });
    const now = new Date();
    const date = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const done = tasks.filter((t) => t.status === "DONE").length;
    const estimatedHours = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);
    const actualHours = tasks.reduce((s, t) => s + Number(t.actualHours ?? 0), 0);
    const payload = {
      total: tasks.length,
      done,
      open: tasks.length - done,
      remaining: tasks.length - done,
      estimatedHours: Math.round(estimatedHours * 100) / 100,
      actualHours: Math.round(actualHours * 100) / 100,
    };
    return this.prisma.sprintDailySnapshot.upsert({
      where: { sprintId_date: { sprintId, date } },
      create: { sprintId, date, ...payload },
      update: payload,
    });
  }

  /** Nightly: snapshot every non-completed sprint so burndown has history. */
  @Cron("30 23 * * *")
  async snapshotActiveSprints() {
    const sprints = await this.prisma.sprint.findMany({ where: { status: { in: ["PLANNED", "ACTIVE"] } }, select: { id: true } });
    for (const s of sprints) await this.captureSprintSnapshot(s.id).catch(() => {});
    return { snapshotted: sprints.length };
  }

  // ── Saved views ──────────────────────────────────────────────────────
  async listSavedViews(user: any) {
    return this.prisma.savedTaskView.findMany({
      where: { OR: [{ ownerId: user?.sub ?? "__none__" }, { isShared: true }] },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async createSavedView(body: any, user: any) {
    if (!body.name?.trim()) throw new BadRequestException("View name is required");
    return this.prisma.savedTaskView.create({
      data: {
        name: body.name.trim(),
        ownerId: user?.sub ?? null,
        filters: body.filters ?? {},
        viewMode: body.viewMode ?? "board",
        groupBy: body.groupBy ?? "project",
        isShared: body.isShared ?? false,
      },
    });
  }

  async updateSavedView(id: string, body: any, user: any) {
    const v = await this.prisma.savedTaskView.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("View not found");
    if (v.ownerId && v.ownerId !== user?.sub && !this.isAdmin(user?.role)) throw new ForbiddenException("Only the owner can edit this view");
    const data: any = {};
    for (const k of ["name", "filters", "viewMode", "groupBy", "isShared"]) if (body[k] !== undefined) data[k] = body[k];
    return this.prisma.savedTaskView.update({ where: { id }, data });
  }

  async deleteSavedView(id: string, user: any) {
    const view = await this.prisma.savedTaskView.findUnique({ where: { id } });
    if (!view) throw new NotFoundException("View not found");
    if (view.ownerId && view.ownerId !== user?.sub && !this.isAdmin(user?.role)) throw new ForbiddenException("Only the owner can delete this view");
    await this.prisma.savedTaskView.delete({ where: { id } });
    return { ok: true };
  }

  // ── Estimation accuracy ──────────────────────────────────────────────
  private async recordEstimateAccuracy(task: { id: string; assignedToId: string | null; taskType: string; estimatedHours: any; actualHours: any }) {
    if (task.estimatedHours == null) return;
    const est = Number(task.estimatedHours);
    const act = Number(task.actualHours ?? 0);
    if (!est) return;
    const varianceRatio = Math.round(((act - est) / est) * 100) / 100;
    // one row per task — overwrite if the task is re-completed
    const existing = await this.prisma.estimateAccuracyLog.findFirst({ where: { taskId: task.id } });
    if (existing) {
      await this.prisma.estimateAccuracyLog.update({
        where: { id: existing.id },
        data: { estimatedHours: est, actualHours: act, varianceRatio, employeeId: task.assignedToId, taskType: task.taskType },
      });
      return;
    }
    await this.prisma.estimateAccuracyLog.create({
      data: {
        taskId: task.id,
        employeeId: task.assignedToId,
        taskType: task.taskType,
        estimatedHours: est,
        actualHours: act,
        varianceRatio,
      },
    });
  }

  async estimationReport(query: { employeeId?: string; taskType?: string } = {}) {
    const rows = await this.prisma.estimateAccuracyLog.findMany({
      where: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.taskType ? { taskType: query.taskType } : {}),
      },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const bucket = (key: string, label: string) => {
      const items = rows.filter((r) => (r as any)[key] === label);
      if (!items.length) return null;
      const est = items.reduce((s, r) => s + Number(r.estimatedHours ?? 0), 0);
      const act = items.reduce((s, r) => s + Number(r.actualHours ?? 0), 0);
      const variance = items.reduce((s, r) => s + (r.varianceRatio ?? 0), 0) / items.length;
      return {
        key: label,
        samples: items.length,
        estimatedHours: Math.round(est * 10) / 10,
        actualHours: Math.round(act * 10) / 10,
        avgVarianceRatio: Math.round(variance * 100) / 100,
        bias: variance > 0.1 ? "underestimated" : variance < -0.1 ? "overestimated" : "accurate",
        avgEstimated: Math.round((est / items.length) * 10) / 10,
      };
    };
    const grouped = (key: "employeeId" | "taskType") => {
      const keys = [...new Set(rows.map((r) => (r as any)[key]).filter(Boolean))] as string[];
      return keys.map((k) => bucket(key, k)).filter(Boolean);
    };
    const byEmployee = grouped("employeeId").map((b: any) => {
      const emp = rows.find((r) => r.employeeId === b.key)?.employee;
      return { ...b, name: emp?.name ?? b.key };
    });
    const byTaskType = grouped("taskType").map((b: any) => ({ ...b, name: b.key }));
    const worst = [...rows]
      .sort((a, b) => Math.abs(b.varianceRatio ?? 0) - Math.abs(a.varianceRatio ?? 0))
      .slice(0, 10)
      .map((r) => ({
        taskId: r.taskId,
        employeeName: r.employee?.name ?? "—",
        taskType: r.taskType,
        estimatedHours: Number(r.estimatedHours ?? 0),
        actualHours: Number(r.actualHours ?? 0),
        varianceRatio: r.varianceRatio,
      }));
    const overall = rows.length
      ? Math.round((rows.reduce((s, r) => s + (r.varianceRatio ?? 0), 0) / rows.length) * 100) / 100
      : 0;
    return { sampleCount: rows.length, overallVarianceRatio: overall, byEmployee, byTaskType, worst };
  }


  async myDayForUser(userId?: string) {
    if (!userId) return [];
    const empId = await this.getEmployeeIdByUserId(userId);
    return this.myDay(empId ?? undefined);
  }

  async myDay(employeeId?: string) {
    // employeeId is resolved by the controller from the JWT — never trust a
    // client-supplied id here or every user sees the whole company's board.
    if (!employeeId) return [];
    const tasks = await this.prisma.task.findMany({
      where: { status: { not: "DONE" }, archivedAt: null, assignedToId: employeeId },
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

  async list(query: { status?: string; priority?: string; taskType?: string; assignee?: string; projectId?: string; sprintId?: string; q?: string; parent?: string; mine?: boolean; sort?: string; archived?: string; employeeId?: string }, user?: any) {
    // `mine` is resolved from the JWT here — the query string used to carry an
    // employeeId that the client never sent, so "Mine" silently matched nothing.
    const mineEmployeeId = (query.mine === true || String(query.mine) === "true") ? (await this.getEmployeeIdByUserId(user?.sub)) ?? undefined : undefined;
    return this.cache.wrapQuery("tasks:list", { ...query, mineEmployeeId }, 30, async () => {
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
          ...(query.status ? { status: toTaskStatus(query.status) ?? undefined } : {}),
          ...(query.priority ? { priority: query.priority as Priority } : {}),
          ...(query.taskType ? { taskType: query.taskType } : {}),
          ...(query.assignee ? { assignedToId: query.assignee } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.sprintId ? { sprintId: query.sprintId } : {}),
          ...(query.parent ? { parentTaskId: query.parent } : { parentTaskId: null }),
          ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { tags: { has: query.q } }] } : {}),
          ...(mineEmployeeId ? { assignedToId: mineEmployeeId } : {}),
        },
        include: {
          project: { select: { id: true, name: true, healthStatus: true } },
          sprint: { select: { id: true, name: true, status: true } },
          assignedTo: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
          reporter: { select: { id: true, name: true } },
          _count: { select: { timeLogs: true, comments: true, checklist: true } },
        },
        orderBy,
        // Safety cap for the unbounded board/table query.
        take: 500,
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
        deliverable: { select: { id: true, title: true, status: true } },
        sprint: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
        assignedTo: { select: { id: true, name: true, roleTitle: true, department: true } },
        reporter: { select: { id: true, name: true, roleTitle: true } },
        assignedBy: { select: { id: true, name: true, roleTitle: true } },
        checklist: { include: { doneBy: { select: { id: true, name: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
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
    assignedToName?: string;
  }) {
    const status = body.status ?? "TODO";
    await this.assertTaskTypeAllowed(body.assignedToId, body.taskType);
    let sortOrder = 0;
    if (body.parentTaskId) {
      const siblings = await this.prisma.task.findMany({ where: { parentTaskId: body.parentTaskId }, select: { sortOrder: true } });
      sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
    }
    // Reporter is never client-supplied: whoever creates the task raises it.
    // (A PM may later reassign the reporter via an explicit update.)
    let reporterId = body.reporterId as string | undefined;
    if (!reporterId && body.createdById) {
      reporterId = (await this.getEmployeeIdByUserId(body.createdById)) ?? undefined;
    }
    // Assigner = whoever is doing the handing out. If the creator assigned it
    // to someone else, they are the assigner; if the creator kept it, there is
    // no separate assigner (they assigned it to themselves).
    const creatorEmpId = body.createdById ? await this.getEmployeeIdByUserId(body.createdById) : null;
    const assignedById = body.assignedToId && body.assignedToId !== creatorEmpId ? creatorEmpId ?? undefined : undefined;
    const activityLog = [
      {
        action: "created",
        field: "task",
        from: null,
        to: status,
        at: new Date().toISOString(),
        by: body.createdByName ?? "System",
      },
      ...(body.assignedToId
        ? [{
            action: "assigned",
            field: "assignedTo",
            from: null,
            to: body.assignedToName ?? body.assignedToId,
            at: new Date().toISOString(),
            by: body.createdByName ?? "System",
          }]
        : []),
    ];
    const task = await this.prisma.task.create({
      data: {
        title: body.title,
        description: body.description,
        projectId: body.projectId,
        sprintId: (body as any).sprintId,
        assignedToId: body.assignedToId,
        assignedById,
        assignedAt: body.assignedToId ? new Date() : null,
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
        // a task created directly as DONE still needs a completion stamp
        completedAt: status === "DONE" ? new Date() : null,
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
    // Changing assignee or type can violate a department rule — check the pair
    // that will result, not just what was submitted.
    if (body.taskType !== undefined || body.assignedToId !== undefined) {
      await this.assertTaskTypeAllowed(
        body.assignedToId !== undefined ? body.assignedToId : existing.assignedToId,
        body.taskType !== undefined ? body.taskType : existing.taskType
      );
    }
    const push = (field: string, from: any, to: any) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        log.push({ action: "updated", field, from: from ?? null, to: to ?? null, at: new Date().toISOString(), by: actorName ?? "System" });
      }
    };
    if (body.title !== undefined) push("title", existing.title, body.title), (data.title = body.title);
    if (body.description !== undefined) push("description", existing.description, body.description), (data.description = body.description);
    if (body.status !== undefined) push("status", existing.status, body.status), (data.status = body.status), (data.completedAt = body.status === "DONE" ? existing.completedAt ?? new Date() : null);
    if (body.priority !== undefined) push("priority", existing.priority, body.priority), (data.priority = body.priority);
    if (body.taskType !== undefined) push("taskType", existing.taskType, body.taskType), (data.taskType = body.taskType);
    if (body.assignedToId !== undefined) push("assignee", existing.assignedToId, body.assignedToId), (data.assignedToId = body.assignedToId);
    // Reassignment records who handed it over, so "assigned by X" survives the
    // hand-off instead of silently pointing at the original creator.
    if (body.assignedToId !== undefined && body.assignedToId !== existing.assignedToId) {
      const actorEmpId = await this.empId(actorUser.sub);
      data.assignedById = actorEmpId ?? null;
      data.assignedAt = body.assignedToId ? new Date() : null;
    }
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
    if (body.status === "DONE" && existing.status !== "DONE") {
      void this.wa.notifyTaskClientUpdate(id).catch(() => {});
      await this.recordEstimateAccuracy(updated).catch(() => {});
      await this.spawnRecurrence(id).catch(() => {});
    }
    // Only rescore when a field the engine actually reads changed.
    if (["status", "dueDate", "isBlocked", "estimatedHours", "projectId"].some((k) => body[k] !== undefined)) {
      if (existing.projectId && existing.projectId !== updated.projectId) {
        await this.rescoreProject(existing.projectId);
      }
      await this.rescoreProject(updated.projectId);
    }
    await this.invalidateTasks();
    return updated;
  }

  async remove(id: string, user?: any) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Task not found");
    if (user && !(await this.canEditFull(existing, user))) throw new ForbiddenException("Only the assigner, reporter, PM or Admin can delete this task");
    await this.prisma.task.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Task not found");
    });
    await this.rescoreProject(existing.projectId);
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
        sprintId: null, // a copy starts in the backlog, not inside the sprint
        assignedToId: t.assignedToId,
        assignedById: t.assignedById,
        assignedAt: t.assignedToId ? new Date() : null,
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
        // stamp/clear completion time so burndown + cycle-time have a source of truth
        ...(status === "DONE" ? { completedAt: existing.completedAt ?? new Date() } : { completedAt: null }),
        activityLog: [
          { action: "updated", field: "status", from: existing.status, to: status, at: new Date().toISOString(), by: actorName ?? "System" },
          ...(((existing.activityLog ?? []) as any[])),
        ].slice(0, 100),
      },
    });
    await this.applyAutomation({ type: "status", taskId: t.id, title: t.title, prev: existing.status, next: status, actorName });
    if (status === "DONE" && existing.status !== "DONE") {
      void this.wa.notifyTaskClientUpdate(t.id).catch(() => {});
      await this.recordEstimateAccuracy(t).catch(() => {});
      await this.spawnRecurrence(id).catch(() => {});
    }
    await this.invalidateTasks();
    return t;
  }

  /**
   * Spawn the next occurrence of a recurring task.
   * Guarded by `recurrenceSpawnedAt` so DONE → reopen → DONE cannot create
   * duplicate siblings (the previous behaviour re-spawned every time).
   */
  private async spawnRecurrence(id: string) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t || !t.isRecurring || !t.recurrenceSchedule || !RECURRENCE_OFFSETS[t.recurrenceSchedule]) return null;
    if (t.recurrenceSpawnedAt) return null; // already produced a successor

    const nextDue = RECURRENCE_OFFSETS[t.recurrenceSchedule](t.dueDate ?? new Date());
    const [updated, spawned] = await this.prisma.$transaction([
      this.prisma.task.update({ where: { id }, data: { recurrenceSpawnedAt: new Date() } }),
      this.prisma.task.create({
        data: {
          title: t.title,
          description: t.description,
          projectId: t.projectId,
          deliverableId: t.deliverableId,
          sprintId: null, // next occurrence lands in the backlog, not the closed sprint
          assignedToId: t.assignedToId,
          assignedById: t.assignedById,
          assignedAt: t.assignedToId ? new Date() : null,
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
      }),
    ]);
    return spawned;
  }

  // ── Comments ─────────────────────────────────────────────────────────
  async addComment(taskId: string, body: { content: string; authorId?: string; parentId?: string; mentionedUserIds?: string[] }, user?: any) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { assignedTo: { select: { user: { select: { id: true } } } }, reporter: { select: { user: { select: { id: true } } } } },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(task, user)) && !(await this.canEditProgress(task, user))) {
      throw new ForbiddenException("You don't have permission to comment on this task");
    }
    const comment = await this.prisma.taskComment.create({
      data: {
        taskId,
        content: body.content,
        authorId: body.authorId,
        parentId: body.parentId,
        mentionedUserIds: body.mentionedUserIds ?? [],
      },
      include: { author: { select: { id: true, name: true } } },
    });

    // Notify @mentions + the assignee/reporter. Author and anyone already
    // notified as a mention are excluded so nobody gets two pings.
    const excerpt = body.content.length > 140 ? `${body.content.slice(0, 140)}…` : body.content;
    const notified = new Set<string>([body.authorId ?? ""]);
    const mentioned = (body.mentionedUserIds ?? []).filter(Boolean);
    for (const uid of mentioned) {
      if (notified.has(uid)) continue;
      notified.add(uid);
      await this.notifications.create(uid, "TASK_MENTION" as any, "You were mentioned", `${comment.author?.name ?? "Someone"} mentioned you on "${task.title}": ${excerpt}`, `/tasks?task=${taskId}`).catch(() => {});
    }
    const watchers = [task.assignedTo?.user?.id, task.reporter?.user?.id].filter(Boolean) as string[];
    for (const uid of watchers) {
      if (notified.has(uid)) continue;
      notified.add(uid);
      await this.notifications.create(uid, "TASK_COMMENT" as any, "New comment", `${comment.author?.name ?? "Someone"} commented on "${task.title}": ${excerpt}`, `/tasks?task=${taskId}`).catch(() => {});
    }
    return comment;
  }

  /**
   * Daily nudge for overdue + due-within-24h tasks.
   * Runs 09:30 Asia/Dhaka (server TZ). Deduped per (user, task, day) by
   * checking Notification rows created since local midnight — so a retried or
   * manually re-run job cannot spam the same person twice in one day.
   */
  @Cron("30 9 * * *")
  async overdueReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 86400000);
    // local midnight — Notification.createdAt is the dedupe window boundary
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { not: "DONE" },
        archivedAt: null,
        isBlocked: false,
        dueDate: { not: null, lte: in24h },
      },
      select: { id: true, title: true, dueDate: true, assignedToId: true, priority: true },
    });
    let sent = 0;
    let skipped = 0;
    for (const t of tasks) {
      const emp = await this.prisma.employee.findUnique({ where: { id: t.assignedToId ?? "__none__" }, include: { user: { select: { id: true } } } });
      if (!emp?.user) continue;
      const overdue = t.dueDate && t.dueDate < now;
      const type = overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON";
      const link = `/tasks?task=${t.id}`;

      // per-day dedupe: has this exact nudge already gone out today?
      const already = await this.prisma.notification.findFirst({
        where: { userId: emp.user.id, type, link, createdAt: { gte: startOfDay } },
        select: { id: true },
      });
      if (already) {
        skipped++;
        continue;
      }

      const n = await this.notifications.create(
        emp.user.id,
        type as any,
        overdue ? "Task overdue" : "Task due soon",
        overdue ? `"${t.title}" is past its due date.` : `"${t.title}" is due within 24 hours.`,
        link
      ).catch(() => null);
      if (n) sent++;
    }
    return { sent, skipped, scanned: tasks.length };
  }

  /** Timer watchdog: auto-stop timers left running > 12h (forgotten clock). */
  @Cron("0 3 * * *")
  async closeStaleTimers() {
    const cutoff = new Date(Date.now() - 12 * 3600000);
    const stale = await this.prisma.taskTimer.findMany({ where: { stoppedAt: null, startedAt: { lt: cutoff } } });
    for (const t of stale) await this.stopTimerRecord(t).catch(() => {});
    if (stale.length) await this.invalidateTasks();
    return { closed: stale.length };
  }

  async toggleReaction(taskId: string, commentId: string, body: { emoji: string; userId: string }, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canViewTask(task, user))) throw new ForbiddenException("You don't have permission to react on this task");
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

  async deleteComment(taskId: string, commentId: string, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    const comment = await this.prisma.taskComment.findFirst({ where: { id: commentId, taskId } });
    if (!comment) throw new NotFoundException("Comment not found");
    // Author can remove their own comment; otherwise only full editors.
    // (Author check is by User id — comments link users, tasks link employees.)
    const isAuthor = user?.sub && comment.authorId === user.sub;
    if (!isAuthor && user && !(await this.canEditFull(task, user))) {
      throw new ForbiddenException("Only the author or a full editor can delete this comment");
    }
    await this.prisma.taskComment.deleteMany({ where: { id: commentId, taskId } });
    return { ok: true };
  }

  // ── Dependencies ─────────────────────────────────────────────────────
  // Changing the graph reshapes everyone's critical path, so both ends need
  // at least work-level access to the task being edited.
  async addDependency(taskId: string, dependsOnTaskId: string, type = "blocked-by", user?: any) {
    if (taskId === dependsOnTaskId) throw new BadRequestException("Cannot depend on itself");
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canWorkOnTask(task, user))) throw new ForbiddenException("You don't have permission to edit this task's dependencies");
    return this.prisma.taskDependency.upsert({
      where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
      create: { taskId, dependsOnTaskId, type },
      update: { type },
    });
  }

  async removeDependency(taskId: string, dependsOnTaskId: string, user?: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (user && !(await this.canWorkOnTask(task, user))) throw new ForbiddenException("You don't have permission to edit this task's dependencies");
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
  // Templates shape everyone's work, so authoring them is PM/Admin-only.
  // *Using* a template just creates tasks, so it stays open to task creators.
  async listTemplates() {
    return this.prisma.taskTemplate.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createTemplate(body: { name: string; description?: string; category?: string; benchmarkDurationDays?: number; benchmarkHours?: number; defaultTasks: any[] }, user?: any) {
    this.requirePlanner(user);
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

  async deleteTemplate(id: string, user?: any) {
    this.requirePlanner(user);
    await this.prisma.taskTemplate.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Template not found");
    });
    return { ok: true };
  }

  async useTemplate(id: string, body: { projectId?: string; assigneeId?: string; createdById?: string; createdByName?: string }) {
    const tpl = await this.prisma.taskTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException("Template not found");
    const tasks = (tpl.defaultTasks as any[]) ?? [];
    // Handoffs from a template carry the same provenance as a manual create:
    // the user pressing the button is both reporter and assigner.
    const creatorEmpId = await this.empId(body.createdById);
    // A template is a plan authored by a planner, but it still must not create
    // tasks the assignee's department is not allowed to own — check every type
    // once up-front so the failure names the offending type instead of
    // half-applying the template.
    if (body.assigneeId) {
      const types = new Set<string>([...(tasks.map((t) => t.taskType ?? "general") as string[])]);
      for (const t of tasks) for (const st of t.subtasks ?? []) types.add(st.taskType ?? "general");
      for (const type of types) await this.assertTaskTypeAllowed(body.assigneeId, type);
    }
    const created = [];
    for (const t of tasks) {
      const assignedToId = body.assigneeId;
      const task = await this.prisma.task.create({
        data: {
          title: t.title,
          description: t.description,
          projectId: body.projectId,
          assignedToId,
          assignedById: assignedToId && assignedToId !== creatorEmpId ? creatorEmpId ?? undefined : undefined,
          assignedAt: assignedToId ? new Date() : null,
          reporterId: creatorEmpId ?? undefined,
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
            ...(assignedToId ? [{ action: "assigned", field: "assignedTo", from: null, to: assignedToId, at: new Date().toISOString(), by: body.createdByName ?? "System" }] : []),
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
  // Rules rewrite other people's tasks, so authoring them is PM/Admin-only.
  async listAutomation() {
    return this.prisma.automationRule.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createAutomation(body: { name: string; trigger: string; action: string; config: any; enabled?: boolean }, user?: any) {
    this.requirePlanner(user);
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

  async updateAutomation(id: string, body: any, user?: any) {
    this.requirePlanner(user);
    return this.prisma.automationRule.update({ where: { id }, data: body }).catch(() => {
      throw new NotFoundException("Rule not found");
    });
  }

  async deleteAutomation(id: string, user?: any) {
    this.requirePlanner(user);
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
        "TASK_ASSIGNED",
        "New Task Assigned",
        `"${title}" has been assigned to you.`,
        `/tasks?task=${taskId}`
      );
    }
  }

  // ── Workload ─────────────────────────────────────────────────────────
  /**
   * Capacity-aware workload. Base capacity = Employee.weeklyCapacityHours
   * (fallback 40), reduced by approved leave days overlapping the next 7
   * days and by the employee's weekly off days.
   */
  async workload() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, name: true, roleTitle: true, department: true, weeklyCapacityHours: true, weeklyOffDays: true },
    });
    const openTasks = await this.prisma.task.findMany({
      where: { status: { notIn: ["DONE"] }, archivedAt: null },
      select: { assignedToId: true, estimatedHours: true, dueDate: true, priority: true, title: true },
    });

    // leave + off days over the next 7 days determine effective capacity
    const windowStart = new Date();
    const windowEnd = new Date(Date.now() + 7 * 86400000);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: windowEnd }, endDate: { gte: windowStart } },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    // Company default weekly offs. An empty per-employee array means
    // "follow policy" (see Employee.weeklyOffDays), not "no off days".
    const policy = await this.prisma.attendancePolicy.findUnique({ where: { id: "default" }, select: { weeklyOffDays: true } }).catch(() => null);
    const defaultOffs = (policy?.weeklyOffDays ?? ["FRIDAY", "SATURDAY"]).map((d) => String(d).trim().toUpperCase());

    const now = Date.now();
    const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const rows = employees.map((e) => {
      const tasks = openTasks.filter((t) => t.assignedToId === e.id);
      const allocated = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);

      const base = Number(e.weeklyCapacityHours ?? 40);
      const dayMs = 86400000;
      const hoursPerDay = base / 5; // capacity spread over a 5-day week
      const offSet = new Set(
        (e.weeklyOffDays?.length ? e.weeklyOffDays : defaultOffs).map((d) => String(d).trim().toUpperCase())
      );
      let leaveDays = 0;
      let offDays = 0;
      for (let d = 0; d < 7; d++) {
        const day = new Date(windowStart.getTime() + d * dayMs);
        if (offSet.has(DAY_NAMES[day.getDay()])) {
          offDays++;
          continue; // weekly off — leave on top of it doesn't double-count
        }
        const overlaps = leaves.some(
          (l) => l.employeeId === e.id && new Date(l.startDate) <= day && new Date(l.endDate) >= day
        );
        if (overlaps) leaveDays++;
      }
      const outDays = leaveDays + offDays;
      const effective = Math.max(0, Math.round((base - outDays * hoursPerDay) * 10) / 10);

      const reasons: string[] = [];
      if (leaveDays > 0) reasons.push(`${leaveDays} leave day(s) this week`);
      if (offDays > 0) reasons.push(`${offDays} weekly off day(s) in window`);
      if (!reasons.length && allocated > base) reasons.push("allocated above base capacity");

      return {
        ...e,
        taskCount: tasks.length,
        allocated: Math.round(allocated * 10) / 10,
        baseCapacity: base,
        leaveDaysInWindow: leaveDays,
        weeklyOffDaysInWindow: offDays,
        outDays,
        capacity: effective,
        utilization: effective ? Math.min(1.5, allocated / effective) : allocated > 0 ? 1.5 : 0,
        overbooked: effective > 0 ? allocated > effective : allocated > 0,
        overbookedReason: reasons.length ? reasons.join("; ") : null,
        urgent: tasks.filter((t) => t.priority === "URGENT").length,
        overdue: tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now).length,
        tasks: tasks.map((t) => ({ title: t.title, hours: Number(t.estimatedHours ?? 0), priority: t.priority, due: t.dueDate })),
      };
    });
    const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
    return {
      rows,
      totalAllocated: Math.round(totalAllocated * 10) / 10,
      teamUtilization: rows.length ? Math.round((rows.reduce((s, r) => s + r.utilization, 0) / rows.length) * 100) : 0,
      overbookedCount: rows.filter((r) => r.overbooked).length,
      leaveAdjusted: true,
    };
  }
}