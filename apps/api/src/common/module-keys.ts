/**
 * Canonical permission-module keys.
 *
 * These MUST match what the guards actually enforce — every controller uses
 * `@RequirePermission("PULSE" | "ACCOUNTS" | "FLOW" | "TASKS" | "PEOPLE" |
 * "CAPITAL" | "INSIGHT" | "CALENDAR" | "PORTAL" | "CONTROL")`.
 *
 * The role editor used to advertise a different vocabulary (CLIENTS, LEADS,
 * PROJECTS, FINANCE, INSIGHTS), so saving the matrix silently changed keys no
 * guard ever read: an admin could "revoke" Finance and the role kept full
 * access. The alias map keeps tokens minted before the fix working.
 */
export const CONTROL_MODULES = [
  "PULSE",
  "ACCOUNTS",
  "FLOW",
  "TASKS",
  "PEOPLE",
  "CAPITAL",
  "INSIGHT",
  "CALENDAR",
  "PORTAL",
  "CONTROL",
] as const;

export type ControlModule = (typeof CONTROL_MODULES)[number];

/** Old editor label → the key the guards read. */
export const LEGACY_MODULE_ALIASES: Record<string, ControlModule> = {
  CLIENTS: "ACCOUNTS",
  LEADS: "PULSE",
  PROJECTS: "FLOW",
  FINANCE: "CAPITAL",
  INSIGHTS: "INSIGHT",
  HR: "PEOPLE",
};

export interface ModulePermission {
  view?: boolean;
  edit?: boolean;
  approve?: boolean;
}

/**
 * Resolve the matrix for one module, accepting the legacy label. Used by the
 * guard so a token issued before the rename keeps working (no forced logout).
 */
export function modulePermission(
  permissions: Record<string, ModulePermission> | null | undefined,
  module: string
): ModulePermission | undefined {
  if (!permissions) return undefined;
  const direct = permissions[module];
  if (direct) return direct;
  for (const [legacy, canonical] of Object.entries(LEGACY_MODULE_ALIASES)) {
    if (canonical === module) return permissions[legacy];
  }
  return undefined;
}

/**
 * Merge a legacy matrix into the canonical key set. Existing grants are
 * preserved (OR-merged) rather than dropped, and the alias keys are removed so
 * the editor and the guard can never disagree again.
 */
export function migrateModuleMatrix(
  input: Record<string, ModulePermission> | null | undefined
): Record<string, { view: boolean; edit: boolean; approve: boolean }> {
  const out: Record<string, { view: boolean; edit: boolean; approve: boolean }> = {};
  const src = input ?? {};
  for (const [key, value] of Object.entries(src)) {
    if (!value) continue;
    const canonical = (LEGACY_MODULE_ALIASES[key] ?? key) as string;
    const prev = out[canonical];
    out[canonical] = {
      view: !!(prev?.view || value.view || value.edit || value.approve),
      edit: !!(prev?.edit || value.edit),
      approve: !!(prev?.approve || value.approve),
    };
  }
  return out;
}
