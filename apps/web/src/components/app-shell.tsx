"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { MobileNav } from "@/components/mobile-nav";
import { useAuth } from "@/lib/auth";
import { getToken } from "@/lib/api";
// BrandingProvider wraps AppShell in (app)/layout.tsx — CSS vars injected via branding-context

/**
 * Immediate chrome while `/auth/me` resolves.
 *
 * The old version rendered a full-screen spinner, so every route painted
 * nothing until JS downloaded, hydrated and the API answered. Rendering the
 * layout skeleton first makes the app feel instant and removes a layout shift
 * when the real shell mounts.
 */
function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden" aria-busy="true" aria-label="Loading workspace">
      <div className="hidden w-64 shrink-0 border-r border-border bg-card/60 p-4 lg:block">
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="ml-auto h-8 w-8 animate-pulse rounded-full bg-muted" />
        </div>
        <main className="flex-1 overflow-y-auto bg-mesh">
          <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6 lg:p-8">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/70" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-muted/60" />
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, loadError, retry } = useAuth();
  const router = useRouter();
  // Read the token in an effect, not during render: the server has no
  // localStorage, so deciding during render would make the first client render
  // differ from the server HTML (hydration mismatch).
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => setHasToken(!!getToken()), []);

  useEffect(() => {
    // Redirect only when there is genuinely no session. A token that failed to
    // verify because the API was restarting must not send the user to /login —
    // that used to look like "all my data disappeared".
    if (!loading && !user && !getToken()) router.replace("/login");
  }, [loading, user, router]);

  // A token means a session almost certainly exists, so mount the page right
  // away: its own queries then run in parallel with /auth/me instead of queuing
  // behind it. That removes one full round trip from every boot and every
  // hard navigation. Visitors with no token still see the skeleton — there is
  // nothing for them to fetch.
  if (loading && !hasToken) return <ShellSkeleton />;

  if (!user && !loading) {
    // Token exists but /auth/me could not be reached → offer a retry instead
    // of silently emptying every page.
    if (getToken()) {
      return (
        <div className="flex h-screen items-center justify-center bg-mesh px-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <p className="font-heading text-section font-semibold">Can&apos;t reach the server</p>
            <p className="mt-1 text-body text-muted-foreground">
              {loadError ?? "The API is not responding. Your session is still valid."}
            </p>
            <button
              onClick={retry}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-gradient px-4 py-2 text-body font-semibold text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-screen items-center justify-center bg-mesh">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Keyboard users land on 11 nav links before the page content otherwise
          (WCAG 2.4.1 — audit UX-03). Visible on focus only. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-body focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        <main id="main-content" tabIndex={-1} className="app-main flex-1 overflow-y-auto bg-mesh">
          <div className="mx-auto max-w-7xl px-3 py-4 sm:p-6 lg:p-8 lg:pb-8">{children}</div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
