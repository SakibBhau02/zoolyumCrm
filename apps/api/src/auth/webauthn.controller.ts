import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { WebAuthnService } from "./webauthn.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";

/** Passwordless biometric endpoints: register, sign in, clock in/out. */
@Controller("auth/webauthn")
export class WebAuthnController {
  constructor(private readonly webAuthn: WebAuthnService) {}

  @Post("register/options")
  registerOptions(@CurrentUser("sub") userId: string, @Req() req: any) {
    return this.webAuthn.registrationOptions(userId, req);
  }

  @Post("register/verify")
  registerVerify(@CurrentUser("sub") userId: string, @Body() body: any, @Req() req: any) {
    return this.webAuthn.verifyRegistration(userId, body, req);
  }

  @Get("credentials")
  credentials(@CurrentUser("sub") userId: string) {
    return this.webAuthn.credentials(userId);
  }

  @Delete("credentials/:id")
  deleteCredential(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.webAuthn.deleteCredential(userId, id);
  }

  @Public()
  @RateLimit({ limit: 20, windowSec: 60, name: "auth.webauthn.options" })
  @Post("login/options")
  loginOptions(@Body() body: { email?: string }, @Req() req: any) {
    return this.webAuthn.loginOptions(body ?? {}, req);
  }

  @Public()
  @RateLimit({ limit: 20, windowSec: 60, name: "auth.webauthn.verify" })
  @Post("login/verify")
  loginVerify(@Body() body: any, @Req() req: any) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress;
    return this.webAuthn.verifyLogin(body, req, ip);
  }

  @Post("clock/options")
  clockOptions(@CurrentUser("sub") userId: string, @Req() req: any) {
    return this.webAuthn.clockOptions(userId, req);
  }

  @Post("clock/verify")
  clockVerify(@CurrentUser("sub") userId: string, @Body() body: any, @Req() req: any) {
    return this.webAuthn.verifyClock(userId, body, req);
  }
}
