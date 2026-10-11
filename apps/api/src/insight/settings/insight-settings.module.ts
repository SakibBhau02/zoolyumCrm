import { Module } from "@nestjs/common";
import { InsightSettingsService } from "./insight-settings.service";
import { InsightSettingsController } from "./insight-settings.controller";

@Module({
  controllers: [InsightSettingsController],
  providers: [InsightSettingsService],
  exports: [InsightSettingsService],
})
export class InsightSettingsModule {}
