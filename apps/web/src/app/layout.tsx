import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { Inter, Noto_Sans_Bengali, Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import { BrandingProvider } from "@/lib/branding-context";
import { brandingStyleSheet } from "@/lib/branding-theme";
import { getServerBranding } from "@/lib/branding-server";
import { RouteTitle } from "@/components/route-title";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

/**
 * Self-hosted via next/font instead of a render-blocking <link> to
 * fonts.googleapis.com: no third-party DNS/TLS before first paint, no layout
 * shift, and the app still looks right offline.
 */
const bengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-bengali",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getServerBranding();
  const appName = branding?.appName?.trim() || "Zoolyum OS";
  return {
    title: `${appName} — Agency Operating System`,
    description:
      "One connected system for leads, clients, projects, tasks, people and finance.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Server-side branding: colours are inlined below and the logo/app name are
  // handed to the provider as initial data, so the first paint is already the
  // workspace theme instead of the shipped default that then swaps out.
  const branding = await getServerBranding();
  const brandCss = brandingStyleSheet(branding);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("zoolyum-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
        {brandCss ? <style id="brand-theme" dangerouslySetInnerHTML={{ __html: brandCss }} /> : null}
      </head>
      <body
        className={`${inter.variable} ${GeistMono.variable} ${outfit.variable} ${bengali.variable} font-sans`}
      >
        <QueryProvider>
          <BrandingProvider initialBranding={branding}>
            <RouteTitle />
            <AuthProvider>{children}</AuthProvider>
          </BrandingProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
