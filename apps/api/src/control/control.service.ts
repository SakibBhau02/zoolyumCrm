import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as bcrypt from "bcryptjs";
import { basename, join } from "path";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { randomInt } from "crypto";
import { findUploadedFile, sanitizeFilename, uploadsRoot } from "../common/file-storage";
import { decryptSecret, encryptSecret } from "../common/crypto";
import { invalidateAdminPolicyCache } from "../common/guards/admin-policy.guard";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { DEFAULT_LEAD_RULES, mergeLeadRules } from "../pulse/lead-rules.service";
import { CONTROL_MODULES, migrateModuleMatrix } from "../common/module-keys";

/** Modules that can be granted per-role permissions. These are the exact keys
 *  the API guards enforce (see common/module-keys.ts). */
export { CONTROL_MODULES };

const INTEGRATION_TYPES = ["ADS", "PAYMENT", "BANKING", "FX_RATE", "MESSAGING"] as const;

export const DEFAULT_SECURITY = {
  passwordMinLength: 8,
  requireNumber: true,
  requireUppercase: false,
  requireSymbol: false,
  sessionHours: 12,
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  ipAllowlist: [] as string[],
};

export const DEFAULT_SYSTEM = {
  maintenanceMode: false,
  maintenanceMessage: "We are performing scheduled maintenance. Please try again shortly.",
  featureFlags: {
    clientPortal: true,
    whatsapp: true,
    telegram: true,
    aiInsights: true,
    payroll: true,
  },
  auditRetentionDays: 365,
};

export const DEFAULT_EMAIL = {
  provider: "smtp",
  host: "",
  port: 587,
  secure: false,
  user: "",
  fromName: "Zoolyum",
  fromEmail: "",
  replyTo: "",
};

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
    // Dashboard planning inputs. Zero/blank hides the target line and lets
    // runway fall back to trailing spend.
    monthlyRevenueTarget: 0,
    monthlyFixedCost: 0,
    concentrationWarnPct: 50,
    concentrationCriticalPct: 60,
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
  /** Lead intake rules — mirrored in pulse/lead-rules.service (single source of truth). */
  leadRules: DEFAULT_LEAD_RULES,
};

/** Top-level keys that actually exist as columns on `Settings`. */
const SETTINGS_COLUMNS = [
  "companyProfile",
  "regional",
  "invoiceTemplate",
  "financeConfig",
  "pipelineStages",
  "leadCategories",
  "clientTiers",
  "leadRules",
  "taskStatuses",
  "taskAutomation",
  "departmentTaskTypes",
  "notifications",
  "integrations",
  "emailTemplates",
  "appearance",
];

/**
 * One statement instead of a long Prisma delete list: TRUNCATE ... CASCADE
 * follows every foreign key, so child tables that were previously missed
 * (ledger, punch logs, budgets, calendar, ads, portal threads) cannot be left
 * behind or block the wipe with an FK error.
 *
 * `Employee` is handled separately: `User.employeeId` points at it, so it is
 * nulled first and the employee rows are deleted after the truncate. This
 * keeps staff accounts, roles, settings and the audit trail intact.
 */
const DATA_WIPE_SQL = `
TRUNCATE TABLE
  "Client",
  "Lead",
  "Project",
  "Task",
  "PortalUser",
  "BankAccount",
  "Invoice",
  "JournalEntry",
  "ReportDefinition",
  "AdAccount",
  "CalendarEvent",
  "ContentPost",
  "DailyTarget",
  "MetricSnapshot",
  "CorrelationInsight",
  "ExecutiveDigestLog",
  "Notification",
  "NotificationPreference",
  "FinanceAuditLog",
  "Holiday",
  "Candidate",
  "TrainingCourse",
  "WorkdayOverride",
  "WhatsappMessageLog",
  "TelegramMessageLog",
  "TelegramLinkCode",
  "Attendance",
  "AttendanceCorrection",
  "LeaveBalance",
  "LeaveRequest",
  "PayrollRecord",
  "PerformanceReview",
  "Okr",
  "TrainingEnrollment",
  "UtilizationLog",
  "AttritionRiskFlag",
  "PunchLog",
  "EmployeeChecklist",
  "EmployeeChecklistItem",
  "TaskTimer",
  "TimeLog",
  "EstimateAccuracyLog"
RESTART IDENTITY CASCADE;
`;

