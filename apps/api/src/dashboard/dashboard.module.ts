import { Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";
import { ScoringModule } from "../scoring/scoring.module";

@Module({
  imports: [ScoringModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
