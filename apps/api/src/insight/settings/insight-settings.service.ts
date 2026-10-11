import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

export const DEFAULT_INSIGHT_SETTINGS = {
  reportDefaults: { datePreset: "30d", metrics: ["spend", "ctr", "roas"], dimensions: ["date"], timezone: "Asia/Dhaka", currency: "BDT", comparePreset: "prev_period" },
  syncConfig: { interval: "6h", backfillDays: 30, retentionDays: 365 },
  alertDefaults: { windowDays: 7, ctrDropPct: 30, spendSpikeX: 2, cplLimit: 400, dedupMinutes: 30 },
  branding: { template: "executive", includeCharts: true },
  automation: { defaultCron: "daily", defaultRecipients: [], format: "pdf" },
  exportConfig: { defaultFormat: "pdf", includeCharts: true, locale: "en-BD" },
};

const CACHE_KEY = "insight:settings";
const TTL = 300;

@Injectable()
export class InsightSettingsService {
  private readonly logger = new Logger(InsightSettingsService.name);
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  private merge(row: any) {
    return {
      id: row.id,
      reportDefaults: { ...DEFAULT_INSIGHT_SETTINGS.reportDefaults, ...(row.reportDefaults as any ?? {}) },
      syncConfig: { ...DEFAULT_INSIGHT_SETTINGS.syncConfig, ...(row.syncConfig as any ?? {}) },
      alertDefaults: { ...DEFAULT_INSIGHT_SETTINGS.alertDefaults, ...(row.alertDefaults as any ?? {}) },
      branding: { ...DEFAULT_INSIGHT_SETTINGS.branding, ...(row.branding as any ?? {}) },
      automation: { ...DEFAULT_INSIGHT_SETTINGS.automation, ...(row.automation as any ?? {}) },
      exportConfig: { ...DEFAULT_INSIGHT_SETTINGS.exportConfig, ...(row.exportConfig as any ?? {}) },
      updatedAt: row.updatedAt,
      updatedById: row.updatedById,
    };
  }

  async get() {
    return this.cache.wrap(CACHE_KEY, TTL, async () => {
      let row = await this.prisma.insightSettings.findUnique({ where: { id: "default" } });
      if (!row) {
        row = await this.prisma.insightSettings.create({ data: { id: "default" } });
      }
      return this.merge(row);
    });
  }

  async update(patch: any, actorId?: string) {
    const existing = await this.prisma.insightSettings.findUnique({ where: { id: "default" } });
    if (!existing) await this.prisma.insightSettings.create({ data: { id: "default" } });

    const data: any = {};
    if (patch.reportDefaults !== undefined) data.reportDefaults = { ...(existing?.reportDefaults as any ?? DEFAULT_INSIGHT_SETTINGS.reportDefaults), ...patch.reportDefaults };
    if (patch.syncConfig !== undefined) data.syncConfig = { ...(existing?.syncConfig as any ?? DEFAULT_INSIGHT_SETTINGS.syncConfig), ...patch.syncConfig };
    if (patch.alertDefaults !== undefined) data.alertDefaults = { ...(existing?.alertDefaults as any ?? DEFAULT_INSIGHT_SETTINGS.alertDefaults), ...patch.alertDefaults };
    if (patch.branding !== undefined) data.branding = { ...(existing?.branding as any ?? DEFAULT_INSIGHT_SETTINGS.branding), ...patch.branding };
    if (patch.automation !== undefined) data.automation = { ...(existing?.automation as any ?? DEFAULT_INSIGHT_SETTINGS.automation), ...patch.automation };
    if (patch.exportConfig !== undefined) data.exportConfig = { ...(existing?.exportConfig as any ?? DEFAULT_INSIGHT_SETTINGS.exportConfig), ...patch.exportConfig };
    if (actorId) (data as any).updatedById = actorId;

    const updated = await this.prisma.insightSettings.update({ where: { id: "default" }, data });
    await this.cache.del(CACHE_KEY);
    await this.cache.delPattern("insight:reports:*");
    await this.cache.delPattern("insight:ads:*");

    // audit
    await this.prisma.systemAuditLog.create({
      data: { actorUserId: actorId ?? null, action: "INSIGHT_SETTINGS_UPDATED", entityType: "InsightSettings", entityId: "default", afterValue: patch as any },
    }).catch(() => {});

    this.logger.log(`InsightSettings updated by ${actorId ?? "system"}`);
    return this.merge(updated);
  }

  // helpers for other services
  async getReportDefaults() { const s = await this.get(); return s.reportDefaults; }
  async getSyncConfig() { const s = await this.get(); return s.syncConfig; }
  async getAlertDefaults() { const s = await this.get(); return s.alertDefaults; }
}
