import { Injectable } from "@nestjs/common";

@Injectable()
export class MetaAdsService {
  private seeded(str: string) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  async fetchInsights(account: { id: string; externalId: string }, from: Date, to: Date) {
    const campaigns = await this.fetchCampaigns(account);
    const rows: any[] = [];
    const dayMs = 86400000;
    for (const camp of campaigns) {
      for (let d = new Date(from); d <= to; d = new Date(d.getTime() + dayMs)) {
        const rnd = this.seeded(`${account.externalId}:${camp.externalId}:${d.toISOString().slice(0,10)}`);
        const reach = 1200 + Math.floor(rnd() * 6000);
        const freq = 1.1 + rnd() * 1.8;
        const impressions = Math.floor(reach * freq);
        const ctr = 0.012 + rnd() * 0.03;
        const clicks = Math.max(4, Math.floor(impressions * ctr));
        const cpm = 45 + rnd() * 90;
        const spend = Math.round((impressions / 1000) * cpm * 100) / 100;
        const conversions = rnd() > 0.3 ? Math.floor(clicks * (0.025 + rnd()*0.07)) : 0;
        const convVal = conversions ? Math.round(conversions * (900 + rnd()*3000)*100)/100 : null;
        const engagement = Math.floor(clicks * (0.3 + rnd()*0.6));
        const videoViews = { p3s: Math.floor(impressions*0.35), p50: Math.floor(impressions*0.12), complete: Math.floor(impressions*0.06) };
        rows.push({
          provider: "META" as const,
          date: new Date(d),
          campaignId: camp.id,
          adSetId: null, adId: null,
          adAccountId: account.id,
          clientId: (account as any).clientId ?? null,
          impressions, clicks, spend, conversions, conversionValue: convVal,
          reach, frequency: Math.round(freq*100)/100,
          ctr: Math.round((clicks/impressions)*10000)/100,
          cpc: clicks ? Math.round((spend/clicks)*100)/100 : null,
          cpm: Math.round(cpm*100)/100,
          cpa: conversions ? Math.round((spend/conversions)*100)/100 : null,
          roas: convVal && spend ? Math.round((convVal/spend)*100)/100 : null,
          engagement, videoViews,
          demographic: { age: {"18-24": Math.floor(impressions*0.2), "25-34": Math.floor(impressions*0.35), "35-44": Math.floor(impressions*0.25)}, gender: {male: Math.floor(impressions*0.55), female: Math.floor(impressions*0.43)} },
        });
        for (let si=0; si<2; si++){
          const rnd2 = this.seeded(`${camp.externalId}:adset${si}:${d.toISOString().slice(0,10)}`);
          const reach2 = Math.floor(reach * (0.35 + rnd2()*0.3));
          const freq2 = 1.1 + rnd2()*1.4;
          const imp2 = Math.floor(reach2*freq2);
          const clk2 = Math.max(2, Math.floor(imp2 * (0.01 + rnd2()*0.025)));
          const spend2 = Math.round((imp2/1000)*(40 + rnd2()*80)*100)/100;
          const conv2 = rnd2()>0.45 ? Math.floor(clk2*(0.02+rnd2()*0.06)) : 0;
          rows.push({
            provider:"META" as const, date:new Date(d), campaignId:camp.id, adSetId: camp.adSets?.[si]?.id ?? null, adId:null, adAccountId:account.id, clientId:(account as any).clientId??null,
            impressions:imp2, clicks:clk2, spend:spend2, conversions:conv2, conversionValue: conv2? Math.round(conv2*(800+rnd2()*2000)*100)/100:null,
            reach:reach2, frequency: Math.round(freq2*100)/100,
            ctr: Math.round((clk2/imp2)*10000)/100, cpc: clk2? Math.round((spend2/clk2)*100)/100:null, cpm: Math.round((spend2/imp2)*1000*100)/100, cpa: conv2? Math.round((spend2/conv2)*100)/100:null,
            roas: conv2 && spend2 ? Math.round((conv2*900/spend2)*100)/100:null, engagement: Math.floor(clk2*(0.2+rnd2()*0.5)), videoViews:{p3s:Math.floor(imp2*0.3), p50:Math.floor(imp2*0.1), complete:Math.floor(imp2*0.05)}
          });
        }
        // creative / ad level (2 ads per first adset)
        for(let ai=0; ai<2; ai++){
          const rnd3 = this.seeded(`${camp.externalId}:ad${ai}:${d.toISOString().slice(0,10)}`);
          const imp3 = Math.floor(impressions * (0.15 + rnd3()*0.15));
          const clk3 = Math.max(1, Math.floor(imp3 * (0.008 + rnd3()*0.02)));
          const spend3 = Math.round((imp3/1000)*(35 + rnd3()*75)*100)/100;
          const conv3 = rnd3()>0.5 ? Math.floor(clk3*(0.015+rnd3()*0.05)):0;
          rows.push({
            provider:"META" as const, date:new Date(d), campaignId:camp.id, adSetId: camp.adSets?.[0]?.id ?? null, adId: `mock_ad_${camp.id}_${ai}`, adAccountId:account.id, clientId:(account as any).clientId??null,
            impressions:imp3, clicks:clk3, spend:spend3, conversions:conv3, conversionValue: conv3? Math.round(conv3*(850+rnd3()*2200)*100)/100:null,
            reach: Math.floor(imp3*0.8), frequency:1.2,
            ctr: Math.round((clk3/imp3)*10000)/100, cpc: clk3?Math.round((spend3/clk3)*100)/100:null, cpm: Math.round((spend3/imp3)*1000*100)/100, cpa: conv3?Math.round((spend3/conv3)*100)/100:null,
            roas: conv3 && spend3? Math.round((conv3*850/spend3)*100)/100:null, engagement: Math.floor(clk3*(0.25+rnd3()*0.5)), creativeUrl: `https://picsum.photos/seed/${camp.externalId}${ai}/600/400`, creativeType: rnd3()>0.5?"IMAGE":"VIDEO"
          });
        }
      }
    }
    return rows;
  }

  async fetchCampaigns(account: { id:string; externalId:string }){
    const rnd=this.seeded(account.externalId);
    const campaigns=[];
    for(let i=0;i<3;i++){ const ext=`m_${account.externalId.replace(/[^a-z0-9]/gi,'')}_${i+1}`; campaigns.push({id:`mock_m_${account.id}_${i}`, externalId:ext, name:`Meta Campaign ${i+1} — ${account.externalId.slice(-4)}`, status: rnd()>0.12?"ACTIVE":"PAUSED", budget: 25000+Math.floor(rnd()*60000), adSets:[{id:`mock_ms_${account.id}_${i}_0`, externalId:`${ext}_as0`},{id:`mock_ms_${account.id}_${i}_1`, externalId:`${ext}_as1`}] })}
    return campaigns;
  }
}
