import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { InsightSettingsService } from "../settings/insight-settings.service";

type DateRange = { from: Date; to: Date };

function parseRange(q: any): DateRange {
  const now = new Date();
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30*86400000);
  from.setHours(0,0,0,0); to.setHours(0,0,0,0);
  return { from, to };
}
function dayKey(d: Date){ return d.toISOString().slice(0,10); }

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService, private readonly settings: InsightSettingsService) {}

  private whereInsight(q: any, level: "campaign"|"adset"|"ad"|"any"="any") {
    const { from, to } = parseRange(q);
    const where: any = { date: { gte: from, lte: to } };
    if (q.clientId) where.clientId = q.clientId;
    if (q.provider) where.provider = q.provider.toUpperCase();
    if (q.campaignId) where.campaignId = q.campaignId;
    if (q.adSetId) where.adSetId = q.adSetId;
    if (q.adAccountId) where.adAccountId = q.adAccountId;
    // level filter: only rows at that grain
    if (level==="campaign") { where.adSetId = null; where.adId = null; }
    else if (level==="adset") { where.adId = null; where.NOT = { adSetId: null }; }
    else if (level==="ad") { where.NOT = { adId: null }; }
    return { where, from, to };
  }

  // ── Executive dashboard (CMO view) ──────────────────────────────────────
  async executive(query: any) {
    const key = `insight:reports:executive:${JSON.stringify(query)}`;
    return this.cache.wrap(key, 120, async () => {
      const { where, from, to } = this.whereInsight(query, "campaign");
      const insights = await this.prisma.adInsight.findMany({ where, orderBy:{ date:"asc" } });
      const campaigns = await this.prisma.adCampaign.findMany({ where: query.clientId ? { adAccount: { clientId: query.clientId } } : undefined, include:{ adAccount: { select:{ clientId:true, provider:true } } } });
      const leads = await this.prisma.lead.findMany({ where:{ createdAt: { gte: from, lte: to }, ...(query.clientId? { convertedClientId: query.clientId }: {}) } });
      const clients = query.clientId ? await this.prisma.client.findMany({ where:{ id: query.clientId }}) : await this.prisma.client.findMany({ take:5 });
      const budgets = await this.prisma.budget.findMany({ where: query.clientId? { project: { clientId: query.clientId }}: undefined });

      const totalSpend = insights.reduce((s,i)=> s+Number(i.spend),0);
      const totalImpressions = insights.reduce((s,i)=> s+i.impressions,0);
      const totalClicks = insights.reduce((s,i)=> s+i.clicks,0);
      const totalConversions = insights.reduce((s,i)=> s+i.conversions,0);
      const totalConvValue = insights.reduce((s,i)=> s+Number(i.conversionValue??0),0);
      const ctr = totalImpressions ? (totalClicks/totalImpressions)*100 : 0;
      const cpc = totalClicks ? totalSpend/totalClicks : 0;
      const cpm = totalImpressions ? (totalSpend/totalImpressions)*1000 : 0;
      const cpa = totalConversions ? totalSpend/totalConversions : 0;
      const roas = totalSpend ? totalConvValue/totalSpend : 0;

      // budget vs spend
      const budgetAmount = budgets.reduce((s,b)=> s+Number(b.budgetAmount),0) || campaigns.reduce((s,c)=> s+Number(c.budget??0),0);
      const budgetUtil = budgetAmount ? (totalSpend/budgetAmount)*100 : null;

      // leads / qualified / conversion
      const qualified = leads.filter(l=> ["QUALIFIED","PROPOSAL_SENT","NEGOTIATION","WON"].includes(l.stage)).length;
      const won = leads.filter(l=> l.stage==="WON").length;
      const convRate = leads.length ? (won/leads.length)*100 : 0;
      const cac = won && totalSpend ? totalSpend/won : null;

      // MoM comparison
      const days = Math.ceil((to.getTime()-from.getTime())/86400000)||30;
      const prevFrom = new Date(from.getTime()-days*86400000);
      const prevTo = new Date(from.getTime()-86400000);
      const prevInsights = await this.prisma.adInsight.findMany({ where:{ ...where, date:{ gte:prevFrom, lte:prevTo } }});
      const prevSpend = prevInsights.reduce((s,i)=> s+Number(i.spend),0);
      const prevConv = prevInsights.reduce((s,i)=> s+i.conversions,0);
      const spendMoM = prevSpend ? ((totalSpend-prevSpend)/prevSpend)*100 : null;
      const convMoM = prevConv ? ((totalConversions-prevConv)/prevConv)*100 : null;

      // health score 0-100 weighted
      const healthScore = Math.max(0, Math.min(100, Math.round(
        (ctr>2?20: ctr*10) + (roas>2?25: roas*12) + (convRate>20?20: convRate) + (budgetUtil!==null && budgetUtil<90?15:5) + (totalConversions>0?20:0)
      )));

      // trend daily
      const byDate = new Map<string, { date:string; spend:number; impressions:number; clicks:number; conversions:number; ctr:number }>();
      for(const d = new Date(from); d<=to; d.setDate(d.getDate()+1)){
        const k=dayKey(d); byDate.set(k, {date:k, spend:0, impressions:0, clicks:0, conversions:0, ctr:0});
      }
      for(const r of insights){ const k=dayKey(r.date); const e=byDate.get(k); if(e){ e.spend+=Number(r.spend); e.impressions+=r.impressions; e.clicks+=r.clicks; e.conversions+=r.conversions; }}
      for(const e of byDate.values()) e.ctr = e.impressions? (e.clicks/e.impressions)*100 : 0;
      const trend = Array.from(byDate.values());

      return {
        range:{from, to}, healthScore,
        summary:{ totalSpend: Math.round(totalSpend*100)/100, totalImpressions, totalClicks, totalConversions, totalConvValue: Math.round(totalConvValue*100)/100,
          ctr: Math.round(ctr*100)/100, cpc: Math.round(cpc*100)/100, cpm: Math.round(cpm*100)/100, cpa: Math.round(cpa*100)/100, roas: Math.round(roas*100)/100,
          budgetAmount: Math.round(budgetAmount*100)/100, budgetUtil: budgetUtil!==null? Math.round(budgetUtil*100)/100:null,
          totalLeads: leads.length, qualifiedLeads: qualified, conversionRate: Math.round(convRate*100)/100, cac: cac!==null? Math.round(cac*100)/100:null,
          wonCustomers: won, revenue: Math.round(totalConvValue*100)/100, profit: Math.round((totalConvValue-totalSpend)*100)/100,
          spendMoM: spendMoM!==null? Math.round(spendMoM*100)/100:null, convMoM: convMoM!==null? Math.round(convMoM*100)/100:null,
        },
        trend,
        clientBreakdown: query.clientId ? undefined : await this.clientBreakdown(from,to),
      };
    });
  }

  private async clientBreakdown(from:Date,to:Date){
    const insights = await this.prisma.adInsight.findMany({ where:{ date:{ gte:from,lte:to }, adSetId: null, adId: null }, select:{ clientId:true, spend:true, conversions:true, conversionValue:true }});
    const map=new Map<string,{clientId:string; spend:number; conversions:number; revenue:number}>();
    for(const r of insights){
      const k=r.clientId??"unassigned"; const e=map.get(k) ?? {clientId:k, spend:0, conversions:0, revenue:0};
      e.spend+=Number(r.spend); e.conversions+=r.conversions; e.revenue+=Number(r.conversionValue??0); map.set(k,e);
    }
    const clients = await this.prisma.client.findMany({ where:{ id:{ in: Array.from(map.keys()).filter(k=>k!=="unassigned")} }, select:{ id:true, companyName:true }});
    const nameById=new Map(clients.map(c=>[c.id,c.companyName]));
    return Array.from(map.values()).map(v=> ({ ...v, clientName: nameById.get(v.clientId) ?? (v.clientId==="unassigned"?"Unassigned":v.clientId), roas: v.spend? v.revenue/v.spend:0 })).sort((a,b)=> b.spend-a.spend).slice(0,8);
  }

  // ── Campaign performance ───────────────────────────────────────────────
  async campaigns(query:any){
    const { where, from, to } = this.whereInsight(query,"campaign");
    const key=`insight:reports:campaigns:${JSON.stringify(query)}`;
    return this.cache.wrap(key,120, async()=>{
      const insights = await this.prisma.adInsight.findMany({ where, include:{ campaign:{ select:{ name:true, budget:true, status:true, externalId:true, adAccount:{ select:{ provider:true, name:true } } } } }, orderBy:{ date:"desc" }});
      const byCampaign=new Map<string, any>();
      for(const r of insights){
        const id=r.campaignId ?? "unknown";
        const e=byCampaign.get(id) ?? { campaignId:id, campaignName: r.campaign?.name ?? id, provider: r.campaign?.adAccount?.provider ?? r.provider, status: r.campaign?.status ?? "UNKNOWN", budget: r.campaign?.budget ? Number(r.campaign.budget):null, externalId: r.campaign?.externalId ?? null, impressions:0, clicks:0, spend:0, conversions:0, conversionValue:0, reach:0, cpm:0 };
        e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; e.conversionValue+=Number(r.conversionValue??0); e.reach+=(r.reach??0);
        byCampaign.set(id,e);
      }
      const rows=Array.from(byCampaign.values()).map(r=> ({
        ...r,
        ctr: r.impressions? Math.round((r.clicks/r.impressions)*10000)/100 : 0,
        cpc: r.clicks? Math.round((r.spend/r.clicks)*100)/100 : 0,
        cpm: r.impressions? Math.round((r.spend/r.impressions)*1000*100)/100 : 0,
        cpa: r.conversions? Math.round((r.spend/r.conversions)*100)/100 : 0,
        roas: r.spend? Math.round((r.conversionValue/r.spend)*100)/100 : 0,
        spend: Math.round(r.spend*100)/100, conversionValue: Math.round(r.conversionValue*100)/100,
        budgetUtil: r.budget? Math.round((r.spend/r.budget)*10000)/100 : null,
        statusLabel: r.spend > (r.budget ?? 1e9) ? "Over Budget" : r.roas>2.5? "🔥 Winner" : r.cpa>500? "❌ Need Optimization" : "—",
      })).sort((a,b)=> b.spend-a.spend);
      // wasteful/high CPC etc
      const wasteful = rows.filter(r=> r.conversions===0 && r.spend>1000).sort((a,b)=> b.spend-a.spend).slice(0,5);
      const highCpc = [...rows].sort((a,b)=> b.cpc-a.cpc).slice(0,5);
      return { from,to, rows, wasteful, highCpc, total:{ spend: Math.round(rows.reduce((s,r)=>s+r.spend,0)*100)/100, conversions: rows.reduce((s,r)=>s+r.conversions,0)} };
    });
  }

  async adsets(query:any){
    const { where } = this.whereInsight(query,"adset");
    const insights = await this.prisma.adInsight.findMany({ where, include:{ adSet:{ select:{ name:true, externalId:true, campaign:{ select:{ name:true } } }} }, orderBy:{ date:"desc" }});
    const bySet=new Map<string,any>();
    for(const r of insights){
      const id=r.adSetId ?? "unknown";
      const e=bySet.get(id) ?? { adSetId:id, adSetName: r.adSet?.name ?? id, campaignName: r.adSet?.campaign?.name ?? null, impressions:0, clicks:0, spend:0, conversions:0, conversionValue:0 };
      e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; e.conversionValue+=Number(r.conversionValue??0); bySet.set(id,e);
    }
    const rows=Array.from(bySet.values()).map(r=> ({...r, ctr: r.impressions? Math.round((r.clicks/r.impressions)*10000)/100:0, cpc: r.clicks? Math.round((r.spend/r.clicks)*100)/100:0, cpm: r.impressions? Math.round((r.spend/r.impressions)*1000*100)/100:0, roas: r.spend? Math.round((r.conversionValue/r.spend)*100)/100:0, spend: Math.round(r.spend*100)/100})).sort((a,b)=> b.spend-a.spend);
    return { rows };
  }

  async ads(query:any){
    const { where } = this.whereInsight(query,"ad");
    const insights = await this.prisma.adInsight.findMany({ where, include:{ ad:{ select:{ name:true, creativeUrl:true, creativeType:true, externalId:true } } }, orderBy:{ date:"desc" }});
    const byAd=new Map<string,any>();
    for(const r of insights){
      const id=r.adId ?? "unknown";
      const e=byAd.get(id) ?? { adId:id, adName: r.ad?.name ?? id, creativeUrl: r.ad?.creativeUrl ?? null, creativeType: r.ad?.creativeType ?? null, impressions:0, clicks:0, spend:0, conversions:0, conversionValue:0, engagement:0 };
      e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; e.conversionValue+=Number(r.conversionValue??0); e.engagement+=(r.engagement??0); byAd.set(id,e);
    }
    const rows=Array.from(byAd.values()).map(r=> ({...r, ctr: r.impressions? Math.round((r.clicks/r.impressions)*10000)/100:0, cpc: r.clicks? Math.round((r.spend/r.clicks)*100)/100:0, roas: r.spend? Math.round((r.conversionValue/r.spend)*100)/100:0, spend:Math.round(r.spend*100)/100})).sort((a,b)=> b.spend-a.spend);
    return { rows };
  }

  async creatives(query:any){
    const { where } = this.whereInsight(query,"ad");
    const insights = await this.prisma.adInsight.findMany({ where, include:{ ad:{ select:{ name:true, creativeUrl:true, creativeType:true } }, campaign:{ select:{ name:true } } }});
    // join creative via adId
    const byAd=new Map<string,any>();
    for(const r of insights){
      const id=r.adId ?? r.campaignId ?? "unknown";
      const e=byAd.get(id) ?? { id, name: r.ad?.name ?? r.campaign?.name ?? id, creativeUrl: r.ad?.creativeUrl ?? null, creativeType: r.ad?.creativeType ?? "UNKNOWN", impressions:0, clicks:0, spend:0, conversions:0, engagement:0, videoViews:{p3s:0,p50:0,complete:0}, ctr:0 };
      e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; e.engagement+=(r.engagement??0);
      const vv=r.videoViews as any; if(vv){ e.videoViews.p3s+=(vv.p3s??0); e.videoViews.p50+=(vv.p50??0); e.videoViews.complete+=(vv.complete??0); }
      byAd.set(id,e);
    }
    const rows=Array.from(byAd.values()).map(r=> ({
      ...r, ctr: r.impressions? Math.round((r.clicks/r.impressions)*10000)/100:0,
      engagementRate: r.impressions? Math.round((r.engagement/r.impressions)*10000)/100:0,
      videoCompleteRate: r.impressions? Math.round((r.videoViews.complete/r.impressions)*10000)/100:0,
      roas: r.spend? Math.round(((r.conversions*800)/r.spend)*100)/100:0, // approx
      spend:Math.round(r.spend*100)/100,
      fatigue: r.impressions>5000 && (r.clicks/r.impressions)<0.01 ? "Fatigue detected" : null,
    })).sort((a,b)=> b.ctr-a.ctr);
    const top = rows.slice(0,6);
    const fatigue = rows.filter(r=> r.fatigue).slice(0,5);
    return { rows, topPerforming: top, fatigue };
  }

  async audience(query:any){
    const { where, from, to } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where: { ...where, provider:"META" }});
    const ageAgg:Record<string,number>={}; const genderAgg:Record<string,number>={};
    for(const r of insights){
      const demo=r.demographic as any;
      if(demo?.age) for(const [k,v] of Object.entries(demo.age)) ageAgg[k]=(ageAgg[k]??0)+(v as number);
      if(demo?.gender) for(const [k,v] of Object.entries(demo.gender)) genderAgg[k]=(genderAgg[k]??0)+(v as number);
    }
    const age = Object.entries(ageAgg).map(([name,value])=> ({name, value})).sort((a,b)=> b.value-a.value);
    const gender = Object.entries(genderAgg).map(([name,value])=> ({name, value}));
    // winning audience = highest ctr proxy (we don't have audience ctr, use impression share)
    const winning = age[0] ?? null;
    return { from,to, age, gender, winningAudience: winning, totalImpressions: insights.reduce((s,i)=>s+i.impressions,0) };
  }

  async spendBudget(query:any){
    const { where, from, to } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where });
    const totalSpend = insights.reduce((s,i)=> s+Number(i.spend),0);
    const campaigns = await this.prisma.adCampaign.findMany({ where: query.clientId? { adAccount:{ clientId: query.clientId } }: undefined, select:{ budget:true }});
    const totalBudget = campaigns.reduce((s,c)=> s+Number(c.budget??0),0);
    const budgetFromProject = await this.prisma.budget.findMany({ where: query.clientId? { project:{ clientId: query.clientId }}: undefined, select:{ budgetAmount:true }});
    const projectBudget = budgetFromProject.reduce((s,b)=> s+Number(b.budgetAmount),0);
    const combinedBudget = totalBudget || projectBudget;
    return { from,to, totalSpend: Math.round(totalSpend*100)/100, totalBudget: Math.round(combinedBudget*100)/100, remaining: Math.round((combinedBudget-totalSpend)*100)/100, util: combinedBudget? Math.round((totalSpend/combinedBudget)*10000)/100 : null, daily: await this.dailySpend(where, from,to) };
  }
  private async dailySpend(where:any, from:Date, to:Date){
    const insights = await this.prisma.adInsight.findMany({ where });
    const byDate=new Map<string, number>();
    for(const d=new Date(from); d<=to; d.setDate(d.getDate()+1)) byDate.set(dayKey(d),0);
    for(const r of insights) { const k=dayKey(r.date); byDate.set(k, (byDate.get(k)??0)+Number(r.spend)); }
    return Array.from(byDate.entries()).map(([date,spend])=> ({date, spend: Math.round(spend*100)/100}));
  }

  async roasRoi(query:any){
    const { where } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where });
    const spend = insights.reduce((s,i)=> s+Number(i.spend),0);
    const revenue = insights.reduce((s,i)=> s+Number(i.conversionValue??0),0);
    const roas = spend? revenue/spend:0;
    const roi = spend? (revenue-spend)/spend*100:0;
    // per campaign ROAS
    const byCamp=new Map<string,{name:string; spend:number; revenue:number}>();
    const withCamp = await this.prisma.adInsight.findMany({ where, include:{ campaign:{ select:{ name:true } } }});
    for(const r of withCamp){ const id=r.campaignId??"unknown"; const e=byCamp.get(id) ?? {name: r.campaign?.name??id, spend:0, revenue:0}; e.spend+=Number(r.spend); e.revenue+=Number(r.conversionValue??0); byCamp.set(id,e);}
    const perCampaign=Array.from(byCamp.values()).map(v=> ({...v, roas: v.spend? Math.round((v.revenue/v.spend)*100)/100:0, roi: v.spend? Math.round(((v.revenue-v.spend)/v.spend)*10000)/100:0})).sort((a,b)=> b.roas-a.roas);
    return { spend: Math.round(spend*100)/100, revenue: Math.round(revenue*100)/100, roas: Math.round(roas*100)/100, roi: Math.round(roi*100)/100, perCampaign };
  }

  async metrics(query:any){
    const { where } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where });
    const imp=insights.reduce((s,i)=>s+i.impressions,0);
    const clk=insights.reduce((s,i)=>s+i.clicks,0);
    const spend=insights.reduce((s,i)=>s+Number(i.spend),0);
    const conv=insights.reduce((s,i)=>s+i.conversions,0);
    return {
      impressions: imp, clicks: clk, ctr: imp? Math.round((clk/imp)*10000)/100:0,
      cpc: clk? Math.round((spend/clk)*100)/100:0, cpm: imp? Math.round((spend/imp)*1000*100)/100:0, cpa: conv? Math.round((spend/conv)*100)/100:0,
      spend: Math.round(spend*100)/100, conversions: conv,
    };
  }

  async conversions(query:any){
    const { where, from, to } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where, orderBy:{ date:"asc" }});
    const total=insights.reduce((s,i)=> s+i.conversions,0);
    const byDate=new Map<string, number>();
    for(const d=new Date(from); d<=to; d.setDate(d.getDate()+1)) byDate.set(dayKey(d),0);
    for(const r of insights) byDate.set(dayKey(r.date), (byDate.get(dayKey(r.date))??0)+r.conversions);
    const daily=Array.from(byDate.entries()).map(([date,conversions])=> ({date, conversions}));
    const byProvider:Record<string,number>={};
    for(const r of insights) byProvider[r.provider]=(byProvider[r.provider]??0)+r.conversions;
    return { from,to, total, daily, byProvider: Object.entries(byProvider).map(([name,value])=>({name,value})) };
  }

  async crossPlatform(query:any){
    const { from, to } = parseRange(query);
    const baseWhere:any={ date:{ gte:from,lte:to }, adSetId: null, adId: null };
    if(query.clientId) baseWhere.clientId=query.clientId;
    const [google, meta] = await Promise.all([
      this.prisma.adInsight.findMany({ where:{ ...baseWhere, provider:"GOOGLE" }}),
      this.prisma.adInsight.findMany({ where:{ ...baseWhere, provider:"META" }}),
    ]);
    const agg=(arr:any[])=> ({ impressions:arr.reduce((s,i)=>s+i.impressions,0), clicks:arr.reduce((s,i)=>s+i.clicks,0), spend:arr.reduce((s,i)=>s+Number(i.spend),0), conversions:arr.reduce((s,i)=>s+i.conversions,0), revenue:arr.reduce((s,i)=>s+Number(i.conversionValue??0),0)});
    const g=agg(google), m=agg(meta);
    const total={ impressions:g.impressions+m.impressions, clicks:g.clicks+m.clicks, spend: Math.round((g.spend+m.spend)*100)/100, conversions:g.conversions+m.conversions, revenue: Math.round((g.revenue+m.revenue)*100)/100 };
    return {
      from,to,
      google:{ ...g, ctr: g.impressions? Math.round((g.clicks/g.impressions)*10000)/100:0, cpc: g.clicks? Math.round((g.spend/g.clicks)*100)/100:0, roas: g.spend? Math.round((g.revenue/g.spend)*100)/100:0 },
      meta:{ ...m, ctr: m.impressions? Math.round((m.clicks/m.impressions)*10000)/100:0, cpc: m.clicks? Math.round((m.spend/m.clicks)*100)/100:0, roas: m.spend? Math.round((m.revenue/m.spend)*100)/100:0 },
      combined:{ ...total, ctr: total.impressions? Math.round((total.clicks/total.impressions)*10000)/100:0, cpc: total.clicks? Math.round((total.spend/total.clicks)*100)/100:0, roas: total.spend? Math.round((total.revenue/total.spend)*100)/100:0 },
      winner: (g.spend && m.spend) ? ( (g.revenue/g.spend) > (m.revenue/m.spend) ? "GOOGLE" : "META") : (g.spend? "GOOGLE":"META"),
    };
  }

  async comparison(query:any){
    const from=new Date(query.from), to=new Date(query.to);
    const compareFrom=new Date(query.compareFrom), compareTo=new Date(query.compareTo);
    if(isNaN(from.getTime())||isNaN(to.getTime())||isNaN(compareFrom.getTime())||isNaN(compareTo.getTime())) throw new Error("from/to/compareFrom/compareTo required as ISO dates");
    const base:any={ adSetId: null, adId: null };
    if(query.clientId) base.clientId=query.clientId;
    if(query.provider) base.provider=query.provider.toUpperCase();
    const [curr, prev]= await Promise.all([
      this.prisma.adInsight.findMany({ where:{ ...base, date:{ gte:from,lte:to }}}),
      this.prisma.adInsight.findMany({ where:{ ...base, date:{ gte:compareFrom,lte:compareTo }}}),
    ]);
    const sum=(arr:any[])=> ({ spend:arr.reduce((s,i)=>s+Number(i.spend),0), imp:arr.reduce((s,i)=>s+i.impressions,0), clk:arr.reduce((s,i)=>s+i.clicks,0), conv:arr.reduce((s,i)=>s+i.conversions,0), rev:arr.reduce((s,i)=>s+Number(i.conversionValue??0),0)});
    const c=sum(curr), p=sum(prev);
    const pct=(a:number,b:number)=> b? Math.round(((a-b)/b)*10000)/100 : null;
    return {
      current:{ ...c, ctr: c.imp? Math.round((c.clk/c.imp)*10000)/100:0, cpc: c.clk? Math.round((c.spend/c.clk)*100)/100:0, roas: c.spend? Math.round((c.rev/c.spend)*100)/100:0, period:{from,to}},
      previous:{ ...p, ctr: p.imp? Math.round((p.clk/p.imp)*10000)/100:0, cpc: p.clk? Math.round((p.spend/p.clk)*100)/100:0, roas: p.spend? Math.round((p.rev/p.spend)*100)/100:0, period:{from:compareFrom,to:compareTo}},
      delta:{ spend: pct(c.spend,p.spend), conversions: pct(c.conv,p.conv), ctr: c.imp&&p.imp? Math.round(((c.clk/c.imp)-(p.clk/p.imp))*10000)/100 : null, roas: c.spend&&p.spend? Math.round(((c.rev/c.spend)-(p.rev/p.spend))*100)/100:null },
    };
  }

  async custom(query:any){
    // choose metrics via query.metrics=spend,ctr,cpc...
    const metrics = (query.metrics ? String(query.metrics).split(",") : ["spend","impressions","clicks","ctr","cpc"]).map((s:string)=> s.trim()).filter(Boolean);
    const dimensions = query.dimensions ? String(query.dimensions).split(",") : ["date"];
    const { where } = this.whereInsight(query,"campaign");
    const insights = await this.prisma.adInsight.findMany({ where, orderBy:{ date:"asc" }});
    // simple aggregation by date or provider or campaign
    if(dimensions.includes("provider")){
      const byProv=new Map<string, any>();
      for(const r of insights){ const k=r.provider; const e=byProv.get(k) ?? { provider:k, impressions:0, clicks:0, spend:0, conversions:0}; e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; byProv.set(k,e);}
      const rows=Array.from(byProv.values()).map(r=> ({...r, ctr: r.impressions? Math.round((r.clicks/r.impressions)*10000)/100:0, cpc: r.clicks? Math.round((r.spend/r.clicks)*100)/100:0}));
      return { rows, metrics, dimensions };
    }
    if(dimensions.includes("campaign")){
      const withCamp=await this.prisma.adInsight.findMany({ where, include:{ campaign:{ select:{ name:true } }}});
      const byCamp=new Map<string,any>();
      for(const r of withCamp){ const k=r.campaign?.name??r.campaignId??"unknown"; const e=byCamp.get(k)??{ campaign:k, impressions:0, clicks:0, spend:0, conversions:0}; e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; byCamp.set(k,e);}
      const rows=Array.from(byCamp.values()).map(r=>({...r, ctr: r.impressions?Math.round((r.clicks/r.impressions)*10000)/100:0}));
      return { rows, metrics, dimensions };
    }
    // default by date
    const byDate=new Map<string,any>();
    for(const r of insights){ const k=dayKey(r.date); const e=byDate.get(k)??{date:k, impressions:0, clicks:0, spend:0, conversions:0}; e.impressions+=r.impressions; e.clicks+=r.clicks; e.spend+=Number(r.spend); e.conversions+=r.conversions; byDate.set(k,e);}
    const rows=Array.from(byDate.values()).map(r=> ({...r, ctr: r.impressions?Math.round((r.clicks/r.impressions)*10000)/100:0, cpc: r.clicks?Math.round((r.spend/r.clicks)*100)/100:0}));
    return { rows, metrics, dimensions };
  }

  // Lead funnel (existing Lead stages) + ad funnel combined
  async funnel(query:any){
    const { from, to } = parseRange(query);
    const insights = await this.prisma.adInsight.findMany({ where:{ date:{ gte:from,lte:to }, adSetId: null, adId: null, ...(query.clientId?{clientId:query.clientId}:{}) }});
    const impressions = insights.reduce((s,i)=>s+i.impressions,0);
    const clicks = insights.reduce((s,i)=>s+i.clicks,0);
    const leads = await this.prisma.lead.count({ where:{ createdAt:{ gte:from,lte:to }, ...(query.clientId?{ convertedClientId: query.clientId }: {}) }});
    const contacted = await this.prisma.lead.count({ where:{ stage:{ in:["CONTACTED","QUALIFIED","PROPOSAL_SENT","NEGOTIATION","WON"] }, createdAt:{ gte:from,lte:to } }});
    const qualified = await this.prisma.lead.count({ where:{ stage:{ in:["QUALIFIED","PROPOSAL_SENT","NEGOTIATION","WON"] }, createdAt:{ gte:from,lte:to } }});
    const proposal = await this.prisma.lead.count({ where:{ stage:{ in:["PROPOSAL_SENT","NEGOTIATION","WON"] }, createdAt:{ gte:from,lte:to } }});
    const won = await this.prisma.lead.count({ where:{ stage:"WON", createdAt:{ gte:from,lte:to } }});
    const steps=[
      { stage:"Ad Impression", count: impressions },
      { stage:"Click", count: clicks, rate: impressions? Math.round((clicks/impressions)*10000)/100:null },
      { stage:"Lead Generated", count: leads, rate: clicks? Math.round((leads/clicks)*10000)/100:null },
      { stage:"Contacted", count: contacted, rate: leads? Math.round((contacted/leads)*10000)/100:null },
      { stage:"Qualified", count: qualified, rate: contacted? Math.round((qualified/contacted)*10000)/100:null },
      { stage:"Proposal Sent", count: proposal, rate: qualified? Math.round((proposal/qualified)*10000)/100:null },
      { stage:"Won Customer", count: won, rate: proposal? Math.round((won/proposal)*10000)/100:null },
    ];
    return { from,to, steps, dropOff: steps.map((s,i)=> i===0?null: steps[i-1].count ? Math.round((1- s.count/steps[i-1].count)*10000)/100:null) };
  }

  async taskReport(taskId:string){
    const task = await this.prisma.task.findUnique({ where:{ id:taskId }, select:{ id:true, title:true, status:true, createdAt:true }});
    if(!task) throw new Error("Task not found");
    // before/after metrics: use task createdAt vs now — stub: compare 7 days before task creation vs 7 days after
    const beforeFrom=new Date(task.createdAt.getTime()-7*86400000), beforeTo=new Date(task.createdAt);
    const afterFrom=new Date(task.createdAt), afterTo=new Date(Date.now());
    const [before, after] = await Promise.all([
      this.prisma.adInsight.findMany({ where:{ date:{ gte:beforeFrom,lte:beforeTo }}}),
      this.prisma.adInsight.findMany({ where:{ date:{ gte:afterFrom,lte:afterTo }}}),
    ]);
    const sum=(arr:any[])=> ({spend:arr.reduce((s,i)=>s+Number(i.spend),0), ctr: arr.reduce((s,i)=>s+i.impressions,0)? Math.round((arr.reduce((s,i)=>s+i.clicks,0)/arr.reduce((s,i)=>s+i.impressions,0))*10000)/100:0});
    const b=sum(before), a=sum(after);
    return { task, before:b, after:a, improvement: b.spend? Math.round(((a.ctr-b.ctr)/b.ctr)*10000)/100:null };
  }
}
