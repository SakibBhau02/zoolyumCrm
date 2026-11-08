import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PortalService } from "./portal.service";
import { PortalController } from "./portal.controller";
import { PortalClientService } from "./portal-client.service";
import { PortalClientController } from "./portal-client.controller";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAccessService } from "./portal-access.service";
import { PortalAdsService } from "./portal-ads.service";
import { TelegramService } from "./telegram.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { TelegramModule } from "../telegram/telegram.module";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET") ?? "dev-secret",
        signOptions: { expiresIn: "7d" as any },
      }),
    }),
    NotificationsModule,
    TelegramModule,
  ],
  controllers: [PortalController, PortalClientController],
  providers: [PortalService, PortalClientService, PortalAuthGuard, PortalAccessService, PortalAdsService, TelegramService],
})
export class PortalModule {}