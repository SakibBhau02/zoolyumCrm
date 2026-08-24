import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : request.query.token;
    if (!token) {
      throw new UnauthorizedException("Missing portal token");
    }
    try {
      const payload = this.jwt.verify(token);
      if (payload.scope !== "portal") throw new Error();
      request.portalUser = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid portal token");
    }
  }
}