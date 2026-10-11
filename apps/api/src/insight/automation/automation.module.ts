import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { SchedulerService } from "./scheduler.service";
import { AlertsService } from "./alerts.service";
import { DeliveryService } from "./delivery.service";
import { AutomationController } from "./automation.controller";
import { ReportsModule } from "../reports/reports.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { InsightSettingsModule } from "../settings/insight-settings.module";

@Module({
  imports: [ReportsModule, NotificationsModule, ScheduleModule, InsightSettingsModule],
  controllers: [AutomationController],
  providers: [SchedulerService, AlertsService, DeliveryService],
  exports: [SchedulerService, AlertsService],
})
export class AutomationModule {}
