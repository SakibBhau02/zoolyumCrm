"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Moon, Search, Sun } from "lucide-react";
import { Avatar } from "./shared";
import { NotificationsDropdown } from "./notifications-dropdown";
import { useAuth } from "@/lib/auth";

export function Topbar() {
  const { user } = useAuth();
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("zoolyum-theme", next ? "dark" : "light");
    } catch {}
  };

  const dateLabel = now.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border/70 bg-background/70 px-6 backdrop-blur-xl">
      <div className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 md:flex">
        <span className="text-[11.5px] text-muted-foreground">{dateLabel}</span>
        <span className="h-3 w-px bg-border" />
        <span className="text-[11.5px] font-medium text-foreground">Term 2 · FY 2026</span>
      </div>

      <div className="relative hidden w-72 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search leads, clients, invoices…"
          className="w-full rounded-xl border border-border bg-card/60 py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <button
          onClick={toggleTheme}
          className="flex size-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <NotificationsDropdown />
        <div className="mx-1 h-6 w-px bg-border" />
        <button className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-muted/60">
          <Avatar name={user?.name ?? "Z"} />
          <span className="hidden text-left sm:block">
            <span className="block text-[12px] font-semibold leading-tight">{user?.name ?? "…"}</span>
            <span className="block text-[10.5px] leading-tight text-muted-foreground">
              {user?.role ?? ""}
            </span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}