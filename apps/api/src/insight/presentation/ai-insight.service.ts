import { Injectable } from "@nestjs/common";
import { ReportsService } from "../reports/reports.service";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AiInsightService {
  constructor(private readonly reports: ReportsService, private readonly prisma: PrismaService) {}

  async summarize(query:any){
    const exec:any = await this.reports.executive(query);
    const cross:any = await this.reports.crossPlatform(query).catch(()=>null);
    const creatives:any = await this.reports.creatives(query).catch(()=>({ fatigue:[] }));
    const s=exec.summary;
    const bullets:string[]=[];
    const recommendations:any[]=[];

    // spend vs prev
    if(s.spendMoM!==null){
      if(s.spendMoM>20) bullets.push(`Spend increased ${s.spendMoM}% vs previous period.`);
      else if(s.spendMoM<-15) bullets.push(`Spend decreased ${Math.abs(s.spendMoM)}% — check if campaigns paused.`);
    }
    // conversions
    if(s.convMoM!==null){
      if(s.convMoM<-20) bullets.push(`Conversions dropped ${Math.abs(s.convMoM)}% — investigate targeting or creative.`);
      else if(s.convMoM>25) bullets.push(`Conversions up ${s.convMoM}% — scale winning campaigns.`);
    }
    // ctr
    if(s.ctr<1.2) { bullets.push(`CTR is low (${s.ctr}%) — creative or audience mismatch.`); recommendations.push({action:"Refresh creatives", reason:"CTR below 1.2%", priority:"high"}); }
    else if(s.ctr>2.5) bullets.push(`CTR strong at ${s.ctr}% — audience is engaged.`);

    // roas
    if(s.roas>3) { bullets.push(`ROAS ${s.roas} is excellent — consider increasing budget.`); recommendations.push({action:`Shift 20% budget to top campaign`, reason:`ROAS ${s.roas} > 3`}); }
    else if(s.roas<1) bullets.push(`ROAS ${s.roas} — you are losing money on ad spend.`);
    
    // cpc anomaly
    if(s.cpc>80) bullets.push(`CPC ৳${s.cpc} is high — check Quality Score and bidding.`);

    // cross-platform winner
    if(cross?.winner) {
      bullets.push(`${cross.winner} has better ROAS — ${cross.google?.roas} vs ${cross.meta?.roas}.`);
      if(cross.winner==="META") recommendations.push({action:"Allocate more to Meta", reason:`Meta ROAS ${cross.meta.roas} > Google ${cross.google.roas}`});
      else recommendations.push({action:"Allocate more to Google", reason:`Google ROAS ${cross.google.roas} > Meta ${cross.meta.roas}`});
    }

    // fatigue
    if(creatives.fatigue?.length){
      bullets.push(`${creatives.fatigue.length} creatives show fatigue (CTR drop).`);
      recommendations.push({action:"Replace fatigued creatives", reason:`${creatives.fatigue.length} creatives flagged`});
    }

    // cpl
    const cpl = s.totalConversions ? s.totalSpend / s.totalConversions : null;
    if(cpl!==null && cpl>400) bullets.push(`CPL ৳${Math.round(cpl)} is high — tighten audience or landing page.`);

    // fallback summary
    const summary = bullets.length ? bullets[0] : `Performance is stable — Health Score ${exec.healthScore}/100, ROAS ${s.roas}, ${s.totalConversions} conversions at ৳${Math.round(s.totalSpend).toLocaleString()} spend.`;
    // plain language AI-style
    const plain = `Last ${Math.ceil((new Date(exec.range.to).getTime()-new Date(exec.range.from).getTime())/86400000)} days: spent ৳${Math.round(s.totalSpend).toLocaleString()} for ${s.totalImpressions.toLocaleString()} impressions → ${s.totalClicks.toLocaleString()} clicks (${s.ctr}% CTR) → ${s.totalConversions} conversions. ROAS ${s.roas}. ${bullets.slice(1).join(" ")}`;

    return { summary, plainLanguage: plain, bullets, recommendations, healthScore: exec.healthScore, generatedAt: new Date() };
  }
}
