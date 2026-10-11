import { Controller, Get, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { AiInsightService } from "./ai-insight.service";

@Controller("insight/presentation")
export class PresentationController {
  constructor(private readonly dash: DashboardService, private readonly ai: AiInsightService) {}

  @Get("dashboard")
  dashboard(@Query() q:any){ return this.dash.executive(q); }

  @Get("white-label")
  whiteLabel(){ return this.dash.whiteLabel(); }

  @Get("ai-summary")
  aiSummary(@Query() q:any){ return this.ai.summarize(q); }
}
