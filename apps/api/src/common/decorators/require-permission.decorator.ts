import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "requiredPermission";

export type PermissionLevel = "view" | "edit" | "approve";

export interface PermissionRequirement {
  /** Module key in the role permission matrix, e.g. "ACCOUNTS". */
  module: string;
  /**
   * Level required. When omitted the guard derives it from the HTTP verb:
   * GET/HEAD/OPTIONS -> view, every write verb -> edit. This keeps controller
   * declarations short while still failing closed on writes.
   */
  level?: PermissionLevel;
}

/**
 * Require a module permission from the signed-in user's role matrix.
 *
 * Unlike `@Roles`, this is permission-based, so a custom role can be granted
 * Accounts access from Control -> Roles without a redeploy.
 *
 * Declare it once on the controller for the module default, and override per
 * handler when a write needs a higher level (e.g. `approve`).
 */
export const RequirePermission = (module: string, level?: PermissionLevel) =>
  SetMetadata(PERMISSION_KEY, { module, level } as PermissionRequirement);

/**
 * Explicitly exempt a handler from a controller-level `@RequirePermission`.
 * Used for self-service routes (my profile, my attendance, my tasks) that a
 * user must reach even when their role has no access to the module workspace.
 */
export const SkipPermission = () => SetMetadata(PERMISSION_KEY, null);
