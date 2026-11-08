import { Module } from "@nestjs/common";
import { ScoringService } from "./scoring.service";
import { ScoringController } from "./scoring.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ScoringController],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
