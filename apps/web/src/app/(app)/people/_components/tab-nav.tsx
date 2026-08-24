"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/shared";
import { TABS } from "./constants";

export default function TabNav() {
  const pathname = usePathname();
  const active = TABS.reduce((best, t) => {
    const match = pathname === t.href || pathname.startsWith(t.href + "/");
    if (match && t.href.length > (best?.href.length ?? 0)) return t;
    return best;
  }, undefined as (typeof TABS)[number] | undefined);
  return (
    <div className="inline-flex overflow-x-auto rounded-xl border border-border bg-card p-1">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all",
            active?.value === t.value
              ? "bg-brand-gradient text-white shadow-md shadow-primary/25"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.value}
        </Link>
      ))}
    </div>
  );
}