import { Injectable } from "@nestjs/common";

// Mock provider — deterministic synthetic data. Swaps to real API when credentialsEnc is valid + env flag.
@Injectable()
export class GoogleAdsService {
  // Generate deterministic pseudo-random in 0..1 from seed string
  private seeded(str: string) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  async fetchInsights(account: { id: string; externalId: string }, from: Date, to: Date) {
    // In real implementation: use google-ads-api with refresh_token from credentialsEnc
    // For now, synthesize campaign/adset/ad level insights
    const campaigns = await this.fetchCampaigns(account);
    const rows: any[] = [];
    const dayMs = 86400000;
    for (const camp of campaigns) {
      for (let d = new Date(from); d <= to; d = new Date(d.getTime() + dayMs)) {
        const rnd = this.seeded(`${account.externalId}:${camp.externalId}:${d.toISOString().slice(0,10)}`);
        const impressions = 800 + Math.floor(rnd() * 4200);
        const ctrBase = 0.018 + rnd() * 0.025;
        const clicks = Math.max(5, Math.floor(impressions * ctrBase));
        const cpc = 12 + rnd() * 45; // BDT
        const spend = Math.round(clicks * cpc * 100) / 100;
        const conversions = rnd() > 0.35 ? Math.floor(clicks * (0.02 + rnd() * 0.06)) : 0;
        const convVal = conversions ? Math.round(conversions * (800 + rnd() * 2500) * 100) / 100 : null;
        const quality = 5 + Math.floor(rnd() * 5);
        rows.push({
          provider: "GOOGLE" as const,
          date: new Date(d),
          campaignId: camp.id,
          adSetId: null,
          adId: null,
          adAccountId: account.id,
          clientId: (account as any).clientId ?? null,
          impressions, clicks, spend, conversions, conversionValue: convVal,
          ctr: Math.round((clicks / impressions) * 10000) / 100,
          cpc: Math.round(cpc * 100) / 100,
          cpm: Math.round((spend / impressions) * 1000 * 100) / 100,
          cpa: conversions ? Math.round((spend / conversions) * 100) / 100 : null,
          roas: convVal && spend ? Math.round((convVal / spend) * 100) / 100 : null,
          qualityScore: quality,
        });
        // adset level (2 adsets per campaign)
        for (let si = 0; si < 2; si++) {
          const rnd2 = this.seeded(`${camp.externalId}:adset${si}:${d.toISOString().slice(0,10)}`);
          const imp2 = Math.floor(impressions * (0.35 + rnd2() * 0.3));
          const clk2 = Math.max(2, Math.floor(imp2 * (0.015 + rnd2() * 0.02)));
          const spend2 = Math.round(clk2 * (10 + rnd2() * 40) * 100) / 100;
          const conv2 = rnd2() > 0.4 ? Math.floor(clk2 * (0.015 + rnd2() * 0.05)) : 0;
          rows.push({
            provider: "GOOGLE" as const,
            date: new Date(d),
            campaignId: camp.id,
            adSetId: camp.adSets?.[si]?.id ?? null,
            adId: null,
            adAccountId: account.id,
            clientId: (account as any).clientId ?? null,
            impressions: imp2, clicks: clk2, spend: spend2, conversions: conv2,
            conversionValue: conv2 ? Math.round(conv2 * (700 + rnd2() * 2000) * 100)/100 : null,
            ctr: Math.round((clk2/imp2)*10000)/100,
            cpc: Math.round((spend2/clk2)*100)/100,
            cpm: Math.round((spend2/imp2)*1000*100)/100,
            cpa: conv2 ? Math.round((spend2/conv2)*100)/100 : null,
            roas: conv2 && spend2 ? Math.round((conv2*(800)/spend2)*100)/100 : null,
            qualityScore: 5 + Math.floor(rnd2()*5),
          });
        }
      }
    }
    return rows;
  }

  async fetchCampaigns(account: { id: string; externalId: string }) {
    // Mock: 3 campaigns per account, deterministic
    const rnd = this.seeded(account.externalId);
    const count = 3;
    const campaigns = [];
    for (let i = 0; i < count; i++) {
      const ext = `g_${account.externalId.replace(/[^a-z0-9]/gi,'')}_${i+1}`;
      campaigns.push({ id: `mock_g_${account.id}_${i}`, externalId: ext, name: `Google Campaign ${i+1} — ${account.externalId.slice(-4)}`, status: rnd() > 0.15 ? "ENABLED" : "PAUSED", budget: 30000 + Math.floor(rnd()*70000), adSets: [{id:`mock_gs_${account.id}_${i}_0`, externalId: `${ext}_ag0`},{id:`mock_gs_${account.id}_${i}_1`, externalId:`${ext}_ag1`}] });
    }
    return campaigns;
  }
}
