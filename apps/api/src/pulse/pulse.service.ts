import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FollowUpStatus, Lead, LeadPriority, LeadStage, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { TasksService } from "../tasks/tasks.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LeadRulesService, normalizeEmail, normalizePhone } from "./lead-rules.service";
import { signStoredFileUrl, uploadedFilename } from "../common/signed-url";
import { findUploadedFile } from "../common/file-storage";
import { existsSync, unlinkSync } from "fs";
import {
  AddActivityDto,
  BulkUpdateLeadsDto,
  ConvertLeadDto,
  CreateFollowUpDto,
  CreateLeadDto,
  CreateMeetingDto,
  CreateProposalDto,
  MarkLostDto,
  QuickLogDto,
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

/** Forward-only pipeline order. LOST is an off-ramp, not a step. */
const STAGE_ORDER: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON"];

const OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: "Connected",
  NO_ANSWER: "No answer",
  LEFT_MESSAGE: "Left a message",
  INTERESTED: "Interested",
  NEEDS_INFO: "Needs more info",
  CALLBACK_REQUESTED: "Asked for a callback",
  MEETING_BOOKED: "Meeting booked",
  NOT_INTERESTED: "Not interested",
};

/** Outcomes that mean "keep this lead warm" — they suggest a next date. */
const POSITIVE_OUTCOMES = ["CONNECTED", "INTERESTED", "NEEDS_INFO", "CALLBACK_REQUESTED", "MEETING_BOOKED"];

const RESPONSE_TYPES = ["CALL", "EMAIL", "WHATSAPP", "LINKEDIN", "MEETING"];


