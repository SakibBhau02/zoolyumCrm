"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/shared";
import { TABS } from "./constants";

export default function CapitalTabNav() {
  const pathname = usePathname();
  const active = TABS.reduce((best, t) => {
    const match = pathname === t.href || pathname.startsWith(t.href + "/");
    if (match && t.href.length > (best?.href.length ?? 0)) return t;
    return best;
  }, undefined as (typeof TABS)[number] | undefined);

  // "/capital" itself → Overview
  const activeKey = active?.key ?? "overview";

  return (
    <div className="scroll-x scroll-x-hint gap-1 rounded-xl border border-border bg-card p-1 sm:flex-wrap sm:overflow-visible">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "whitespace-nowrap rounded-lg px-3.5 py-2.5 text-body font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:py-2 sm:text-meta",
            activeKey === t.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          {t.value}
        </Link>
      ))}
    </div>
  );
}
