import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type ChecklistKind = "ONBOARDING" | "OFFBOARDING";

/**
 * Default runbooks. Kept in code (not the database) so a fresh install has a
 * working process on day one; HR can still add/remove individual steps per run.
 */
const TEMPLATES: Record<ChecklistKind, { label: string; owner: string }[]> = {
  ONBOARDING: [
    { label: "Signed contract & NDA on file", owner: "HR" },
    { label: "NID + emergency contact collected", owner: "HR" },
    { label: "Work email and system accounts created", owner: "IT" },
    { label: "Laptop / equipment issued", owner: "IT" },
    { label: "Added to Slack + Telegram groups", owner: "IT" },
    { label: "Bank details collected for payroll", owner: "Finance" },
    { label: "Intro meeting with the team", owner: "Manager" },
    { label: "30-day check-in scheduled", owner: "Manager" },
  ],
  OFFBOARDING: [
    { label: "Resignation / termination letter on file", owner: "HR" },
    { label: "Handover document completed", owner: "Manager" },
    { label: "Laptop, phone and access cards returned", owner: "IT" },
    { label: "Email, Slack and client access revoked", owner: "IT" },
    { label: "Final settlement calculated", owner: "Finance" },
    { label: "Exit interview completed", owner: "HR" },
    { label: "Experience letter issued", owner: "HR" },
  ],
};

const SHAPE = {
  items: { orderBy: { sortOrder: "asc" as const }, include: { doneBy: { select: { id: true, name: true } } } },
  employee: { select: { id: true, name: true, roleTitle: true, department: true, joinDate: true, employmentStatus: true } },
};

