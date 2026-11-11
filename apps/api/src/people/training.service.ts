import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
    if (!body?.title?.trim()) throw new BadRequestException("title is required");
    return this.prisma.trainingCourse.create({
      data: {
        title: body.title.trim(),
        description: body.description ?? "",
        type: body.type ?? "optional",
        category: body.category ?? "technical",
        duration: Number(body.duration) || 0,
        provider: body.provider ?? "",
        format: body.format ?? "online",
      },
    });
  }

  async deleteCourse(id: string) {
    await this.prisma.trainingCourse.delete({ where: { id } }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException("Course not found");
      if (err?.code === "P2003") throw new BadRequestException("This course still has enrollments — remove them first");
      throw err;
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
    if (!body?.courseId || !body?.employeeId) throw new BadRequestException("courseId and employeeId are required");
    const [course, employee] = await Promise.all([
      this.prisma.trainingCourse.findUnique({ where: { id: body.courseId }, select: { id: true } }),
      this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true } }),
    ]);
    if (!course) throw new NotFoundException("Course not found");
    if (!employee) throw new NotFoundException("Employee not found");
    // Re-enrolling used to be a no-op (`update: {}`) so a second call silently
    // changed nothing and the UI still looked "saved".
    return this.prisma.trainingEnrollment.upsert({
      where: { courseId_employeeId: { courseId: body.courseId, employeeId: body.employeeId } },
      create: {
        courseId: body.courseId,
        employeeId: body.employeeId,
        status: body.status ?? "enrolled",
        progress: body.progress ?? 0,
      },
      update: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.progress !== undefined ? { progress: body.progress } : {}),
      },
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
