"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken } from "./api";

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

function isValidHex(color: string | null | undefined): boolean {
  return !!color && /^#[0-9A-Fa-f]{6}$/.test(color);
}

function withAlpha(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`;
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<Branding>({
    queryKey: ["branding", typeof window !== "undefined" && !!getToken()],
    // Staff pages read the full company profile; anonymous/portal pages use the
    // public display-only endpoint so they never fire a 401 on load.
    queryFn: () =>
      apiFetch<Branding>(getToken() ? "/control/branding" : "/control/branding/public"),
    staleTime: 30_000,
    retry: false,
  });

  const branding = (data as Branding) ?? null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const primary = isValidHex(branding?.primaryColor) ? branding!.primaryColor! : null;
    const secondary = isValidHex(branding?.secondaryColor) ? branding!.secondaryColor! : null;

    if (primary) {
      root.style.setProperty("--primary", primary);
    } else {
      root.style.removeProperty("--primary");
    }
    if (secondary) {
      root.style.setProperty("--secondary", secondary);
    } else {
      root.style.removeProperty("--secondary");
    }

    // Buttons must be solid (no gradient) — per branding request, use primary solid
    if (primary) {
      root.style.setProperty("--chart-1", primary);
      root.style.setProperty("--brand-gradient", primary);
      root.style.setProperty("--brand-gradient-soft", `color-mix(in oklch, ${primary} 12%, transparent)`);
    } else {
      root.style.removeProperty("--chart-1");
      root.style.removeProperty("--brand-gradient");
      root.style.removeProperty("--brand-gradient-soft");
    }
    if (secondary) {
      root.style.setProperty("--chart-2", secondary);
      root.style.setProperty("--brand-mesh-secondary", withAlpha(secondary, "1A"));
    } else {
      root.style.removeProperty("--chart-2");
      root.style.removeProperty("--brand-mesh-secondary");
    }
    // bg-mesh primary radial
    if (primary) root.style.setProperty("--brand-mesh-primary", withAlpha(primary, "1A"));
    else root.style.removeProperty("--brand-mesh-primary");
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