/**
 * Onboarding / offboarding runs.
 *
 * One run per employee per kind (`@@unique([employeeId, kind])`), items as rows
 * so progress and "who ticked it" are queryable. The value is not the checklist
 * itself — it is that a half-finished offboarding (laptop not returned, access
 * not revoked) becomes visible instead of living in someone's head.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private progress(items: { done: boolean }[]) {
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  private shape<T extends { items: { done: boolean }[] }>(row: T) {
    return { ...row, progress: this.progress(row.items) };
  }

  async list(kind?: ChecklistKind) {
    const rows = await this.prisma.employeeChecklist.findMany({
      where: kind ? { kind } : undefined,
      include: SHAPE,
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    });
    return rows.map((r) => this.shape(r));
  }

  async summary() {
    const rows = await this.prisma.employeeChecklist.findMany({ include: { items: { select: { done: true } } } });
    const counts = { ONBOARDING: 0, OFFBOARDING: 0, completed: 0, inProgress: 0, stale: 0 };
    for (const r of rows) {
      if (r.kind === "OFFBOARDING") counts.OFFBOARDING++;
      else counts.ONBOARDING++;
      if (r.status === "COMPLETED") counts.completed++;
      else counts.inProgress++;
      const p = this.progress(r.items);
      // "Stale" = in progress, started more than a week ago, not finished.
      if (r.status !== "COMPLETED" && Date.now() - r.startedAt.getTime() > 7 * 86400000) counts.stale++;
      void p;
    }
    return counts;
  }

  async forEmployee(employeeId: string) {
    const rows = await this.prisma.employeeChecklist.findMany({ where: { employeeId }, include: SHAPE });
    return rows.map((r) => this.shape(r));
  }

  /**
   * Start a run. Idempotent by (employee, kind): calling it twice returns the
   * existing run instead of creating a duplicate checklist.
   */
  async start(body: { employeeId: string; kind?: ChecklistKind; dueDate?: string; reset?: boolean }) {
    const kind: ChecklistKind = body.kind === "OFFBOARDING" ? "OFFBOARDING" : "ONBOARDING";
    if (!body.employeeId) throw new BadRequestException("employeeId is required");
    const emp = await this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, name: true } });
    if (!emp) throw new NotFoundException("Employee not found");

    const existing = await this.prisma.employeeChecklist.findUnique({
      where: { employeeId_kind: { employeeId: body.employeeId, kind } },
      include: SHAPE,
    });
    if (existing && !body.reset) return this.shape(existing);

    // Reset = rebuild the item list but keep the same run row.
    if (existing && body.reset) {
      await this.prisma.employeeChecklistItem.deleteMany({ where: { checklistId: existing.id } });
      const fresh = await this.prisma.employeeChecklist.update({
        where: { id: existing.id },
        data: {
          status: "IN_PROGRESS",
          completedAt: null,
          startedAt: new Date(),
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          items: { create: TEMPLATES[kind].map((t, i) => ({ label: t.label, owner: t.owner, sortOrder: i })) },
        },
        include: SHAPE,
      });
      return this.shape(fresh);
    }

    const created = await this.prisma.employeeChecklist.create({
      data: {
        employeeId: body.employeeId,
        kind,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        items: { create: TEMPLATES[kind].map((t, i) => ({ label: t.label, owner: t.owner, sortOrder: i })) },
      },
      include: SHAPE,
    });
    return this.shape(created);
  }

  async toggleItem(itemId: string, done: boolean, userId?: string) {
    const item = await this.prisma.employeeChecklistItem.findUnique({ where: { id: itemId }, select: { checklistId: true } });
    if (!item) throw new NotFoundException("Checklist item not found");
    await this.prisma.employeeChecklistItem.update({
      where: { id: itemId },
      data: { done, doneAt: done ? new Date() : null, doneById: done ? (userId ?? null) : null },
    });
    await this.syncStatus(item.checklistId);
    const row = await this.prisma.employeeChecklist.findUnique({ where: { id: item.checklistId }, include: SHAPE });
    return row ? this.shape(row) : null;
  }

  /** A run flips to COMPLETED automatically once every item is ticked. */
  private async syncStatus(checklistId: string) {
    const items = await this.prisma.employeeChecklistItem.findMany({ where: { checklistId }, select: { done: true } });
    const allDone = items.length > 0 && items.every((i) => i.done);
    await this.prisma.employeeChecklist.update({
      where: { id: checklistId },
      data: { status: allDone ? "COMPLETED" : "IN_PROGRESS", completedAt: allDone ? new Date() : null },
    });
  }

  async setStatus(id: string, status: "IN_PROGRESS" | "COMPLETED") {
    const row = await this.prisma.employeeChecklist.update({
      where: { id },
      data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
      include: SHAPE,
    }).catch(() => {
      throw new NotFoundException("Checklist not found");
    });
    return this.shape(row);
  }

  async addItem(checklistId: string, body: { label: string; owner?: string }) {
    if (!body.label?.trim()) throw new BadRequestException("label is required");
    const owner = body.owner?.trim() || null;
    const count = await this.prisma.employeeChecklistItem.count({ where: { checklistId } });
    await this.prisma.employeeChecklistItem.create({
      data: { checklistId, label: body.label.trim(), owner, sortOrder: count },
    }).catch((err) => {
      if (err?.code === "P2003") throw new NotFoundException("Checklist not found");
      throw err;
    });
    await this.prisma.employeeChecklist.update({ where: { id: checklistId }, data: { status: "IN_PROGRESS", completedAt: null } }).catch(() => null);
    const row = await this.prisma.employeeChecklist.findUnique({ where: { id: checklistId }, include: SHAPE });
    return row ? this.shape(row) : null;
  }

  async removeItem(itemId: string) {
    const item = await this.prisma.employeeChecklistItem.findUnique({ where: { id: itemId }, select: { checklistId: true } });
    if (!item) throw new NotFoundException("Checklist item not found");
    await this.prisma.employeeChecklistItem.delete({ where: { id: itemId } });
    await this.syncStatus(item.checklistId);
    return { ok: true };
  }

  async remove(id: string) {
    await this.prisma.employeeChecklist.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Checklist not found");
    });
    return { ok: true };
  }

  /** Called when HR adds an employee — onboarding starts itself. */
  async autoStartOnboarding(employeeId: string) {
    return this.start({ employeeId, kind: "ONBOARDING" }).catch(() => null);
  }

  /** Called when employmentStatus flips to EXITED. */
  async autoStartOffboarding(employeeId: string) {
    return this.start({ employeeId, kind: "OFFBOARDING" }).catch(() => null);
  }
}
