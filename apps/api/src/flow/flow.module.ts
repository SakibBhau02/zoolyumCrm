import { Module } from "@nestjs/common";
import { FlowService } from "./flow.service";
import { FlowController } from "./flow.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { CapitalModule } from "../capital/capital.module";
import { ScoringModule } from "../scoring/scoring.module";

@Module({
  imports: [NotificationsModule, CapitalModule, ScoringModule],
  controllers: [FlowController],
  providers: [FlowService],
  exports: [FlowService],
})
export class FlowModule {}
