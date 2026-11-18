"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  ListTodo,
  Loader2,
  LogOut,
  Megaphone,
  Moon,
  Search,
  Settings,
  Sun,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Avatar } from "./shared";
import { NotificationsDropdown } from "./notifications-dropdown";
import { ClockChip } from "./clock-chip";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { usePrivacy } from "@/lib/privacy";

interface SearchHit {
  type: "lead" | "client" | "project" | "invoice" | "task" | "post" | "event";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const TYPE_META: Record<SearchHit["type"], { label: string; icon: typeof Zap }> = {
  lead: { label: "Lead", icon: Zap },
  client: { label: "Client", icon: Users },
  project: { label: "Project", icon: FolderKanban },
  invoice: { label: "Invoice", icon: FileText },
  task: { label: "Task", icon: ListTodo },
  post: { label: "Post", icon: Megaphone },
  event: { label: "Event", icon: CalendarDays },
};

export function Topbar() {
  const { user, logout } = useAuth();
  const { hidden, toggle } = usePrivacy();
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Debounced type-ahead. <2 characters never leaves the browser.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      apiFetch<SearchHit[]>(`/search?q=${encodeURIComponent(term)}`)
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
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
  // Replaces the hardcoded school term that leaked from the design reference.
  const fiscalLabel = useMemo(() => {
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    return `Q${quarter} · FY ${now.getFullYear()}`;
  }, [now]);

  const go = (hit: SearchHit) => {
    setSearchOpen(false);
    setQuery("");
    setHits([]);
    router.push(hit.href);
  };

  const canControl = user?.role === "Owner" || user?.permissions?.CONTROL?.view === true;
  const canPeople = user?.role === "Owner" || user?.permissions?.PEOPLE?.view === true;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        onClick={() => setMobileSearch(true)}
        aria-label="Search"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground md:hidden"
      >
        <Search className="size-4" />
      </button>

      {/* The date + fiscal chip needs ~200px. It waited for `lg` (1024px) and
          wrapped the topbar into 4 lines there, so it only appears from `xl`. */}
      <div className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card/60 px-3 py-1.5 xl:flex">
        <span className="text-meta text-muted-foreground">{dateLabel}</span>
        <span className="h-3 w-px bg-border" />
        <span className="text-meta font-medium text-foreground">{fiscalLabel}</span>
      </div>

      <div ref={searchRef} className="relative hidden w-full max-w-xs md:block xl:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearchOpen(false);
              setQuery("");
            }
            if (e.key === "Enter" && hits[0]) go(hits[0]);
          }}
          placeholder="Search leads, clients, invoices…"
          aria-label="Search leads, clients, projects, invoices and tasks"
          className="w-full rounded-xl border border-border bg-card/60 py-2 pl-9 pr-8 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
        />
        {searching && (
          <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}

        {searchOpen && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            {hits.length === 0 && !searching ? (
              <p className="px-3 py-3 text-body text-muted-foreground">No matches for “{query.trim()}”.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {hits.map((hit) => {
                  const meta = TYPE_META[hit.type];
                  const Icon = meta.icon;
                  return (
                    <li key={`${hit.type}:${hit.id}`}>
                      <button
                        type="button"
                        onClick={() => go(hit)}
                        className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-semibold">{hit.title}</span>
                          <span className="block truncate text-micro text-muted-foreground">
                            {meta.label}
                            {hit.subtitle ? ` · ${hit.subtitle}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        <ClockChip />
        <button
          onClick={toggle}
          className="flex size-10 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground sm:size-9"
          aria-label={hidden ? "Show money amounts" : "Hide money amounts"}
          aria-pressed={hidden}
          title={hidden ? "Amounts hidden — click to show" : "Hide ৳ amounts"}
        >
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button
          onClick={toggleTheme}
          className="flex size-10 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground sm:size-9"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <NotificationsDropdown />
        <div className="mx-1 h-6 w-px bg-border" />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-muted/60"
          >
            <Avatar name={user?.name ?? "Z"} />
            <span className="hidden max-w-[9rem] text-left sm:block">
              <span className="block truncate text-body font-semibold leading-tight">{user?.name ?? "—"}</span>
              <span className="block truncate text-micro leading-tight text-muted-foreground">
                {user?.role ?? ""}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl"
            >
              <div className="border-b border-border/60 px-3 py-2">
                <p className="truncate text-body font-semibold">{user?.name}</p>
                <p className="truncate text-micro text-muted-foreground">{user?.email}</p>
              </div>
              {canPeople && (
                <Link
                  href="/people/me"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-body font-medium transition-colors hover:bg-muted/60"
                >
                  <User className="size-3.5 text-muted-foreground" /> My space
                </Link>
              )}
              {canControl && (
                <Link
                  href="/control"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-body font-medium transition-colors hover:bg-muted/60"
                >
                  <Settings className="size-3.5 text-muted-foreground" /> Admin panel
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={logout}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body font-medium text-rose-500 transition-colors hover:bg-rose-500/10"
              >
                <LogOut className="size-3.5" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Phone search: a full-screen sheet keeps the header uncluttered and the
          input at a 16px size, so iOS never zooms the page on focus. */}
      {mobileSearch && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads, clients, invoices…"
              aria-label="Search"
              className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => {
                setMobileSearch(false);
                setQuery("");
                setHits([]);
              }}
              aria-label="Close search"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {query.trim().length < 2 ? (
              <p className="px-2 py-8 text-center text-body text-muted-foreground">
                Type at least 2 characters.
              </p>
            ) : hits.length === 0 && !searching ? (
              <p className="px-2 py-8 text-center text-body text-muted-foreground">
                No matches for “{query.trim()}”.
              </p>
            ) : (
              <ul className="space-y-1">
                {hits.map((hit) => {
                  const meta = TYPE_META[hit.type];
                  const Icon = meta.icon;
                  return (
                    <li key={`${hit.type}:${hit.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileSearch(false);
                          go(hit);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-muted/60"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-lg font-semibold">{hit.title}</span>
                          <span className="block truncate text-meta text-muted-foreground">
                            {meta.label}
                            {hit.subtitle ? ` · ${hit.subtitle}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
