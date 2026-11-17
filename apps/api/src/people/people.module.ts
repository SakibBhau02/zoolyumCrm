import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { text } from "express";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { TeamService } from "./team.service";
import { PeopleAutomationService } from "./people-automation.service";
import { UtilizationService } from "./utilization.service";
import { MeService } from "./me.service";
import { OnboardingService } from "./onboarding.service";
import { AssetsService } from "./assets.service";
import { PeopleAnalyticsService } from "./analytics.service";
import { PeopleController } from "./people.controller";
import { IclockController } from "./iclock.controller";
import { CapitalModule } from "../capital/capital.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [CapitalModule, NotificationsModule],
  controllers: [PeopleController, IclockController],
  providers: [
    DirectoryService,
    AttendanceService,
    LeaveService,
    PayrollService,
    PerformanceService,
    TrainingService,
    RecruitmentService,
    TeamService,
    PeopleAutomationService,
    UtilizationService,
    MeService,
    OnboardingService,
    AssetsService,
    PeopleAnalyticsService,
  ],
  // The Telegram bot commands need attendance punching and leave decisions;
  // exporting keeps that logic in one place instead of duplicating rules.
  exports: [AttendanceService, LeaveService, DirectoryService, PayrollService],
})
export class PeopleModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Fingerprint devices POST raw tab-separated text (text/plain), which the
    // global JSON parser ignores — parse it as text for this route only.
    // Both path shapes are registered so the global `/api` prefix can't miss.
    consumer
      .apply(text({ type: () => true, limit: "5mb" }))
      .forRoutes(
        { path: "iclock/cdata", method: RequestMethod.POST },
        { path: "api/iclock/cdata", method: RequestMethod.POST },
      );
  }
}
