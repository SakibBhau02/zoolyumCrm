import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

/**
 * Period targets (leads, calls, revenue, posts…). These lived in the Calendar
 * module, where they did not belong: a target is a sales/marketing goal, not a
 * date-aware calendar item. Moved here so the Calendar stays about time.
 */
@Injectable()
export class PulseTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  private async invalidate() {
    await this.cache.delPattern("cal:targets:*");
    await this.cache.delPattern("pulse:*");
  }

  async list(params: { period?: string; clientId?: string; periodType?: string }) {
    const period = params.period && /^\d{4}(-\d{2})?$/.test(params.period)
      ? params.period
      : new Date().toISOString().slice(0, 7);
    return this.prisma.dailyTarget.findMany({
      where: {
        period,
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.periodType ? { periodType: params.periodType } : {}),
      },
      include: { client: { select: { id: true, companyName: true, calendarColor: true } } },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async create(dto: any) {
    const title = String(dto.title ?? "").trim();
    if (!title) throw new BadRequestException("Title is required");
    const target = Number(dto.target);
    if (!Number.isFinite(target) || target <= 0) throw new BadRequestException("Target must be a positive number");
    const period = String(dto.period ?? "").trim();
    if (!/^\d{4}(-\d{2})?$/.test(period)) throw new BadRequestException("Period must be YYYY-MM or YYYY");
    const created = await this.prisma.dailyTarget.create({
      data: {
        title,
        target,
        current: Number(dto.current ?? 0),
        unit: dto.unit ?? "",
        category: dto.category ?? "sales",
        period,
        periodType: dto.periodType ?? (period.length === 4 ? "YEAR" : "MONTH"),
        clientId: dto.clientId || null,
      },
      include: { client: { select: { id: true, companyName: true, calendarColor: true } } },
    });
    await this.invalidate();
    return created;
  }

  async update(id: string, dto: any) {
    const exists = await this.prisma.dailyTarget.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Target not found");
    const data: any = {};
    for (const k of ["title", "current", "target", "unit", "category", "period", "periodType", "clientId"]) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (data.title !== undefined) data.title = String(data.title).trim();
    if (data.target !== undefined) {
      const n = Number(data.target);
      if (!Number.isFinite(n) || n <= 0) throw new BadRequestException("Target must be a positive number");
      data.target = n;
    }
    if (data.current !== undefined) data.current = Number(data.current);
    const updated = await this.prisma.dailyTarget.update({
      where: { id },
      data,
      include: { client: { select: { id: true, companyName: true, calendarColor: true } } },
    });
    await this.invalidate();
    return updated;
  }

  async remove(id: string) {
    await this.prisma.dailyTarget.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Target not found");
    });
    await this.invalidate();
    return { ok: true };
  }

  /** Overall progress for the Pulse header. */
  async summary(period?: string) {
    const rows = await this.list({ period });
    const pct = rows.length
      ? Math.round(
          rows.reduce((sum, r) => sum + Math.min(100, (Number(r.current) / Math.max(Number(r.target), 1)) * 100), 0) /
            rows.length
        )
      : 0;
    return { period: rows[0]?.period ?? period ?? null, count: rows.length, avgProgress: pct };
  }
}
