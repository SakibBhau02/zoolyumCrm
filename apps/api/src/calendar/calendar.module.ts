import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { CalendarController } from "./calendar.controller";
import { CalendarPublicController } from "./calendar-public.controller";
import { CalendarService } from "./calendar.service";
import { CalendarFeedService } from "./calendar-feed.service";
import { CalendarPlanService } from "./calendar-plan.service";
import { CalendarAdsService } from "./calendar-ads.service";
import { CalendarExportService } from "./calendar-export.service";
import { CalendarAutomationService } from "./calendar-automation.service";

@Module({
  imports: [NotificationsModule],
  controllers: [CalendarController, CalendarPublicController],
  providers: [
    CalendarService,
    CalendarFeedService,
    CalendarPlanService,
    CalendarAdsService,
    CalendarExportService,
    CalendarAutomationService,
  ],
  exports: [CalendarService, CalendarFeedService, CalendarPlanService],
})
export class CalendarModule {}
