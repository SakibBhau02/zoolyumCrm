import { API_URL } from "./api";

/**
 * Branding rows store uploads as `/api/control/branding/uploads/...`, which is
 * relative to the API origin (port 4000), not the web origin (port 3000).
 * Passing that raw value to `<img src>` produced a 404 on every page, so the
 * shell silently fell back to the default mark while invoices looked correct.
 */
export function resolveBrandingUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/api/")) return `${API_URL}${url.slice(4)}`;
  return url;
}
