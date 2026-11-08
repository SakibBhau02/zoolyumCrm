import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { SkipPermission } from "../common/decorators/require-permission.decorator";

/**
 * Unauthenticated liveness probe.
 *
 * Used by the Playwright webServer gate, container healthchecks and uptime
 * monitors. It deliberately touches no database so it stays cheap and cannot
 * fail for application reasons.
 */
@Controller("health")
export class HealthController {
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
}
