import { Module } from "@nestjs/common";
import { CapitalService } from "./capital.service";
import { CapitalController } from "./capital.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [CapitalController],
  providers: [CapitalService],
  exports: [CapitalService],
})
export class CapitalModule {}
