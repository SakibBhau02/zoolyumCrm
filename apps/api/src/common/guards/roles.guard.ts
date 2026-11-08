import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AuthUser } from "../decorators/current-user.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    if (requiredRoles.includes(user.role)) return true;

    // "CONTROL" is a module permission, not only a role name: any role whose
    // matrix grants Control → View may use the admin workspace. This keeps the
    // sidebar (permission-based) and the API (role-based) consistent.
    if (requiredRoles.includes("CONTROL") && user.permissions?.CONTROL?.view === true) {
      return true;
    }

    throw new ForbiddenException("Insufficient role for this action");
  }
}
