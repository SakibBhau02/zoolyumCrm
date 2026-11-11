import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";

/** Shared cache so a settings save can invalidate the guard immediately. */
let policyCache: { at: number; data: any } | null = null;
const TTL_MS = 10_000;

export function invalidateAdminPolicyCache() {
  policyCache = null;
}

/**
 * Workspace-wide access policy, evaluated after authentication:
 *
 *  - IP allowlist (Settings.adminConfig.security.ipAllowlist) — when non-empty,
 *    staff requests from any other address are rejected.
 *  - Maintenance mode (Settings.adminConfig.system.maintenanceMode) — blocks
 *    writes for everyone except the Owner, while reads keep working.
 *
 * The policy is cached for 10 seconds to avoid a settings query on every
 * request; saving settings clears the cache immediately.
 */
@Injectable()
export class AdminPolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  private async policy(): Promise<any> {
    if (policyCache && Date.now() - policyCache.at < TTL_MS) return policyCache.data;
    let data: any = {};
    try {
      const row = await this.prisma.settings.findUnique({
        where: { id: "default" },
        select: { adminConfig: true },
      });
      data = (row?.adminConfig as any) ?? {};
    } catch {
      data = {};
    }
    policyCache = { at: Date.now(), data };
    return data;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true;

    const policy = await this.policy();

    const allowlist: string[] = Array.isArray(policy?.security?.ipAllowlist)
      ? policy.security.ipAllowlist
      : [];
    if (allowlist.length) {
      // Same rule as the rate limiter: X-Forwarded-For is attacker-controlled
      // unless the app is explicitly behind a trusted proxy. Reading it
      // unconditionally let anyone bypass the allowlist by spoofing the header.
      const trustProxy = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
      const forwarded = trustProxy
        ? String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
        : "";
      const ip = (forwarded || request.ip || request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
      if (!allowlist.includes(ip)) {
        throw new ForbiddenException(`Your IP address (${ip || "unknown"}) is not allowed by the workspace policy`);
      }
    }

    if (policy?.system?.maintenanceMode) {
      const method = String(request.method ?? "GET").toUpperCase();
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(method);
      if (!readOnly && user.role !== "Owner") {
        throw new ServiceUnavailableException(
          policy.system.maintenanceMessage || "The workspace is in maintenance mode. Please try again shortly."
        );
      }
    }

    return true;
  }
}
