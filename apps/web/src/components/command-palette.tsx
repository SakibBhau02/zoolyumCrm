"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CornerDownLeft,
  Globe2,
  LayoutDashboard,
  ListTodo,
  Loader2,
  Search,
  Settings,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/components/shared";

/* ────────────────────────────────────────────────────────────────────────────
   Command palette (Ctrl/⌘ + K).

   Three result kinds in one list: actions (create/where to go), pages, and
   records from /search. Keyboard-first: ↑↓ move, Enter opens, Esc closes.
   ──────────────────────────────────────────────────────────────────────────── */

type Hit = {
  id: string;
  kind: "action" | "page" | "record";
  title: string;
  subtitle?: string;
  href: string;
  icon: any;
  perm?: string;
};

const PAGES: Hit[] = [
  { id: "p-dashboard", kind: "page", title: "Dashboard", subtitle: "Command center", href: "/dashboard", icon: LayoutDashboard },
  { id: "p-pulse", kind: "page", title: "Pulse", subtitle: "Leads & pipeline", href: "/pulse", icon: Zap, perm: "PULSE" },
  { id: "p-accounts", kind: "page", title: "Accounts", subtitle: "Clients", href: "/accounts", icon: Building2, perm: "ACCOUNTS" },
  { id: "p-flow", kind: "page", title: "Flow", subtitle: "Projects", href: "/flow", icon: Workflow, perm: "FLOW" },
  { id: "p-tasks", kind: "page", title: "Tasks", subtitle: "My work & team board", href: "/tasks", icon: ListTodo, perm: "TASKS" },
  { id: "p-people", kind: "page", title: "People", subtitle: "HR, attendance, payroll", href: "/people", icon: Users, perm: "PEOPLE" },
  { id: "p-capital", kind: "page", title: "Capital", subtitle: "Invoices, expenses, cash", href: "/capital", icon: Wallet, perm: "CAPITAL" },
  { id: "p-insight", kind: "page", title: "Insight", subtitle: "Ads, reports, analytics", href: "/insight", icon: BarChart3, perm: "INSIGHT" },
  { id: "p-calendar", kind: "page", title: "Calendar", subtitle: "Meetings & deadlines", href: "/calendar", icon: CalendarDays, perm: "CALENDAR" },
  { id: "p-portal", kind: "page", title: "Portal", subtitle: "Client self-service", href: "/portal", icon: Globe2, perm: "PORTAL" },
  { id: "p-control", kind: "page", title: "Control", subtitle: "Admin, roles, settings", href: "/control", icon: Settings, perm: "CONTROL" },
];

const ACTIONS: Hit[] = [
  { id: "a-invoice", kind: "action", title: "Invoices", subtitle: "Capital → create & collect", href: "/capital/invoices", icon: Wallet, perm: "CAPITAL" },
  { id: "a-expense", kind: "action", title: "Expenses", subtitle: "Capital → expenses", href: "/capital/expenses", icon: Wallet, perm: "CAPITAL" },
  { id: "a-lead", kind: "action", title: "Leads pipeline", subtitle: "Pulse → pipeline", href: "/pulse?tab=pipeline", icon: Zap, perm: "PULSE" },
  { id: "a-task", kind: "action", title: "Tasks board", subtitle: "Tasks", href: "/tasks", icon: ListTodo, perm: "TASKS" },
  { id: "a-attendance", kind: "action", title: "My attendance", subtitle: "People → My space", href: "/people/me", icon: Users, perm: "PEOPLE" },
];

const RECORD_ICON: Record<string, any> = {
  lead: Zap,
  client: Building2,
  project: Workflow,
  invoice: Wallet,
  task: ListTodo,
  employee: Users,
};

export function CommandPalette() {
  const router = useRouter();
  const { user } = useAuth();
  const perms = user?.permissions;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allowed = useCallback(
    (hit: Hit) => !hit.perm || !perms || perms[hit.perm]?.view !== false,
    [perms]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      setCursor(0);
      return () => clearTimeout(t);
    }
    setQuery("");
    setRecords([]);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRecords([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const hits = await apiFetch<any[]>(`/search?q=${encodeURIComponent(term)}`);
        if (cancelled) return;
        setRecords(
          (hits ?? []).slice(0, 6).map((h: any) => ({
            id: `r-${h.type}-${h.id}`,
            kind: "record" as const,
            title: h.title,
            subtitle: [h.type, h.subtitle].filter(Boolean).join(" · "),
            href: h.href,
            icon: RECORD_ICON[String(h.type).toLowerCase()] ?? Search,
          }))
        );
      } catch {
        if (!cancelled) setRecords([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pages = PAGES.filter(allowed);
    const actions = ACTIONS.filter(allowed);
    if (!term) {
      return [...actions, ...pages];
    }
    const match = (hit: Hit) =>
      hit.title.toLowerCase().includes(term) ||
      (hit.subtitle ?? "").toLowerCase().includes(term);
    return [...actions.filter(match), ...pages.filter(match), ...records];
  }, [allowed, query, records]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  const go = useCallback(
    (hit: Hit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      go(results[cursor]);
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  if (!open) return null;

  const groups: { label: string; hits: Hit[] }[] = [
    { label: "Quick links", hits: results.filter((r) => r.kind === "action") },
    { label: "Pages", hits: results.filter((r) => r.kind === "page") },
    { label: "Records", hits: results.filter((r) => r.kind === "record") },
  ].filter((g) => g.hits.length > 0);

  let index = -1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/45 px-3 pt-[12vh] backdrop-blur-sm sm:pt-[16vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, leads, invoices, tasks…"
            aria-label="Search everything"
            className="w-full bg-transparent text-body-lg outline-none placeholder:text-muted-foreground"
          />
          {searching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <kbd className="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 text-micro font-semibold text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-body text-muted-foreground">
              {query.trim().length >= 2 ? `No matches for “${query.trim()}”.` : "Type to search."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-1">
                <p className="px-4 pb-1 pt-2 text-micro font-bold uppercase tracking-widest text-muted-foreground">
                  {group.label}
                </p>
                {group.hits.map((hit) => {
                  index += 1;
                  const active = index === cursor;
                  const Icon = hit.icon;
                  const at = index;
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      data-index={at}
                      onMouseEnter={() => setCursor(at)}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
                        active ? "bg-primary/10" : "hover:bg-muted/60"
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-semibold">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="block truncate text-micro capitalize text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        )}
                      </span>
                      {active ? (
                        <CornerDownLeft className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/40" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2 text-micro text-muted-foreground">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-semibold">↑↓</kbd> move
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-semibold">↵</kbd> open
          </span>
          <span className="truncate">Ctrl / ⌘ + K</span>
        </div>
      </div>
    </div>
  );
}
