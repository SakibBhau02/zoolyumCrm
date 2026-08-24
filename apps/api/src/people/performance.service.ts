import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async reviews() {
    return this.prisma.performanceReview.findMany({
      include: { employee: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async createReview(body: any) {
    return this.prisma.performanceReview.create({
      data: {
        employeeId: body.employeeId,
        reviewPeriod: body.reviewPeriod,
        status: body.status ?? "PENDING",
        selfScore: body.selfScore ?? null,
        managerScore: body.managerScore ?? null,
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
    if (body.reviewedAt !== undefined || (body.managerScore !== undefined && body.managerScore !== null)) {
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
    const okr = await this.prisma.okr.create({
      data: {
        employeeId: body.employeeId,
        title: body.title,
        quarter: body.quarter,
        keyResults: body.keyResults ?? [],
        status: body.status ?? "on-track",
      },
    });
    return this.recomputeOkr(okr.id);
  }

  async updateOkr(id: string, body: any) {
    const data: any = {};
    for (const f of ["title", "quarter", "status"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.keyResults !== undefined) data.keyResults = body.keyResults;
    await this.prisma.okr.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("OKR not found");
    });
    return this.recomputeOkr(id);
  }

  async deleteOkr(id: string) {
    await this.prisma.okr.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("OKR not found");
    });
    return { ok: true };
  }

  private async recomputeOkr(id: string) {
    const okr = await this.prisma.okr.findUnique({ where: { id } });
    if (!okr) return null;
    const krs = (okr.keyResults as any[]) ?? [];
    const progress = krs.length
      ? Math.round((krs.reduce((s, k) => s + Math.min(1, (k.current ?? 0) / Math.max(k.target ?? 1, 0.001)), 0) / krs.length) * 100)
      : 0;
    const status = progress >= 100 ? "completed" : progress < 40 ? "behind" : progress < 70 ? "at-risk" : "on-track";
    return this.prisma.okr.update({ where: { id }, data: { overallProgress: progress, status } });
  }
}
