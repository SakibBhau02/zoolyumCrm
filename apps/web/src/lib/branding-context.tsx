"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken } from "./api";
import { BRANDING_TOKEN_NAMES, brandingTokens } from "./branding-theme";

export { accessibleOnWhite } from "./branding-theme";

export type Branding = {
  id?: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  logoLightUrl?: string | null;
  appName?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  invoiceNumberingFormat?: string;
  // Company profile for invoices (mirrors Finance_System CompanyProfile)
  tagline?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
  website?: string | null;
  authorizedSignerName?: string | null;
  authorizedSignerTitle?: string | null;
  signatureImageUrl?: string | null;
  defaultPaymentDetails?: Record<string, any> | null;
  defaultCurrency?: string | null;
  defaultNotes?: string | null;
  defaultTerms?: string | null;
  updatedAt?: string;
};

interface BrandingContextValue {
  branding: Branding | null;
  refresh: () => Promise<void>;
  isLoading: boolean;
}

export const BrandingContext = createContext<BrandingContextValue | null>(null);

/**
 * The signed-in payload carries the invoice company profile (payment details,
 * signature) that the public one deliberately omits, so the key follows the
 * session. Both keys still receive the server-seeded `initialData`, which is
 * what removed the paint-then-swap flash.
 */
const brandingKey = () => ["branding", typeof window !== "undefined" && !!getToken()] as const;

export function BrandingProvider({
  children,
  initialBranding = null,
}: {
  children: React.ReactNode;
  /** Server-rendered branding from the root layout (see lib/branding-server). */
  initialBranding?: Branding | null;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<Branding | null>({
    queryKey: brandingKey(),
    // Staff pages read the full company profile; anonymous/portal pages use the
    // public display-only endpoint so they never fire a 401 on load.
    queryFn: () =>
      apiFetch<Branding>(getToken() ? "/control/branding" : "/control/branding/public"),
    // First paint uses the server payload; `initialDataUpdatedAt: 0` marks it
    // stale immediately so the richer authenticated payload still arrives in
    // the background on the next tick.
    initialData: initialBranding ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    retry: false,
  });

  const branding = (data as Branding) ?? null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const tokens = brandingTokens(branding);

    // Remove only what this provider owns, then apply the current values.
    for (const name of BRANDING_TOKEN_NAMES) {
      if (!(name in tokens)) root.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(tokens)) {
      root.style.setProperty(name, value);
    }
  }, [branding]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["branding"] });
  }, [queryClient]);

  const value = useMemo<BrandingContextValue>(
    () => ({ branding, refresh, isLoading }),
    [branding, refresh, isLoading]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    // fallback when used outside provider (e.g., login page) - return null branding without crash
    return { branding: null, refresh: async () => {}, isLoading: false };
  }
  return ctx;
}
