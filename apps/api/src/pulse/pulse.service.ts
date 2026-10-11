import { Injectable, NotFoundException } from "@nestjs/common";
import { FollowUpStatus, Lead, LeadPriority, LeadStage, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { TasksService } from "../tasks/tasks.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  AddActivityDto,
  ConvertLeadDto,
  CreateFollowUpDto,
  CreateLeadDto,
  CreateMeetingDto,
  CreateProposalDto,
  MarkLostDto,
  UpdateFollowUpDto,
  UpdateLeadDto,
  UpdateMeetingDto,
  UpdateProposalDto,
} from "./dto/lead.dto";

const STAGE_PROBABILITY: Record<string, number> = {
  NEW: 0.1,
  CONTACTED: 0.25,
  QUALIFIED: 0.4,
  PROPOSAL_SENT: 0.5,
  NEGOTIATION: 0.75,
  WON: 1,
  LOST: 0,
};

const ACTIVE_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION"];

const SOURCE_BONUS: Record<string, number> = {
  REFERRAL: 15,
  WEBSITE: 10,
  LINKEDIN: 10,
  PARTNER: 10,
  FACEBOOK: 8,
  GOOGLE_ADS: 8,
  WHATSAPP: 8,
  EVENT: 6,
  INBOUND_PHONE: 6,
  EMAIL_CAMPAIGN: 5,
  EMAIL: 5,
  COLD_CALL: 3,
  COLD: 3,
  OTHER: 0,
};

const PRIORITY_BONUS: Record<string, number> = {
  URGENT: 8,
  HIGH: 5,
  MEDIUM: 0,
  LOW: -3,
};

const RESPONSE_TYPES = ["CALL", "EMAIL", "WHATSAPP", "LINKEDIN", "MEETING"];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

