"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";

export type Branding = {
  id?: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  logoLightUrl?: string | null;
  appName?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  invoiceNumberingFormat?: string;
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
    queryKey: ["branding"],
    queryFn: () => apiFetch<Branding>("/control/branding"),
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

    if (primary && secondary) {
      root.style.setProperty("--brand-gradient", `linear-gradient(135deg, ${primary}, ${secondary})`);
      root.style.setProperty(
        "--brand-gradient-soft",
        `linear-gradient(135deg, ${withAlpha(primary, "14")}, ${withAlpha(secondary, "14")})`
      );
      root.style.setProperty("--brand-mesh-primary", withAlpha(primary, "1A"));
      root.style.setProperty("--brand-mesh-secondary", withAlpha(secondary, "1A"));
    } else {
      root.style.removeProperty("--brand-gradient");
      root.style.removeProperty("--brand-gradient-soft");
      root.style.removeProperty("--brand-mesh-primary");
      root.style.removeProperty("--brand-mesh-secondary");
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
