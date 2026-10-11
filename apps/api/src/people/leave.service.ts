import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { leaveDays } from "./people-utils";

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  async leaveRequests() {
    return this.prisma.leaveRequest.findMany({
      include: { employee: { select: { id: true, name: true, roleTitle: true } } },
      orderBy: { appliedAt: "desc" },
    });
  }

  async applyLeave(body: { employeeId: string; leaveType: string; startDate: string; endDate: string }) {
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    const totalDays = leaveDays(start, end);
    const leave = await this.prisma.leaveRequest.create({
      data: {
        employeeId: body.employeeId,
        leaveType: body.leaveType as any,
        startDate: start,
        endDate: end,
      },
      include: { employee: { select: { name: true } } },
    });
    try {
      await this.notifications.notifyRole(
        "HR",
        "LEAVE_REQUEST",
        "Leave request submitted",
        `${leave.employee?.name ?? "Someone"} requested ${totalDays} day(s) ${body.leaveType} leave (${body.startDate} → ${body.endDate}).`,
        "/people"
      );
    } catch {}
    return { ...leave, totalDays };
  }

  async approveLeave(id: string, approved: boolean, approvedById?: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: { select: { name: true } } },
    });
    if (!leave) throw new NotFoundException("Leave request not found");
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        approvedById: approved ? approvedById : null,
      },
    });
    if (approved && leave.leaveType !== "UNPAID") {
      const period = `${leave.startDate.getFullYear()}`;
      const balance = await this.prisma.leaveBalance.findUnique({
        where: { employeeId_leaveType_period: { employeeId: leave.employeeId, leaveType: leave.leaveType, period } },
      });
      if (balance) {
        const days = leaveDays(leave.startDate, leave.endDate);
        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: { balanceDays: Math.max(0, Number(balance.balanceDays) - days) },
        });
      }
    }
    try {
      const userId = await this.notifications.userIdForEmployee(leave.employeeId);
      if (userId) {
        await this.notifications.create(
          userId,
          "LEAVE_STATUS",
          approved ? "Leave approved" : "Leave rejected",
          `Your ${leave.leaveType} leave (${leave.startDate.toISOString().slice(0, 10)} → ${leave.endDate.toISOString().slice(0, 10)}) was ${approved ? "approved" : "rejected"}.`,
          "/people"
        );
      }
    } catch {}
    return updated;
  }

  async leaveBalances(employeeId?: string) {
    return this.prisma.leaveBalance.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: [{ employee: { name: "asc" } }, { period: "desc" }],
    });
  }
}
