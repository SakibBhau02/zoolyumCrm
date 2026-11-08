import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rateLimit";

export interface RateLimitOptions {
  /** Allowed requests inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Optional suffix so two routes can budget independently. */
  name?: string;
}

/**
 * Per-route budget. The guard keys by client IP + route, so a public endpoint
 * (login, kiosk, webhook) cannot be hammered even though it has no session.
 *
 * Defaults (when no decorator is present) are read from
 * RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SEC and are deliberately generous so a
 * normal dashboard session is never throttled.
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
