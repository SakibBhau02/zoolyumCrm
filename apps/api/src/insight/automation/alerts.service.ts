import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Cron } from "@nestjs/schedule";
import { NotificationsService } from "../../notifications/notifications.service";
import { InsightSettingsService } from "../settings/insight-settings.service";

@Injectable()
export class AlertsService {
  private readonly logger=new Logger(AlertsService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService, private readonly settings: InsightSettingsService) {}

  async list(){ return this.prisma.alertRule.findMany({ orderBy:{ createdAt:"desc" }, include:{ client:{ select:{ companyName:true } } }}); }
  async create(body:any){
    return this.prisma.alertRule.create({ data:{
      name: body.name, clientId: body.clientId??null, metric: body.metric, condition: body.condition, threshold: body.threshold, windowDays: body.windowDays??7, isActive: body.isActive??true
    }});
  }
  async update(id:string, body:any){
    const ex=await this.prisma.alertRule.findUnique({ where:{ id }}); if(!ex) throw new Error("Alert not found");
    const data:any={}; for(const f of ["name","clientId","metric","condition","threshold","windowDays","isActive"]) if(body[f]!==undefined) data[f]=body[f];
    return this.prisma.alertRule.update({ where:{ id }, data });
  }
  async remove(id:string){ await this.prisma.alertRule.delete({ where:{ id }}); return {deleted:true}; }

  // Evaluate all active rules
  async evaluate(){
    const rules=await this.prisma.alertRule.findMany({ where:{ isActive:true }});
    const triggered:any[]=[];
    for(const rule of rules){
      try{
        const hit=await this.evalRule(rule);
        if(hit){
          triggered.push(hit);
          await this.prisma.alertRule.update({ where:{ id: rule.id }, data:{ lastTriggeredAt: new Date() }});
          // notify
          await this.notifications.broadcast("report_alert", `🚨 ${rule.name}`, hit.message, "/insight").catch(()=>{});
        }
      }catch(e:any){ this.logger.warn(`Rule ${rule.id} eval failed: ${e.message}`); }
    }
    // built-in anomaly detection
    const auto=await this.detectAnomalies();
    return { evaluated: rules.length, triggered: [...triggered, ...auto] };
  }

  private async evalRule(rule:any){
    const to=new Date(); to.setHours(0,0,0,0);
    const from=new Date(to.getTime()-rule.windowDays*86400000);
    const where:any={ date:{ gte: from, lte: to }, adSetId: null, adId: null, ...(rule.clientId?{ clientId: rule.clientId }: {})};
    const insights=await this.prisma.adInsight.findMany({ where });
    if(!insights.length) return null;
    let value:number;
    const spend=insights.reduce((s,i)=>s+Number(i.spend),0);
    const clicks=insights.reduce((s,i)=>s+i.clicks,0);
    const imp=insights.reduce((s,i)=>s+i.impressions,0);
    const conv=insights.reduce((s,i)=>s+i.conversions,0);
    const rev=insights.reduce((s,i)=>s+Number(i.conversionValue??0),0);
    switch(rule.metric){
      case "spend": value=spend; break;
      case "ctr": value=imp? (clicks/imp)*100:0; break;
      case "cpc": value=clicks? spend/clicks:0; break;
      case "cpm": value=imp? (spend/imp)*1000:0; break;
      case "roas": value=spend? rev/spend:0; break;
      case "cpa": value=conv? spend/conv:0; break;
      case "conversions": value=conv; break;
      case "impressions": value=imp; break;
      default: value=spend;
    }
    // previous window for change_pct
    let triggered=false; let message="";
    if(rule.condition==="gt" && value>rule.threshold) { triggered=true; message=`${rule.metric} is ${Math.round(value*100)/100} > ${rule.threshold}`; }
    else if(rule.condition==="lt" && value<rule.threshold) { triggered=true; message=`${rule.metric} is ${Math.round(value*100)/100} < ${rule.threshold}`; }
    else if(rule.condition==="change_pct_gt" || rule.condition==="change_pct_lt"){
      const prevFrom=new Date(from.getTime()-rule.windowDays*86400000), prevTo=new Date(from.getTime()-86400000);
      const prev=await this.prisma.adInsight.findMany({ where:{ ...where, date:{ gte:prevFrom,lte:prevTo }}});
      if(prev.length){
        const prevVal=(()=>{
          const s=prev.reduce((a,i)=>a+Number(i.spend),0), cl=prev.reduce((a,i)=>a+i.clicks,0), im=prev.reduce((a,i)=>a+i.impressions,0);
          switch(rule.metric){
            case "spend": return s;
            case "ctr": return im? (cl/im)*100:0;
            case "cpc": return cl? s/cl:0;
            default: return s;
          }
        })();
        const pct=prevVal? ((value-prevVal)/prevVal)*100:0;
        if(rule.condition==="change_pct_gt" && pct>rule.threshold) { triggered=true; message=`${rule.metric} increased ${Math.round(pct*100)/100}% (> ${rule.threshold}%)`; }
        if(rule.condition==="change_pct_lt" && pct < -rule.threshold) { triggered=true; message=`${rule.metric} dropped ${Math.round(Math.abs(pct)*100)/100}%`; }
      }
    }
    if(!triggered) return null;
    return { ruleId: rule.id, name: rule.name, metric: rule.metric, value: Math.round(value*100)/100, threshold: rule.threshold, condition: rule.condition, message, window:{from,to} };
  }

  private async detectAnomalies(){
    const out:any[]=[];
    // spend without leads
    const to=new Date(); const from=new Date(to.getTime()-7*86400000);
    const insights=await this.prisma.adInsight.findMany({ where:{ date:{ gte:from,lte:to }, adSetId: null, adId: null }});
    const spend=insights.reduce((s,i)=>s+Number(i.spend),0);
    const conv=insights.reduce((s,i)=>s+i.conversions,0);
    if(spend>5000 && conv===0){
      out.push({ name:"Spending without leads", message:`🚨 Campaign spending ৳${Math.round(spend)} in last 7 days without any conversion`, metric:"conversions", value:0 });
      await this.notifications.broadcast("report_alert","Spending without leads",`Spent ৳${Math.round(spend)} with 0 conversions in last 7 days`,"/insight").catch(()=>{});
    }
    // ctr drop
    const byDate=new Map<string,{imp:number; clk:number}>();
    for(const r of insights){ const k=r.date.toISOString().slice(0,10); const e=byDate.get(k)??{imp:0,clk:0}; e.imp+=r.impressions; e.clk+=r.clicks; byDate.set(k,e); }
    const sorted=Array.from(byDate.entries()).sort((a,b)=> a[0].localeCompare(b[0]));
    if(sorted.length>=7){
      const recent=sorted.slice(-3).reduce((s,[,v])=> s+(v.clk/v.imp),0)/3;
      const prev=sorted.slice(-7,-3).reduce((s,[,v])=> s+(v.clk/v.imp),0)/4;
      if(prev && recent < prev*0.7){
        out.push({name:"CTR dropped", message:`🚨 CTR dropped ${(Math.round((1-recent/prev)*100))}% vs previous period`, metric:"ctr"});
      }
    }
    return out;
  }

  @Cron("0 */30 * * * *")
  async cronAlerts(){
    try{ const r=await this.evaluate(); if(r.triggered.length) this.logger.log(`Alerts: ${r.triggered.length} triggered`); }catch(e){ this.logger.error("Alert eval failed", e); }
  }
}
