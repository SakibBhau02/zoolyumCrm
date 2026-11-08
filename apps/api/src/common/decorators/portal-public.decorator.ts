import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route on a portal controller that must be reachable *without* a
 * portal token (only `login` today).
 *
 * Portal controllers are guarded at the class level, so a newly added route is
 * locked by default. Forgetting to decorate a route can no longer expose it.
 */
export const PORTAL_PUBLIC_KEY = "isPortalPublic";
export const PortalPublic = () => SetMetadata(PORTAL_PUBLIC_KEY, true);
