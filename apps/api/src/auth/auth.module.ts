import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { WebAuthnService } from "./webauthn.service";
import { WebAuthnController } from "./webauthn.controller";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        if (!secret && process.env.NODE_ENV === "production") {
          throw new Error("JWT_SECRET is required in production");
        }
        return {
          secret: secret ?? "dev-secret",
          signOptions: {
            expiresIn: (config.get<string>("JWT_EXPIRES_IN") ?? "7d") as `${number}d`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController, WebAuthnController],
  providers: [AuthService, WebAuthnService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
