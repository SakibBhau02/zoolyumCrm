"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for the whole app. Without this file a render or
 * data-shape error escaped to Next's generic overlay and the user had no way
 * back except a manual reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the digest in the console so a support ticket can be matched to a
    // server log line.
    console.error("Route error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="font-heading text-section font-semibold">Something went wrong</p>
        <p className="mt-1.5 text-body leading-relaxed text-muted-foreground">
          This page could not be rendered. Your data is safe — try again, and if it keeps
          happening reload the app.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-micro text-muted-foreground/70">ref: {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-xl bg-brand-gradient px-4 py-2 text-body font-semibold text-white"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-border px-4 py-2 text-body font-semibold"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
