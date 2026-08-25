import { Module } from "@nestjs/common";
import { FlowService } from "./flow.service";
import { FlowController } from "./flow.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { CapitalModule } from "../capital/capital.module";

@Module({
  imports: [NotificationsModule, CapitalModule],
  controllers: [FlowController],
  providers: [FlowService],
  exports: [FlowService],
})
export class FlowModule {}