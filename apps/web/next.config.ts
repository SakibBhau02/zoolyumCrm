import type { NextConfig } from "next";

/**
 * The browser bundle calls the API directly, so NEXT_PUBLIC_API_URL is inlined
 * at BUILD time. Without it the app falls back to http://localhost:4000 and
 * every request from a real deployment hits the visitor's own machine. Fail
 * the build instead of shipping a broken bundle.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
if (process.env.NODE_ENV === "production" && !apiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is required for a production build (e.g. https://api.example.com/api). " +
      "Set it in the build environment (docker build --build-arg) before running `next build`."
  );
}
if (apiUrl && process.env.NODE_ENV === "production" && !/^https:\/\//.test(apiUrl)) {
  console.warn(`[zoolyum] NEXT_PUBLIC_API_URL is not HTTPS: ${apiUrl}`);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Smaller runtime image and faster cold starts.
  output: "standalone",
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
