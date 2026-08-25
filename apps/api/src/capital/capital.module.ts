import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { CapitalService } from "./capital.service";
import { CapitalController } from "./capital.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  controllers: [CapitalController],
  providers: [CapitalService],
  exports: [CapitalService],
})
export class CapitalModule {}
