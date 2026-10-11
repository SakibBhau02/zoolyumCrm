import { Module } from "@nestjs/common";
import { PulseService } from "./pulse.service";
import { PulseController } from "./pulse.controller";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [TasksModule, NotificationsModule],
  controllers: [PulseController],
  providers: [PulseService],
})
export class PulseModule {}
