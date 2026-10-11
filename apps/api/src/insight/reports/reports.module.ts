import { Module } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";
import { InsightSettingsModule } from "../settings/insight-settings.module";

@Module({
  imports: [InsightSettingsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
