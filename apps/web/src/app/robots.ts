import type { MetadataRoute } from "next";

/** Keep the authenticated portal and staff workspace out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/portal-client", "/portal-login", "/portal", "/login", "/api/"],
      },
    ],
  };
}
