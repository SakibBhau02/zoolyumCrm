import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  async candidates() {
    return this.prisma.candidate.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createCandidate(body: any) {
    return this.prisma.candidate.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName ?? "",
        email: body.email,
        phone: body.phone ?? "",
        position: body.position,
        department: body.department ?? "",
        stage: body.stage ?? "applied",
        source: body.source ?? "",
        appliedAt: body.appliedAt ?? new Date().toISOString().slice(0, 10),
        notes: body.notes ?? [],
        interviews: body.interviews ?? [],
        rating: body.rating ?? 0,
        expectedSalary: body.expectedSalary ?? null,
        skills: body.skills ?? [],
      },
    });
  }

  async updateCandidate(id: string, body: any) {
    const data: any = {};
    for (const f of ["stage", "firstName", "lastName", "email", "phone", "position", "department", "source", "rating", "notes", "interviews", "skills"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.expectedSalary !== undefined) data.expectedSalary = body.expectedSalary;
    return this.prisma.candidate.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("Candidate not found");
    });
  }

  async deleteCandidate(id: string) {
    await this.prisma.candidate.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Candidate not found");
    });
    return { ok: true };
  }
}
