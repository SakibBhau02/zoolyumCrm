import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ limit: 30, windowSec: 60, name: "auth.login" })
  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: any) {
    // Only trust X-Forwarded-For when the deployment says it is behind a proxy
    // (TRUST_PROXY=1). Otherwise any client can spoof its own IP, which feeds
    // the login lockout key and lastLoginIp (audit SEC-10).
    const trustProxy = String(process.env.TRUST_PROXY ?? "0") === "1";
    const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = forwarded || req.ip || req.socket?.remoteAddress;
    return this.auth.login(dto, ip);
  }

  @Get("me")
  me(@CurrentUser("sub") userId: string) {
    return this.auth.me(userId);
  }

  @Post("logout")
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.signOut(user?.jti, user?.exp);
  }
}
