# Task 5 Report — Consumer Updates (Sidebar, Login, etc.)

## Summary
Created `BrandLogo` variant-aware component and updated 4 consumers (Sidebar, Login, Portal-Login, Landing) to use dynamic logo with dark/light selection and `var(--brand-gradient)` styling. Wrapped root layout with `BrandingProvider` so public pages also resolve branding.

## Changes
- `apps/web/src/components/brand-logo.tsx:1-51` — CREATE: `BrandLogo({ height, variant })`
  - uses `useBranding()`; tracks `isDark` via `document.documentElement.classList.contains('dark')` + `MutationObserver` for reactive toggle
  - picks `src = effectiveDark ? logoLightUrl ?? logoUrl : logoDarkUrl ?? logoUrl` where `effectiveDark = variant==='light'?true: variant==='dark'?false:isDark`
  - fallback when no src: renders `Sparkles` icon in `size-9` (or `size-14` if height>=36) with `background: var(--brand-gradient, linear-gradient(...fallback OKLCH...))` + `appName` text — both logos optional
  - else renders `<img src alt height max-w-[180px] object-contain />`

- `apps/web/src/components/sidebar.tsx:19-21,63-66` — replace hard-coded `Sparkles` block with `<BrandLogo variant="light" />` (sidebar bg is always dark `bg-sidebar`, so force light logo); removed unused `Sparkles` import; header div now single BrandLogo.

- `apps/web/src/app/login/page.tsx:6-7,14-16,46-62` — import `BrandLogo` + `useBranding`, read `appName`, replace `bg-brand-gradient`+Sparkles header with `<BrandLogo height={36} />`, heading gradient text now uses `style={{backgroundImage: 'var(--brand-gradient, linear-gradient(...))'}}` and displays dynamic `appName`.

- `apps/web/src/app/portal-login/page.tsx:8,62-75` — same: import `BrandLogo`, replace Sparkles header with `<BrandLogo height={36} />`, heading uses `var(--brand-gradient)`.

- `apps/web/src/app/page.tsx:19,56-57,83-93` — import `BrandLogo`, header replaces `Z` box + text with `<BrandLogo />`, hero heading gradient span now uses `var(--brand-gradient)` inline style with fallback.

- `apps/web/src/app/layout.tsx:7,42-45` — add `BrandingProvider` wrapping `AuthProvider` inside `QueryProvider` so public routes (login, portal-login, landing) have branding context; inner `(app)/layout.tsx` provider remains (nested, harmless, cache-shared).

## Verification
- `npx tsc --noEmit` in `apps/web`: PASS (0 errors)
- Manual logic check:
  - `BrandLogo` checks `isDark` via `document.documentElement.classList.contains('dark')` per spec `src = isDark ? logoLightUrl : logoDarkUrl ?? logoUrl`
  - Sidebar forces `variant="light"` to show light logo on dark sidebar regardless of html theme — fixes light-mode inconsistency while preserving auto logic elsewhere
  - All `bg-brand-gradient` usages either via `var(--brand-gradient, fallback)` inline style (BrandLogo fallback) or `globals.css` fallback; no hard-coded gradient without var
  - Fallback to `Sparkles` + `appName` when both URLs null (global constraint)
  - Dark/light toggle will trigger `MutationObserver` → re-render with correct src (manual verification per plan Step 4)

## Constraints Met
- Both logos optional fallback to Sparkles — yes
- CSS variable with fallback OKLCH gradients — yes (`globals.css` fallback + inline `var(--brand-gradient, linear-gradient(...))`)
- `height` prop supported — yes, default 32, used 36 on login pages

## Self-Review
- No hardcoded secrets
- No duplicate Sparkles import leakage (sidebar cleaned)
- BrandLogo client-only, safe for SSR (`typeof document` guard + initial isDark false → hydration OK, corrects on mount)
- Root provider addition does not break existing `(app)` provider; `useBranding` fallback returns null outside provider but now all routes inside provider

## Commit
`feat(brand): dynamic logo with dark/light variants` — includes `apps/web/src/components/brand-logo.tsx`, `apps/web/src/components/sidebar.tsx`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/portal-login/page.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/layout.tsx`
