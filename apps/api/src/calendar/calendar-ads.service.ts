import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { addDays, dateOnly, dateToDay, isDayKey, isRealDay, todayKey } from "./calendar.utils";

/**
 * Campaigns and ad flights — the "which ad runs on which day" half of the
 * calendar. Flights are planning records; AdInsight rows remain the measured
 * truth, so planned vs actual can be compared without duplicating spend data.
 */
@Injectable()
export class CalendarAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  private async invalidate() {
    await this.cache.delPattern("cal:*");
    await this.cache.del("dashboard:overview");
  }

  private readonly PLATFORMS = [
    "FACEBOOK",
    "INSTAGRAM",
    "LINKEDIN",
    "TIKTOK",
    "X",
    "YOUTUBE",
    "GOOGLE_BUSINESS",
    "PINTEREST",
    "THREADS",
  ];

  private assertRange(start: string, end: string) {
    if (!isRealDay(start) || !isRealDay(end)) {
      throw new BadRequestException("Start and end dates must be real YYYY-MM-DD days");
    }
    if (start > end) throw new BadRequestException("End date cannot be before the start date");
  }

  private assertPlatform(platform: unknown) {
    if (!this.PLATFORMS.includes(String(platform))) {
      throw new BadRequestException("Unknown platform");
    }
  }

  private assertBudget(value: unknown, label: string) {
    if (value === null || value === undefined || value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label} must be zero or more`);
  }

  async campaigns(params: { clientId?: string; from?: string; to?: string }) {
    return this.prisma.campaign.findMany({
      where: {
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(isDayKey(params.from) ? { endDate: { gte: dateOnly(params.from) } } : {}),
        ...(isDayKey(params.to) ? { startDate: { lte: dateOnly(params.to) } } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true, calendarColor: true } },
        project: { select: { id: true, name: true } },
        _count: { select: { posts: true, flights: true } },
      },
      orderBy: { startDate: "desc" },
      take: 200,
    });
  }

  async createCampaign(dto: any) {
    if (!dto.clientId || !String(dto.name ?? "").trim()) {
      throw new BadRequestException("Client and name are required");
    }
    if (!isRealDay(dto.startDate) || !isRealDay(dto.endDate)) throw new BadRequestException("Start and end dates are required");
    this.assertRange(dto.startDate, dto.endDate);
    this.assertBudget(dto.totalBudget, "Total budget");
    const platforms = Array.isArray(dto.platforms) ? dto.platforms : [];
    for (const p of platforms) this.assertPlatform(p);
    const created = await this.prisma.campaign.create({
      data: {
        clientId: dto.clientId,
        projectId: dto.projectId || null,
        name: String(dto.name).trim(),
        objective: dto.objective ?? null,
        status: dto.status ?? "PLAN",
        startDate: dateOnly(dto.startDate),
        endDate: dateOnly(dto.endDate),
        totalBudget: dto.totalBudget != null ? Number(dto.totalBudget) : null,
        currency: dto.currency ?? "BDT",
        briefLink: dto.briefLink ?? null,
        ownerId: dto.ownerId ?? null,
        color: dto.color ?? null,
        platforms,
        notes: dto.notes ?? null,
      },
    });
    await this.invalidate();
    return created;
  }

  async updateCampaign(id: string, dto: any) {
    const exists = await this.prisma.campaign.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Campaign not found");
    const data: any = {};
    for (const k of ["name", "objective", "status", "totalBudget", "currency", "briefLink", "ownerId", "color", "platforms", "notes", "projectId"]) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.startDate !== undefined) {
      if (!isRealDay(dto.startDate)) throw new BadRequestException("Invalid start date");
      data.startDate = dateOnly(dto.startDate);
    }
    if (dto.endDate !== undefined) {
      if (!isRealDay(dto.endDate)) throw new BadRequestException("Invalid end date");
      data.endDate = dateOnly(dto.endDate);
    }
    const nextStart = dto.startDate ?? dateToDay(exists.startDate)!;
    const nextEnd = dto.endDate ?? dateToDay(exists.endDate)!;
    this.assertRange(nextStart, nextEnd);
    if (dto.totalBudget !== undefined) this.assertBudget(dto.totalBudget, "Total budget");
    if (dto.platforms !== undefined) {
      if (!Array.isArray(dto.platforms)) throw new BadRequestException("Platforms must be a list");
      for (const p of dto.platforms) this.assertPlatform(p);
    }
    const updated = await this.prisma.campaign.update({ where: { id }, data });
    await this.invalidate();
    return updated;
  }

  async deleteCampaign(id: string) {
    await this.prisma.campaign.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Campaign not found");
    });
    await this.invalidate();
    return { ok: true };
  }

  async flights(params: { clientId?: string; campaignId?: string; from?: string; to?: string }) {
    const rows = await this.prisma.adFlight.findMany({
      where: {
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.campaignId ? { campaignId: params.campaignId } : {}),
        ...(isDayKey(params.from) ? { endDate: { gte: dateOnly(params.from) } } : {}),
        ...(isDayKey(params.to) ? { startDate: { lte: dateOnly(params.to) } } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true, calendarColor: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { startDate: "desc" },
      take: 300,
    });

    // Actual spend for the visible window, so "planned vs actual" is one call.
    const from = isDayKey(params.from) ? params.from : todayKey();
    const to = isDayKey(params.to) ? params.to : from;
    const spend = await this.prisma.adInsight.groupBy({
      by: ["clientId"],
      where: {
        date: { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) },
        ...(params.clientId ? { clientId: params.clientId } : {}),
      },
      _sum: { spend: true },
    });
    const spendByClient = new Map(spend.map((s) => [s.clientId, Number(s._sum.spend ?? 0)]));

    return rows.map((f) => {
      const days = Math.max(
        1,
        Math.round((f.endDate.getTime() - f.startDate.getTime()) / 86_400_000) + 1
      );
      const planned = Number(f.dailyBudget ?? 0) * days;
      const actual = spendByClient.get(f.clientId) ?? 0;
      return { ...f, days, plannedSpend: planned, actualSpend: actual };
    });
  }

  async createFlight(dto: any) {
    if (!dto.clientId || !String(dto.name ?? "").trim() || !dto.platform) {
      throw new BadRequestException("Client, name and platform are required");
    }
    if (!isRealDay(dto.startDate) || !isRealDay(dto.endDate)) throw new BadRequestException("Start and end dates are required");
    this.assertRange(dto.startDate, dto.endDate);
    this.assertPlatform(dto.platform);
    this.assertBudget(dto.dailyBudget, "Daily budget");
    this.assertBudget(dto.totalBudget, "Total budget");
    const created = await this.prisma.adFlight.create({
      data: {
        clientId: dto.clientId,
        campaignId: dto.campaignId || null,
        projectId: dto.projectId || null,
        name: String(dto.name).trim(),
        platform: dto.platform,
        objective: dto.objective ?? null,
        startDate: dateOnly(dto.startDate),
        endDate: dateOnly(dto.endDate),
        dailyBudget: dto.dailyBudget != null ? Number(dto.dailyBudget) : null,
        totalBudget: dto.totalBudget != null ? Number(dto.totalBudget) : null,
        currency: dto.currency ?? "BDT",
        status: dto.status ?? "PLANNED",
        creativeNote: dto.creativeNote ?? null,
        adAccountId: dto.adAccountId ?? null,
        externalCampaignId: dto.externalCampaignId ?? null,
        ownerId: dto.ownerId ?? null,
      },
    });
    await this.invalidate();
    return created;
  }

  async updateFlight(id: string, dto: any) {
    const exists = await this.prisma.adFlight.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Flight not found");
    const data: any = {};
    for (const k of [
      "name",
      "platform",
      "objective",
      "dailyBudget",
      "totalBudget",
      "currency",
      "status",
      "creativeNote",
      "adAccountId",
      "externalCampaignId",
      "ownerId",
      "campaignId",
      "projectId",
    ]) {
      if (dto[k] !== undefined) data[k] = dto[k] === "" ? null : dto[k];
    }
    if (dto.startDate !== undefined) {
      if (!isRealDay(dto.startDate)) throw new BadRequestException("Invalid start date");
      data.startDate = dateOnly(dto.startDate);
    }
    if (dto.endDate !== undefined) {
      if (!isRealDay(dto.endDate)) throw new BadRequestException("Invalid end date");
      data.endDate = dateOnly(dto.endDate);
    }
    this.assertRange(dto.startDate ?? dateToDay(exists.startDate)!, dto.endDate ?? dateToDay(exists.endDate)!);
    if (dto.platform !== undefined) this.assertPlatform(dto.platform);
    if (dto.dailyBudget !== undefined) this.assertBudget(dto.dailyBudget, "Daily budget");
    if (dto.totalBudget !== undefined) this.assertBudget(dto.totalBudget, "Total budget");
    const updated = await this.prisma.adFlight.update({ where: { id }, data });
    await this.invalidate();
    return updated;
  }

  async deleteFlight(id: string) {
    await this.prisma.adFlight.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Flight not found");
    });
    await this.invalidate();
    return { ok: true };
  }

  /** Gantt payload: campaigns and flights as span bars. */
  async timeline(params: { clientId?: string; from?: string; to?: string }) {
    const [campaigns, flights] = await Promise.all([
      this.campaigns(params),
      this.flights(params),
    ]);
    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        clientId: c.clientId,
        clientName: c.client?.companyName,
        name: c.name,
        status: c.status,
        start: dateToDay(c.startDate),
        end: dateToDay(c.endDate),
        color: c.color ?? c.client?.calendarColor ?? "#7C3AED",
        platforms: c.platforms,
        posts: c._count?.posts ?? 0,
      })),
      flights: flights.map((f) => ({
        id: f.id,
        clientId: f.clientId,
        clientName: f.client?.companyName,
        campaignName: f.campaign?.name,
        name: f.name,
        platform: f.platform,
        status: f.status,
        start: dateToDay(f.startDate),
        end: dateToDay(f.endDate),
        plannedSpend: f.plannedSpend,
        actualSpend: f.actualSpend,
      })),
    };
  }
}

