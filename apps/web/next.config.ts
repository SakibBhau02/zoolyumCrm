import type { NextConfig } from "next";

/**
 * The browser bundle calls the API at `NEXT_PUBLIC_API_URL`, inlined at BUILD
 * time. Two shapes are supported:
 *
 *   - absolute: "https://api.example.com/api" — browser talks to the API directly
 *   - relative: "/api"                          — browser talks to this Next
 *     server, which proxies to `API_PROXY_TARGET` (single-origin deploys,
 *     tunnels, reverse proxies). Same-origin also means no CORS at all.
 *
 * A production build without it would silently ship `http://localhost:4000`
 * and every request would hit the visitor's own machine — fail the build.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const isRelativeApi = !!apiUrl && apiUrl.startsWith("/");
// Only the BUILD needs the value (it is inlined into the bundle). `next start`
// loads this file again with NODE_ENV=production but no build env, so gate the
// check on the actual build phase instead of NODE_ENV.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (isBuildPhase && !apiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is required for a production build (e.g. https://api.example.com/api or /api). " +
      "Set it in the build environment (docker build --build-arg) before running `next build`."
  );
}
if (isBuildPhase && apiUrl && !isRelativeApi && !/^https:\/\//.test(apiUrl)) {
  console.warn(`[zoolyum] NEXT_PUBLIC_API_URL is not HTTPS: ${apiUrl}`);
}

const proxyTarget = process.env.API_PROXY_TARGET?.trim().replace(/\/$/, "") || "http://127.0.0.1:4000";

// Dev only. Next blocks /_next asset requests from any host other than the one
// it was started on, which breaks the app when it is opened over the LAN or a
// tunnel (the page loads, every chunk 403s). `*.host` style entries are
// supported, so a quick Cloudflare tunnel works without knowing its random
// subdomain. Extend with ALLOWED_DEV_ORIGINS="127.0.0.1,192.168.0.42".
const allowedDevOrigins = (
  process.env.ALLOWED_DEV_ORIGINS ?? "127.0.0.1,169.254.205.49,*.trycloudflare.com,*.ngrok-free.app"
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Smaller runtime image and faster cold starts.
  output: "standalone",
  allowedDevOrigins,
  async rewrites() {
    // Only active when the bundle uses the relative "/api" form. With an
    // absolute API URL the browser never hits this rule.
    if (!isRelativeApi) return [];
    return [{ source: "/api/:path*", destination: `${proxyTarget}/api/:path*` }];
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    return [
      { source: "/:path*", headers: security },
      // Client-facing portal pages hold private account data: never index them.
      {
        source: "/portal-client/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      { source: "/portal-login", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/portal/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
