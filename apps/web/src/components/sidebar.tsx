"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Globe2,
  LayoutDashboard,
  ListTodo,
  Menu,
  Settings,
  Users,
  Wallet,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { cn, Avatar } from "./shared";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "./brand-logo";

const NAV: {
  section: string;
  items: { href: string; label: string; icon: any; badge?: string; perm?: string }[];
}[] = [
  { section: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    section: "Business",
    items: [
      { href: "/pulse", label: "Pulse", icon: Zap, badge: "CRM", perm: "PULSE" },
      { href: "/accounts", label: "Accounts", icon: Building2, badge: "Clients", perm: "ACCOUNTS" },
      { href: "/flow", label: "Flow", icon: Workflow, badge: "Projects", perm: "FLOW" },
      { href: "/tasks", label: "Tasks", icon: ListTodo, perm: "TASKS" },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/people", label: "People", icon: Users, badge: "HRM", perm: "PEOPLE" },
      { href: "/capital", label: "Capital", icon: Wallet, badge: "Finance", perm: "CAPITAL" },
      { href: "/insight", label: "Insight", icon: BarChart3, badge: "Reports", perm: "INSIGHT" },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, perm: "FLOW" },
      { href: "/portal", label: "Portal", icon: Globe2, badge: "Client", perm: "PORTAL" },
    ],
  },
  { section: "System", items: [{ href: "/control", label: "Control", icon: Settings, badge: "Admin", perm: "CONTROL" }] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const perms = user?.permissions;
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const visible = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!item.perm || !perms) return true;
      return perms[item.perm]?.view !== false;
    }),
  })).filter((g) => g.items.length > 0);

  const nav = (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {visible.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
              {group.section}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                      active
                        ? "bg-sidebar-primary text-white shadow-primary/25"
                        : "text-white/70 hover:bg-sidebar-accent hover:text-white"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-4 transition-transform group-hover:scale-110",
                        active && "text-white"
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide",
                          active ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-accent p-2.5">
          <Avatar name={user?.name ?? "Z"} size="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold">{user?.name ?? "Zoolyum"}</p>
            <p className="truncate text-[10.5px] text-white/50">{user?.role ?? "Loading…"}</p>
          </div>
          <button
            onClick={logout}
            className="rounded-lg px-2 py-1 text-[10.5px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            Exit
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-white lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <BrandLogo variant="light" />
        </div>
        {nav}
      </aside>

      {/* Mobile: floating menu button + slide-over nav (no sidebar below lg) */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-2xl bg-sidebar text-white shadow-xl transition-transform outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/60 lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-72 max-w-[85vw] flex-col bg-sidebar text-white shadow-2xl"
              role="dialog"
              aria-label="Navigation menu"
            >
              <div className="flex items-center justify-between py-3 pl-5 pr-3">
                <BrandLogo variant="light" />
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                  className="flex size-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {nav}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}