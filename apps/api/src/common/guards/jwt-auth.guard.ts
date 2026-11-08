import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

/**
 * Verifies the bearer token **and** the account behind it.
 *
 * A signature check alone is not enough in production: deactivating a user or
 * resetting their password used to leave the old JWT valid until it expired.
 * Every user now carries `tokenVersion`, which is bumped on those events; the
 * guard rejects any token whose `ver` no longer matches.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing access token");
    }

    let payload: any;
    try {
      payload = this.jwt.verify(auth.slice(7));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (payload.scope === "portal") {
      throw new UnauthorizedException("Portal tokens are not valid on staff routes");
    }

    // Logout revokes the exact session by jti, so a copied token stops working
    // immediately instead of living until its natural expiry.
    if (payload.jti) {
      const revoked = await this.cache.get(`revoked:jti:${payload.jti}`).catch(() => null);
      if (revoked) throw new UnauthorizedException("This session has ended. Please sign in again.");
    }

    // One indexed lookup per request keeps deactivated accounts out immediately.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("This account is disabled");
    }
    const tokenVersion = typeof payload.ver === "number" ? payload.ver : 0;
    if (tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException("Session expired — please sign in again");
    }

    request.user = payload;
    return true;
  }
}