@Injectable()
export class PulseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService
  ) {}

  // ── Action → task automation (meetings & follow-ups) ────────────────────
  private async createActionTask(
    lead: Lead,
    opts: { assignToId?: string; taskTitle?: string; dueDate: Date; kind: "meeting" | "follow-up"; detail: string }
  ) {
    if (!opts.assignToId) return null;
    const title =
      opts.taskTitle?.trim() ||
      (opts.kind === "meeting" ? `Meeting: ${lead.name}` : `Follow-up: ${lead.name}`);
    const task = await this.tasks.create({
      title,
      description: `From ${lead.name}${lead.company ? ` (${lead.company})` : ""} — ${opts.detail}. Lead: ${lead.uid ?? lead.id}`,
      assignedToId: opts.assignToId,
      dueDate: opts.dueDate.toISOString(),
      priority: (["URGENT", "HIGH", "MEDIUM", "LOW"].includes(lead.priority) ? lead.priority : "MEDIUM") as any,
      taskType: opts.kind === "meeting" ? "meeting" : "follow-up",
      tags: ["lead"],
    });
    return { id: task.id, title: task.title, assigneeName: opts.assignToId };
  }

  // ── Scoring engine ──────────────────────────────────────────────────────
  private computeScore(
    lead: Pick<
      Lead,
      "source" | "vertical" | "estimatedDealSize" | "contactEmail" | "contactPhone" | "company" | "createdAt" | "priority"
    > & { activityCount: number }
  ): number {
    let s = 20;

    s += SOURCE_BONUS[lead.source] ?? 0;
    s += PRIORITY_BONUS[lead.priority] ?? 0;

    const verticalBonus: Record<string, number> = { EDUCATION: 10, D2C: 8, HEALTHCARE: 5, OTHER: 2 };
    s += verticalBonus[lead.vertical] ?? 0;

    const size = Number(lead.estimatedDealSize ?? 0);
    if (size >= 500000) s += 25;
    else if (size >= 200000) s += 20;
    else if (size >= 100000) s += 15;
    else if (size >= 50000) s += 10;
    else if (size > 0) s += 5;

    if (lead.contactEmail) s += 10;
    if (lead.contactPhone) s += 5;
    if (lead.company) s += 5;

    const ageDays = (Date.now() - lead.createdAt.getTime()) / 86400000;
    if (ageDays < 7) s += 10;
    else if (ageDays < 21) s += 5;
    else if (ageDays > 45) s -= 10;

    s += Math.min(lead.activityCount * 2, 10);

    return clamp(Math.round(s), 0, 100);
  }

  private async recomputeScore(lead: Lead): Promise<number> {
    const activityCount = await this.prisma.leadActivity.count({ where: { leadId: lead.id } });
    return this.computeScore({ ...lead, activityCount });
  }

  private async audit(action: string, entityId: string, afterValue?: object) {
    await this.prisma.systemAuditLog.create({
      data: { action, entityType: "Lead", entityId, afterValue: afterValue ?? undefined },
    });
  }

  // ── UID (LD-####) ───────────────────────────────────────────────────────
  private async nextUid(): Promise<string> {
    const leads = await this.prisma.lead.findMany({
      where: { uid: { not: null } },
      select: { uid: true },
    });
    let max = 0;
    for (const l of leads) {
      const m = /^LD-(\d+)$/.exec(l.uid ?? "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `LD-${String(max + 1).padStart(4, "0")}`;
  }

  // ── Field diff helper (activity history) ────────────────────────────────
  private diffFields(oldLead: Partial<Record<string, unknown>>, dto: Record<string, unknown>) {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const before = oldLead[key];
      if (before !== value) changes[key] = { old: before ?? null, new: value };
    }
    return changes;
  }

  // ── Summary (Redis cache-aside, 30s TTL; invalidated on every write) ────
  async summary() {
    return this.cache.wrap("pulse:summary", 30, () => this.computeSummary());
  }

  private async computeSummary() {
    const [leads, stages, categories] = await Promise.all([
      this.prisma.lead.findMany({ include: { assignedTo: { select: { id: true, name: true } } } }),
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } }),
      this.prisma.leadCategory.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const active = leads.filter((l) => !["WON", "LOST"].includes(l.stage));
    const pipelineValue = active.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0);
    const weightedForecast = active.reduce(
      (s, l) => s + Number(l.estimatedDealSize ?? 0) * (STAGE_PROBABILITY[l.stage] ?? 0),
      0
    );
    const won = leads.filter((l) => l.stage === "WON").length;
    const lost = leads.filter((l) => l.stage === "LOST").length;
    const now = Date.now();
    const hotLeads = active.filter((l) => (l.leadScore ?? 0) >= 70).length;
    const staleLeads = active.filter(
      (l) =>
        !l.lastContactedAt &&
        now - l.createdAt.getTime() > 7 * 86400000
    ).length;
    const byStage = stages.map((st) => {
      const stage = st.name.toUpperCase().replace(/\s+/g, "_") as LeadStage;
      return {
        id: st.id,
        name: st.name,
        order: st.order,
        slaDays: st.slaDays,
        count: leads.filter((l) => l.stage === stage).length,
        value: leads.filter((l) => l.stage === stage).reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0),
      };
    });
    const bySource = [...new Set(leads.map((l) => l.source))].map((source) => {
      const group = leads.filter((l) => l.source === source);
      const groupWon = group.filter((l) => l.stage === "WON").length;
      return {
        source,
        count: group.length,
        won: groupWon,
        conversionRate: group.length ? Math.round((groupWon / group.length) * 100) : null,
        value: group.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0),
      };
    });
    const byOwner = [...new Set(leads.map((l) => l.assignedToId ?? ""))]
      .filter(Boolean)
      .map((ownerId) => {
        const group = leads.filter((l) => l.assignedToId === ownerId);
        const groupWon = group.filter((l) => l.stage === "WON").length;
        return {
          ownerId,
          ownerName: group[0]?.assignedTo?.name ?? "Unassigned",
          count: group.length,
          won: groupWon,
          conversionRate: group.length ? Math.round((groupWon / group.length) * 100) : null,
          value: group.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0),
        };
      });
    const followUpsDue = active.filter(
      (l) => l.nextFollowUpAt && l.nextFollowUpAt.getTime() <= now
    ).length;
    const urgent = active.filter((l) => l.priority === "URGENT").length;
    const avgResponseHours = this.avgResponseHours(leads);
    const temperatureCounts = {
      HOT: active.filter((l) => l.temperature === "HOT").length,
      WARM: active.filter((l) => l.temperature === "WARM").length,
      COLD: active.filter((l) => l.temperature === "COLD").length,
    };
    const categoryCounts = Object.fromEntries(
      categories.map((c) => [c.name, leads.filter((l) => l.leadCategoryId === c.id).length])
    );
    return {
      totalLeads: leads.length,
      activeLeads: active.length,
      pipelineValue,
      weightedForecast,
      won,
      lost,
      winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      hotLeads,
      staleLeads,
      avgScore: active.length ? Math.round(active.reduce((s, l) => s + (l.leadScore ?? 0), 0) / active.length) : null,
      followUpsDue,
      urgentCount: urgent,
      avgResponseHours,
      starredCount: leads.filter((l) => l.starred).length,
      avgProbability: active.length ? Math.round(active.reduce((s, l) => s + (l.probability ?? 0), 0) / active.length) : null,
      temperatureCounts,
      categoryCounts,
      byStage,
      bySource,
      byOwner,
    };
  }

  private async invalidateSummary() {
    await this.cache.del("pulse:summary");
    await this.cache.del("insight:overview");
    await this.cache.del("insight:performance");
    await this.cache.del("dashboard:overview");
  }

  private avgResponseHours(leads: Lead[]): number | null {
    const withResponse = leads.filter((l) => l.firstResponseAt && l.createdAt);
    if (!withResponse.length) return null;
    const total = withResponse.reduce((s, l) => {
      const hrs = (l.firstResponseAt!.getTime() - l.createdAt.getTime()) / 3600000;
      return s + Math.max(0, hrs);
    }, 0);
    return Math.round((total / withResponse.length) * 10) / 10;
  }

  // ── List with filters (paginated) ──────────────────────────────────────
  async list(query: {
    q?: string;
    stage?: string;
    assignedToId?: string;
    source?: string;
    vertical?: string;
    priority?: string;
    temperature?: string;
    categoryId?: string;
    starred?: string;
    followUpDue?: string;
    createdAfter?: string;
    minScore?: string;
    page?: string;
    pageSize?: string;
  }) {
    const minScore = query.minScore ? Number(query.minScore) : undefined;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 100));
    const where: Prisma.LeadWhereInput = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { company: { contains: query.q, mode: "insensitive" } },
              { contactEmail: { contains: query.q, mode: "insensitive" } },
              { contactPhone: { contains: query.q, mode: "insensitive" } },
              { uid: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.stage ? { stage: query.stage as LeadStage } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.source ? { source: query.source as any } : {}),
      ...(query.vertical ? { vertical: query.vertical as any } : {}),
      ...(query.priority ? { priority: query.priority as LeadPriority } : {}),
      ...(query.temperature ? { temperature: query.temperature as any } : {}),
      ...(query.categoryId ? { leadCategoryId: query.categoryId } : {}),
      ...(query.starred === "true" ? { starred: true } : {}),
      ...(query.followUpDue ? { nextFollowUpAt: { lte: new Date(query.followUpDue + "T23:59:59.999") } } : {}),
      ...(query.createdAfter ? { createdAt: { gte: new Date(query.createdAfter + "T00:00:00.000") } } : {}),
      ...(minScore !== undefined && !Number.isNaN(minScore) ? { leadScore: { gte: minScore } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: {
          id: true,
          uid: true,
          name: true,
          company: true,
          contactEmail: true,
          contactPhone: true,
          source: true,
          vertical: true,
          temperature: true,
          priority: true,
          stage: true,
          probability: true,
          leadScore: true,
          starred: true,
          tags: true,
          estimatedDealSize: true,
          currency: true,
          nextFollowUpAt: true,
          lastContactedAt: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true } },
          leadCategory: { select: { id: true, name: true, color: true } },
          lostReason: { select: { reasonCategory: true } },
          activities: { orderBy: { loggedAt: "desc" }, take: 1 },
          proposals: { orderBy: { versionNumber: "desc" }, take: 1 },
          meetings: { where: { status: "SCHEDULED" }, orderBy: { scheduledAt: "asc" }, take: 1 },
          followUps: { orderBy: { date: "asc" }, take: 1 },
        },
        orderBy: [{ priority: "desc" }, { leadScore: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // ── Create (with duplicate detection) ───────────────────────────────────
  async create(dto: CreateLeadDto, userId?: string) {
    const dupQuery = {
      OR: [
        ...(dto.contactEmail ? [{ contactEmail: dto.contactEmail }] : []),
        ...(dto.contactPhone ? [{ contactPhone: dto.contactPhone }] : []),
      ],
    };
    const duplicates = dupQuery.OR.length
      ? await this.prisma.lead.findMany({
          where: {
            AND: [dupQuery, { stage: { in: ACTIVE_STAGES } }],
          },
          select: { id: true, name: true, company: true, stage: true, leadScore: true },
        })
      : [];

    const uid = await this.nextUid();
    const lead = await this.prisma.lead.create({
      data: {
        name: dto.name,
        company: dto.company,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        source: dto.source,
        vertical: dto.vertical,
        temperature: dto.temperature,
        leadCategoryId: dto.categoryId,
        probability: dto.probability,
        starred: dto.starred,
        tags: dto.tags,
        website: dto.website,
        pageLink: dto.pageLink,
        uid,
        priority: dto.priority,
        estimatedDealSize: dto.estimatedDealSize ?? undefined,
        currency: dto.currency ?? "BDT",
        nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined,
        assignedToId: dto.assignedToId,
        notes: dto.notes,
        stage: "NEW",
        stageEnteredAt: new Date(),
      },
    });
    const score = await this.recomputeScore(lead);
    const updated = await this.prisma.lead.update({ where: { id: lead.id }, data: { leadScore: score } });
    await this.prisma.leadActivity.create({
      data: { leadId: lead.id, type: "CREATED", content: "Lead created", loggedById: userId },
    });
    if (dto.notes) {
      await this.prisma.leadNote.create({
        data: { leadId: lead.id, content: dto.notes, createdById: userId },
      });
    }
    await this.audit("LEAD_CREATED", lead.id);

    if (duplicates.length) {
      await this.audit("DUPLICATE_WARNING", lead.id, { matches: duplicates.map((d) => d.name) });
    }
    if (dto.assignedToId && dto.assignedToId !== userId) {
      try {
        await this.notifications.create(
          dto.assignedToId,
          "LEAD_ASSIGNED",
          "New lead assigned",
          `"${lead.name}"${lead.company ? ` (${lead.company})` : ""} was assigned to you.`,
          "/pulse"
        );
      } catch {}
    }
    await this.invalidateSummary();
    return { ...updated, duplicateWarnings: duplicates };
  }

  // ── Update ──────────────────────────────────────────────────────────────
  async update(id: string, dto: UpdateLeadDto, userId?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");

    const stageChanged = dto.stage && dto.stage !== lead.stage;
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        name: dto.name,
        company: dto.company,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        source: dto.source,
        vertical: dto.vertical,
        temperature: dto.temperature,
        leadCategoryId: dto.categoryId,
        probability: dto.probability,
        starred: dto.starred,
        tags: dto.tags,
        website: dto.website,
        pageLink: dto.pageLink,
        priority: dto.priority,
        stage: dto.stage,
        stageEnteredAt: stageChanged ? new Date() : undefined,
        estimatedDealSize: dto.estimatedDealSize,
        currency: dto.currency,
        nextFollowUpAt: dto.nextFollowUpAt === null ? null : dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined,
        assignedToId: dto.assignedToId,
        notes: dto.notes,
      },
    });

    const score = await this.recomputeScore(updated);
    await this.prisma.lead.update({ where: { id }, data: { leadScore: score } });

    const changes = this.diffFields(lead, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.company !== undefined && { company: dto.company }),
      ...(dto.contactEmail !== undefined && { contactEmail: dto.contactEmail }),
      ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
      ...(dto.source !== undefined && { source: dto.source }),
      ...(dto.vertical !== undefined && { vertical: dto.vertical }),
      ...(dto.temperature !== undefined && { temperature: dto.temperature }),
      ...(dto.categoryId !== undefined && { category: dto.categoryId }),
      ...(dto.probability !== undefined && { probability: dto.probability }),
      ...(dto.starred !== undefined && { starred: dto.starred }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
      ...(dto.website !== undefined && { website: dto.website }),
      ...(dto.pageLink !== undefined && { pageLink: dto.pageLink }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.estimatedDealSize !== undefined && { estimatedDealSize: dto.estimatedDealSize }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    });
    if (Object.keys(changes).length > 0) {
      if (dto.categoryId !== undefined && dto.categoryId !== lead.leadCategoryId) {
        const [oldCat, newCat] = await Promise.all([
          lead.leadCategoryId ? this.prisma.leadCategory.findUnique({ where: { id: lead.leadCategoryId } }) : null,
          dto.categoryId ? this.prisma.leadCategory.findUnique({ where: { id: dto.categoryId } }) : null,
        ]);
        changes.category = { old: oldCat?.name ?? "None", new: newCat?.name ?? "None" };
      }
      await this.prisma.leadActivity.create({
        data: {
          leadId: id,
          type: "UPDATED",
          content: `Updated ${Object.keys(changes).length} field(s)`,
          changes: changes as any,
          loggedById: userId,
        },
      });
    }
    if (stageChanged) {
      await this.prisma.leadActivity.create({
        data: {
          leadId: id,
          type: "STAGE_CHANGED",
          content: `Stage changed from ${lead.stage} to ${dto.stage}`,
          changes: { stage: { old: lead.stage, new: dto.stage } } as any,
          loggedById: userId,
        },
      });
      await this.audit("LEAD_STAGE_CHANGED", id, { from: lead.stage, to: dto.stage });
      if (dto.stage === "WON") {
        try {
          await this.notifications.notifyRole(
            "Owner",
            "LEAD_ASSIGNED",
            "🎉 Deal won",
            `"${updated.name}"${updated.company ? ` (${updated.company})` : ""} just closed.`,
            "/pulse",
            userId
          );
        } catch {}
      }
    }
    const reassigned = dto.assignedToId !== undefined && dto.assignedToId !== lead.assignedToId;
    if (reassigned && dto.assignedToId && dto.assignedToId !== userId) {
      try {
        await this.notifications.create(
          dto.assignedToId,
          "LEAD_ASSIGNED",
          "Lead reassigned to you",
          `"${updated.name}"${updated.company ? ` (${updated.company})` : ""} was assigned to you.`,
          "/pulse"
        );
      } catch {}
    }
    await this.invalidateSummary();
    return this.detail(id);
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  async remove(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");
    await this.audit("LEAD_DELETED", id, { name: lead.name });
    await this.prisma.lead.delete({ where: { id } });
    await this.invalidateSummary();
    return { deleted: true };
  }

  // ── Convert to client + auto onboarding project ─────────────────────────
  async convert(id: string, dto: ConvertLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.convertedClientId) throw new Error("Lead already converted");

    const latestProposal = await this.prisma.proposal.findFirst({
      where: { leadId: id },
      orderBy: [{ status: "desc" }, { versionNumber: "desc" }],
    });

    const client = await this.prisma.client.create({
      data: {
        companyName: dto.companyName || lead.company || lead.name,
        industryVertical: dto.vertical ?? lead.vertical,
        accountOwnerId: dto.accountOwnerId ?? lead.assignedToId,
        healthScore: dto.healthScore ?? 80,
        healthLevel: "GREEN",
        contractStartDate: new Date(),
      },
    });

    if (dto.contactName || lead.contactEmail || lead.contactPhone) {
      await this.prisma.clientContact.create({
        data: {
          clientId: client.id,
          name: dto.contactName ?? lead.name,
          email: dto.contactEmail ?? lead.contactEmail,
          phone: dto.contactPhone ?? lead.contactPhone,
          isPrimary: true,
        },
      });
    }

    const project = await this.prisma.project.create({
      data: {
        clientId: client.id,
        name: dto.projectName || `${client.companyName} — Onboarding`,
        type: "FIXED",
        status: "PLANNING",
        startDate: new Date(),
        assignedPmId: dto.accountOwnerId ?? lead.assignedToId,
        budgetAmount: lead.estimatedDealSize ?? undefined,
        sourceLeadId: id,
        sourceProposalId: latestProposal?.id,
      },
    });

    await this.prisma.lead.update({
      where: { id },
      data: { stage: "WON", convertedClientId: client.id, leadScore: 100 },
    });

    await this.audit("LEAD_CONVERTED", id, { clientId: client.id, projectId: project.id });
    await this.invalidateSummary();
    await this.cache.del("accounts:overview");
    await this.cache.delPattern("accounts:list:*");
    await this.cache.del("insight:client-health");
    await this.cache.del("flow:overview");
    await this.cache.delPattern("flow:list:*");
    await this.cache.del("tasks:stats");
    await this.cache.delPattern("tasks:list:*");
    return { client, project, leadId: id };
  }

  // ── Mark lost / reopen ──────────────────────────────────────────────────
  async markLost(id: string, dto: MarkLostDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.stage === "WON") throw new Error("Won leads cannot be marked lost");

    await this.prisma.lostReason.upsert({
      where: { leadId: id },
      create: { leadId: id, reasonCategory: dto.reasonCategory, notes: dto.notes },
      update: { reasonCategory: dto.reasonCategory, notes: dto.notes, recordedAt: new Date() },
    });
    await this.prisma.lead.update({ where: { id }, data: { stage: "LOST" } });
    await this.audit("LEAD_LOST", id, { reasonCategory: dto.reasonCategory });
    await this.invalidateSummary();
    return this.detail(id);
  }

  async reopen(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");

    await this.prisma.lostReason.deleteMany({ where: { leadId: id } });
    await this.prisma.lead.update({ where: { id }, data: { stage: "NEW", stageEnteredAt: new Date() } });
    const score = await this.recomputeScore(lead);
    await this.prisma.lead.update({ where: { id }, data: { leadScore: score } });
    await this.audit("LEAD_REOPENED", id);
    await this.invalidateSummary();
    return this.detail(id);
  }

  // ── Detail ──────────────────────────────────────────────────────────────
  async detail(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true } },
        leadCategory: true,
        activities: { include: { loggedBy: { select: { name: true } } }, orderBy: { loggedAt: "desc" } },
        proposals: { orderBy: { versionNumber: "desc" } },
        meetings: { orderBy: { scheduledAt: "desc" } },
        followUps: { orderBy: { date: "desc" } },
        notesList: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
        attachments: { include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
        lostReason: true,
        client: { select: { id: true, companyName: true } },
        projects: { select: { id: true, name: true, status: true } },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  // ── Activities ──────────────────────────────────────────────────────────
  async addActivity(id: string, dto: AddActivityDto, loggedById?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");

    const activity = await this.prisma.leadActivity.create({
      data: { leadId: id, type: dto.type, content: dto.content, loggedById },
      include: { loggedBy: { select: { name: true } } },
    });

    const firstResponse =
      !lead.firstResponseAt && RESPONSE_TYPES.includes(dto.type) ? new Date() : undefined;
    await this.prisma.lead.update({
      where: { id },
      data: { lastContactedAt: new Date(), firstResponseAt: firstResponse },
    });
    const score = await this.recomputeScore(lead);
    await this.prisma.lead.update({ where: { id }, data: { leadScore: score } });
    await this.invalidateSummary();
    return activity;
  }

  // ── Meetings ────────────────────────────────────────────────────────────
  async addMeeting(id: string, dto: CreateMeetingDto, createdById?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");

    const meeting = await this.prisma.leadMeeting.create({
      data: {
        leadId: id,
        title: dto.title,
        type: dto.type,
        scheduledAt: new Date(dto.scheduledAt),
        durationMins: dto.durationMins ?? 30,
        meetingLink: dto.meetingLink,
        location: dto.location,
        attendees: dto.attendees,
        notes: dto.notes,
        createdById,
      },
    });

    const scheduled = new Date(dto.scheduledAt);
    await this.prisma.lead.update({
      where: { id },
      data: {
        lastContactedAt: new Date(),
        nextFollowUpAt: scheduled.getTime() > Date.now() ? scheduled : undefined,
      },
    });
    const createdTask = await this.createActionTask(lead, {
      assignToId: dto.assignToId,
      taskTitle: dto.taskTitle,
      dueDate: scheduled,
      kind: "meeting",
      detail: `${meeting.title} (${meeting.type}) — ${scheduled.toISOString()}${meeting.meetingLink ? ` — ${meeting.meetingLink}` : ""}`,
    });
    await this.audit("MEETING_SCHEDULED", id, { meetingTitle: dto.title, at: scheduled.toISOString(), taskCreated: !!createdTask });
    if (lead.assignedToId && lead.assignedToId !== createdById) {
      try {
        await this.notifications.create(
          lead.assignedToId,
          "MEETING_SCHEDULED",
          "Meeting scheduled",
          `"${meeting.title}" with ${lead.name} — ${scheduled.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`,
          "/pulse"
        );
      } catch {}
    }
    await this.invalidateSummary();
    return { ...meeting, createdTask };
  }

  async updateMeeting(leadId: string, meetingId: string, dto: UpdateMeetingDto) {
    const meeting = await this.prisma.leadMeeting.findFirst({ where: { id: meetingId, leadId } });
    if (!meeting) throw new NotFoundException("Meeting not found");

    const wasCompleted = meeting.status === "COMPLETED";
    const updated = await this.prisma.leadMeeting.update({
      where: { id: meetingId },
      data: {
        title: dto.title,
        type: dto.type,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        durationMins: dto.durationMins,
        meetingLink: dto.meetingLink,
        location: dto.location,
        attendees: dto.attendees,
        notes: dto.notes,
        status: dto.status,
      },
    });

    const touchData: { lastContactedAt?: Date; nextFollowUpAt?: Date | null } = {};
    if (dto.scheduledAt) {
      const sched = new Date(dto.scheduledAt);
      touchData.nextFollowUpAt = sched.getTime() > Date.now() ? sched : null;
    }
    if (dto.status === "COMPLETED" && !wasCompleted) {
      touchData.lastContactedAt = new Date();
      await this.prisma.leadActivity.create({
        data: {
          leadId,
          type: "MEETING",
          content: `Meeting done: ${updated.title}${updated.notes ? ` — ${updated.notes}` : ""}`,
        },
      });
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (lead) {
        const score = await this.recomputeScore(lead);
        await this.prisma.lead.update({ where: { id: leadId }, data: { leadScore: score } });
      }
    }
    if (Object.keys(touchData).length) {
      await this.prisma.lead.update({ where: { id: leadId }, data: touchData });
    }
    await this.invalidateSummary();
    return updated;
  }

  async removeMeeting(leadId: string, meetingId: string) {
    const meeting = await this.prisma.leadMeeting.findFirst({ where: { id: meetingId, leadId } });
    if (!meeting) throw new NotFoundException("Meeting not found");
    await this.prisma.leadMeeting.delete({ where: { id: meetingId } });
    return { deleted: true };
  }

  // ── Follow-ups (v0-crm subsystem) ───────────────────────────────────────
  private async recalcNextFollowUp(leadId: string) {
    const next = await this.prisma.leadFollowUp.findFirst({
      where: { leadId, status: "SCHEDULED" },
      orderBy: { date: "asc" },
    });
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { nextFollowUpAt: next?.date ?? null },
    });
  }

  async getFollowUps(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return this.prisma.leadFollowUp.findMany({
      where: { leadId },
      orderBy: [{ status: "asc" }, { date: "asc" }],
    });
  }

  async addFollowUp(leadId: string, dto: CreateFollowUpDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    const followUp = await this.prisma.leadFollowUp.create({
      data: { leadId, date: new Date(dto.date), notes: dto.notes ?? "" },
    });
    const createdTask = await this.createActionTask(lead, {
      assignToId: dto.assignToId,
      taskTitle: dto.taskTitle,
      dueDate: new Date(dto.date),
      kind: "follow-up",
      detail: `Follow-up ${new Date(dto.date).toISOString()}${dto.notes ? ` — ${dto.notes}` : ""}`,
    });
    await this.recalcNextFollowUp(leadId);
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: "NOTE",
        content: `Follow-up scheduled for ${new Date(dto.date).toISOString()}${dto.notes ? ` — ${dto.notes}` : ""}${createdTask ? " (task assigned)" : ""}`,
      },
    });
    await this.audit("FOLLOW_UP_SCHEDULED", leadId, { date: dto.date, taskCreated: !!createdTask });
    if (lead.assignedToId) {
      try {
        await this.notifications.create(
          lead.assignedToId,
          "FOLLOWUP_SCHEDULED",
          "Follow-up scheduled",
          `${lead.name} — ${new Date(dto.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${dto.notes ? ` · ${dto.notes}` : ""}`,
          "/pulse"
        );
      } catch {}
    }
    await this.invalidateSummary();
    return { ...followUp, createdTask };
  }

  async updateFollowUp(leadId: string, followUpId: string, dto: UpdateFollowUpDto) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, leadId },
    });
    if (!followUp) throw new NotFoundException("Follow-up not found");

    const updated = await this.prisma.leadFollowUp.update({
      where: { id: followUpId },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        notes: dto.notes,
        status: dto.status,
      },
    });
    await this.recalcNextFollowUp(leadId);
    if (dto.status && dto.status !== followUp.status) {
      await this.prisma.leadActivity.create({
        data: {
          leadId,
          type: "NOTE",
          content: `Follow-up marked ${dto.status.toLowerCase()}${followUp.notes ? ` — ${followUp.notes}` : ""}`,
        },
      });
    }
    await this.invalidateSummary();
    return updated;
  }

  async removeFollowUp(leadId: string, followUpId: string) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, leadId },
    });
    if (!followUp) throw new NotFoundException("Follow-up not found");
    await this.prisma.leadFollowUp.delete({ where: { id: followUpId } });
    await this.recalcNextFollowUp(leadId);
    await this.invalidateSummary();
    return { deleted: true };
  }

  // ── Notes (v0-crm note history) ─────────────────────────────────────────
  async addNote(leadId: string, content: string, userId?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    const note = await this.prisma.leadNote.create({
      data: { leadId, content, createdById: userId },
      include: { createdBy: { select: { name: true } } },
    });
    await this.prisma.leadActivity.create({
      data: { leadId, type: "NOTE", content, loggedById: userId },
    });
    await this.audit("LEAD_NOTE_ADDED", leadId, { noteId: note.id });
    return note;
  }

  async updateNote(leadId: string, noteId: string, content: string) {
    const note = await this.prisma.leadNote.findFirst({ where: { id: noteId, leadId } });
    if (!note) throw new NotFoundException("Note not found");
    return this.prisma.leadNote.update({
      where: { id: noteId },
      data: { content },
      include: { createdBy: { select: { name: true } } },
    });
  }

  async removeNote(leadId: string, noteId: string) {
    const note = await this.prisma.leadNote.findFirst({ where: { id: noteId, leadId } });
    if (!note) throw new NotFoundException("Note not found");
    await this.prisma.leadNote.delete({ where: { id: noteId } });
    return { deleted: true };
  }

  // ── Attachments (reference files) ───────────────────────────────────────
  async addAttachment(
    leadId: string,
    file: Express.Multer.File,
    title?: string,
    userId?: string
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (!file) throw new Error("No file uploaded");

    const attachment = await this.prisma.leadAttachment.create({
      data: {
        leadId,
        title: title?.trim() || null,
        fileUrl: `/api/pulse/uploads/${file.filename}`,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { name: true } } },
    });
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: "ATTACHMENT",
        content: `Attachment uploaded: ${file.originalname}${title?.trim() ? ` (${title.trim()})` : ""}`,
        loggedById: userId,
      },
    });
    await this.audit("LEAD_ATTACHMENT_ADDED", leadId, { filename: file.originalname });
    return attachment;
  }

  async removeAttachment(leadId: string, attachmentId: string) {
    const attachment = await this.prisma.leadAttachment.findFirst({
      where: { id: attachmentId, leadId },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    await this.prisma.leadAttachment.delete({ where: { id: attachmentId } });
    return { deleted: true };
  }

  // ── Categories (user-defined) ───────────────────────────────────────────
  async listCategories() {
    return this.cache.wrap("pulse:categories", 300, () =>
      this.prisma.leadCategory.findMany({ orderBy: { createdAt: "asc" } })
    );
  }

  async createCategory(name: string, color?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name is required");
    const cat = await this.prisma.leadCategory.create({ data: { name: trimmed, color: color ?? null } });
    await this.cache.del("pulse:categories");
    await this.invalidateSummary();
    return cat;
  }

  async deleteCategory(id: string) {
    const cat = await this.prisma.leadCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException("Category not found");
    await this.prisma.leadCategory.delete({ where: { id } });
    await this.cache.del("pulse:categories");
    await this.invalidateSummary();
    return { deleted: true };
  }

  // ── Proposals ───────────────────────────────────────────────────────────
  // Move an early-stage lead to PROPOSAL_SENT on first send (never backwards,
  // never touches WON/LOST).
  private async advanceStageOnSend(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { stage: true } });
    if (lead && ["NEW", "CONTACTED", "QUALIFIED"].includes(lead.stage)) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { stage: "PROPOSAL_SENT", stageEnteredAt: new Date(), lastContactedAt: new Date() },
      });
      await this.invalidateSummary();
    } else {
      await this.prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });
    }
  }

  async addProposal(id: string, dto: CreateProposalDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead not found");

    const last = await this.prisma.proposal.findFirst({
      where: { leadId: id },
      orderBy: { versionNumber: "desc" },
    });
    const status = dto.status === "SENT" ? "SENT" : "DRAFT";
    const proposal = await this.prisma.proposal.create({
      data: {
        leadId: id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        fileUrl: dto.fileUrl,
        portalLink: dto.portalLink,
        status,
        sentDate: status === "SENT" ? new Date() : undefined,
      },
    });
    await this.audit("PROPOSAL_CREATED", id, { version: proposal.versionNumber });
    if (status === "SENT") {
      await this.advanceStageOnSend(id);
      await this.audit("PROPOSAL_SENT", id, { version: proposal.versionNumber });
    }
    return proposal;
  }

  async updateProposal(leadId: string, proposalId: string, dto: UpdateProposalDto) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, leadId },
    });
    if (!proposal) throw new NotFoundException("Proposal not found");

    const firstSend = dto.status === "SENT" && !proposal.sentDate;
    const updated = await this.prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: dto.status,
        fileUrl: dto.fileUrl,
        portalLink: dto.portalLink,
        sentDate: firstSend ? new Date() : undefined,
      },
    });
    if (dto.status === "SENT" || dto.status === "ACCEPTED") {
      await this.advanceStageOnSend(leadId);
    }
    if (firstSend) {
      await this.audit("PROPOSAL_SENT", leadId, { version: proposal.versionNumber });
    }
    return updated;
  }

  async markProposalViewed(leadId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, leadId },
      select: { id: true, viewed: true },
    });
    if (!proposal) throw new NotFoundException("Proposal not found");
    if (!proposal.viewed) {
      await this.prisma.proposal.update({ where: { id: proposalId }, data: { viewed: true } });
    }
    return { viewed: true };
  }

  // ── CSV import / export ─────────────────────────────────────────────────
  async exportCsv(query: { q?: string; stage?: string; assignedToId?: string } = {}) {
    const leads = await this.prisma.lead.findMany({
      where: {
        ...(query.q
          ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { company: { contains: query.q, mode: "insensitive" } }, { contactEmail: { contains: query.q, mode: "insensitive" } }] }
          : {}),
        ...(query.stage ? { stage: query.stage as any } : {}),
        ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      },
      include: { assignedTo: { select: { name: true, email: true } }, leadCategory: true },
      orderBy: { createdAt: "desc" },
    });
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Name", "Company", "Email", "Phone", "Source", "Stage", "Priority", "Temperature", "Category", "Probability", "Tags", "Value", "Score", "Assignee", "Notes", "Created"];
    const rows = leads.map((l) =>
      [
        l.name,
        l.company,
        l.contactEmail,
        l.contactPhone,
        l.source,
        l.stage,
        l.priority,
        l.temperature,
        l.leadCategory?.name ?? "",
        l.probability ?? "",
        (l.tags ?? []).join("; "),
        l.estimatedDealSize ? Number(l.estimatedDealSize).toFixed(2) : "",
        l.leadScore ?? "",
        l.assignedTo?.email ?? "",
        l.notes,
        l.createdAt.toISOString(),
      ]
        .map(esc)
        .join(",")
    );
    return { filename: `leads-${new Date().toISOString().slice(0, 10)}.csv`, content: [header.join(","), ...rows].join("\r\n") };
  }

  async importCsv(buffer: Buffer) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { imported: 0, skipped: [], total: lines.length - 1 };

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else inQuotes = false;
          } else cur += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ",") {
          cells.push(cur);
          cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      return cells;
    };

    const header = parseRow(lines[0]).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const at = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i].trim() : "");

    const normEnum = (v: string, values: string[]) => {
      const key = v.toUpperCase().replace(/[\s-]+/g, "_");
      return values.includes(key) ? key : undefined;
    };

    const stages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
    const sources = ["FACEBOOK", "REFERRAL", "COLD", "WEBSITE", "EMAIL", "OTHER", "LINKEDIN", "GOOGLE_ADS", "WHATSAPP", "COLD_CALL", "EMAIL_CAMPAIGN", "EVENT", "PARTNER", "INBOUND_PHONE"];
    const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    const verticals = ["EDUCATION", "D2C", "HEALTHCARE", "OTHER"];
    const temperatures = ["HOT", "WARM", "COLD"];

    const iName = col("name"), iCompany = col("company"), iEmail = col("email"), iPhone = col("phone"), iSource = col("source"), iStage = col("stage"), iPrio = col("priority"), iValue = col("value"), iAssignee = col("assignee"), iNotes = col("notes"), iVertical = col("vertical"), iCategory = col("category"), iTemp = col("temperature"), iProb = col("probability"), iTags = col("tags"), iStarred = col("starred");

    const users = await this.prisma.user.findMany({ select: { id: true, email: true } });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    const categories = await this.prisma.leadCategory.findMany();
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    let imported = 0;
    const skipped: string[] = [];
    for (let r = 1; r < lines.length; r++) {
      const row = parseRow(lines[r]);
      const name = at(row, iName) || at(row, iEmail);
      if (!name) {
        skipped.push(`line ${r + 1}: missing name/email`);
        continue;
      }
      const email = at(row, iEmail) || null;
      const existing = email
        ? await this.prisma.lead.findFirst({ where: { contactEmail: email } })
        : null;
      if (existing) {
        skipped.push(`line ${r + 1}: duplicate email ${email}`);
        continue;
      }
      const assigneeEmail = at(row, iAssignee).toLowerCase();
      const value = parseFloat(at(row, iValue));
      const probability = parseInt(at(row, iProb), 10);
      const uid = await this.nextUid();
      const catName = at(row, iCategory);
      let leadCategoryId: string | null = null;
      if (catName) {
        const key = catName.toLowerCase();
        if (catByName.has(key)) {
          leadCategoryId = catByName.get(key)!;
        } else {
          const created = await this.prisma.leadCategory.create({ data: { name: catName } });
          catByName.set(key, created.id);
          leadCategoryId = created.id;
        }
      }
      await this.prisma.lead.create({
        data: {
          name,
          company: at(row, iCompany) || null,
          contactEmail: email,
          contactPhone: at(row, iPhone) || null,
          source: (normEnum(at(row, iSource), sources) as any) ?? "OTHER",
          stage: (normEnum(at(row, iStage), stages) as any) ?? "NEW",
          priority: (normEnum(at(row, iPrio), priorities) as any) ?? "MEDIUM",
          vertical: (normEnum(at(row, iVertical), verticals) as any) ?? "OTHER",
          temperature: (normEnum(at(row, iTemp), temperatures) as any) ?? "WARM",
          leadCategoryId,
          probability: Number.isFinite(probability) && probability >= 0 && probability <= 100 ? probability : 50,
          starred: ["true", "1", "yes"].includes(at(row, iStarred).toLowerCase()),
          tags: at(row, iTags)
            ? at(row, iTags)
                .split(";")
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
          uid,
          estimatedDealSize: Number.isFinite(value) ? value : undefined,
          notes: at(row, iNotes) || null,
          assignedToId: assigneeEmail && byEmail.has(assigneeEmail) ? byEmail.get(assigneeEmail) : null,
          leadScore: 0,
        },
      });
      imported++;
    }
    await this.invalidateSummary();
    return { imported, skipped, total: lines.length - 1 };
  }
}