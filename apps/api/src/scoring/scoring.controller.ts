import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ScoringService } from "./scoring.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

const ADMIN = ["Owner", "CONTROL"] as const;

@RequirePermission("CONTROL")
@Controller("scoring")
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  // Admin-only: the engine config is agency-level policy.
  @Get("config")
  @Roles(...ADMIN)
  config() {
    return this.scoring.getConfig();
  }

  @Patch("config")
  @Roles(...ADMIN)
  saveConfig(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.scoring.saveConfig(body, actorId);
  }

  @Post("config/reset")
  @Roles(...ADMIN)
  resetConfig(@CurrentUser("sub") actorId: string) {
    return this.scoring.resetConfig(actorId);
  }

  @Get("overview")
  @Roles(...ADMIN)
  overview() {
    return this.scoring.overview();
  }

  @Get("backtest")
  @Roles(...ADMIN)
  backtest(@Query("days") days?: string) {
    return this.scoring.backtest(Math.min(730, Math.max(7, Number(days) || 90)));
  }

  @Post("overall/preview")
  @Roles(...ADMIN)
  overallPreview(@Body() body: { values?: Record<string, number> }) {
    return this.scoring.computeOverall(body?.values ?? {});
  }

  @Get("subjects")
  @Roles(...ADMIN)
  subjects(@Query("q") q?: string) {
    return this.scoring.subjects(q);
  }

  /** Profile list for the client-file selector — every signed-in staff member may read it. */
  @Get("profiles")
  profiles() {
    return this.scoring.profileChoices();
  }

  @Get("calibrate")
  @Roles(...ADMIN)
  calibrate(@Query("days") days?: string) {
    return this.scoring.calibrate(Math.min(730, Math.max(7, Number(days) || 90)));
  }

  @Get("forecast")
  @Roles(...ADMIN)
  forecast(@Query("scope") scope?: string, @Query("id") id?: string, @Query("points") points?: string) {
    return this.scoring.forecast(scope === "project" ? "project" : "client", String(id ?? ""), Number(points) || 8);
  }

  @Post("clients/:id/preview")
  @Roles(...ADMIN)
  previewClient(@Param("id") id: string, @Body() body: any) {
    return this.scoring.previewClient(id, body?.config, body?.metrics);
  }

  @Post("projects/:id/preview")
  @Roles(...ADMIN)
  previewProject(@Param("id") id: string, @Body() body: any) {
    return this.scoring.previewProject(id, body?.config, body?.metrics);
  }

  @Post("clients/:id/recompute")
  @Roles(...ADMIN)
  recomputeClient(@Param("id") id: string) {
    return this.scoring.recomputeClient(id);
  }

  @Post("projects/:id/recompute")
  @Roles(...ADMIN)
  recomputeProject(@Param("id") id: string) {
    return this.scoring.recomputeProject(id);
  }

  @Post("recompute")
  @Roles(...ADMIN)
  recompute(@Body() body: { scope?: "clients" | "projects" | "all" }) {
    return this.scoring.recomputeAll(body?.scope ?? "all");
  }

  @Get("clients/:id/history")
  @Roles(...ADMIN)
  clientHistory(@Param("id") id: string, @Query("take") take?: string) {
    return this.scoring.clientHistory(id, Number(take) || 30);
  }

  @Get("projects/:id/history")
  @Roles(...ADMIN)
  projectHistory(@Param("id") id: string, @Query("take") take?: string) {
    return this.scoring.projectHistory(id, Number(take) || 30);
  }
}
