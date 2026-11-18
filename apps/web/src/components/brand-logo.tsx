"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useBranding } from "@/lib/branding-context";
import { resolveBrandingUrl } from "@/lib/branding-url";

/**
 * Renders the workspace logo.
 *
 * Light and dark variants are both rendered and toggled with CSS (`dark:`), not
 * with a `MutationObserver` on <html>. The observer only ran after hydration, so
 * dark-mode reloads painted the light logo first and then swapped it — the
 * "old logo flashes before the new one" report. CSS has no such gap: the inline
 * theme script in the root layout sets `.dark` before the first paint.
 */
export function BrandLogo({
  height = 32,
  variant = "auto",
}: {
  height?: number;
  variant?: "auto" | "light" | "dark";
}) {
  const { branding } = useBranding();
  const appName = branding?.appName?.trim() || "Zoolyum OS";
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Dark chrome wants the light-on-transparent artwork and vice versa.
  const lightSrc = resolveBrandingUrl(branding?.logoDarkUrl ?? branding?.logoUrl ?? null);
  const darkSrc = resolveBrandingUrl(branding?.logoLightUrl ?? branding?.logoUrl ?? null);

  const pick = variant === "light" ? darkSrc : variant === "dark" ? lightSrc : null;

  if (!lightSrc && !darkSrc) return <Fallback appName={appName} height={height} />;

  const img = (src: string | null, className: string, key: string) => {
    if (!src || failed[key]) return null;
    return (
      <img
        key={key}
        src={src}
        alt=""
        aria-hidden="true"
        style={{ height }}
        className={`max-w-[180px] object-contain ${className}`}
        onError={() => setFailed((prev) => ({ ...prev, [key]: true }))}
      />
    );
  };

  if (variant !== "auto" && pick) {
    return (
      <span role="img" aria-label={appName} className="flex items-center">
        {img(pick, "", "solo") ?? <Fallback appName={appName} height={height} />}
      </span>
    );
  }

  const hasBoth = !!lightSrc && !!darkSrc && lightSrc !== darkSrc;
  return (
    <span role="img" aria-label={appName} className="flex items-center">
      {hasBoth ? (
        <>
          {img(lightSrc, "dark:hidden", "light")}
          {img(darkSrc, "hidden dark:block", "dark")}
        </>
      ) : (
        img(lightSrc ?? darkSrc, "", "single")
      )}
    </span>
  );
}

/** No upload yet (or every URL 404'd): the shipped wordmark. */
function Fallback({ appName, height }: { appName: string; height: number }) {
  const isLarge = height >= 36;
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`flex items-center justify-center rounded-xl ${isLarge ? "size-14 rounded-2xl" : "size-9"}`}
        style={{ background: "var(--primary, oklch(0.56 0.23 290))" }}
      >
        <Sparkles className={isLarge ? "size-4 text-white" : "size-4.5 text-white"} />
      </span>
      <span className={`font-heading font-bold tracking-tight ${isLarge ? "text-title" : "text-section"}`}>{appName}</span>
    </span>
  );
}
