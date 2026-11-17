"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/components/shared";

/* ────────────────────────────────────────────────────────────────────────────
   Privacy mode.

   The owner shares the dashboard on client calls and screen recordings, so one
   toggle must hide every taka amount without re-laying out the page. The mask
   itself is CSS (`html[data-privacy="on"] .money`), which means any component
   that renders money through <Money> is covered — no per-page wiring.
   ──────────────────────────────────────────────────────────────────────────── */

type PrivacyContextValue = {
  hidden: boolean;
  setHidden: (value: boolean) => void;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

const STORAGE_KEY = "zoolyum-privacy";

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY) === "1";
    setHiddenState(saved);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.privacy = hidden ? "on" : "off";
    try {
      window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }, [hidden]);

  const setHidden = useCallback((value: boolean) => setHiddenState(value), []);
  const toggle = useCallback(() => setHiddenState((v) => !v), []);

  const value = useMemo(
    () => ({ hidden, setHidden, toggle }),
    [hidden, setHidden, toggle]
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  // Components can render outside the provider (login, print sheets).
  return ctx ?? { hidden: false, setHidden: () => {}, toggle: () => {} };
}

/**
 * A money value that participates in privacy mode.
 *
 * Always render amounts through this in the dashboard so the 👁 toggle covers
 * them; plain `formatBDT(...)` strings stay visible.
 */
export function Money({
  value,
  currency = "BDT",
  className,
  title,
}: {
  value: number | string | null | undefined;
  currency?: string;
  className?: string;
  title?: string;
}) {
  const { hidden } = usePrivacy();
  return (
    <span
      className={cn("money tabular-nums", className)}
      title={hidden ? "Amount hidden" : title}
      aria-label={hidden ? "Amount hidden" : undefined}
    >
      {formatMoney(value, currency)}
    </span>
  );
}

/** Wraps an already-formatted amount (e.g. a custom "৳4.03L" string). */
export function MoneyText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("money tabular-nums", className)} data-money>
      {children}
    </span>
  );
}

/**
 * Masks every taka amount inside a sentence, leaving the words readable.
 * Used for alert hints and the AI brief, which mix names and money.
 */
export function MaskAmounts({
  text,
  className,
}: {
  text: React.ReactNode;
  className?: string;
}) {
  if (typeof text !== "string") return <span className={className}>{text}</span>;
  const parts = text.split(/(৳\s?[\d,]+(?:\.\d+)?\s?[LMK]?)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.startsWith("৳") ? (
          <span key={i} className="money">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
}
