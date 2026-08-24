"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useBranding } from "@/lib/branding-context";

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
  const src = effectiveDark
    ? (branding?.logoLightUrl ?? branding?.logoUrl ?? null)
    : (branding?.logoDarkUrl ?? branding?.logoUrl ?? null);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    const isLarge = height >= 36;
    return (
      <span className="flex items-center gap-2.5">
        <span
          className={`flex items-center justify-center rounded-xl shadow-lg shadow-violet-600/30 ${isLarge ? "size-14 rounded-2xl" : "size-9"}`}
          style={{
            background: "var(--brand-gradient, linear-gradient(135deg, oklch(0.56 0.23 290), oklch(0.6 0.21 310), oklch(0.62 0.16 220)))",
          }}
        >
          <Sparkles className={isLarge ? "size-7 text-white" : "size-4.5 text-white"} />
        </span>
        <span className={`font-heading font-bold tracking-tight ${isLarge ? "text-lg" : "text-[15px]"}`}>{appName}</span>
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
