import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { ScoringModule } from "../scoring/scoring.module";

@Module({
  imports: [NotificationsModule, WhatsappModule, ScoringModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
