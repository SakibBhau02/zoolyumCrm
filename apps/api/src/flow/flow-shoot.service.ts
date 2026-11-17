import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { dayKey } from "../calendar/calendar.utils";
import { writeSystemAudit } from "../common/system-audit";
import {
  AddShootCrewDto,
  CreateShootDto,
  UpdateShootCrewDto,
  UpdateShootDto,
} from "./dto/flow-mutations.dto";

/**
 * Shoots are production call-sheets: a date, a duration, the people travelling
 * and the gear going with them. They are deliberately independent of
 * deliverables — a shoot is logistics, a deliverable is a commitment.
 *
 * The shoot owns exactly one CalendarEvent (type SHOOT). The sync is one-way:
 * edit the shoot, the event follows. Dragging the event does not move a locked
 * shoot — the call-sheet is the source of truth for the crew.
 */
@Injectable()
export class FlowShootService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // ── plumbing ─────────────────────────────────────────────────────────

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, clientId: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  private async loadShoot(shootId: string) {
    const shoot = await this.prisma.shoot.findUnique({
      where: { id: shootId },
      include: { project: { select: { id: true, name: true, clientId: true } } },
    });
    if (!shoot) throw new NotFoundException("Shoot not found");
    return shoot;
  }

  /** Calendar days are stored at UTC midnight so `@db.Date` round-trips. */
  private toDateOnly(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    return new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
    );
  }

  /**
   * A shoot may only use a campaign that belongs to the same client as the
   * project — otherwise the report would mix two clients' work.
   */
  private async assertCampaign(clientId: string, campaignId?: string | null) {
    if (!campaignId) return null;
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, clientId: true },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.clientId !== clientId) {
      throw new BadRequestException("This campaign belongs to a different client");
    }
    return campaign;
  }

  /** Free-text gear list: trimmed, de-duplicated, capped. */
  private cleanEquipment(list?: string[] | null): string[] | undefined {
    if (list === undefined) return undefined;
    if (list === null) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const item = String(raw ?? "").trim().replace(/\s+/g, " ");
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item.slice(0, 120));
      if (out.length >= 100) break;
    }
    return out;
  }

  private async invalidate() {
    await this.cache.del("flow:overview");
    await this.cache.delPattern("flow:list:*");
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
    await this.cache.del("tasks:stats");
  }

  // ── calendar sync (one-way: shoot → event) ───────────────────────────

  private eventPayload(
    shoot: {
      title: string;
      shootDate: Date;
      endDate: Date | null;
      callTime: string | null;
      wrapTime: string | null;
      location: string | null;
      description: string | null;
      campaignId: string | null;
      projectId: string;
    },
    project: { clientId: string },
    attendeeIds: string[]
  ) {
    return {
      title: shoot.title,
      type: "SHOOT" as const,
      // `date` is a Dhaka day key string on the calendar model.
      date: dayKey(shoot.shootDate),
      endDate: shoot.endDate ? dayKey(shoot.endDate) : null,
      startTime: shoot.callTime ?? null,
      endTime: shoot.wrapTime ?? null,
      allDay: !shoot.callTime,
      location: shoot.location ?? null,
      notes: shoot.description ?? null,
      attendeeIds,
      projectId: shoot.projectId,
      clientId: project.clientId,
      campaignId: shoot.campaignId ?? null,
      visibility: "INTERNAL" as const,
    };
  }

  private async teamAttendeeIds(shootId: string): Promise<string[]> {
    const crew = await this.prisma.shootCrew.findMany({
      where: { shootId, employeeId: { not: null } },
      select: { employeeId: true },
    });
    return [...new Set(crew.map((c) => c.employeeId!).filter(Boolean))];
  }

  /** Create or update the mirrored calendar event; never duplicates it. */
  private async syncCalendar(shootId: string) {
    const shoot = await this.loadShoot(shootId);
    const attendeeIds = await this.teamAttendeeIds(shoot.id);
    const payload = this.eventPayload(shoot, shoot.project, attendeeIds);

    if (shoot.calendarEventId) {
      try {
        await this.prisma.calendarEvent.update({
          where: { id: shoot.calendarEventId },
          data: payload,
        });
        return;
      } catch (e) {
        // The event was deleted directly in the calendar — re-create it.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2025") {
          throw e;
        }
      }
    }
    const created = await this.prisma.calendarEvent.create({ data: payload });
    await this.prisma.shoot.update({
      where: { id: shoot.id },
      data: { calendarEventId: created.id },
    });
  }

  private async removeCalendarEvent(eventId?: string | null) {
    if (!eventId) return;
    await this.prisma.calendarEvent.delete({ where: { id: eventId } }).catch(() => null);
  }

  // ── reads ────────────────────────────────────────────────────────────

  private readonly crewInclude = {
    employee: { select: { id: true, name: true, photoUrl: true, roleTitle: true } },
    vendor: { select: { id: true, name: true, phone: true, category: true } },
  } as const;

  async list(projectId: string) {
    await this.loadProject(projectId);
    return this.prisma.shoot.findMany({
      where: { projectId },
      include: {
        crew: { include: this.crewInclude, orderBy: { createdAt: "asc" } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: [{ shootDate: "asc" }, { createdAt: "asc" }],
    });
  }

  async detail(shootId: string) {
    const shoot = await this.prisma.shoot.findUnique({
      where: { id: shootId },
      include: {
        crew: { include: this.crewInclude, orderBy: { createdAt: "asc" } },
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!shoot) throw new NotFoundException("Shoot not found");
    return shoot;
  }

  // ── writes ───────────────────────────────────────────────────────────

  async create(projectId: string, dto: CreateShootDto, actorId?: string) {
    const project = await this.loadProject(projectId);
    const shootDate = this.toDateOnly(dto.shootDate, "Shoot date");
    const endDate = dto.endDate ? this.toDateOnly(dto.endDate, "End date") : null;
    if (endDate && endDate < shootDate) {
      throw new BadRequestException("End date cannot be before the shoot date");
    }
    const campaign = await this.assertCampaign(project.clientId, dto.campaignId);
    const equipment = this.cleanEquipment(dto.equipment) ?? [];

    const shoot = await this.prisma.shoot.create({
      data: {
        projectId,
        campaignId: campaign?.id ?? null,
        title: dto.title.trim(),
        shootDate,
        endDate,
        durationType: dto.durationType ?? "FULL_DAY",
        callTime: dto.callTime ?? null,
        wrapTime: dto.wrapTime ?? null,
        isDateLocked: dto.isDateLocked ?? false,
        location: dto.location?.trim() || null,
        locationUrl: dto.locationUrl?.trim() || null,
        locationNote: dto.locationNote?.trim() || null,
        description: dto.description?.trim() || null,
        notes: dto.notes?.trim() || null,
        equipment,
        status: dto.status ?? "PLANNED",
        createdById: actorId,
      },
      include: {
        crew: { include: this.crewInclude },
        campaign: { select: { id: true, name: true } },
      },
    });

    await this.syncCalendar(shoot.id);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.create",
      entityType: "Shoot",
      entityId: shoot.id,
      after: { projectId, title: shoot.title, shootDate: dayKey(shootDate) },
    });
    await this.invalidate();
    return this.detail(shoot.id);
  }

  async update(shootId: string, dto: UpdateShootDto, actorId?: string) {
    const existing = await this.loadShoot(shootId);
    const data: Prisma.ShootUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.shootDate !== undefined) data.shootDate = this.toDateOnly(dto.shootDate, "Shoot date");
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate ? this.toDateOnly(dto.endDate, "End date") : null;
    }
    if (dto.durationType !== undefined) data.durationType = dto.durationType;
    if (dto.callTime !== undefined) data.callTime = dto.callTime || null;
    if (dto.wrapTime !== undefined) data.wrapTime = dto.wrapTime || null;
    if (dto.isDateLocked !== undefined) data.isDateLocked = dto.isDateLocked;
    if (dto.location !== undefined) data.location = dto.location?.trim() || null;
    if (dto.locationUrl !== undefined) data.locationUrl = dto.locationUrl?.trim() || null;
    if (dto.locationNote !== undefined) data.locationNote = dto.locationNote?.trim() || null;
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.equipment !== undefined) data.equipment = this.cleanEquipment(dto.equipment) ?? [];
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.campaignId !== undefined) {
      const campaign = await this.assertCampaign(existing.project.clientId, dto.campaignId);
      data.campaign = campaign ? { connect: { id: campaign.id } } : { disconnect: true };
    }

    const nextDate =
      (data.shootDate as Date | undefined) ?? existing.shootDate;
    const nextEnd =
      dto.endDate !== undefined
        ? (data.endDate as Date | null)
        : existing.endDate;
    if (nextEnd && nextEnd < nextDate) {
      throw new BadRequestException("End date cannot be before the shoot date");
    }

    const shoot = await this.prisma.shoot.update({ where: { id: shootId }, data });
    await this.syncCalendar(shoot.id);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.update",
      entityType: "Shoot",
      entityId: shootId,
      before: {
        title: existing.title,
        shootDate: dayKey(existing.shootDate),
        status: existing.status,
      },
      after: { title: shoot.title, shootDate: dayKey(shoot.shootDate), status: shoot.status },
    });
    await this.invalidate();
    return this.detail(shootId);
  }

  async remove(shootId: string, actorId?: string) {
    const existing = await this.loadShoot(shootId);
    await this.prisma.shoot.delete({ where: { id: shootId } });
    await this.removeCalendarEvent(existing.calendarEventId);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.delete",
      entityType: "Shoot",
      entityId: shootId,
      before: { projectId: existing.projectId, title: existing.title },
    });
    await this.invalidate();
    return { ok: true };
  }

  // ── crew ─────────────────────────────────────────────────────────────

  private async resolveCrewIdentity(
    dto: AddShootCrewDto,
    existing?: { name: string; employeeId: string | null; vendorId: string | null; source: string }
  ) {
    const source = dto.source ?? (existing?.source as any) ?? "EMPLOYEE";
    let name = dto.name?.trim() ?? "";
    let phone = dto.phone?.trim() || null;

    if (source === "EMPLOYEE") {
      const employeeId = dto.employeeId ?? existing?.employeeId ?? null;
      if (!employeeId) throw new BadRequestException("Pick a team member for this crew role");
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, name: true, phone: true },
      });
      if (!employee) throw new NotFoundException("Employee not found");
      name = name || employee.name;
      phone = phone || employee.phone || null;
      return { source, employeeId: employee.id, vendorId: null, name, phone };
    }

    if (source === "VENDOR") {
      const vendorId = dto.vendorId ?? existing?.vendorId ?? null;
      if (!vendorId) throw new BadRequestException("Pick a vendor for this crew role");
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, name: true, phone: true },
      });
      if (!vendor) throw new NotFoundException("Vendor not found");
      name = name || vendor.name;
      phone = phone || vendor.phone || null;
      return { source, employeeId: null, vendorId: vendor.id, name, phone };
    }

    // EXTERNAL — a name is mandatory, there is nothing to look up.
    if (!name) throw new BadRequestException("Name is required for external crew");
    return { source, employeeId: null, vendorId: null, name, phone };
  }

  private async assertCrewBelongsToShoot(shootId: string, crewId: string) {
    const crew = await this.prisma.shootCrew.findUnique({ where: { id: crewId } });
    if (!crew || crew.shootId !== shootId) throw new NotFoundException("Crew member not found");
    return crew;
  }

  async addCrew(shootId: string, dto: AddShootCrewDto, actorId?: string) {
    const shoot = await this.loadShoot(shootId);
    const identity = await this.resolveCrewIdentity(dto);
    const crew = await this.prisma.shootCrew.create({
      data: {
        shootId,
        role: dto.role,
        ...identity,
        callTime: dto.callTime || null,
        isConfirmed: dto.isConfirmed ?? false,
        fee: dto.fee != null ? new Prisma.Decimal(dto.fee) : null,
        notes: dto.notes?.trim() || null,
      },
      include: this.crewInclude,
    });
    await this.syncCalendar(shoot.id);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.crew.add",
      entityType: "ShootCrew",
      entityId: crew.id,
      after: { shootId, role: crew.role, name: crew.name },
    });
    await this.invalidate();
    return crew;
  }

  async updateCrew(shootId: string, crewId: string, dto: UpdateShootCrewDto, actorId?: string) {
    const existing = await this.assertCrewBelongsToShoot(shootId, crewId);
    const needsIdentity =
      dto.source !== undefined ||
      dto.employeeId !== undefined ||
      dto.vendorId !== undefined ||
      dto.name !== undefined ||
      dto.phone !== undefined;

    const data: Prisma.ShootCrewUpdateInput = {};
    if (needsIdentity) {
      const identity = await this.resolveCrewIdentity(
        { ...dto, role: dto.role ?? existing.role } as AddShootCrewDto,
        existing
      );
      data.source = identity.source;
      data.employee = identity.employeeId ? { connect: { id: identity.employeeId } } : { disconnect: true };
      data.vendor = identity.vendorId ? { connect: { id: identity.vendorId } } : { disconnect: true };
      data.name = identity.name;
      data.phone = identity.phone;
    }
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.callTime !== undefined) data.callTime = dto.callTime || null;
    if (dto.isConfirmed !== undefined) data.isConfirmed = dto.isConfirmed;
    if (dto.fee !== undefined) data.fee = dto.fee != null ? new Prisma.Decimal(dto.fee) : null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    const crew = await this.prisma.shootCrew.update({
      where: { id: crewId },
      data,
      include: this.crewInclude,
    });
    await this.syncCalendar(shootId);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.crew.update",
      entityType: "ShootCrew",
      entityId: crewId,
      after: { role: crew.role, name: crew.name, isConfirmed: crew.isConfirmed },
    });
    await this.invalidate();
    return crew;
  }

  async removeCrew(shootId: string, crewId: string, actorId?: string) {
    const existing = await this.assertCrewBelongsToShoot(shootId, crewId);
    await this.prisma.shootCrew.delete({ where: { id: crewId } });
    await this.syncCalendar(shootId);
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.shoot.crew.delete",
      entityType: "ShootCrew",
      entityId: crewId,
      before: { shootId, role: existing.role, name: existing.name },
    });
    await this.invalidate();
    return { ok: true };
  }
}
