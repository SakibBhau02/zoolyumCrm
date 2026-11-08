import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  PERMISSION_KEY,
  PermissionLevel,
  PermissionRequirement,
} from "../decorators/require-permission.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { AuthUser } from "../decorators/current-user.decorator";

/**
 * Enforces the role permission matrix on the API, not just in the sidebar.
 *
 * The JWT already carries `permissions` (the role's module matrix), so this is
 * a cheap in-memory check. `@RequirePermission("ACCOUNTS")` on a controller
 * blocks anyone whose role does not grant that module; writes additionally
 * need `edit` (or `approve` when the handler asks for it).
 *
 * Order matters: this runs after `JwtAuthGuard`, so `request.user` is present.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<
      PermissionRequirement | null
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    // The JWT guard already rejects anonymous requests; fail closed anyway.
    if (!user) throw new ForbiddenException("Sign in required");

    // The Owner role owns the workspace and always passes.
    if (user.role === "Owner") return true;

    const level: PermissionLevel =
      required.level ?? deriveLevel(String(request.method ?? "GET"));

    const matrix = user.permissions?.[required.module];
    if (!matrix) {
      throw new ForbiddenException(`You do not have access to ${required.module}`);
    }

    const allowed =
      level === "view"
        ? matrix.view === true || matrix.edit === true || matrix.approve === true
        : level === "edit"
          ? matrix.edit === true || matrix.approve === true
          : matrix.approve === true;

    if (!allowed) {
      throw new ForbiddenException(
        `You need ${required.module} ${level} permission for this action`
      );
    }
    return true;
  }
}

/** Read verbs map to `view`; every other verb is a state change. */
function deriveLevel(method: string): PermissionLevel {
  const verb = method.toUpperCase();
  return verb === "GET" || verb === "HEAD" || verb === "OPTIONS" ? "view" : "edit";
}
