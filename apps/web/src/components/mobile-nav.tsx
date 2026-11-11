"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, ListTodo, Menu, Wallet, Zap } from "lucide-react";
import { cn } from "./shared";
import { useAuth } from "@/lib/auth";

/**
 * Thumb-reachable primary navigation for phones.
 *
 * The desktop sidebar is hidden below `lg`, which used to leave a hamburger as
 * the only way to change module — two taps for the four screens people live in.
 * This is a fixed bottom bar (44px+ targets, safe-area aware) with the four
 * busiest modules plus a "More" entry that opens the full drawer.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const perms = user?.permissions;

  const items = [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard, perm: undefined },
    { href: "/pulse", label: "Pulse", icon: Zap, perm: "PULSE" },
    { href: "/tasks", label: "Tasks", icon: ListTodo, perm: "TASKS" },
    { href: "/capital", label: "Capital", icon: Wallet, perm: "CAPITAL" },
    { href: "/accounts", label: "Clients", icon: Building2, perm: "ACCOUNTS" },
  ].filter((i) => !i.perm || perms?.[i.perm]?.view !== false);

  return (
    <nav
      aria-label="Primary"
      className="mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/95 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                active ? "text-primary" : "text-muted-foreground active:bg-muted/60"
              )}
            >
              <item.icon className={cn("size-5", active && "text-primary")} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("zoolyum:open-nav"))}
          aria-label="More navigation"
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors active:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Menu className="size-5" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
