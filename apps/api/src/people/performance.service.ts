import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** 0–10 stored score → 1 decimal 0–5 star rating (null when ungraded). */
const scoreToStars = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 2) * 10) / 10;
};

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async reviews() {
    const rows = await this.prisma.performanceReview.findMany({
      include: { employee: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    // The table stores 0–10 scores; the product speaks 1–5 stars. Normalise here
    // so every client renders the same number instead of guessing.
    return rows.map((r) => ({
      ...r,
      rating: scoreToStars(r.managerScore ?? r.selfScore),
    }));
  }

  async createReview(body: any) {
    // Accept either the raw 0–10 scores or a 1–5 star rating from the UI.
    const managerScore = body.managerScore ?? (body.overallRating != null ? Number(body.overallRating) * 2 : null);
    return this.prisma.performanceReview.create({
      data: {
        employeeId: body.employeeId,
        reviewPeriod: body.reviewPeriod,
        status: body.status ?? "PENDING",
        selfScore: body.selfScore ?? null,
        managerScore,
        goalsSet: body.goalsSet ?? [],
        objectiveSignals: body.objectiveSignals ?? {},
        reviewedById: body.reviewedById ?? null,
      },
    });
  }

  async updateReview(id: string, body: any) {
    const data: any = {};
    for (const f of ["reviewPeriod", "status", "selfScore", "managerScore", "goalsSet", "objectiveSignals"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.overallRating !== undefined && body.managerScore === undefined) {
      data.managerScore = body.overallRating === null ? null : Number(body.overallRating) * 2;
    }
    if (body.reviewedAt !== undefined || (body.managerScore !== undefined && body.managerScore !== null) || (body.overallRating !== undefined && body.overallRating !== null)) {
      data.reviewedAt = body.reviewedAt ? new Date(body.reviewedAt) : new Date();
    }
    return this.prisma.performanceReview.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("Review not found");
    });
  }

  async okrs(employeeId?: string) {
    return this.prisma.okr.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async createOkr(body: any) {
    if (!body?.employeeId || !body?.title?.trim()) throw new BadRequestException("employeeId and title are required");
    const emp = await this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found");
    const okr = await this.prisma.okr.create({
      data: {
        employeeId: body.employeeId,
        title: body.title.trim(),
        quarter: body.quarter ?? `${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`,
        keyResults: Array.isArray(body.keyResults) ? body.keyResults : [],
        status: body.status ?? "on-track",
      },
    });
    return this.recomputeOkr(okr.id, body.status !== undefined);
  }

  async updateOkr(id: string, body: any) {
    const data: any = {};
    for (const f of ["title", "quarter"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.keyResults !== undefined) {
      if (!Array.isArray(body.keyResults)) throw new BadRequestException("keyResults must be an array");
      data.keyResults = body.keyResults;
    }
    await this.prisma.okr.update({ where: { id }, data }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException("OKR not found");
      throw err;
    });
    // A manually chosen status ("on-hold") must not be overwritten by progress.
    return this.recomputeOkr(id, body.status !== undefined);
  }

  async deleteOkr(id: string) {
    await this.prisma.okr.delete({ where: { id } }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException("OKR not found");
      throw err;
    });
    return { ok: true };
  }

  private async recomputeOkr(id: string, keepStatus = false) {
    const okr = await this.prisma.okr.findUnique({ where: { id } });
    if (!okr) return null;
    const krs = (okr.keyResults as any[]) ?? [];
    const progress = krs.length
      ? Math.round((krs.reduce((s, k) => s + Math.min(1, (k.current ?? 0) / Math.max(k.target ?? 1, 0.001)), 0) / krs.length) * 100)
      : 0;
    const status = progress >= 100 ? "completed" : progress < 40 ? "behind" : progress < 70 ? "at-risk" : "on-track";
    return this.prisma.okr.update({ where: { id }, data: { overallProgress: progress, ...(keepStatus ? {} : { status }) } });
  }
}
