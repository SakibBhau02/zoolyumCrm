"use client";

import { useEffect } from "react";

/**
 * Error boundary for the authenticated shell. It sits inside the app layout, so
 * the sidebar/topbar stay usable while the page itself offers a retry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="font-heading text-[15px] font-semibold">This page hit an error</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Nothing was lost. Retry the page — the rest of the workspace keeps working.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/70">ref: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-5 rounded-xl bg-brand-gradient px-4 py-2 text-[12.5px] font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
