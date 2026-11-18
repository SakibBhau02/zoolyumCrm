/**
 * Shared branding → CSS custom properties mapping.
 *
 * Runs in two places that must produce byte-identical output:
 *   - the root layout (server) — writes a `<style>` block into the document, so
 *     the very first paint already uses the workspace colours instead of the
 *     shipped defaults (the "old theme flashes before the new one" bug);
 *   - BrandingProvider (client) — re-applies the same tokens after a save.
 */
export type BrandingTheme = {
  primaryColor?: string | null;
  secondaryColor?: string | null;
};

export function isValidHex(color: string | null | undefined): boolean {
  return !!color && /^#[0-9A-Fa-f]{6}$/.test(color);
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
  // Two surfaces matter in this UI: pure white (page background) and the 10%
  // brand tint used by every chip/badge (`bg-primary/10`). Clearing white alone
  // left `text-primary` chips at 4.1:1, so both are checked.
  const tintOf = (c: string) => mix(c, "#ffffff", 0.9);
  let candidate = hex;
  for (
    let i = 0;
    i < 25 && (contrastRatio(candidate, "#ffffff") < 4.5 || contrastRatio(candidate, tintOf(candidate)) < 4.5);
    i += 1
  ) {
    candidate = mix(candidate, "#000000", 0.04);
  }
  return candidate;
}

/**
 * Same idea for the dark surface (#171412): keep the hue and lighten it until
 * it can be used as text. #FF5001 already clears 4.5:1 there, so the logo
 * orange stays untouched while a dark navy brand would become readable.
 */
export function accessibleOnDark(hex: string): string {
  let candidate = hex;
  for (let i = 0; i < 25 && contrastRatio(candidate, "#171412") < 4.5; i += 1) {
    candidate = mix(candidate, "#ffffff", 0.06);
  }
  return candidate;
}

/**
 * The tokens BrandingProvider used to set imperatively, as a plain map.
 * Empty entries mean "remove / fall back to globals.css".
 *
 * `--primary` is theme-scoped in globals.css:
 *   :root { --primary: var(--brand-primary-light, #c9400a) }
 *   .dark { --primary: var(--brand-primary-dark,  #ff6a2b) }
 * so an inline `--primary` (which used to win over the `.dark` rule and made
 * dark mode keep the white-safe, dark orange) is no longer written here.
 */
export function brandingTokens(branding: BrandingTheme | null | undefined): Record<string, string> {
  const tokens: Record<string, string> = {};
  const primary = isValidHex(branding?.primaryColor) ? branding!.primaryColor! : null;
  const secondary = isValidHex(branding?.secondaryColor) ? branding!.secondaryColor! : null;

  if (primary) {
    // White text sits on this colour in every primary button, so it must clear AA.
    tokens["--brand-primary-light"] = accessibleOnWhite(primary);
    // On the near-black surface the same hue can be brighter; keep it legible.
    tokens["--brand-primary-dark"] = accessibleOnDark(primary);
    // `.bg-brand-gradient` + hard-coded text-white chips always need white text.
    tokens["--brand-primary-strong"] = accessibleOnWhite(primary);
    tokens["--brand-primary-raw"] = primary;
    tokens["--chart-1"] = primary;
    tokens["--brand-gradient"] = `linear-gradient(135deg, ${accessibleOnWhite(primary)}, ${accessibleOnWhite(primary)})`;
    tokens["--brand-gradient-soft"] = `color-mix(in oklch, ${primary} 12%, transparent)`;
    tokens["--brand-mesh-primary"] = `${primary}1A`;
  }
  if (secondary) {
    tokens["--secondary"] = secondary;
    tokens["--chart-2"] = secondary;
    tokens["--brand-mesh-secondary"] = `${secondary}1A`;
  }
  return tokens;
}

/** All tokens this module can emit — the client removes only these on reset. */
export const BRANDING_TOKEN_NAMES = [
  "--brand-primary-light",
  "--brand-primary-dark",
  "--brand-primary-strong",
  "--brand-primary-raw",
  "--chart-1",
  "--brand-gradient",
  "--brand-gradient-soft",
  "--brand-mesh-primary",
  "--secondary",
  "--chart-2",
  "--brand-mesh-secondary",
] as const;

/** Serialise tokens to a `:root{…}` rule for the server-rendered <style>. */
export function brandingStyleSheet(branding: BrandingTheme | null | undefined): string {
  const tokens = brandingTokens(branding);
  const body = Object.entries(tokens)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  return body ? `:root{${body}}` : "";
}
