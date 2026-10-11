import { Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { AiInsightService } from "./ai-insight.service";
import { PresentationController } from "./presentation.controller";
import { ReportsModule } from "../reports/reports.module";

@Module({
  imports: [ReportsModule],
  controllers: [PresentationController],
  providers: [DashboardService, AiInsightService],
})
export class PresentationModule {}
