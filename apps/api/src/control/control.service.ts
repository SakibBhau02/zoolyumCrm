import { Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { basename, join } from "path";
import { existsSync, unlinkSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

export const DEFAULT_SETTINGS = {
  companyProfile: {
    companyName: "Zoolyum",
    companyLogo: "/brand/zoolyum-logo.svg",
    website: "zoolyum.com",
    businessEmail: "support@zoolyum.com",
    phone: "+880 1712-000000",
    taxId: "",
    address: "Dhaka, Bangladesh",
  },
  regional: { timezone: "utc+6", currency: "bdt", dateFormat: "dmy", fiscalYearStart: "jan" },
  invoiceTemplate: {
    invoicePrefix: "ZLM",
    invoiceStartNumber: 1001,
    logoPosition: "left",
    accentColor: "#7C3AED",
    paymentTermsText: "Payment is due within 30 days.",
    defaultNotes: "Thank you for your business!",
  },
  financeConfig: {
    defaultPaymentTerms: "net30",
    latePaymentFee: 1.5,
    paymentMethods: [
      { name: "Bank Transfer", enabled: true },
      { name: "bKash", enabled: true },
      { name: "Nagad", enabled: true },
      { name: "Cash", enabled: true },
      { name: "Card", enabled: true },
    ],
    taxConfigs: [
      { id: "1", name: "Standard VAT", rate: 15, isDefault: true },
      { id: "2", name: "Reduced VAT", rate: 5, isDefault: false },
      { id: "3", name: "Zero Rate", rate: 0, isDefault: false },
    ],
  },
  pipelineStages: [
    { id: "1", name: "New", color: "#64748b", probability: 10, order: 0 },
    { id: "2", name: "Contacted", color: "#3b82f6", probability: 25, order: 1 },
    { id: "3", name: "Qualified", color: "#06b6d4", probability: 40, order: 2 },
    { id: "4", name: "Proposal", color: "#8b5cf6", probability: 60, order: 3 },
    { id: "5", name: "Negotiation", color: "#f59e0b", probability: 80, order: 4 },
    { id: "6", name: "Won", color: "#22c55e", probability: 100, order: 5 },
    { id: "7", name: "Lost", color: "#ef4444", probability: 0, order: 6 },
  ],
  leadCategories: [
    { id: "1", name: "Digital Marketing", color: "#8b5cf6" },
    { id: "2", name: "SEO", color: "#22c55e" },
    { id: "3", name: "Social Media", color: "#ec4899" },
    { id: "4", name: "Content", color: "#06b6d4" },
    { id: "5", name: "Branding", color: "#f97316" },
    { id: "6", name: "Web Development", color: "#6366f1" },
    { id: "7", name: "PPC", color: "#f43f5e" },
  ],
  clientTiers: [
    { name: "Enterprise", minValue: 100000, color: "#f59e0b" },
    { name: "Professional", minValue: 25000, color: "#3b82f6" },
    { name: "Starter", minValue: 0, color: "#64748b" },
  ],
  healthScoreWeights: [
    { factor: "Payment History", weight: 30 },
    { factor: "Engagement", weight: 25 },
    { factor: "Project Activity", weight: 25 },
    { factor: "NPS Score", weight: 20 },
  ],
  taskStatuses: ["Backlog", "To Do", "In Progress", "In Review", "Done", "Blocked"],
  taskAutomation: true,
  notifications: [
    { id: "1", title: "New Lead Assigned", email: true, push: true, sms: false },
    { id: "2", title: "Task Reminders", email: true, push: true, sms: true },
    { id: "3", title: "Invoice Paid", email: true, push: true, sms: false },
    { id: "4", title: "Client Messages", email: true, push: true, sms: true },
    { id: "5", title: "Overdue Payments", email: true, push: true, sms: true },
    { id: "6", title: "Weekly Reports", email: true, push: false, sms: false },
  ],
  integrations: [
    { name: "Google Calendar", connected: false },
    { name: "Stripe", connected: false },
    { name: "Slack", connected: false },
    { name: "QuickBooks", connected: false },
  ],
  emailTemplates: [
    { id: "1", name: "Invoice Sent", subject: "Invoice {invoiceNumber} from {companyName}", body: "Dear {clientName},\n\nYour invoice {invoiceNumber} for {amount} is due on {dueDate}.\n\nThank you,\n{companyName}" },
    { id: "2", name: "Payment Reminder", subject: "Payment reminder for {invoiceNumber}", body: "Dear {clientName},\n\nThis is a reminder that invoice {invoiceNumber} of {amount} was due on {dueDate}.\n\nThank you,\n{companyName}" },
    { id: "3", name: "Payment Received", subject: "Payment received — {invoiceNumber}", body: "Dear {clientName},\n\nWe received your payment of {amount} for invoice {invoiceNumber}. Thank you!\n\n{companyName}" },
    { id: "4", name: "Welcome Email", subject: "Welcome to {companyName}!", body: "Dear {clientName},\n\nWelcome to {companyName}! We are excited to work with you.\n\nBest,\n{companyName}" },
  ],
  appearance: { compactMode: false, animations: true, sidebarCollapsed: false },
};

@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async roles() {
    return this.prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async integrations() {
    return this.prisma.integration.findMany({
      include: { connectedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async branding() {
    return this.cache.wrap("control:branding", 300, async () => {
      const config = await this.prisma.brandingConfig.findFirst();
      return (
        config ?? {
          logoUrl: "/brand/zoolyum-logo.svg",
          logoDarkUrl: null,
          logoLightUrl: null,
          appName: "Zoolyum OS",
          primaryColor: "#7C3AED",
          secondaryColor: "#38BDF8",
          invoiceNumberingFormat: "ZLM-{year}-{seq}",
        }
      );
    });
  }

  async updateBranding(body: any) {
    const existing = await this.prisma.brandingConfig.findFirst();
    // cleanup old files if URL changed or cleared and points to uploads/branding
    const tryDeleteOld = (oldUrl?: string | null, newUrl?: string | null) => {
      if (!oldUrl) return;
      if (newUrl === undefined) return; // field not being updated
      if (oldUrl === newUrl) return;
      if (!oldUrl.includes("uploads/branding")) return;
      try {
        const filename = basename(oldUrl);
        const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g, "");
        const full = join(process.cwd(), "uploads/branding", safe);
        if (existsSync(full)) unlinkSync(full);
      } catch {}
    };
    if (existing) {
      tryDeleteOld(existing.logoDarkUrl, body.logoDarkUrl);
      tryDeleteOld(existing.logoLightUrl, body.logoLightUrl);
      tryDeleteOld((existing as any).logoUrl, body.logoUrl);
    }
    const result = existing
      ? await this.prisma.brandingConfig.update({ where: { id: existing.id }, data: body })
      : await this.prisma.brandingConfig.create({ data: body });
    await this.cache.del("control:branding");
    await this.cache.del("control:settings");
    return result;
  }

  async auditLogs() {
    return this.prisma.systemAuditLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });
  }

  async updateIntegration(id: string, body: { status?: string; credentialsEnc?: string }) {
    return this.prisma.integration.update({
      where: { id },
      data: {
        status: body.status as any,
        credentialsEnc: body.credentialsEnc,
        connectedAt: body.status === "CONNECTED" ? new Date() : undefined,
      },
    });
  }

  // ── Settings ─────────────────────────────────────────────────────────
  async getSettings() {
    return this.cache.wrap("control:settings", 300, async () => {
      const settings = await this.prisma.settings.findUnique({ where: { id: "default" } });
      if (settings) {
        const merged: any = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          merged[key] = (settings as any)[key] ?? (DEFAULT_SETTINGS as any)[key];
        }
        return { ...settings, ...merged };
      }
      return this.prisma.settings.create({ data: DEFAULT_SETTINGS as any });
    });
  }

  async updateSettings(body: any) {
    const existing = await this.prisma.settings.findUnique({ where: { id: "default" } });
    const result = existing
      ? await this.prisma.settings.update({ where: { id: "default" }, data: body })
      : await this.prisma.settings.create({ data: { ...DEFAULT_SETTINGS, ...body } as any });
    await this.cache.del("control:settings");
    return result;
  }

  // ── Users ────────────────────────────────────────────────────────────
  async createUser(body: { name: string; email: string; password: string; roleId: string; employeeId?: string }) {
    const email = body.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new Error("User with this email already exists");
    const user = await this.prisma.user.create({
      data: {
        name: body.name,
        email,
        passwordHash: await bcrypt.hash(body.password, 12),
        roleId: body.roleId,
        employeeId: body.employeeId ?? null,
      },
      include: { role: { select: { name: true } } },
    });
    await this.cache.del("users:list");
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async updateUser(id: string, body: any) {
    const data: any = {};
    for (const f of ["name", "email", "roleId", "employeeId", "isActive"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 12);
    const user = await this.prisma.user.update({ where: { id }, data, include: { role: { select: { name: true } } } });
    await this.cache.del("users:list");
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async resetPassword(id: string, newPassword: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      select: { id: true, email: true },
    });
  }

  async changePassword(id: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new Error("Current password is incorrect");
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      select: { id: true },
    });
  }

  async deleteUser(id: string) {
    await this.prisma.user.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("User not found");
    });
    await this.cache.del("users:list");
    return { ok: true };
  }

  // ── Pipeline stages ──────────────────────────────────────────────────
  async pipelineStages() {
    return this.cache.wrap("control:stages", 300, () =>
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } })
    );
  }

  private async invalidateStages() {
    await this.cache.del("control:stages");
  }

  async createPipelineStage(body: { name: string; slaDays?: number }) {
    const max = await this.prisma.pipelineStage.aggregate({ _max: { order: true } });
    const result = await this.prisma.pipelineStage.create({
      data: { name: body.name, slaDays: body.slaDays ?? 5, order: (max._max.order ?? -1) + 1 },
    });
    await this.invalidateStages();
    return result;
  }

  async updatePipelineStage(id: string, body: any) {
    const result = await this.prisma.pipelineStage.update({ where: { id }, data: body }).catch(() => {
      throw new NotFoundException("Stage not found");
    });
    await this.invalidateStages();
    return result;
  }

  async deletePipelineStage(id: string) {
    await this.prisma.pipelineStage.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Stage not found");
    });
    await this.invalidateStages();
    return { ok: true };
  }

  // ── Data management ──────────────────────────────────────────────────
  async exportAllData() {
    const [clients, leads, projects, tasks, invoices, employees, expenses, payments, proposals, milestones, contacts, attendance] = await Promise.all([
      this.prisma.client.findMany({ include: { contacts: true, documents: true } }),
      this.prisma.lead.findMany({ include: { activities: true, proposals: true, meetings: true } }),
      this.prisma.project.findMany({ include: { milestones: true, files: true, tasks: true } }),
      this.prisma.task.findMany(),
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.employee.findMany({ include: { attendance: true, leaveRequests: true, payrollRecords: true } }),
      this.prisma.expense.findMany(),
      this.prisma.payment.findMany(),
      this.prisma.proposal.findMany(),
      this.prisma.milestone.findMany(),
      this.prisma.clientContact.findMany(),
      this.prisma.attendance.findMany(),
    ]);
    return {
      exportDate: new Date().toISOString(),
      counts: { clients: clients.length, leads: leads.length, projects: projects.length, tasks: tasks.length, invoices: invoices.length, employees: employees.length, expenses: expenses.length, payments: payments.length },
      data: { clients, leads, projects, tasks, invoices, employees, expenses, payments, proposals, milestones, contacts, attendance },
    };
  }

  async deleteAllData() {
    await this.prisma.$transaction([
      this.prisma.leadActivity.deleteMany(),
      this.prisma.leadMeeting.deleteMany(),
      this.prisma.proposal.deleteMany(),
      this.prisma.lostReason.deleteMany(),
      this.prisma.lead.deleteMany(),
      this.prisma.taskDependency.deleteMany(),
      this.prisma.taskComment.deleteMany(),
      this.prisma.timeLog.deleteMany(),
      this.prisma.task.deleteMany(),
      this.prisma.estimateAccuracyLog.deleteMany(),
      this.prisma.performanceReview.deleteMany(),
      this.prisma.okr.deleteMany(),
      this.prisma.trainingEnrollment.deleteMany(),
      this.prisma.trainingCourse.deleteMany(),
      this.prisma.candidate.deleteMany(),
      this.prisma.holiday.deleteMany(),
      this.prisma.leaveBalance.deleteMany(),
      this.prisma.leaveRequest.deleteMany(),
      this.prisma.attendance.deleteMany(),
      this.prisma.payrollRecord.deleteMany(),
      this.prisma.utilizationLog.deleteMany(),
      this.prisma.attritionRiskFlag.deleteMany(),
      this.prisma.employee.deleteMany(),
      this.prisma.invoiceLineItem.deleteMany(),
      this.prisma.payment.deleteMany(),
      this.prisma.invoice.deleteMany(),
      this.prisma.expense.deleteMany(),
      this.prisma.creditBalance.deleteMany(),
      this.prisma.budget.deleteMany(),
      this.prisma.reconciliationRecord.deleteMany(),
      this.prisma.bankAccount.deleteMany(),
      this.prisma.financeAuditLog.deleteMany(),
      this.prisma.milestone.deleteMany(),
      this.prisma.projectFile.deleteMany(),
      this.prisma.projectRiskLog.deleteMany(),
      this.prisma.clientComment.deleteMany(),
      this.prisma.deliverableApproval.deleteMany(),
      this.prisma.portalActivityLog.deleteMany(),
      this.prisma.portalUser.deleteMany(),
      this.prisma.project.deleteMany(),
      this.prisma.clientHealthLog.deleteMany(),
      this.prisma.churnRiskFlag.deleteMany(),
      this.prisma.clientDocument.deleteMany(),
      this.prisma.clientContact.deleteMany(),
      this.prisma.client.deleteMany(),
      this.prisma.contentPost.deleteMany(),
      this.prisma.calendarEvent.deleteMany(),
      this.prisma.dailyTarget.deleteMany(),
      this.prisma.metricSnapshot.deleteMany(),
      this.prisma.correlationInsight.deleteMany(),
      this.prisma.executiveDigestLog.deleteMany(),
      this.prisma.reportDefinition.deleteMany(),
      this.prisma.notification.deleteMany(),
      this.prisma.notificationPreference.deleteMany(),
    ]);
    await this.cache.delPattern("*");
    return { ok: true };
  }
}