import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PORTAL_PUBLIC_KEY } from "../common/decorators/portal-public.decorator";
import { CacheService } from "../cache/cache.service";
import { PortalAccessService } from "./portal-access.service";

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly access: PortalAccessService,
    private readonly cache: CacheService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Applied at controller level: every portal route is protected unless the
    // handler explicitly opts out (login only).
    const isPublic = this.reflector.getAllAndOverride<boolean>(PORTAL_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const auth = request.headers.authorization;
    // Header only: a token in the query string leaks into proxy logs, browser
    // history and Referer headers. The portal frontend stores it and sends it
    // as a bearer header, so the fallback was unnecessary attack surface.
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException("Missing portal token");
    }

    let payload: any;
    try {
      payload = this.jwt.verify(token, { algorithms: ["HS256"] });
    } catch {
      throw new UnauthorizedException("Invalid or expired portal token");
    }
    // Staff tokens must never be accepted on portal routes (and vice versa).
    if (payload.scope !== "portal" || !payload.sub || payload.aud !== "portal") {
      throw new UnauthorizedException("Invalid portal token");
    }
    // Logout revokes the exact session by jti, so a copied token stops working
    // immediately instead of living until its natural expiry.
    if (payload.jti) {
      const revoked = await this.cache.get(`revoked:portal:jti:${payload.jti}`).catch(() => null);
      if (revoked) throw new UnauthorizedException("This session has ended. Please sign in again.");
    }

    request.portalUser = payload;
    // Resolve the full permission envelope once per request (cached 60s).
    const scope = await this.access.resolve(payload.sub);
    // Password reset / disable bumps tokenVersion; every older token dies.
    const tokenVersion = typeof payload.ver === "number" ? payload.ver : 0;
    if (tokenVersion !== scope.tokenVersion) {
      throw new UnauthorizedException("Session expired — please sign in again");
    }
    request.portalScope = scope;
    return true;
  }
}
