import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PortalService } from "./portal.service";
import { PortalController } from "./portal.controller";
import { PortalClientService } from "./portal-client.service";
import { PortalClientController } from "./portal-client.controller";
import { PortalAuthGuard } from "./portal-auth.guard";

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
  ],
  controllers: [PortalController, PortalClientController],
  providers: [PortalService, PortalClientService, PortalAuthGuard],
})
export class PortalModule {}