@Injectable()
export class PulseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly rules: LeadRulesService
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
    // The task is a convenience, never a precondition. Department rules on
    // /tasks/setup can reject a task type, and a rejected task must not lose
    // the call the rep just logged.
    try {
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
    } catch {
      return null;
    }
  }

  // ── Scoring engine ──────────────────────────────────────────────────────
  private computeScore(
    lead: Pick<
      Lead,
      "source" | "vertical" | "estimatedDealSize" | "contactEmail" | "contactPhone" | "company" | "createdAt" | "priority"
    > & { activityCount: number },
    rules?: Awaited<ReturnType<LeadRulesService["getRules"]>>
  ): number {
    // Weights come from Control → Lead Rules; the service falls back to the
    // defaults when scoring is switched off or a weight is missing.
    if (!rules) return 0;
    return this.rules.score(lead, rules);
  }

  private async recomputeScore(lead: Lead): Promise<number> {
    const [activityCount, rules] = await Promise.all([
      this.prisma.leadActivity.count({ where: { leadId: lead.id } }),
      this.rules.getRules(),
    ]);
    return this.computeScore({ ...lead, activityCount }, rules);
  }

  private async audit(action: string, entityId: string, afterValue?: object) {
    await this.prisma.systemAuditLog.create({
      data: { action, entityType: "Lead", entityId, afterValue: afterValue ?? undefined },
    });
  }

  // ── UID (LD-####) ───────────────────────────────────────────────────────
  /**
   * Reads the numeric maximum in one query. The old version pulled every lead
   * into memory on each create, which got slower with every import and could
   * hand out the same id to two concurrent creates.
   */
  private async maxUidNumber(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CASE WHEN uid ~ '^LD-[0-9]+$' THEN substring(uid from 4)::int END) AS max
      FROM "Lead"
    `;
    return Number(rows?.[0]?.max ?? 0) || 0;
  }

  private formatUid(n: number) {
    return `LD-${String(n).padStart(4, "0")}`;
  }

  private async nextUid(): Promise<string> {
    return this.formatUid((await this.maxUidNumber()) + 1);
  }

  /** Create a lead, retrying if a concurrent request claimed the same UID. */
  private async createLeadSafe(data: Prisma.LeadUncheckedCreateInput, attempts = 5) {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.prisma.lead.create({ data: { ...data, uid: await this.nextUid() } });
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        lastError = error;
      }
    }
    throw lastError;
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
    const [leads, stages, categories, rules] = await Promise.all([
      this.prisma.lead.findMany({ include: { assignedTo: { select: { id: true, name: true } } } }),
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } }),
      this.prisma.leadCategory.findMany({ orderBy: { createdAt: "asc" } }),
      this.rules.getRules(),
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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + 86400000 - 1);
    const hotLeads = active.filter((l) => (l.leadScore ?? 0) >= 70).length;
    // Stale means "no touch in 7 days" for contacted leads too — the old rule
    // only looked at leads that had *never* been contacted, which hid the ones
    // that had gone quiet after a promising first call.
    // Stale means "no touch in N days" (N comes from Control → Lead Rules).
    const staleLeads = active.filter((l) => this.rules.isStale(l, rules)).length;
    // First-response SLA breaches: active leads nobody has touched yet.
    const slaBreached = active.filter((l) => this.rules.isSlaBreached(l, rules)).length;
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
      (l) => l.nextFollowUpAt && l.nextFollowUpAt.getTime() < startOfToday.getTime()
    ).length;
    const followUpsToday = active.filter(
      (l) =>
        l.nextFollowUpAt &&
        l.nextFollowUpAt.getTime() >= startOfToday.getTime() &&
        l.nextFollowUpAt.getTime() <= endOfToday.getTime()
    ).length;
    const noNextAction = active.filter((l) => !l.nextFollowUpAt).length;
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
      slaBreached,
      avgScore: active.length ? Math.round(active.reduce((s, l) => s + (l.leadScore ?? 0), 0) / active.length) : null,
      followUpsDue,
      followUpsToday,
      noNextAction,
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
          qualityFlags: true,
          description: true,
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

  // ── Create (rules → validation → duplicates → routing → score) ─────────
  async create(dto: CreateLeadDto, userId?: string) {
    const rules = await this.rules.getRules();

    // 1. Intake gate — a hard rule refuses the record before anything is written.
    const intake = await this.rules.checkIntake(dto);
    if (intake.errors.length) {
      throw new BadRequestException(intake.errors.join(" · "));
    }

    // 2. Duplicates — BLOCK stops the save, WARN rides along as a confirmation.
    const dup = await this.rules.findDuplicates({
      contactPhone: dto.contactPhone,
      contactEmail: dto.contactEmail,
      company: dto.company,
      name: dto.name,
    });
    if (dup.hard.length) {
      const names = dup.hard.map((d) => `${d.name}${d.company ? ` (${d.company})` : ""}`).join(", ");
      throw new BadRequestException(
        `This contact already exists as ${names}. Open the existing lead instead of creating a duplicate.`
      );
    }

    // 3. Defaults + ownership.
    const withDefaults = this.rules.applyDefaults(dto, rules) as CreateLeadDto;
    const ownerId = await this.rules.pickOwner(
      { vertical: withDefaults.vertical, creatorId: userId, explicitOwnerId: withDefaults.assignedToId },
      rules
    );
    const followUpHours = rules.enabled ? Number(rules.routing.autoFollowUpHours ?? 0) : 0;
    const nextFollowUpAt = withDefaults.nextFollowUpAt
      ? new Date(withDefaults.nextFollowUpAt)
      : followUpHours > 0
        ? new Date(Date.now() + followUpHours * 3600000)
        : undefined;

    const lead = await this.createLeadSafe({
      name: withDefaults.name,
      company: withDefaults.company,
      contactEmail: intake.emailNormalized ?? withDefaults.contactEmail,
      contactPhone: withDefaults.contactPhone,
      phoneNormalized: intake.phoneNormalized,
      source: withDefaults.source,
      vertical: withDefaults.vertical,
      temperature: withDefaults.temperature,
      leadCategoryId: withDefaults.categoryId,
      probability: withDefaults.probability,
      starred: withDefaults.starred,
      tags: withDefaults.tags,
      website: withDefaults.website,
      pageLink: withDefaults.pageLink,
      priority: withDefaults.priority,
      estimatedDealSize: withDefaults.estimatedDealSize ?? undefined,
      currency: withDefaults.currency ?? "BDT",
      nextFollowUpAt,
      assignedToId: ownerId ?? undefined,
      description: withDefaults.description,
      notes: withDefaults.notes,
      stage: "NEW",
      stageEnteredAt: new Date(),
    });
    // A date picked on the form (or the auto follow-up) becomes a real row so
    // the agenda, the reminder cron and the lead's next-action field all agree.
    if (nextFollowUpAt) {
      await this.prisma.leadFollowUp.create({
        data: {
          leadId: lead.id,
          date: nextFollowUpAt,
          notes: withDefaults.nextFollowUpAt ? "Initial follow-up" : "Auto: first contact (SLA)",
        },
      });
    }
    const score = await this.recomputeScore(lead);
    const temperature = this.rules.temperatureFor(score, rules) ?? undefined;
    const qualityFlags = this.rules.flagsFor(
      { ...lead, leadScore: score, ...(temperature ? { temperature } : {}), phoneNormalized: intake.phoneNormalized } as Lead,
      { duplicate: dup.soft.length > 0 },
      rules
    );
    // The follow-up, score, flags, activity and note are one unit: a failure
    // half-way used to leave a lead with no CREATED activity and no score.
    await this.prisma.$transaction([
      ...(nextFollowUpAt
        ? [
            this.prisma.leadFollowUp.create({
              data: {
                leadId: lead.id,
                date: nextFollowUpAt,
                notes: withDefaults.nextFollowUpAt ? "Initial follow-up" : "Auto: first contact (SLA)",
              },
            }),
          ]
        : []),
      this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          leadScore: score,
          ...(temperature ? { temperature } : {}),
          ...(qualityFlags.length ? { qualityFlags } : {}),
        },
      }),
      this.prisma.leadActivity.create({
        data: { leadId: lead.id, type: "CREATED", content: "Lead created", loggedById: userId },
      }),
      ...(withDefaults.notes
        ? [
            this.prisma.leadNote.create({
              data: { leadId: lead.id, content: withDefaults.notes, createdById: userId },
            }),
          ]
        : []),
    ]);
    const updated = { ...lead, leadScore: score, ...(temperature ? { temperature } : {}), qualityFlags };
    await this.audit("LEAD_CREATED", lead.id);

    // Every decision the engine took, so the form can explain itself.
    const warnings = [
      ...intake.warnings,
      ...dup.soft.map((d) => `Similar ${d.matchedOn === "company" ? "company" : "contact"} already exists: ${d.name}`),
    ];
    await this.audit("LEAD_INTAKE_RULES", lead.id, {
      warnings,
      ownerId: ownerId ?? null,
      score,
      autoFollowUp: !withDefaults.nextFollowUpAt && followUpHours > 0 ? followUpHours : null,
    });
    if (dup.soft.length) {
      await this.audit("DUPLICATE_WARNING", lead.id, { matches: dup.soft.map((d) => d.name) });
    }
    if (ownerId && ownerId !== userId) {
      try {
        await this.notifications.create(
          ownerId,
          "LEAD_ASSIGNED",
          "New lead assigned",
          `"${lead.name}"${lead.company ? ` (${lead.company})` : ""} was assigned to you.`,
          `/pulse?lead=${lead.id}`
        );
      } catch {}
    }
    await this.invalidateSummary();
    return {
      ...updated,
      qualityFlags,
      duplicateWarnings: dup.soft.map((d) => ({ name: d.name, id: d.id, matchedOn: d.matchedOn })),
      warnings,
    };
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
        ...(dto.nextFollowUpAt === null ? {} : dto.nextFollowUpAt ? { nextFollowUpAt: new Date(dto.nextFollowUpAt) } : {}),
        assignedToId: dto.assignedToId,
        description: dto.description,
        notes: dto.notes,
      },
    });

    // A date picked in the edit form is a promise, so it becomes a real
    // follow-up row instead of a field that silently disagrees with the agenda.
    if (dto.nextFollowUpAt === null) {
      // Clearing the field is an explicit "cancel the open plan" — otherwise
      // the derived value would immediately restore the old date.
      await this.prisma.leadFollowUp.updateMany({
        where: { leadId: id, status: "SCHEDULED" },
        data: { status: "MISSED" },
      });
    }
    if (dto.nextFollowUpAt && new Date(dto.nextFollowUpAt).getTime() !== lead.nextFollowUpAt?.getTime()) {
      const when = new Date(dto.nextFollowUpAt);
      const open = await this.prisma.leadFollowUp.findFirst({
        where: { leadId: id, status: "SCHEDULED" },
        orderBy: { date: "asc" },
      });
      if (open) {
        await this.prisma.leadFollowUp.update({ where: { id: open.id }, data: { date: when } });
      } else {
        await this.prisma.leadFollowUp.create({ data: { leadId: id, date: when, notes: "Next step" } });
      }
    }
    await this.recomputeNextAction(id);

    const rules = await this.rules.getRules();
    const score = await this.recomputeScore(updated);
    const autoTemperature = this.rules.temperatureFor(score, rules);
    const phoneNormalized = normalizePhone(updated.contactPhone);
    const emailNormalized = normalizeEmail(updated.contactEmail);
    const qualityFlags = this.rules.flagsFor({ ...updated, phoneNormalized } as Lead, {}, rules);
    await this.prisma.lead.update({
      where: { id },
      data: {
        leadScore: score,
        phoneNormalized,
        ...(emailNormalized && emailNormalized !== updated.contactEmail ? { contactEmail: emailNormalized } : {}),
        ...(autoTemperature ? { temperature: autoTemperature } : {}),
        qualityFlags,
      },
    });

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
      ...(dto.description !== undefined && { description: dto.description }),
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
      if (dto.stage === "WON" || dto.stage === "LOST") {
        await this.closeAgenda(id, dto.stage);
      }
      if (dto.stage === "WON") {
        try {
          await this.notifications.notifyRole(
            "Owner",
            "LEAD_ASSIGNED",
            "🎉 Deal won",
            `"${updated.name}"${updated.company ? ` (${updated.company})` : ""} just closed.`,
            `/pulse?lead=${updated.id}`,
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
          `/pulse?lead=${updated.id}`
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
    if (lead.convertedClientId) throw new ConflictException("Lead already converted");

    // Prefer the accepted proposal, then the newest version. The old ordering
    // used the enum ordinal, which put REJECTED first and linked the project to
    // a rejected proposal (and sourceProposalId is unique, so it could never be
    // corrected later).
    const proposals = await this.prisma.proposal.findMany({
      where: { leadId: id },
      orderBy: [{ versionNumber: "desc" }],
      select: { id: true, status: true, versionNumber: true },
    });
    const latestProposal =
      proposals.find((p) => p.status === "ACCEPTED") ?? proposals[0] ?? null;

    // One transaction: a failure after client.create used to leave an orphan
    // client/project, and two concurrent clicks created two of everything.
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.lead.updateMany({
        where: { id, convertedClientId: null },
        data: { stage: "WON", leadScore: 100, nextFollowUpAt: null },
      });
      if (claimed.count === 0) throw new ConflictException("Lead already converted");

      const client = await tx.client.create({
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
        await tx.clientContact.create({
          data: {
            clientId: client.id,
            name: dto.contactName ?? lead.name,
            email: dto.contactEmail ?? lead.contactEmail,
            phone: dto.contactPhone ?? lead.contactPhone,
            isPrimary: true,
          },
        });
      }

      const project = await tx.project.create({
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

      await tx.lead.update({
        where: { id },
        data: { convertedClientId: client.id },
      });

      return { client, project };
    }, { timeout: 15000 });

    const { client, project } = result;
    await this.closeAgenda(id, "WON").catch(() => null);
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
    if (lead.stage === "WON") throw new BadRequestException("Won leads cannot be marked lost");

    await this.prisma.lostReason.upsert({
      where: { leadId: id },
      create: { leadId: id, reasonCategory: dto.reasonCategory, notes: dto.notes },
      update: { reasonCategory: dto.reasonCategory, notes: dto.notes, recordedAt: new Date() },
    });
    await this.prisma.lead.update({ where: { id }, data: { stage: "LOST" } });
    await this.closeAgenda(id, "LOST");
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
    await this.recomputeNextAction(id);
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
        // A lead can accumulate hundreds of touches; the modal only needs the
        // recent trail, and an unbounded include made the panel slow to open.
        activities: {
          include: { loggedBy: { select: { name: true } } },
          orderBy: { loggedAt: "desc" },
          take: 200,
        },
        proposals: { orderBy: { versionNumber: "desc" } },
        meetings: {
          orderBy: { scheduledAt: "desc" },
          include: {
            attendeeLinks: {
              include: { employee: { select: { id: true, name: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        followUps: { orderBy: [{ status: "asc" }, { date: "asc" }] },
        notesList: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 },
        attachments: { include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
        lostReason: true,
        client: { select: { id: true, companyName: true } },
        projects: {
          select: {
            id: true,
            name: true,
            status: true,
            team: true,
            assignedPm: { select: { name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    // Attachment/proposal links are signed on read, so a leaked response cannot
    // be replayed as a permanent unauthenticated file URL.
    return {
      ...lead,
      proposals: lead.proposals.map((p) => ({ ...p, fileUrl: signStoredFileUrl(p.fileUrl) })),
      attachments: lead.attachments.map((a) => ({ ...a, fileUrl: signStoredFileUrl(a.fileUrl) })),
    };
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

  /**
   * Mirrors `LeadMeeting.attendees` into `LeadMeetingAttendee` rows keyed on
   * Employee, preserving existing attendance statuses for people who stay
   * invited.
   *
   * Attendee ids arrive in two shapes: the current picker sends **Employee** ids
   * (so people without a login can be invited), while older meetings stored
   * **User** ids. Both are resolved here — a user id is mapped back through
   * `User.employeeId`.
   */
  private async syncMeetingAttendees(meetingId: string, attendees?: { id: string; name: string }[] | null) {
    if (!Array.isArray(attendees)) return [] as string[];
    const ids = [...new Set(attendees.map((a) => a?.id).filter(Boolean))] as string[];
    if (!ids.length) {
      await this.prisma.leadMeetingAttendee.deleteMany({ where: { meetingId } });
      return [] as string[];
    }
    const [users, employeeRows] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { employeeId: true } }),
      this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ]);
    const employeeIds = new Set<string>();
    for (const u of users) if (u.employeeId) employeeIds.add(u.employeeId);
    for (const e of employeeRows) employeeIds.add(e.id);
    const wanted = [...employeeIds];

    const existing = await this.prisma.leadMeetingAttendee.findMany({
      where: { meetingId },
      select: { employeeId: true },
    });
    const existingIds = new Set(existing.map((e) => e.employeeId));

    const stale = [...existingIds].filter((id) => !wanted.includes(id));
    if (stale.length) {
      await this.prisma.leadMeetingAttendee.deleteMany({ where: { meetingId, employeeId: { in: stale } } });
    }
    const added = wanted.filter((id) => !existingIds.has(id));
    if (added.length) {
      await this.prisma.leadMeetingAttendee.createMany({
        data: added.map((employeeId) => ({ meetingId, employeeId })),
        skipDuplicates: true,
      });
    }
    return added;
  }

  /**
   * Team members invited to a meeting should hear about it in-app — otherwise
   * "invite anyone" is a silent write nobody notices.
   */
  private async notifyMeetingInvitees(
    lead: { id: string; name: string },
    meeting: { title: string; scheduledAt: Date },
    employeeIds: string[],
    actorId?: string
  ) {
    if (!employeeIds.length) return;
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, user: { select: { id: true } } },
    });
    const when = meeting.scheduledAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    for (const e of employees) {
      const userId = e.user?.id;
      if (!userId || userId === actorId) continue;
      try {
        await this.notifications.create(
          userId,
          "MEETING_INVITE",
          "You're invited to a meeting",
          `${meeting.title} with ${lead.name} — ${when}.`,
          `/pulse?lead=${lead.id}`
        );
      } catch {}
    }
  }

  /** Mark whether an employee actually showed up. */
  async setMeetingAttendance(meetingId: string, employeeId: string, status: "INVITED" | "ATTENDED" | "NO_SHOW") {
    const row = await this.prisma.leadMeetingAttendee.findUnique({
      where: { meetingId_employeeId: { meetingId, employeeId } },
    });
    if (!row) throw new NotFoundException("This employee is not invited to that meeting");
    if (!["INVITED", "ATTENDED", "NO_SHOW"].includes(status)) throw new BadRequestException("Invalid attendance status");
    return this.prisma.leadMeetingAttendee.update({
      where: { meetingId_employeeId: { meetingId, employeeId } },
      data: { status, markedAt: new Date() },
    });
  }

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
    const invited = await this.syncMeetingAttendees(meeting.id, dto.attendees);
    await this.notifyMeetingInvitees(lead, { title: meeting.title, scheduledAt: scheduled }, invited, createdById);
    await this.prisma.lead.update({ where: { id }, data: { lastContactedAt: new Date() } });
    await this.recomputeNextAction(id);
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
          `/pulse?lead=${lead.id}`
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
    const invited = await this.syncMeetingAttendees(meetingId, dto.attendees);
    if (invited.length || dto.scheduledAt) {
      // On a reschedule everyone already invited needs the new time, not just
      // the people added in this edit.
      const notifyIds = dto.scheduledAt
        ? (
            await this.prisma.leadMeetingAttendee.findMany({
              where: { meetingId },
              select: { employeeId: true },
            })
          ).map((a) => a.employeeId)
        : invited;
      if (notifyIds.length) {
        const owner = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true } });
        if (owner) {
          await this.notifyMeetingInvitees(owner, { title: updated.title, scheduledAt: updated.scheduledAt }, notifyIds);
        }
      }
    }

    const touchData: { lastContactedAt?: Date } = {};
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
    await this.recomputeNextAction(leadId);
    await this.invalidateSummary();
    return updated;
  }

  async removeMeeting(leadId: string, meetingId: string) {
    const meeting = await this.prisma.leadMeeting.findFirst({ where: { id: meetingId, leadId } });
    if (!meeting) throw new NotFoundException("Meeting not found");
    await this.prisma.leadMeeting.delete({ where: { id: meetingId } });
    await this.recomputeNextAction(leadId);
    await this.invalidateSummary();
    return { deleted: true };
  }

  // ── Follow-ups (v0-crm subsystem) ───────────────────────────────────────
  /**
   * Single source of truth for "what happens next" on a lead.
   *
   * `Lead.nextFollowUpAt` used to be written by three separate paths — the
   * follow-up list, the meeting scheduler and the edit form — so booking a
   * meeting could silently erase an overdue call-back. It is now always derived
   * from the earliest open item, and closed leads carry no agenda at all.
   */
  private async recomputeNextAction(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { stage: true },
    });
    if (!lead) return null;
    if (lead.stage === "WON" || lead.stage === "LOST") {
      await this.prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: null } });
      return null;
    }
    const [followUp, meeting] = await Promise.all([
      this.prisma.leadFollowUp.findFirst({
        where: { leadId, status: "SCHEDULED" },
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      this.prisma.leadMeeting.findFirst({
        where: { leadId, status: "SCHEDULED" },
        orderBy: { scheduledAt: "asc" },
        select: { scheduledAt: true },
      }),
    ]);
    const candidates = [followUp?.date, meeting?.scheduledAt].filter(Boolean) as Date[];
    const next = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
    await this.prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next } });
    return next;
  }

  /**
   * Closes everything still open on a lead. Used when a deal is won or lost so
   * the Today queue stops asking for calls that can no longer happen.
   */
  private async closeAgenda(leadId: string, outcome: "WON" | "LOST") {
    await Promise.all([
      this.prisma.leadFollowUp.updateMany({
        where: { leadId, status: "SCHEDULED" },
        data: { status: outcome === "WON" ? "COMPLETED" : "MISSED" },
      }),
      this.prisma.leadMeeting.updateMany({
        where: { leadId, status: "SCHEDULED" },
        data: { status: outcome === "WON" ? "COMPLETED" : "CANCELLED" },
      }),
    ]);
    await this.prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: null } });
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
    await this.recomputeNextAction(leadId);
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
          `/pulse?lead=${lead.id}`
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
    await this.recomputeNextAction(leadId);
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
    await this.recomputeNextAction(leadId);
    await this.invalidateSummary();
    return { deleted: true };
  }

  /** Mark a follow-up done/missed without knowing which lead it belongs to. */
  async setFollowUpStatus(followUpId: string, status: FollowUpStatus) {
    const followUp = await this.prisma.leadFollowUp.findUnique({ where: { id: followUpId } });
    if (!followUp) throw new NotFoundException("Follow-up not found");
    if (followUp.status === status) return followUp;

    const updated = await this.prisma.leadFollowUp.update({ where: { id: followUpId }, data: { status } });
    await this.prisma.leadActivity.create({
      data: {
        leadId: followUp.leadId,
        type: "NOTE",
        content: `Follow-up ${status === "COMPLETED" ? "completed" : status === "MISSED" ? "missed" : "reopened"}${followUp.notes ? ` — ${followUp.notes}` : ""}`,
      },
    });
    await this.recomputeNextAction(followUp.leadId);
    await this.invalidateSummary();
    return updated;
  }

  // ── Today cockpit ───────────────────────────────────────────────────────
  /**
   * The one screen that answers "who do I need to contact right now?".
   *
   * Buckets are derived from the lead's next action so a follow-up and a
   * meeting compete on the same timeline. `unscheduled` is the silent killer:
   * active leads that have no next step at all.
   */
  async worklist(query: { ownerId?: string; mine?: string }, currentUserId?: string) {
    const ownerId = query.mine === "true" ? currentUserId : query.ownerId || undefined;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86400000 - 1);
    const weekAhead = new Date(now.getTime() + 7 * 86400000);

    const leads = await this.prisma.lead.findMany({
      where: {
        stage: { in: ACTIVE_STAGES },
        ...(ownerId ? { assignedToId: ownerId } : {}),
      },
      select: {
        id: true,
        uid: true,
        name: true,
        company: true,
        stage: true,
        priority: true,
        temperature: true,
        leadScore: true,
        probability: true,
        estimatedDealSize: true,
        currency: true,
        contactEmail: true,
        contactPhone: true,
        lastContactedAt: true,
        firstResponseAt: true,
        nextFollowUpAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, name: true } },
        followUps: {
          where: { status: "SCHEDULED" },
          orderBy: { date: "asc" },
          take: 1,
          select: { id: true, date: true, notes: true },
        },
        meetings: {
          where: { status: "SCHEDULED" },
          orderBy: { scheduledAt: "asc" },
          take: 1,
          select: { id: true, title: true, scheduledAt: true },
        },
      },
      orderBy: [{ nextFollowUpAt: "asc" }, { leadScore: "desc" }],
      take: 1000,
    });
    const rules = await this.rules.getRules();
    const staleDays = rules.sla.staleDays ?? 7;

    const decorate = (l: (typeof leads)[number]) => {
      const fu = l.followUps[0];
      const mt = l.meetings[0];
      const nextAt = l.nextFollowUpAt;
      const kind = fu && mt ? (fu.date <= mt.scheduledAt ? "follow-up" : "meeting") : fu ? "follow-up" : mt ? "meeting" : null;
      const note = kind === "follow-up" ? fu?.notes ?? null : kind === "meeting" ? mt?.title ?? null : null;
      const last = l.lastContactedAt ? l.lastContactedAt.getTime() : null;
      return {
        id: l.id,
        uid: l.uid,
        name: l.name,
        company: l.company,
        stage: l.stage,
        priority: l.priority,
        temperature: l.temperature,
        leadScore: l.leadScore,
        probability: l.probability,
        estimatedDealSize: l.estimatedDealSize,
        currency: l.currency,
        contactEmail: l.contactEmail,
        contactPhone: l.contactPhone,
        lastContactedAt: l.lastContactedAt,
        nextFollowUpAt: nextAt,
        nextActionKind: kind,
        nextActionNote: note,
        followUpId: fu?.id ?? null,
        meetingId: mt?.id ?? null,
        assignedTo: l.assignedTo,
        daysSinceContact: last === null ? null : Math.floor((now.getTime() - last) / 86400000),
        stale: last === null ? now.getTime() - l.createdAt.getTime() > staleDays * 86400000 : now.getTime() - last > staleDays * 86400000,
        slaBreached: this.rules.isSlaBreached(l, rules),
        slaDueAt: this.rules.slaDueAt(l.createdAt, l.priority, rules),
      };
    };

    const items = leads.map(decorate);
    const overdue = items.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt < startOfToday);
    const today = items.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt >= startOfToday && l.nextFollowUpAt <= endOfToday);
    const upcoming = items.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt > endOfToday && l.nextFollowUpAt <= weekAhead);
    const unscheduled = items
      .filter((l) => !l.nextFollowUpAt && (l.daysSinceContact === null || l.daysSinceContact >= 2))
      .sort((a, b) => (b.daysSinceContact ?? 999) - (a.daysSinceContact ?? 999));

    const sortByPriority = (a: (typeof items)[number], b: (typeof items)[number]) => {
      const rank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      const byPriority = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
      if (byPriority !== 0) return byPriority;
      return (b.leadScore ?? 0) - (a.leadScore ?? 0);
    };
    // Oldest broken promise first — a 9-day-old call-back outranks a 1-hour one.
    overdue.sort(
      (a, b) =>
        (a.nextFollowUpAt?.getTime() ?? 0) - (b.nextFollowUpAt?.getTime() ?? 0) || sortByPriority(a, b)
    );
    today.sort(sortByPriority);
    upcoming.sort((a, b) => (a.nextFollowUpAt?.getTime() ?? 0) - (b.nextFollowUpAt?.getTime() ?? 0));

    return {
      generatedAt: now,
      counts: {
        overdue: overdue.length,
        today: today.length,
        upcoming: upcoming.length,
        unscheduled: unscheduled.length,
        stale: items.filter((l) => l.stale).length,
        pipelineValue: items.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0),
      },
      overdue,
      today,
      upcoming,
      unscheduled,
    };
  }

  /**
   * One touch → one request. Records the activity, moves the stage forward when
   * asked, and queues the next follow-up so the lead never goes dark.
   */
  async quickLog(leadId: string, dto: QuickLogDto, userId?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.stage === "WON" || lead.stage === "LOST") {
      throw new BadRequestException("This lead is closed — reopen it before logging a touch.");
    }

    const now = new Date();
    const note = dto.content?.trim();
    const outcomeLabel = dto.outcome ? OUTCOME_LABELS[dto.outcome] ?? dto.outcome : null;
    const content = [outcomeLabel, note].filter(Boolean).join(" — ") || `${dto.type.toLowerCase()} logged`;

    const activity = await this.prisma.leadActivity.create({
      data: { leadId, type: dto.type, content, loggedById: userId },
      include: { loggedBy: { select: { name: true } } },
    });

    // Forward-only stage movement. A contact log should never undo progress.
    const currentIdx = STAGE_ORDER.indexOf(lead.stage);
    const explicitIdx = dto.stage ? STAGE_ORDER.indexOf(dto.stage) : -1;
    let nextStage: LeadStage | null = explicitIdx > currentIdx ? dto.stage! : null;
    if (!nextStage && !dto.stage) {
      // A connected first touch is what CONTACTED means; don't guess further.
      if (lead.stage === "NEW" && dto.outcome && POSITIVE_OUTCOMES.includes(dto.outcome)) nextStage = "CONTACTED";
    }

    const firstResponse = !lead.firstResponseAt && RESPONSE_TYPES.includes(dto.type) ? now : undefined;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        lastContactedAt: now,
        firstResponseAt: firstResponse,
        ...(nextStage ? { stage: nextStage, stageEnteredAt: now } : {}),
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.temperature ? { temperature: dto.temperature } : {}),
      },
    });

    if (nextStage) {
      await this.prisma.leadActivity.create({
        data: {
          leadId,
          type: "STAGE_CHANGED",
          content: `Stage changed from ${lead.stage} to ${nextStage}`,
          changes: { stage: { old: lead.stage, new: nextStage } } as any,
          loggedById: userId,
        },
      });
      await this.audit("LEAD_STAGE_CHANGED", leadId, { from: lead.stage, to: nextStage, via: "quick-log" });
      if (nextStage === "WON") await this.closeAgenda(leadId, "WON");
    }

    let followUpId: string | null = null;
    // A logged touch closes the day's plan. Without this the overdue item the
    // rep just called stays at the top of the queue forever.
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const dueFollowUps = await this.prisma.leadFollowUp.findMany({
      where: { leadId, status: "SCHEDULED", date: { lte: endOfToday } },
      select: { id: true },
    });
    if (dueFollowUps.length) {
      const closeStatus = dto.outcome && ["NO_ANSWER", "NOT_INTERESTED"].includes(dto.outcome) ? "MISSED" : "COMPLETED";
      await this.prisma.leadFollowUp.updateMany({
        where: { id: { in: dueFollowUps.map((f) => f.id) } },
        data: { status: closeStatus },
      });
    }

    // "No next step" is an explicit choice, not a no-op: drop any plan that is
    // still open so the lead actually leaves the Today queue.
    if (dto.clearNextStep && !dto.nextFollowUpAt) {
      await this.prisma.leadFollowUp.updateMany({
        where: { leadId, status: "SCHEDULED" },
        data: { status: "MISSED" },
      });
    }

    if (dto.nextFollowUpAt) {
      const when = new Date(dto.nextFollowUpAt);
      if (Number.isNaN(when.getTime())) throw new BadRequestException("Invalid follow-up date");
      const followUp = await this.prisma.leadFollowUp.create({
        data: { leadId, date: when, notes: note?.slice(0, 180) ?? "" },
      });
      followUpId = followUp.id;
      await this.createActionTask(lead, {
        assignToId: dto.assignToId,
        taskTitle: dto.taskTitle,
        dueDate: when,
        kind: "follow-up",
        detail: `${OUTCOME_LABELS[dto.outcome ?? ""] ?? dto.type}${note ? ` — ${note}` : ""}`,
      });
      if (lead.assignedToId && lead.assignedToId !== userId) {
        try {
          await this.notifications.create(
            lead.assignedToId,
            "FOLLOWUP_SCHEDULED",
            "Next step scheduled",
            `${lead.name} — ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${note ? ` · ${note}` : ""}`,
            `/pulse?lead=${lead.id}`
          );
        } catch {}
      }
    }

    await this.recomputeNextAction(leadId);
    const score = await this.recomputeScore({ ...lead, lastContactedAt: now });
    await this.prisma.lead.update({ where: { id: leadId }, data: { leadScore: score } });
    await this.invalidateSummary();

    const fresh = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { stage: true, nextFollowUpAt: true, lastContactedAt: true, leadScore: true },
    });
    return { activity, followUpId, ...fresh };
  }

  /** Push the open follow-up forward N days — the "not today" button. */
  async snooze(leadId: string, days: number) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.stage === "WON" || lead.stage === "LOST") throw new BadRequestException("Closed leads have no agenda");

    const target = new Date(Date.now() + days * 86400000);
    const open = await this.prisma.leadFollowUp.findFirst({
      where: { leadId, status: "SCHEDULED" },
      orderBy: { date: "asc" },
    });
    if (open) {
      await this.prisma.leadFollowUp.update({ where: { id: open.id }, data: { date: target } });
    } else {
      await this.prisma.leadFollowUp.create({ data: { leadId, date: target, notes: "Snoozed" } });
    }
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: "NOTE",
        content: `Follow-up snoozed to ${target.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      },
    });
    await this.recomputeNextAction(leadId);
    await this.invalidateSummary();
    return this.prisma.lead.findUnique({ where: { id: leadId }, select: { nextFollowUpAt: true } });
  }

  /**
   * Bulk move / reassign from the pipeline. Stage changes are logged per lead
   * so the activity trail stays honest even when 40 rows move at once.
   */
  async bulkUpdate(dto: BulkUpdateLeadsDto, userId?: string) {
    const ids = [...new Set(dto.ids ?? [])].filter(Boolean);
    if (!ids.length) throw new BadRequestException("Select at least one lead");
    if (ids.length > 500) throw new BadRequestException("Up to 500 leads per bulk action");

    const leads = await this.prisma.lead.findMany({ where: { id: { in: ids } } });
    let changed = 0;
    for (const lead of leads) {
      const stageChanged = dto.stage && dto.stage !== lead.stage;
      const tags = (lead.tags ?? []).filter((t) => !(dto.removeTags ?? []).includes(t));
      const mergedTags = [...new Set([...tags, ...(dto.addTags ?? [])])];
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(dto.stage ? { stage: dto.stage } : {}),
          ...(stageChanged ? { stageEnteredAt: new Date() } : {}),
          ...(dto.assignedToId !== undefined
            ? { assignedToId: dto.assignedToId === "none" ? null : dto.assignedToId || null }
            : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.temperature ? { temperature: dto.temperature } : {}),
          ...(dto.addTags || dto.removeTags ? { tags: mergedTags } : {}),
        },
      });
      if (stageChanged) {
        await this.prisma.leadActivity.create({
          data: {
            leadId: lead.id,
            type: "STAGE_CHANGED",
            content: `Stage changed from ${lead.stage} to ${dto.stage}`,
            changes: { stage: { old: lead.stage, new: dto.stage } } as any,
            loggedById: userId,
          },
        });
        if (dto.stage === "WON" || dto.stage === "LOST") await this.closeAgenda(lead.id, dto.stage);
      }
      if (dto.assignedToId && dto.assignedToId !== "none" && dto.assignedToId !== lead.assignedToId) {
        try {
          await this.notifications.create(
            dto.assignedToId,
            "LEAD_ASSIGNED",
            "Leads assigned to you",
            `${lead.name}${lead.company ? ` (${lead.company})` : ""} was assigned to you.`,
            `/pulse?lead=${lead.id}`
          );
        } catch {}
      }
      changed++;
    }
    await this.invalidateSummary();
    return { updated: changed };
  }

  /**
   * 9:45am digest — one notification per owner, not one per lead. Deduped per
   * day so a restart or a second cron tick cannot spam anyone.
   */
  @Cron("45 9 * * *")
  async followUpDigest() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfDay.getTime() + 86400000 - 1);

    const leads = await this.prisma.lead.findMany({
      where: {
        stage: { in: ACTIVE_STAGES },
        assignedToId: { not: null },
        nextFollowUpAt: { not: null, lte: endOfToday },
      },
      select: { assignedToId: true, nextFollowUpAt: true },
    });

    const byOwner = new Map<string, { overdue: number; today: number }>();
    for (const l of leads) {
      if (!l.assignedToId) continue;
      const bucket = byOwner.get(l.assignedToId) ?? { overdue: 0, today: 0 };
      if (l.nextFollowUpAt && l.nextFollowUpAt < now) bucket.overdue++;
      else bucket.today++;
      byOwner.set(l.assignedToId, bucket);
    }

    let sent = 0;
    for (const [ownerId, counts] of byOwner) {
      const already = await this.prisma.notification.findFirst({
        where: { userId: ownerId, type: "FOLLOWUP_DIGEST", createdAt: { gte: startOfDay } },
        select: { id: true },
      });
      if (already) continue;
      const parts = [
        counts.overdue ? `${counts.overdue} overdue` : null,
        counts.today ? `${counts.today} due today` : null,
      ].filter(Boolean);
      try {
        await this.notifications.create(
          ownerId,
          "FOLLOWUP_DIGEST",
          "Your leads need a touch",
          `${parts.join(" · ")}. Start with the oldest — open Pulse → Today.`,
          "/pulse?tab=today"
        );
        sent++;
      } catch {}
    }
    return { owners: byOwner.size, sent };
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
    if (!file) throw new BadRequestException("No file uploaded");

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
    return { ...attachment, fileUrl: signStoredFileUrl(attachment.fileUrl) };
  }

  async removeAttachment(leadId: string, attachmentId: string) {
    const attachment = await this.prisma.leadAttachment.findFirst({
      where: { id: attachmentId, leadId },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    await this.prisma.leadAttachment.delete({ where: { id: attachmentId } });
    // Remove the blob too; otherwise deleted attachments stay downloadable
    // forever and the uploads volume never shrinks.
    const stored = uploadedFilename(attachment.fileUrl);
    if (stored) {
      for (const candidate of [findUploadedFile("pulse", stored), findUploadedFile(stored)]) {
        try {
          if (existsSync(candidate)) unlinkSync(candidate);
        } catch {
          // A missing/locked blob must not fail the delete.
        }
      }
    }
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
    if (!trimmed) throw new BadRequestException("Category name is required");
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
    return { ...proposal, fileUrl: signStoredFileUrl(proposal.fileUrl) };
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
    return { ...updated, fileUrl: signStoredFileUrl(updated.fileUrl) };
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
      select: {
        id: true, name: true, company: true, contactEmail: true, contactPhone: true,
        source: true, vertical: true, stage: true, priority: true, temperature: true,
        leadScore: true, estimatedDealSize: true, currency: true, nextFollowUpAt: true,
        probability: true, tags: true, description: true, notes: true, createdAt: true,
        assignedTo: { select: { name: true, email: true } }, leadCategory: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      // Hard cap: the export used to materialise the entire lead book (with two
      // relations) into one in-memory CSV. Filter first, or page the rest.
      take: 5000,
    });
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Name", "Company", "Email", "Phone", "Source", "Stage", "Priority", "Temperature", "Category", "Probability", "Tags", "Value", "Score", "Assignee", "Description", "Notes", "Created"];
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
        l.description,
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

    const iName = col("name"), iCompany = col("company"), iEmail = col("email"), iPhone = col("phone"), iSource = col("source"), iStage = col("stage"), iPrio = col("priority"), iValue = col("value"), iAssignee = col("assignee"), iDescription = col("description"), iNotes = col("notes"), iVertical = col("vertical"), iCategory = col("category"), iTemp = col("temperature"), iProb = col("probability"), iTags = col("tags"), iStarred = col("starred");

    const users = await this.prisma.user.findMany({ select: { id: true, email: true } });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    const categories = await this.prisma.leadCategory.findMany();
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const rules = await this.rules.getRules();

    let imported = 0;
    const skipped: string[] = [];
    const warnings: string[] = [];
    // One read for the whole file instead of a query per row.
    let uidSeq = await this.maxUidNumber();
    for (let r = 1; r < lines.length; r++) {
      const row = parseRow(lines[r]);
      const name = at(row, iName) || at(row, iEmail);
      if (!name) {
        skipped.push(`line ${r + 1}: missing name/email`);
        continue;
      }
      const email = normalizeEmail(at(row, iEmail) || null);
      const phoneRaw = at(row, iPhone) || null;
      const phoneNormalized = normalizePhone(phoneRaw);
      const company = at(row, iCompany) || null;

      // Same duplicate logic as the form, so an import can't smuggle in
      // contacts the UI would refuse.
      const dup = await this.rules.findDuplicates({ contactPhone: phoneRaw, contactEmail: email, company });
      if (dup.hard.length) {
        skipped.push(`line ${r + 1}: duplicate of ${dup.hard[0].name}${dup.hard[0].company ? ` (${dup.hard[0].company})` : ""}`);
        continue;
      }
      if (dup.soft.length) {
        warnings.push(`line ${r + 1}: similar contact exists — ${dup.soft[0].name}`);
      }
      if (!phoneNormalized) {
        warnings.push(`line ${r + 1}: no usable phone number`);
      }
      const assigneeEmail = at(row, iAssignee).toLowerCase();
      const value = parseFloat(at(row, iValue));
      const probability = parseInt(at(row, iProb), 10);
      const uid = this.formatUid(++uidSeq);
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
      const created = await this.prisma.lead.create({
        data: {
          name,
          company,
          contactEmail: email,
          contactPhone: phoneRaw,
          phoneNormalized,
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
          description: at(row, iDescription) || null,
          notes: at(row, iNotes) || null,
          assignedToId: assigneeEmail && byEmail.has(assigneeEmail) ? byEmail.get(assigneeEmail) : null,
          leadScore: 0,
        },
      });
      const score = this.rules.score({ ...created, activityCount: 0 }, rules);
      const qualityFlags = this.rules.flagsFor(created, { duplicate: dup.soft.length > 0 }, rules);
      await this.prisma.lead.update({ where: { id: created.id }, data: { leadScore: score, qualityFlags } });
      imported++;
    }
    await this.invalidateSummary();
    return { imported, skipped, warnings, total: lines.length - 1 };
  }

  // ── Lead intake rules (read + maintenance) ──────────────────────────────

  /** The live rule set — the Add Lead form uses it for required markers. */
  async getLeadRules() {
    return this.rules.getRules();
  }

  /** Live duplicate check while the rep is still typing (before save). */
  async checkDuplicates(input: { phone?: string; email?: string; company?: string; name?: string; excludeId?: string }) {
    const [rules, hits] = await Promise.all([
      this.rules.getRules(),
      this.rules.findDuplicates({
        contactPhone: input.phone,
        contactEmail: input.email,
        company: input.company,
        name: input.name,
        excludeId: input.excludeId,
      }),
    ]);
    return {
      ...hits,
      enabled: rules.enabled,
      phoneRequired: rules.intake.requirePhone.enabled,
    };
  }

  /** Re-run the rule engine over every stored lead (Control → "Run audit"). */
  async auditLeads() {
    return this.rules.auditAll();
  }

  /** Nightly hygiene: normalise phones, refresh flags and scores. */
  @Cron("15 3 * * *")
  async nightlyLeadAudit() {
    const rules = await this.rules.getRules();
    if (!rules.audit.nightly) return;
    await this.rules.auditAll();
  }
}