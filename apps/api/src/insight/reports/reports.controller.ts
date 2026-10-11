import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { Response } from "express";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("insight/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly prisma: PrismaService) {}

  @Get("executive")
  executive(@Query() q:any) { return this.reports.executive(q); }

  @Get("campaigns")
  campaigns(@Query() q:any) { return this.reports.campaigns(q); }

  @Get("adsets")
  adsets(@Query() q:any) { return this.reports.adsets(q); }

  @Get("ads")
  ads(@Query() q:any) { return this.reports.ads(q); }

  @Get("creatives")
  creatives(@Query() q:any) { return this.reports.creatives(q); }

  @Get("audience")
  audience(@Query() q:any) { return this.reports.audience(q); }

  @Get("spend-budget")
  spendBudget(@Query() q:any) { return this.reports.spendBudget(q); }

  @Get("roas-roi")
  roasRoi(@Query() q:any) { return this.reports.roasRoi(q); }

  @Get("metrics")
  metrics(@Query() q:any) { return this.reports.metrics(q); }

  @Get("conversions")
  conversions(@Query() q:any) { return this.reports.conversions(q); }

  @Get("cross-platform")
  crossPlatform(@Query() q:any) { return this.reports.crossPlatform(q); }

  @Get("comparison")
  comparison(@Query() q:any) { return this.reports.comparison(q); }

  @Get("custom")
  custom(@Query() q:any) { return this.reports.custom(q); }

  @Get("funnel")
  funnel(@Query() q:any) { return this.reports.funnel(q); }

  @Get("task/:taskId/snapshot")
  taskSnapshot(@Param("taskId") taskId:string) { return this.reports.taskReport(taskId); }

  // Export PDF/Excel handled via custom export endpoint (simple JSON->CSV for now)
  @Get("custom/export")
  async exportCustom(@Query() q:any, @Res() res: Response) {
    const data:any = await this.reports.custom(q);
    const format = q.format ?? "json";
    if (format==="csv" || format==="excel") {
      const rows=data.rows ?? [];
      if(!rows.length){ res.setHeader("Content-Type","text/csv"); res.send("No data\n"); return; }
      const headers=Object.keys(rows[0]);
      const csv=[headers.join(","), ...rows.map((r:any)=> headers.map(h=> `"${String(r[h]??"").replace(/"/g,'""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type","text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csv); return;
    }
    res.json(data);
  }

  // Report runs history
  @Get("runs")
  async runs(@Query("reportDefId") reportDefId?: string) {
    return this.prisma.reportRun.findMany({ where: reportDefId?{ reportDefId}:{}, orderBy:{ ranAt:"desc" }, take:20, include:{ reportDef:{ select:{ name:true } } }});
  }

  // Create/update report def extended (proxy to legacy insight.service but with new fields)
  @Post("defs")
  async createDef(@Body() body:any) {
    return this.prisma.reportDefinition.create({ data:{
      name: body.name, metrics: body.metrics??[], dimensions: body.dimensions??[], filters: body.filters??{}, schedule: body.schedule??null,
      clientId: body.clientId??null, provider: body.provider? body.provider.toUpperCase():null, reportType: body.reportType??"CUSTOM", isCrossPlatform: body.isCrossPlatform??false, taskId: body.taskId??null,
      createdById: body.createdById??null,
    }});
  }
}
