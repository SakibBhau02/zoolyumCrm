import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: string;
  permissions?: Record<string, { view?: boolean; edit?: boolean; approve?: boolean }>;
  /** Session id (set on tokens issued after the logout feature shipped). */
  jti?: string;
  /** Expiry, seconds since epoch. */
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  }
);
