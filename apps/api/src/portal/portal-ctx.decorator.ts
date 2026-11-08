import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PortalScope } from "./portal-access.service";

/** Injects the scope resolved by PortalAuthGuard (clientId, modules, projectIds…). */
export const PortalCtx = createParamDecorator(
  (data: keyof PortalScope | undefined, ctx: ExecutionContext): PortalScope | any => {
    const request = ctx.switchToHttp().getRequest();
    const scope = request.portalScope as PortalScope;
    return data ? scope?.[data] : scope;
  }
);
