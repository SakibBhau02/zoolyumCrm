import { Module } from "@nestjs/common";
import { FlowService } from "./flow.service";
import { FlowShootService } from "./flow-shoot.service";
import { FlowController } from "./flow.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { CapitalModule } from "../capital/capital.module";
import { ScoringModule } from "../scoring/scoring.module";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  imports: [NotificationsModule, CapitalModule, ScoringModule, TasksModule],
  controllers: [FlowController],
  providers: [FlowService, FlowShootService],
  exports: [FlowService],
})
export class FlowModule {}
