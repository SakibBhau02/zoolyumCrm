import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { Inter, Noto_Sans_Bengali, Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import { BrandingProvider } from "@/lib/branding-context";

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

export const metadata: Metadata = {
  title: "Zoolyum OS — Agency Operating System",
  description:
    "One connected system for leads, clients, projects, tasks, people and finance.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("zoolyum-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${GeistMono.variable} ${outfit.variable} ${bengali.variable} font-sans`}
      >
        <QueryProvider>
          <BrandingProvider>
            <AuthProvider>{children}</AuthProvider>
          </BrandingProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
