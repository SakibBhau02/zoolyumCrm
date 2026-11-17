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

/** WCAG relative luminance for an sRGB hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function mix(hex: string, target: string, weight: number): string {
  const src = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dst = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  const out = src.map((c, i) => Math.round(c * (1 - weight) + dst[i] * weight));
  return "#" + out.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/**
 * Keep the brand hue but guarantee AA contrast against white.
 *
 * The shipped orange (#FF5001 on white) is 3.14:1, which fails WCAG 1.4.3 on
 * every primary button and active tab (audit UX-02). An admin can pick any hex,
 * so the fix lives here rather than in one button: the colour is darkened in 4%
 * steps until it reaches 4.5:1. Ties are preserved — #FF5001 becomes a deeper
 * orange, not a different hue.
 */
export function accessibleOnWhite(hex: string): string {
  let candidate = hex;
  for (let i = 0; i < 25 && contrastRatio(candidate, "#ffffff") < 4.5; i += 1) {
    candidate = mix(candidate, "#000000", 0.04);
  }
  return candidate;
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
      // Text sits on this colour in every primary button, so it must clear AA.
      root.style.setProperty("--primary", accessibleOnWhite(primary));
      root.style.setProperty("--primary-brand-raw", primary);
    } else {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-brand-raw");
    }
    if (secondary) {
      root.style.setProperty("--secondary", secondary);
    } else {
      root.style.removeProperty("--secondary");
    }

    // Buttons must be solid (no gradient) — per branding request, use primary solid.
    // `--brand-gradient` is consumed as a *background-image* (bg-clip-text wordmarks
    // on /, /login, /portal-login). A solid colour there is invalid CSS, so the
    // image is dropped and the text renders transparent — the product name was
    // invisible on the login page (audit UX-01). Keep the token an image.
    if (primary) {
      root.style.setProperty("--chart-1", primary);
      root.style.setProperty("--brand-gradient", `linear-gradient(135deg, var(--primary), var(--primary))`);
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
