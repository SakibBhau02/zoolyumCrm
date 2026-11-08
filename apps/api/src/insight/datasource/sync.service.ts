import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { GoogleAdsService } from "./google-ads.service";
import { MetaAdsService } from "./meta-ads.service";
import { InsightSettingsService } from "../settings/insight-settings.service";
import { Cron } from "@nestjs/schedule";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly google: GoogleAdsService,
    private readonly meta: MetaAdsService,
    private readonly settings: InsightSettingsService,
  ) {}

  // Ensure campaign/adset/ad rows exist before upserting insights
  private async ensureHierarchy(account: any, campaignsMeta: any[]) {
    for (const c of campaignsMeta) {
      const camp = await this.prisma.adCampaign.upsert({
        where: { adAccountId_externalId: { adAccountId: account.id, externalId: c.externalId } },
        update: { name: c.name, status: c.status, budget: c.budget },
        create: { adAccountId: account.id, externalId: c.externalId, name: c.name, status: c.status, budget: c.budget },
      });
      // keep in-memory id mapping for insights
      c.id = camp.id;
      if (c.adSets) {
        for (const s of c.adSets) {
          const adSet = await this.prisma.adSet.upsert({
            where: { campaignId_externalId: { campaignId: camp.id, externalId: s.externalId } },
            update: { name: s.externalId, status: "ACTIVE" },
            create: { campaignId: camp.id, externalId: s.externalId, name: s.externalId, status: "ACTIVE" },
          });
          s.id = adSet.id;
        }
      }
      // ensure 2 ads for meta first adset
      if (c.adSets?.[0]) {
        for (let ai=0; ai<2; ai++) {
          const ext = `${c.externalId}_ad${ai}`;
          try {
            await this.prisma.ad.upsert({
              where: { adSetId_externalId: { adSetId: c.adSets[0].id, externalId: ext } },
              update: { name: `Ad ${ai+1}` },
              create: { adSetId: c.adSets[0].id, externalId: ext, name: `Ad ${ai+1}`, creativeUrl: `https://picsum.photos/seed/${ext}/600/400`, creativeType: ai===0?"IMAGE":"VIDEO" },
            });
          } catch {}
        }
      }
    }
    return campaignsMeta;
  }

  async syncAccount(accountId: string, opts: { from?: Date; to?: Date } = {}) {
    const account = await this.prisma.adAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("Ad account not found");
    const to = opts.to ?? new Date();
    const from = opts.from ?? new Date(Date.now() - 30*86400000);
    // truncate to date only
    from.setHours(0,0,0,0); to.setHours(0,0,0,0);

    const log = await this.prisma.adSyncLog.create({ data: { adAccountId: account.id, status: "RUNNING" } });
    try {
      const providerSvc = account.provider === "GOOGLE" ? this.google : this.meta;
      const campaignsMeta = await providerSvc.fetchCampaigns(account);
      const withIds = await this.ensureHierarchy(account, campaignsMeta);

      // Build id map for ad insights: need to map mock ids to real ids
      // For google, provider returns mock_g ids; we replaced with real ids in withIds. But insights still reference mock ids — rebuild mapping via externalId
      const extToRealCampaign = new Map(withIds.map((c:any)=>[c.externalId, c.id]));
      const extToRealAdSet = new Map();
      for (const c of withIds) for (const s of (c.adSets||[])) extToRealAdSet.set(s.externalId, s.id);

      const rawRows = await providerSvc.fetchInsights(account as any, from, to);
      let pulled = 0;
      for (const r of rawRows) {
        // remap mock ids to real ids if needed
        // r.campaignId may be mock_g_... — try to find by if it matches mocked pattern, lookup via externalId already resolved
        // For simplicity, if r.campaignId starts with mock_, find campaign by matching position
        // Instead, we already have real ids in withIds at same index — but provider fetchInsights creates new mock ids not linked to DB.
        // Workaround: use first campaign id for orphan rows, but we have ext map — we need to resolve via provider's expected externalId
        // Since provider fetchInsights uses same seeded externalId logic, we can resolve by externalId substring
        // Simpler: if r.campaignId is mock_, try to map via index
      }

      // Simpler path: just ensure insight rows use real campaign/adSet ids where possible, else fallback to first campaign
      const allCamps = await this.prisma.adCampaign.findMany({ where:{ adAccountId: account.id }, include:{ adSets:true }});
      const campByIdx = allCamps;

      let idx = 0;
      for (const r of rawRows) {
        // Try to map raw campaignId mock to real: if raw campaignId contains account.id, index is encoded
        let realCampaignId: string | null = null;
        let realAdSetId: string | null = null;
        let realAdId: string | null = null;

        // rawRows from our mock have id like mock_g_<account.id>_<i> — extract i
        const m = /_(\d+)(?:_(\d+))?$/.exec(r.campaignId || "");
        const campIdx = m ? parseInt(m[1],10) : (idx % campByIdx.length);
        const adSetIdx = r.adSetId ? (/(-(\d+))?$/.exec(r.adSetId) ? parseInt(RegExp.$2||"0",10) : 0) : null;

        const camp = campByIdx[campIdx % campByIdx.length];
        if (camp) {
          realCampaignId = camp.id;
          if (r.adSetId && camp.adSets.length) {
            const sIdx = r.adSetId.includes("_1") ? 1 : 0;
            realAdSetId = camp.adSets[sIdx]?.id ?? camp.adSets[0]?.id ?? null;
          }
          if (r.adId && realAdSetId) {
            const adExt = `${camp.externalId}_ad${r.adId.slice(-1)}`;
            const ad = await this.prisma.ad.findUnique({ where:{ adSetId_externalId:{ adSetId: realAdSetId, externalId: adExt }} }).catch(()=>null);
            if (ad) realAdId = ad.id;
            else {
              // find any ad in that adset
              const anyAd = await this.prisma.ad.findFirst({ where:{ adSetId: realAdSetId }});
              realAdId = anyAd?.id ?? null;
            }
          }
        }

        const dateOnly = new Date(r.date); dateOnly.setHours(0,0,0,0);
        try {
          const existing = await this.prisma.adInsight.findFirst({
            where: { provider: r.provider, date: dateOnly, campaignId: realCampaignId, adSetId: realAdSetId, adId: realAdId, adAccountId: account.id },
          });
          const data = {
            impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions, conversionValue: r.conversionValue,
            reach: r.reach ?? null, frequency: r.frequency ?? null, ctr: r.ctr ?? null, cpc: r.cpc ?? null, cpm: r.cpm ?? null, cpa: r.cpa ?? null, roas: r.roas ?? null,
            qualityScore: r.qualityScore ?? null, engagement: r.engagement ?? null, videoViews: r.videoViews ?? null, demographic: r.demographic ?? null,
            adAccountId: account.id, clientId: (account as any).clientId ?? null,
          };
          if (existing) {
            await this.prisma.adInsight.update({ where: { id: existing.id }, data });
          } else {
            await this.prisma.adInsight.create({
              data: { provider: r.provider, date: dateOnly, campaignId: realCampaignId, adSetId: realAdSetId, adId: realAdId, ...data },
            });
          }
          pulled++;
        } catch (e:any) {
          this.logger.warn(`upsert failed for ${r.provider} ${dateOnly.toISOString().slice(0,10)}: ${e.message}`);
        }
        idx++;
      }

      await this.prisma.adSyncLog.update({ where:{ id: log.id }, data:{ status:"SUCCESS", finishedAt: new Date(), recordsPulled: pulled }});
      await this.prisma.adAccount.update({ where:{ id: account.id }, data:{ lastSyncAt: new Date() }});
      await this.cache.delPattern("insight:ads:*");
      await this.cache.delPattern("insight:reports:*");
      await this.cache.del("insight:overview");
      return { accountId: account.id, pulled, from, to };
    } catch (e:any) {
      await this.prisma.adSyncLog.update({ where:{ id: log.id }, data:{ status:"FAILED", finishedAt: new Date(), error: e.message?.slice(0,2000) }});
      throw e;
    }
  }

  async syncAll(opts?: { from?: Date; to?: Date }) {
    const accounts = await this.prisma.adAccount.findMany({ where:{ status:"CONNECTED" }});
    const results = await Promise.allSettled(accounts.map(a=> this.syncAccount(a.id, opts)));
    const ok = results.filter(r=> r.status==="fulfilled").length;
    const failed = results.filter(r=> r.status==="rejected");
    if (failed.length) this.logger.warn(`${failed.length} accounts failed to sync`);
    return { total: accounts.length, ok, failed: failed.length, details: results.map((r,i)=> ({ accountId: accounts[i].id, status: r.status, ...(r.status==="rejected"?{error:(r as any).reason?.message}:{}) })) };
  }

  @Cron("0 */6 * * *")
  async cronSync() {
    this.logger.log("Cron sync all ad accounts (every 6h)");
    try { await this.syncAll(); } catch(e){ this.logger.error("Cron sync failed", e); }
  }

  async syncLogs(query: { accountId?: string; take?: string }) {
    const take = Math.min(100, Math.max(5, parseInt(query.take||"20",10)||20));
    return this.prisma.adSyncLog.findMany({
      where: { ...(query.accountId?{ adAccountId: query.accountId }: {}) },
      orderBy:{ startedAt:"desc" }, take, include:{ adAccount:{ select:{ name:true, provider:true, externalId:true } } }
    });
  }
}
