"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/lib/auth";
import { getToken } from "@/lib/api";
// BrandingProvider wraps AppShell in (app)/layout.tsx — CSS vars injected via branding-context

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, loadError, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect only when there is genuinely no session. A token that failed to
    // verify because the API was restarting must not send the user to /login —
    // that used to look like "all my data disappeared".
    if (!loading && !user && !getToken()) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-mesh">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    // Token exists but /auth/me could not be reached → offer a retry instead
    // of silently emptying every page.
    if (getToken()) {
      return (
        <div className="flex h-screen items-center justify-center bg-mesh px-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <p className="font-heading text-[15px] font-semibold">Can&apos;t reach the server</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {loadError ?? "The API is not responding. Your session is still valid."}
            </p>
            <button
              onClick={retry}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-gradient px-4 py-2 text-[12.5px] font-semibold text-white"
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
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-mesh">
          <div className="mx-auto max-w-7xl p-4 pb-24 sm:p-6 lg:p-8 lg:pb-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