@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // ── Audit trail ──────────────────────────────────────────────────────

  /** Fire-and-forget admin audit. Never blocks or breaks the mutation. */
  private async audit(
    actorId: string | undefined,
    action: string,
    entityType: string,
    entityId: string,
    before?: any,
    after?: any
  ) {
    try {
      await this.prisma.systemAuditLog.create({
        data: {
          actorUserId: actorId ?? null,
          action,
          entityType,
          entityId,
          beforeValue: before === undefined ? undefined : before,
          afterValue: after === undefined ? undefined : after,
        },
      });
    } catch {
      /* auditing must never fail the request */
    }
  }

  async auditLogs(query: any = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(query.pageSize) || 50));
    const where: any = {};
    if (query.action) where.action = String(query.action);
    if (query.entityType) where.entityType = String(query.entityType);
    if (query.actorUserId) where.actorUserId = String(query.actorUserId);
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        where.timestamp.lte = end;
      }
    }
    if (query.q) {
      const q = String(query.q);
      where.OR = [
        { action: { contains: q, mode: "insensitive" } },
        { entityType: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
      ];
    }

    const [rows, total, actionRows, entityRows] = await Promise.all([
      this.prisma.systemAuditLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.systemAuditLog.count({ where }),
      this.prisma.systemAuditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
      this.prisma.systemAuditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    ]);

    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    return {
      rows: rows.map((r) => ({
        ...r,
        actor: r.actorUserId ? actorMap.get(r.actorUserId) ?? null : null,
      })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      actions: actionRows.map((a) => a.action).filter(Boolean),
      entityTypes: entityRows.map((e) => e.entityType).filter(Boolean),
    };
  }

  // ── Roles ────────────────────────────────────────────────────────────

  async roles() {
    const rows = await this.prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: "asc" },
    });
    // Present the canonical matrix even for roles that have not been re-saved
    // since the module-key rename.
    return rows.map((r) => ({
      ...r,
      modulePermissions: migrateModuleMatrix(r.modulePermissions as any),
    }));
  }

  private normalizePermissions(input: any, existing?: any) {
    // Migrate legacy labels (CLIENTS→ACCOUNTS, LEADS→PULSE, PROJECTS→FLOW,
    // FINANCE→CAPITAL, INSIGHTS→INSIGHT) and keep every canonical key the
    // editor does not send. Rebuilding from the visible list alone used to
    // wipe grants for modules the UI did not know about.
    const out: Record<string, { view: boolean; edit: boolean; approve: boolean }> = migrateModuleMatrix(existing);
    for (const m of CONTROL_MODULES) {
      const p = input?.[m];
      if (p === undefined) continue;
      const edit = !!p.edit;
      const approve = !!p.approve;
      // Edit/approve imply view: a matrix with "edit" but no "view" would be
      // unusable, and the old code silently dropped the edit flag instead of
      // repairing it.
      const view = !!p.view || edit || approve;
      out[m] = { view, edit: view && edit, approve: view && approve };
    }
    return out;
  }

  async createRole(body: { name?: string; description?: string; modulePermissions?: any }, actorId?: string) {
    const name = String(body?.name ?? "").trim();
    if (name.length < 2) throw new BadRequestException("Role name must be at least 2 characters");
    const exists = await this.prisma.role.findUnique({ where: { name } });
    if (exists) throw new BadRequestException("A role with this name already exists");
    const role = await this.prisma.role.create({
      data: {
        name,
        description: body.description?.trim() || null,
        modulePermissions: this.normalizePermissions(body.modulePermissions),
      },
      include: { _count: { select: { users: true } } },
    });
    await this.audit(actorId, "role.create", "Role", role.id, undefined, { name: role.name });
    return role;
  }

  async updateRole(id: string, body: any, actorId?: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException("Role not found");
    if (role.name === "Owner") {
      if (body.name && body.name !== "Owner") throw new BadRequestException("The Owner role cannot be renamed");
      if (body.modulePermissions) throw new BadRequestException("Owner permissions are fixed (full access)");
    }
    if (body.name && body.name !== role.name) {
      const clash = await this.prisma.role.findUnique({ where: { name: body.name } });
      if (clash) throw new BadRequestException("A role with this name already exists");
    }
    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.modulePermissions !== undefined
          ? { modulePermissions: this.normalizePermissions(body.modulePermissions, role.modulePermissions) }
          : {}),
      },
      include: { _count: { select: { users: true } } },
    });
    await this.cache.del("users:list");
    // The permission matrix is baked into the JWT. Bump every member's
    // tokenVersion so a revoked permission takes effect immediately instead of
    // lingering until the token expires.
    if (body.modulePermissions !== undefined) {
      await this.prisma.user.updateMany({
        where: { roleId: id },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    await this.audit(actorId, "role.update", "Role", id, { name: role.name }, { name: updated.name });
    return updated;
  }

  async deleteRole(id: string, actorId?: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException("Role not found");
    if (role.name === "Owner") throw new BadRequestException("The Owner role cannot be deleted");
    if (role._count.users > 0) {
      throw new BadRequestException(
        `This role is assigned to ${role._count.users} user(s). Reassign them before deleting it.`
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.cache.del("users:list");
    await this.audit(actorId, "role.delete", "Role", id, { name: role.name });
    return { ok: true };
  }

  // ── Integrations ─────────────────────────────────────────────────────

  async integrations() {
    const rows = await this.prisma.integration.findMany({
      include: { connectedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(({ credentialsEnc, ...rest }) => {
      const raw = decryptSecret(credentialsEnc);
      let keys: string[] = [];
      if (raw) {
        try {
          keys = Object.keys(JSON.parse(raw));
        } catch {
          keys = [];
        }
      }
      return { ...rest, hasCredentials: !!credentialsEnc, credentialKeys: keys };
    });
  }

  async createIntegration(
    body: { providerName?: string; type?: string; credentials?: Record<string, any> },
    actorId?: string
  ) {
    const providerName = String(body?.providerName ?? "").trim();
    if (!providerName) throw new BadRequestException("Provider name is required");
    const type = INTEGRATION_TYPES.includes(body?.type as any) ? (body!.type as any) : "MESSAGING";
    const credentialsEnc = body?.credentials
      ? encryptSecret(JSON.stringify(body.credentials))
      : null;
    const row = await this.prisma.integration.create({
      data: { providerName, type, credentialsEnc },
    });
    await this.audit(actorId, "integration.create", "Integration", row.id, undefined, { providerName, type });
    return { ...row, credentialsEnc: undefined, hasCredentials: !!credentialsEnc };
  }

  async updateIntegration(
    id: string,
    body: { status?: string; credentials?: Record<string, any>; providerName?: string; type?: string },
    actorId?: string
  ) {
    const existing = await this.prisma.integration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Integration not found");
    const data: any = {};
    if (body.providerName !== undefined) data.providerName = String(body.providerName).trim();
    if (body.type !== undefined && INTEGRATION_TYPES.includes(body.type as any)) data.type = body.type;
    if (body.credentials !== undefined) {
      data.credentialsEnc =
        body.credentials && Object.keys(body.credentials).length
          ? encryptSecret(JSON.stringify(body.credentials))
          : null;
    }
    if (body.status === "CONNECTED" || body.status === "DISCONNECTED") {
      data.status = body.status;
      data.connectedAt = body.status === "CONNECTED" ? new Date() : null;
      data.connectedById = body.status === "CONNECTED" ? actorId ?? null : null;
    }
    const row = await this.prisma.integration.update({ where: { id }, data });
    await this.audit(actorId, "integration.update", "Integration", id, { status: existing.status }, {
      status: row.status,
      providerName: row.providerName,
    });
    return { ...row, credentialsEnc: undefined, hasCredentials: !!row.credentialsEnc };
  }

  async deleteIntegration(id: string, actorId?: string) {
    const row = await this.prisma.integration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Integration not found");
    await this.prisma.integration.delete({ where: { id } });
    await this.audit(actorId, "integration.delete", "Integration", id, { providerName: row.providerName });
    return { ok: true };
  }

  /**
   * Credential-level test. Without provider SDKs we can only prove the stored
   * config is present and parseable, so we report exactly that instead of a
   * fake "connected" state.
   */
  async testIntegration(id: string) {
    const row = await this.prisma.integration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Integration not found");
    const raw = decryptSecret(row.credentialsEnc);
    if (!raw) return { ok: false, message: "No credentials stored for this integration." };
    try {
      const parsed = JSON.parse(raw);
      const keys = Object.keys(parsed);
      if (!keys.length) return { ok: false, message: "Credentials object is empty." };
      const blank = keys.filter((k) => parsed[k] === "" || parsed[k] === null);
      if (blank.length) {
        return { ok: false, message: `Missing values for: ${blank.join(", ")}`, credentialKeys: keys };
      }
      return {
        ok: true,
        message: `Credentials are stored and well-formed (${keys.length} field(s)).`,
        credentialKeys: keys,
      };
    } catch {
      return { ok: false, message: "Stored credentials could not be parsed." };
    }
  }

  // ── Branding ─────────────────────────────────────────────────────────

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
          defaultCurrency: "BDT",
          defaultTerms: "Payment is due within 15 days of invoice date.",
        }
      );
    });
  }

  async updateBranding(body: any, actorId?: string) {
    const existing = await this.prisma.brandingConfig.findFirst();
    const tryDeleteOld = (oldUrl?: string | null, newUrl?: string | null) => {
      if (!oldUrl) return;
      if (newUrl === undefined) return;
      if (oldUrl === newUrl) return;
      if (!oldUrl.includes("uploads/branding")) return;
      try {
        const safe = sanitizeFilename(basename(oldUrl));
        const full = findUploadedFile("branding", safe);
        if (existsSync(full)) unlinkSync(full);
      } catch {}
    };
    if (existing) {
      tryDeleteOld(existing.logoDarkUrl, body.logoDarkUrl);
      tryDeleteOld(existing.logoLightUrl, body.logoLightUrl);
      tryDeleteOld((existing as any).logoUrl, body.logoUrl);
      tryDeleteOld((existing as any).signatureImageUrl, body.signatureImageUrl);
      tryDeleteOld((existing as any).logoJxlUrl, body.logoJxlUrl);
      tryDeleteOld((existing as any).logoDarkJxlUrl, body.logoDarkJxlUrl);
      tryDeleteOld((existing as any).logoLightJxlUrl, body.logoLightJxlUrl);
    }
    const result = existing
      ? await this.prisma.brandingConfig.update({ where: { id: existing.id }, data: body })
      : await this.prisma.brandingConfig.create({ data: body });
    await this.cache.del("control:branding");
    await this.cache.del("control:settings");
    await this.audit(actorId, "branding.update", "Branding", result.id, undefined, {
      appName: body.appName,
      primaryColor: body.primaryColor,
    });
    return result;
  }

  // ── Settings ─────────────────────────────────────────────────────────

  async getSettings(role?: string) {
    const full = await this.cache.wrap("control:settings", 60, () => this.loadFullSettings());
    if (role === "Owner" || role === "CONTROL") return full;
    // Non-admin modules (Accounts reads client tiers) need the workspace
    // sections, but never the security policy, SMTP credentials or flags.
    const { security: _sec, system: _sys, email: _em, adminConfig: _ac, ...safe } = full as any;
    return safe;
  }

  private async loadFullSettings() {
    const existing = await this.prisma.settings.findUnique({ where: { id: "default" } });
    const settings = existing ?? (await this.prisma.settings.create({ data: DEFAULT_SETTINGS as any }));
    const admin = ((settings as any).adminConfig ?? {}) as any;

    const merged: any = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      merged[key] = (settings as any)[key] ?? (DEFAULT_SETTINGS as any)[key];
    }
    const email = { ...DEFAULT_EMAIL, ...(admin.email ?? {}) } as any;
    const hasSmtpPassword = !!email.smtpPasswordEnc;
    delete email.smtpPasswordEnc;

    return {
      ...settings,
      ...merged,
      adminConfig: undefined,
      security: { ...DEFAULT_SECURITY, ...(admin.security ?? {}) },
      system: {
        ...DEFAULT_SYSTEM,
        ...(admin.system ?? {}),
        featureFlags: { ...DEFAULT_SYSTEM.featureFlags, ...(admin.system?.featureFlags ?? {}) },
      },
      email: { ...email, hasSmtpPassword },
    };
  }

  private mergeAdminConfig(current: any, body: any) {
    const next: any = { ...(current ?? {}) };
    if (body.security && typeof body.security === "object") {
      next.security = { ...DEFAULT_SECURITY, ...(current?.security ?? {}), ...body.security };
      next.security.passwordMinLength = Math.min(
        64,
        Math.max(6, Number(next.security.passwordMinLength) || 8)
      );
      next.security.maxLoginAttempts = Math.min(
        50,
        Math.max(1, Number(next.security.maxLoginAttempts) || 5)
      );
      next.security.lockoutMinutes = Math.min(
        1440,
        Math.max(1, Number(next.security.lockoutMinutes) || 15)
      );
      next.security.sessionHours = Math.min(720, Math.max(1, Number(next.security.sessionHours) || 12));
      next.security.ipAllowlist = Array.isArray(next.security.ipAllowlist)
        ? next.security.ipAllowlist.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
    }
    if (body.system && typeof body.system === "object") {
      next.system = {
        ...DEFAULT_SYSTEM,
        ...(current?.system ?? {}),
        ...body.system,
        featureFlags: {
          ...DEFAULT_SYSTEM.featureFlags,
          ...(current?.system?.featureFlags ?? {}),
          ...(body.system.featureFlags ?? {}),
        },
      };
      next.system.maintenanceMode = !!next.system.maintenanceMode;
      next.system.auditRetentionDays = Math.min(
        3650,
        Math.max(7, Number(next.system.auditRetentionDays) || 365)
      );
    }
    if (body.email && typeof body.email === "object") {
      const prev = current?.email ?? {};
      const { smtpPassword, ...rest } = body.email;
      next.email = { ...DEFAULT_EMAIL, ...prev, ...rest };
      if (typeof smtpPassword === "string" && smtpPassword.length > 0) {
        next.email.smtpPasswordEnc = encryptSecret(smtpPassword);
      }
      if (body.email.clearPassword) delete next.email.smtpPasswordEnc;
      delete next.email.hasSmtpPassword;
      delete next.email.clearPassword;
    }
    return next;
  }

  async updateSettings(body: any, actorId?: string) {
    if (!body || typeof body !== "object") throw new BadRequestException("Invalid settings payload");
    const existing = await this.prisma.settings.findUnique({ where: { id: "default" } });

    const data: any = {};
    for (const key of SETTINGS_COLUMNS) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.leadRules && typeof body.leadRules === "object") {
      const current = (existing as any)?.leadRules ?? DEFAULT_LEAD_RULES;
      data.leadRules = mergeLeadRules(current, body.leadRules);
    }

    const touchesAdmin = body.security !== undefined || body.system !== undefined || body.email !== undefined;
    if (touchesAdmin) {
      data.adminConfig = this.mergeAdminConfig((existing as any)?.adminConfig, body);
    }

    if (!Object.keys(data).length) throw new BadRequestException("No recognised settings fields were supplied");

    let result;
    try {
      result = existing
        ? await this.prisma.settings.update({ where: { id: "default" }, data })
        : await this.prisma.settings.create({ data: { ...DEFAULT_SETTINGS, ...data } as any });
    } catch (e: any) {
      throw new BadRequestException(`Settings could not be saved: ${e?.message ?? "invalid payload"}`);
    }

    await this.cache.del("control:settings");
    await this.cache.del("lead:rules");
    invalidateAdminPolicyCache();
    await this.audit(actorId, "settings.update", "Settings", "default", undefined, {
      sections: Object.keys(data).filter((k) => k !== "adminConfig"),
      admin: touchesAdmin,
    });
    return this.getSettings("Owner");
  }

  private async securityPolicy() {
    const s = await this.getSettings("Owner");
    return (s as any).security ?? DEFAULT_SECURITY;
  }

  /** Role name of the acting admin (used for Owner-only transitions). */
  private async actorRole(actorId?: string) {
    if (!actorId) return null;
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: { select: { name: true } } },
    });
    return actor?.role.name ?? null;
  }

  /** A CONTROL admin must never be able to touch an Owner account. */
  private async assertOwnerTarget(actorId: string | undefined, targetRoleName: string, action: string) {
    if (targetRoleName !== "Owner") return;
    if ((await this.actorRole(actorId)) !== "Owner") {
      throw new BadRequestException(`Only an Owner can ${action} an Owner account`);
    }
  }

  /** Only an Owner may grant the Owner role. */
  private async assertOwnerRoleGrant(actorId: string | undefined, roleId: string | undefined) {
    if (!roleId) return;
    const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: { name: true } });
    if (role?.name === "Owner" && (await this.actorRole(actorId)) !== "Owner") {
      throw new BadRequestException("Only an Owner can assign the Owner role");
    }
  }

  private assertPassword(password: string, policy: typeof DEFAULT_SECURITY, label = "Password") {
    const p = String(password ?? "");
    if (p.length < policy.passwordMinLength) {
      throw new BadRequestException(`${label} must be at least ${policy.passwordMinLength} characters`);
    }
    if (policy.requireNumber && !/\d/.test(p)) {
      throw new BadRequestException(`${label} must contain a number`);
    }
    if (policy.requireUppercase && !/[A-Z]/.test(p)) {
      throw new BadRequestException(`${label} must contain an uppercase letter`);
    }
    if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(p)) {
      throw new BadRequestException(`${label} must contain a symbol`);
    }
  }

  // ── Users ────────────────────────────────────────────────────────────

  private async assertNotLastOwner(userId: string, action: string) {
    const ownerCount = await this.prisma.user.count({
      where: { role: { name: "Owner" }, isActive: true },
    });
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (target?.role.name === "Owner" && ownerCount <= 1) {
      throw new BadRequestException(`Cannot ${action} the last active Owner`);
    }
  }

  async createUser(
    body: { name: string; email: string; password: string; roleId: string; employeeId?: string },
    actorId?: string
  ) {
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").toLowerCase().trim();
    if (!name) throw new BadRequestException("Name is required");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException("Enter a valid email address");
    if (!body?.roleId) throw new BadRequestException("Role is required");
    const policy = await this.securityPolicy();
    this.assertPassword(body?.password, policy);

    const [exists, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.role.findUnique({ where: { id: body.roleId } }),
    ]);
    if (exists) throw new BadRequestException("A user with this email already exists");
    if (!role) throw new BadRequestException("Selected role does not exist");
    await this.assertOwnerRoleGrant(actorId, body.roleId);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(body.password, 12),
        roleId: body.roleId,
        employeeId: body.employeeId ?? null,
      },
      include: { role: { select: { name: true } } },
    });
    await this.cache.del("users:list");
    await this.audit(actorId, "user.create", "User", user.id, undefined, {
      name: user.name,
      email: user.email,
      role: user.role.name,
    });
    const { passwordHash: _ph, tokenVersion: _tv, ...safe } = user as any;
    return safe;
  }

  async updateUser(id: string, body: any, actorId?: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException("User not found");
    await this.assertOwnerTarget(actorId, target.role.name, "modify");

    const data: any = {};
    for (const f of ["name", "email", "roleId", "employeeId"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.email !== undefined) {
      const email = String(body.email).toLowerCase().trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException("Enter a valid email address");
      data.email = email;
    }
    if (body.roleId !== undefined && body.roleId !== target.roleId) {
      if (target.role.name === "Owner") await this.assertNotLastOwner(id, "demote");
      await this.assertOwnerRoleGrant(actorId, body.roleId);
      const role = await this.prisma.role.findUnique({ where: { id: body.roleId } });
      if (!role) throw new BadRequestException("Selected role does not exist");
      data.tokenVersion = { increment: 1 };
    }
    if (body.isActive !== undefined) {
      if (!body.isActive) {
        if (id === actorId) throw new BadRequestException("You cannot deactivate your own account");
        await this.assertNotLastOwner(id, "deactivate");
        data.tokenVersion = { increment: 1 };
      }
      data.isActive = !!body.isActive;
    }
    if (body.password) {
      const policy = await this.securityPolicy();
      this.assertPassword(body.password, policy);
      data.passwordHash = await bcrypt.hash(body.password, 12);
      data.tokenVersion = { increment: 1 };
    }
    if (!Object.keys(data).length) throw new BadRequestException("Nothing to update");

    let user;
    try {
      user = await this.prisma.user.update({
        where: { id },
        data,
        include: { role: { select: { name: true } } },
      });
    } catch (e: any) {
      if (e?.code === "P2002") throw new BadRequestException("That email is already in use");
      throw e;
    }
    await this.cache.del("users:list");
    await this.audit(actorId, "user.update", "User", id, { name: target.name, role: target.role.name }, {
      name: user.name,
      email: user.email,
      role: user.role.name,
      isActive: user.isActive,
      passwordChanged: !!body.password,
    });
    const { passwordHash: _ph2, tokenVersion: _tv2, ...safe } = user as any;
    return safe;
  }

  async resetPassword(id: string, newPassword?: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw new NotFoundException("User not found");
    await this.assertOwnerTarget(actorId, user.role.name, "reset the password of");
    const policy = await this.securityPolicy();
    const generated = !newPassword || !String(newPassword).trim();
    const password = generated ? generatePassword(policy.passwordMinLength) : String(newPassword);
    this.assertPassword(password, policy);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        tokenVersion: { increment: 1 },
      },
    });
    await this.audit(actorId, "user.reset_password", "User", id, undefined, {
      email: user.email,
      generated,
    });
    // The generated password is returned exactly once; it is never persisted in
    // plaintext and never written to the audit log.
    return { id, email: user.email, temporaryPassword: generated ? password : undefined };
  }

  async changePassword(id: string, oldPassword: string, newPassword: string, actorId?: string, actorRole?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    // The route is documented as self-service. CONTROL-editors used to be able
    // to target any id (the old password was verified against the *victim*, and
    // a success bumped their tokenVersion, killing their sessions) — SEC-05.
    if (actorId && actorId !== id && actorRole !== "Owner") {
      throw new ForbiddenException("You can only change your own password");
    }
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new BadRequestException("Current password is incorrect");
    const policy = await this.securityPolicy();
    this.assertPassword(newPassword, policy);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        tokenVersion: { increment: 1 },
      },
    });
    await this.audit(actorId ?? id, "user.change_password", "User", id);
    return { ok: true };
  }

  async deleteUser(id: string, actorId?: string) {
    if (id === actorId) throw new BadRequestException("You cannot delete your own account");
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException("User not found");
    if (target.role.name === "Owner") await this.assertNotLastOwner(id, "delete");

    try {
      await this.prisma.user.delete({ where: { id } });
    } catch {
      throw new BadRequestException(
        "This user is linked to records (employees, invoices, etc.) and cannot be deleted. Deactivate the account instead."
      );
    }
    await this.cache.del("users:list");
    await this.audit(actorId, "user.delete", "User", id, { name: target.name, email: target.email });
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

  async createPipelineStage(body: { name: string; slaDays?: number }, actorId?: string) {
    if (!body?.name?.trim()) throw new BadRequestException("Stage name is required");
    const max = await this.prisma.pipelineStage.aggregate({ _max: { order: true } });
    const result = await this.prisma.pipelineStage.create({
      data: { name: body.name.trim(), slaDays: body.slaDays ?? 5, order: (max._max.order ?? -1) + 1 },
    });
    await this.invalidateStages();
    await this.audit(actorId, "pipeline.create", "PipelineStage", result.id, undefined, { name: result.name });
    return result;
  }

  async updatePipelineStage(id: string, body: any, actorId?: string) {
    const existing = await this.prisma.pipelineStage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Stage not found");
    const result = await this.prisma.pipelineStage.update({ where: { id }, data: body });
    await this.invalidateStages();
    await this.audit(actorId, "pipeline.update", "PipelineStage", id, { name: existing.name }, { name: result.name });
    return result;
  }

  async deletePipelineStage(id: string, actorId?: string) {
    const existing = await this.prisma.pipelineStage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Stage not found");
    await this.prisma.pipelineStage.delete({ where: { id } });
    await this.invalidateStages();
    await this.audit(actorId, "pipeline.delete", "PipelineStage", id, { name: existing.name });
    return { ok: true };
  }

  // ── System health ────────────────────────────────────────────────────

  /** Daily: drop audit rows older than the configured retention window. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneAuditLogs() {
    try {
      const settings: any = await this.getSettings("Owner");
      const days = Math.max(7, Number(settings?.system?.auditRetentionDays) || 365);
      const cutoff = new Date(Date.now() - days * 86_400_000);
      await this.prisma.systemAuditLog.deleteMany({ where: { timestamp: { lt: cutoff } } });
    } catch {
      /* retention must never crash the process */
    }
  }

  private dirSize(dir: string): number {
    try {
      let total = 0;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) total += this.dirSize(full);
        else {
          try {
            total += statSync(full).size;
          } catch {}
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  async health() {
    const started = Date.now();
    let dbOk = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    const dbLatencyMs = Date.now() - started;
    const redis = await this.cache.ping();

    const [users, activeUsers, clients, projects, invoices, tasks, auditEvents, lastAudit] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.client.count(),
        this.prisma.project.count(),
        this.prisma.invoice.count(),
        this.prisma.task.count(),
        this.prisma.systemAuditLog.count(),
        this.prisma.systemAuditLog.findFirst({
          orderBy: { timestamp: "desc" },
          select: { timestamp: true, action: true, entityType: true },
        }),
      ]);

    const mem = process.memoryUsage();
    const settings = await this.getSettings("Owner");
    const uploadsBytes = this.dirSize(uploadsRoot());

    return {
      ok: dbOk && redis !== "down",
      checkedAt: new Date(),
      version: process.env.npm_package_version ?? "0.1.0",
      environment: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
      database: { ok: dbOk, latencyMs: dbLatencyMs },
      cache: redis,
      process: {
        pid: process.pid,
        node: process.version,
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      },
      counts: { users, activeUsers, clients, projects, invoices, tasks, auditEvents },
      storage: {
        uploadsBytes,
        uploadsMb: Math.round((uploadsBytes / 1024 / 1024) * 100) / 100,
      },
      lastAudit,
      maintenanceMode: !!(settings as any).system?.maintenanceMode,
    };
  }

  // ── Data management ──────────────────────────────────────────────────

  async exportAllData(actorId?: string) {
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
    await this.audit(actorId, "data.export", "Workspace", "all", undefined, {
      clients: clients.length,
      leads: leads.length,
      projects: projects.length,
      invoices: invoices.length,
    });
    return {
      exportDate: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
      counts: {
        clients: clients.length,
        leads: leads.length,
        projects: projects.length,
        tasks: tasks.length,
        invoices: invoices.length,
        employees: employees.length,
        expenses: expenses.length,
        payments: payments.length,
      },
      data: { clients, leads, projects, tasks, invoices, employees, expenses, payments, proposals, milestones, contacts, attendance },
    };
  }

  async deleteAllData(actorId?: string) {
    await this.prisma.$transaction(
      async (tx) => {
        // Staff accounts survive the wipe; detach them from employee records so
        // the Employee delete below cannot touch `User`.
        await tx.$executeRawUnsafe(`UPDATE "User" SET "employeeId" = NULL`);
        await tx.$executeRawUnsafe(DATA_WIPE_SQL);
        await tx.$executeRawUnsafe(`DELETE FROM "Employee"`);
      },
      { timeout: 60_000 }
    );
    await this.cache.delPattern("*");
    // Audit after the wipe so the event survives; SystemAuditLog is intentionally
    // not part of the delete list - the trail must outlive the data.
    await this.audit(actorId, "data.delete_all", "Workspace", "all");
    return { ok: true };
  }
}

/** Cryptographically-random temporary password that satisfies the policy. */
function generatePassword(minLength: number): string {
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lower + upper + digits + symbols;
  const pick = (set: string) => set[randomInt(0, set.length)];
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  const target = Math.max(minLength, 12);
  while (chars.length < target) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
