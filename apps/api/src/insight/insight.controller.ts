import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { InsightService } from "./insight.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

@RequirePermission("INSIGHT")
@Controller("insight")
export class InsightController {
  constructor(private readonly insight: InsightService) {}

  @Get("metrics")
  metrics(@Query("metric") metric?: string) {
    return this.insight.metrics(metric);
  }

  @Get("correlations")
  correlations() {
    return this.insight.correlations();
  }

  @Patch("correlations/:id/dismiss")
  dismiss(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.insight.dismiss(id, userId);
  }

  @Get("digests")
  digests() {
    return this.insight.digests();
  }

  // ── Report library ─────────────────────────────────────────────────────
  @Get("reports")
  reports() {
    return this.insight.reportDefinitions();
  }

  @Post("reports")
  createReport(@Body() body: any, @CurrentUser("sub") userId: string) {
    return this.insight.createReport(body, userId);
  }

  @Patch("reports/:id")
  updateReport(@Param("id") id: string, @Body() body: any) {
    return this.insight.updateReport(id, body);
  }

  @Delete("reports/:id")
  deleteReport(@Param("id") id: string) {
    return this.insight.deleteReport(id);
  }

  @Post("reports/:id/run")
  runReport(@Param("id") id: string) {
    return this.insight.runReport(id);
  }

  // ── Report pages ───────────────────────────────────────────────────────
  @Get("report/overview")
  overview() {
    return this.insight.overview();
  }

  @Get("report/client-health")
  clientHealth() {
    return this.insight.clientHealth();
  }

  @Get("report/tax")
  taxReport() {
    return this.insight.taxReport();
  }

  @Get("report/performance")
  performance() {
    return this.insight.performance();
  }
}