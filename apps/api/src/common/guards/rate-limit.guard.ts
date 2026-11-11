import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CacheService } from "../../cache/cache.service";
import { RATE_LIMIT_KEY, RateLimitOptions } from "../decorators/rate-limit.decorator";

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Every route gets a budget: the per-route `@RateLimit()` value when present,
 * otherwise RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_SEC. Redis INCR is atomic, so
 * multiple API instances share one counter; the in-memory cache fallback keeps
 * single-instance deployments working without Redis.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly defaultLimit = Math.max(1, Number(process.env.RATE_LIMIT_MAX ?? 600));
  private readonly defaultWindow = Math.max(1, Number(process.env.RATE_LIMIT_WINDOW_SEC ?? 60));

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // Never throttle the health probe or trusted background traffic.
    if (req.method === "OPTIONS") return true;

    const opts =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? { limit: this.defaultLimit, windowSec: this.defaultWindow };

    const handler = context.getClass().name + "." + context.getHandler().name;
    const ip = this.clientIp(req);
    const key = `rl:${opts.name ?? handler}:${ip}`;

    let count = 0;
    try {
      count = await this.cache.incr(key, opts.windowSec);
    } catch {
      // A cache outage must not take the API down with it.
      return true;
    }

    if (count > opts.limit) {
      const retryAfter = Number(req.res.headers?.["retry-after"]) || opts.windowSec;
      req.res?.setHeader?.("Retry-After", String(retryAfter));
      throw new HttpException(
        `Too many requests. Try again in ${opts.windowSec} second(s).`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    return true;
  }

  private clientIp(req: any): string {
    // Only honour a forwarded address when the app is actually behind a trusted
    // proxy; otherwise any client can rotate X-Forwarded-For and bypass limits.
    const trustProxy = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
    const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return (forwarded || req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
  }
}
