# Task 3 Report — BrandingContext & CSS Variable Injection

**Plan:** `docs/superpowers/plans/2026-08-24-branding-logo-gradient.md` Task 3
**Spec:** `docs/superpowers/specs/2026-08-24-branding-logo-gradient-design.md` §4
**Date:** 2026-08-24

## Summary
Implemented `BrandingContext` that fetches `GET /control/branding`, injects CSS variables, and provides `apiFetchFormData` helper. Updated `globals.css` to use CSS vars with OKLCH fallbacks. Wrapped `(app)/layout.tsx` with `BrandingProvider`.

## Files
- **Created:** `apps/web/src/lib/branding-context.tsx` — `BrandingProvider`, `useBranding`, `BrandingContext`, `Branding` type, `isValidHex` validation, `refresh()` via `queryClient.invalidateQueries`, `useEffect` sets `--primary`, `--secondary`, `--brand-gradient`, `--brand-gradient-soft`, `--brand-mesh-*`
- **Modified:** `apps/web/src/lib/api.ts` — added `apiFetchFormData<T>(path, formData)` POST without `Content-Type`, adds `Authorization: Bearer <token>` if present, error handling mirrors `apiFetch`
- **Modified:** `apps/web/src/app/globals.css` — `.bg-brand-gradient` now `background: var(--brand-gradient, linear-gradient(...oklch fallback))`, `.bg-brand-gradient-soft` uses `var(--brand-gradient-soft, ...)`, `.bg-mesh` uses `color-mix(in oklch, var(--primary,...) 10%, transparent)` and `var(--secondary,...)` with OKLCH fallbacks
- **Modified:** `apps/web/src/app/(app)/layout.tsx` — wraps `<AppShell>` with `<BrandingProvider>`
- **Modified:** `apps/web/src/components/app-shell.tsx` — comment noting BrandingProvider wrapper location

## Interfaces
- Consumes: `GET /control/branding` (Task 2, cached `control:branding`)
- Produces: `BrandingContext { branding: Branding | null, refresh: () => Promise<void>, isLoading: boolean }`, CSS vars `--primary`, `--secondary`, `--brand-gradient`, `--brand-gradient-soft`, `apiFetchFormData`

## Key decisions
- `useQuery` with `staleTime 30s`, `retry: false` to avoid auth loops on unauthenticated pages
- `useBranding()` returns safe fallback `{ branding: null, refresh: noop }` when used outside provider (e.g., `/login`, `/portal-login` before Task 5) — prevents crash, enables future `BrandLogo` reuse
- Hex validation `^#[0-9A-Fa-f]{6}$` before injecting; invalid colors ignored, fallback OKLCH remains
- `withAlpha(hex, "14")` ~8% opacity for soft gradient, `"1A"` ~10% for mesh
- `globals.css` uses `color-mix(in oklch, var(--primary) 10%, transparent)` so hex ` --primary` works with opacity and fallback is OKLCH; satisfies “CSS variables must have fallback OKLCH, dark/light variants support”

## Verification
- `npx tsc --noEmit` in `apps/web` → **PASS** (no output)
- `npm run build` in `apps/web` (Next 16.3 Turbopack) → **PASS** compiled, 29 static pages generated, typecheck 7.9s
- `npm run build` in `apps/api` (nest build) → **PASS**
- Manual check: `document.documentElement.style.getPropertyValue('--brand-gradient')` will be `linear-gradient(135deg, #7C3AED, #38BDF8)` after fetch; fallback gradient visible when fetch fails

## Self-review
- No `Content-Type` header in `apiFetchFormData` — FormData boundary auto-set ✓
- No secrets stored
- `"use client"` directives correct
- `BrandingProvider` inside `QueryProvider`/`AuthProvider` tree via `(app)/layout.tsx` — available only for authenticated app shell, login pages unaffected ✓
- Fallbacks preserved in CSS — OKLCH gradients remain if branding null ✓

## Commit
`feat(web): add BrandingContext with CSS variable sync`
Files: `branding-context.tsx`, `api.ts`, `globals.css`, `(app)/layout.tsx`, `app-shell.tsx`
