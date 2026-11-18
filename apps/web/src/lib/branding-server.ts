import type { Branding } from "./branding-context";

/**
 * Where the API lives **from the server process**. A relative
 * `NEXT_PUBLIC_API_URL` ("/api") is browser-only: a server-side fetch needs an
 * absolute origin, and proxying through this app's own port during a build
 * would fail. `API_PROXY_TARGET` is the same upstream next.config rewrites to.
 */
function apiBase(): string {
  const publicUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (publicUrl && /^https?:\/\//.test(publicUrl)) return publicUrl;
  const target = process.env.API_PROXY_TARGET?.trim().replace(/\/$/, "") || "http://127.0.0.1:4000";
  return `${target}/api`;
}

/**
 * Branding for the very first paint.
 *
 * Fetched on the server so `layout.tsx` can inline the colours and pass the
 * logo/app name into the client provider as `initialData`. Before this, the
 * HTML always shipped the default Sparkles mark and violet palette and only
 * swapped to the workspace branding after hydration — a visible flash on every
 * reload/route change.
 *
 * Cached for 60s: branding changes are rare, and the cost of a miss is one
 * loopback request.
 */
export async function getServerBranding(): Promise<Branding | null> {
  try {
    const res = await fetch(`${apiBase()}/control/branding/public`, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Branding;
  } catch {
    // API down / build-time prerender without the backend: fall back to the
    // shipped defaults instead of failing the whole layout.
    return null;
  }
}
