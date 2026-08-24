import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  async courses() {
    return this.prisma.trainingCourse.findMany({
      include: { _count: { select: { enrollments: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async createCourse(body: any) {
    return this.prisma.trainingCourse.create({
      data: {
        title: body.title,
        description: body.description ?? "",
        type: body.type ?? "optional",
        category: body.category ?? "technical",
        duration: body.duration ?? 0,
        provider: body.provider ?? "",
        format: body.format ?? "online",
      },
    });
  }

  async deleteCourse(id: string) {
    await this.prisma.trainingCourse.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Course not found");
    });
    return { ok: true };
  }

  async enrollments() {
    return this.prisma.trainingEnrollment.findMany({
      include: {
        course: true,
        employee: { select: { id: true, name: true } },
      },
      orderBy: { enrolledAt: "desc" },
    });
  }

  async createEnrollment(body: { courseId: string; employeeId: string; status?: string; progress?: number }) {
    return this.prisma.trainingEnrollment.upsert({
      where: { courseId_employeeId: { courseId: body.courseId, employeeId: body.employeeId } },
      create: {
        courseId: body.courseId,
        employeeId: body.employeeId,
        status: body.status ?? "enrolled",
        progress: body.progress ?? 0,
      },
      update: {},
    });
  }

  async updateEnrollment(id: string, body: any) {
    const data: any = {};
    for (const f of ["status", "progress", "score", "certificateUrl"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.progress === 100 || body.status === "completed") data.completedAt = new Date();
    return this.prisma.trainingEnrollment.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("Enrollment not found");
    });
  }
}
