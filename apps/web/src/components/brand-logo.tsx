"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useBranding } from "@/lib/branding-context";
import { resolveBrandingUrl } from "@/lib/branding-url";

export function BrandLogo({
  height = 32,
  variant = "auto",
}: {
  height?: number;
  variant?: "auto" | "light" | "dark";
}) {
  const { branding } = useBranding();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const appName = branding?.appName ?? "Zoolyum OS";
  const [failed, setFailed] = useState(false);
  const effectiveDark = variant === "light" ? true : variant === "dark" ? false : isDark;
  const rawSrc = effectiveDark
    ? (branding?.logoLightUrl ?? branding?.logoUrl ?? null)
    : (branding?.logoDarkUrl ?? branding?.logoUrl ?? null);
  // Branding uploads live behind the API origin (/api/...), not the web origin.
  // Resolving them here is what stopped the shell logo from 404ing on every
  // page while the invoice print view showed it correctly.
  const src = resolveBrandingUrl(rawSrc);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    const isLarge = height >= 36;
    return (
      <span className="flex items-center gap-2.5">
        <span
          className={`flex items-center justify-center rounded-xl ${isLarge ? "size-14 rounded-2xl" : "size-9"}`}
          style={{
            background: "var(--primary, oklch(0.56 0.23 290))",
          }}
        >
          <Sparkles className={isLarge ? "size-4 text-white" : "size-4.5 text-white"} />
        </span>
        <span className={`font-heading font-bold tracking-tight ${isLarge ? "text-title" : "text-section"}`}>{appName}</span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={appName}
      style={{ height }}
      className="max-w-[180px] object-contain"
      onError={() => setFailed(true)}
    />
  );
}
