import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { SkipPermission } from "../common/decorators/require-permission.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

/**
 * Liveness + readiness probes.
 *
 * `/health` deliberately touches nothing (cheap uptime check used by CI and
 * the Playwright webServer gate). `/health/ready` is what a load balancer or
 * orchestrator should use: it fails when Postgres or Redis is unreachable, so
 * a broken instance stops receiving traffic instead of answering "ok".
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  @Public()
  @SkipPermission()
  @Get()
  health() {
    return {
      ok: true,
      service: "zoolyum-api",
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }

  @Public()
  @SkipPermission()
  @Get("ready")
  async ready() {
    const started = Date.now();
    let db = false;
    let redis: string = "unknown";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    try {
      redis = await this.cache.ping();
    } catch {
      redis = "down";
    }
    const ok = db && redis !== "down";
    const body = {
      ok,
      db: db ? "up" : "down",
      cache: redis,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
