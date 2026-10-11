import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Cron } from "@nestjs/schedule";
import { ReportsService } from "../reports/reports.service";

function parseCron(cron:string){
  // alias
  if(cron==="daily") return "0 9 * * *";
  if(cron==="weekly") return "0 9 * * 1";
  if(cron==="monthly") return "0 9 1 * *";
  return cron;
}
function nextRun(cron:string, from=new Date()){
  // very simple: add interval based on alias, else +1 day
  if(cron.includes("daily") || cron==="0 9 * * *") { const d=new Date(from); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return d; }
  if(cron.includes("weekly")) { const d=new Date(from); d.setDate(d.getDate()+7); d.setHours(9,0,0,0); return d; }
  if(cron.includes("monthly")) { const d=new Date(from); d.setMonth(d.getMonth()+1); d.setDate(1); d.setHours(9,0,0,0); return d; }
  const d=new Date(from); d.setHours(d.getHours()+1); return d;
}

@Injectable()
export class SchedulerService {
  private readonly logger=new Logger(SchedulerService.name);
  constructor(private readonly prisma: PrismaService, private readonly reports: ReportsService) {}

  async list(){ return this.prisma.scheduledReport.findMany({ include:{ reportDef:{ select:{ name:true, reportType:true } } }, orderBy:{ createdAt:"desc" }}); }

  async create(body:any){
    const cron=parseCron(body.cron ?? "daily");
    const def=await this.prisma.reportDefinition.findUnique({ where:{ id: body.reportDefId }}); if(!def) throw new NotFoundException("ReportDefinition not found");
    const rec=await this.prisma.scheduledReport.create({ data:{ reportDefId: body.reportDefId, cron, recipients: body.recipients ?? [], isActive: body.isActive??true, nextRunAt: nextRun(cron) }});
    return rec;
  }
  async update(id:string, body:any){
    const existing=await this.prisma.scheduledReport.findUnique({ where:{ id }}); if(!existing) throw new NotFoundException("Schedule not found");
    const data:any={};
    if(body.cron!==undefined) { data.cron=parseCron(body.cron); data.nextRunAt=nextRun(data.cron); }
    if(body.recipients!==undefined) data.recipients=body.recipients;
    if(body.isActive!==undefined) data.isActive=body.isActive;
    return this.prisma.scheduledReport.update({ where:{ id }, data });
  }
  async remove(id:string){ await this.prisma.scheduledReport.delete({ where:{ id }}).catch(()=>{ throw new NotFoundException("Schedule not found"); }); return {deleted:true}; }

  async runNow(id:string){
    const sched=await this.prisma.scheduledReport.findUnique({ where:{ id }, include:{ reportDef:true }});
    if(!sched) throw new NotFoundException("Schedule not found");
    const filters=sched.reportDef.filters as any ?? {};
    const from = filters.from ? new Date(filters.from) : new Date(Date.now()-30*86400000);
    const to = new Date();
    let result:any={};
    try{
      // dispatch by reportType
      const t=sched.reportDef.reportType;
      if(t==="CAMPAIGN") result=await this.reports.campaigns({ ...filters, from: from.toISOString(), to: to.toISOString() });
      else if(t==="CROSS_PLATFORM") result=await this.reports.crossPlatform({ ...filters });
      else result=await this.reports.executive({ ...filters, from: from.toISOString(), to: to.toISOString() });
    }catch(e:any){ result={error:e.message}; }
    const run=await this.prisma.reportRun.create({ data:{ reportDefId: sched.reportDefId, params:{ ...filters, from, to }, resultSnapshot: result }});
    await this.prisma.scheduledReport.update({ where:{ id }, data:{ lastRunAt: new Date(), nextRunAt: nextRun(sched.cron) }});
    // create notification for recipients (stub: log + notification)
    // In real: email via nodemailer / whatsapp via Twilio
    this.logger.log(`Scheduled report ${sched.reportDef.name} ran, runId=${run.id} recipients=${JSON.stringify(sched.recipients)}`);
    return { run, result };
  }

  @Cron("0 * * * *")
  async cronTick(){
    const due=await this.prisma.scheduledReport.findMany({ where:{ isActive:true, nextRunAt:{ lte: new Date() } }});
    for(const s of due){
      try{ await this.runNow(s.id); }catch(e){ this.logger.error(`Schedule ${s.id} failed`, e); }
    }
    if(due.length) this.logger.log(`Scheduler tick: ${due.length} reports executed`);
  }
}
