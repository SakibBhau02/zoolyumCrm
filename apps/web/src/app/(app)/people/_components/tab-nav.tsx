"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, LayoutDashboard, Settings, TrendingUp, UserCircle, Users, Wallet } from "lucide-react";
import { cn } from "@/components/shared";
import { NAV } from "./constants";

const HUB_ICON: Record<string, typeof Users> = {
  "My space": UserCircle,
  Overview: LayoutDashboard,
  Team: Users,
  Time: Clock,
  Pay: Wallet,
  Grow: TrendingUp,
};

const matches = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Two-tier navigation: five hubs, then only the routes inside the active hub.
 * Showing 14 equal tabs at once made Attendance and Payroll scroll off-screen
 * on a laptop and completely unreachable on a phone.
 */
export default function TabNav() {
  const pathname = usePathname();

  const activeHub =
    NAV.find((h) => h.items.some((i) => matches(pathname, i.href))) ??
    NAV.find((h) => matches(pathname, h.href, h.exact)) ??
    NAV[0];

  const subItems = activeHub.items;
  const settingsActive = matches(pathname, "/people/settings");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((h) => {
            const Icon = HUB_ICON[h.label] ?? Users;
            const active = h.label === activeHub.label;
            return (
              <Link
                key={h.label}
                href={h.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-meta font-semibold transition-all",
                  active ? "bg-brand-gradient text-white shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {h.label}
              </Link>
            );
          })}
        </div>
        <Link
          href="/people/settings"
          title="Attendance policy, work calendar and leave quotas"
          aria-current={settingsActive ? "page" : undefined}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors",
            settingsActive ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Settings className="size-4" />
        </Link>
      </div>

      {subItems.length > 1 && (
        <div className="flex items-center gap-4 overflow-x-auto border-b border-border/60 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {subItems.map((item) => {
            const active = matches(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative shrink-0 whitespace-nowrap py-1.5 text-body font-semibold transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
                {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-gradient" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
