import { Module } from "@nestjs/common";
import { PulseService } from "./pulse.service";
import { PulseController } from "./pulse.controller";
import { LeadRulesService } from "./lead-rules.service";
import { PulseTargetsService } from "./pulse-targets.service";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [TasksModule, NotificationsModule],
  controllers: [PulseController],
  providers: [PulseService, LeadRulesService, PulseTargetsService],
})
export class PulseModule {}
