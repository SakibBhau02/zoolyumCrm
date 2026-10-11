import { Module } from "@nestjs/common";
import { InsightService } from "./insight.service";
import { InsightController } from "./insight.controller";
import { DatasourceModule } from "./datasource/datasource.module";
import { ReportsModule } from "./reports/reports.module";
import { AutomationModule } from "./automation/automation.module";
import { PresentationModule } from "./presentation/presentation.module";
import { InsightSettingsModule } from "./settings/insight-settings.module";

@Module({
  imports: [DatasourceModule, ReportsModule, AutomationModule, PresentationModule, InsightSettingsModule],
  controllers: [InsightController],
  providers: [InsightService],
  exports: [InsightService],
})
export class InsightModule {}
