import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
    try {
      const payload = this.jwt.verify(auth.slice(7));
      if (payload.scope === "portal") {
        throw new UnauthorizedException("Portal tokens are not valid on staff routes");
      }
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
