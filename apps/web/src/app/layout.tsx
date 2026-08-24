import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Space_Grotesk, Hind_Siliguri } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import { BrandingProvider } from "@/lib/branding-context";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const hindSiliguri = Hind_Siliguri({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-bangla",
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
        className={`${GeistSans.variable} ${GeistMono.variable} ${spaceGrotesk.variable} ${hindSiliguri.variable} font-sans`}
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
