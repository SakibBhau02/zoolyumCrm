import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AdAccountService } from "./ad-account.service";
import { GoogleAdsService } from "./google-ads.service";
import { MetaAdsService } from "./meta-ads.service";
import { SyncService } from "./sync.service";
import { DatasourceController } from "./datasource.controller";
import { InsightSettingsModule } from "../settings/insight-settings.module";

@Module({
  imports: [ScheduleModule, InsightSettingsModule],
  controllers: [DatasourceController],
  providers: [AdAccountService, GoogleAdsService, MetaAdsService, SyncService],
  exports: [AdAccountService, SyncService, GoogleAdsService, MetaAdsService],
})
export class DatasourceModule {}
