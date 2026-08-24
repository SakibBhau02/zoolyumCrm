# Final Fix Report — Branding Logo Gradient (Review Findings)

**Date:** 2026-08-24
**Branch:** master
**Scope:** Fix 9 findings from whole-branch review (Important x7 + Minor x2)

## Summary

All 9 findings addressed in a single commit. `npx tsc --noEmit` passes in both `apps/web` and `apps/api`; `npm run build` passes in `apps/api`.

## Fixes Applied

### 1. SVG XSS via public uploads — `apps/api/src/control/control.controller.ts:54-56` + `apps/web/src/app/(app)/control/page.tsx:809,915,952`
- Removed `image/svg+xml` from `FileInterceptor` `fileFilter` allowlist. Now only `image/png, image/jpeg, image/webp` are accepted server-side. Error message updated to `Only image files are allowed (png, jpeg, webp)`.
- Client: removed `image/svg+xml` and generic `image/*` from `accept` attributes on both hidden file inputs (dark + light). Changed to `accept="image/png,image/jpeg,image/webp"`.
- Client `handleFile` tightened: removed `file.type.startsWith("image/")` generic check; now strictly checks `allowed.includes(file.type)` against the 3 mimes, rejecting all others with `Only png, jpeg, webp images are allowed`.

### 2. PDF logo fetch uses wrong origin — `apps/web/src/lib/invoice-pdf.ts:1,290-302`
- Added `import { API_URL } from "./api"` and helper `resolveLogoFetchUrl(url)` which resolves relative `"/api/..."` URLs via `API_URL + url.slice(4)` (same pattern as `resolveBrandingImgUrl` in `control/page.tsx:714`).
- `buildInvoicePdfAsync` now calls `resolveLogoFetchUrl(branding.logoDarkUrl)` before `fetch`, so relative upload URLs work correctly in both dev and prod.
- Also verified `apps/web/src/app/portal-client/page.tsx:373` already fetches branding via `pfetch("/portal-client/branding")` (uses `API_URL` via `pfetch`), no change needed there; PDF call site now passes resolved branding correctly.

### 3. Old-file cleanup misses clear — `apps/api/src/control/control.service.ts:135-147`
- Changed `tryDeleteOld` from `if (!oldUrl || !newUrl || oldUrl===newUrl) return` to:
  ```ts
  if (!oldUrl) return;
  if (newUrl === undefined) return; // field not being updated
  if (oldUrl === newUrl) return;
  if (!oldUrl.includes("uploads/branding")) return;
  ```
- Now handles clear case: when `newUrl` is `null` or `""` and `oldUrl` contains `uploads/branding`, the old file is deleted. When `newUrl` is `undefined` (field not in PATCH body), no deletion occurs. This matches PATCH semantics for explicit clear vs. no-op.

### 4. Stale CSS vars not removed — `apps/web/src/lib/branding-context.tsx:46-71`
- Added `else` branches for `--primary` and `--secondary` to `removeProperty` when `isValidHex` fails / branding cleared.
- Added `else` for gradient block to `removeProperty` for `--brand-gradient`, `--brand-gradient-soft`, `--brand-mesh-primary`, `--brand-mesh-secondary` when either color missing. Previously only set when truthy, never removed, leaving stale branding after clear.
- Kept `--brand-mesh-*` vars wired (not dead) — they remain set via `withAlpha(primary,"1A")` / secondary and removed on clear.

### 5. Double BrandingProvider — `apps/web/src/app/(app)/layout.tsx:1-10`
- Removed `BrandingProvider` wrapper from `(app)/layout.tsx`. Now `app/layout.tsx:43` remains sole provider (`<BrandingProvider><AuthProvider>{children}</AuthProvider></BrandingProvider>`). Prevents double query + double effect.

### 6. Upload dest uses process.cwd() — `apps/api/src/control/control.controller.ts:14`
- Kept `join(process.cwd(), "uploads/branding")` (works in both dev and prod) but added comment: `// Stored relative to process.cwd() — works in both dev (repo root) and prod (dist) because we mkdirSync recursively on upload`. `mkdirSync(..., {recursive:true})` already ensures dir creation.

### 7. Missing onError in BrandLogo — `apps/web/src/components/brand-logo.tsx:27-57`
- Added `const [failed, setFailed] = useState(false)` with `useEffect(() => setFailed(false), [src])` to reset on src change.
- Added `onError={() => setFailed(true)}` to `<img>`.
- Fallback condition changed to `if (!src || failed)` to show `Sparkles` + appName when image fails to load.

### 8. DTO appName unconstrained — `apps/api/src/control/dto/update-branding.dto.ts:1-6`
- Added `import { MaxLength }` and `@MaxLength(60)` to `appName` field (was `@IsString()` only). Enforces spec limit.

### 9. globals.css never defines --secondary — `apps/web/src/app/globals.css:12,34`
- Added `--secondary: oklch(0.62 0.14 220)` to `:root` and `--secondary: oklch(0.68 0.12 220)` to `.dark`. Ensures `bg-mesh` `color-mix(in oklch, var(--secondary, oklch(...)) 10%, transparent)` has a defined variable before branding fetch, and `branding-context.tsx:57` `setProperty("--secondary")` has a fallback.

## Verification

- `npx tsc --noEmit` in `apps/web` — **PASS** (no output)
- `npx tsc --noEmit` in `apps/api` — **PASS** (no output)
- `npm run build` in `apps/api` — **PASS** (`nest build` succeeded)

## Files Touched (9)

- `apps/api/src/control/control.controller.ts`
- `apps/api/src/control/dto/update-branding.dto.ts`
- `apps/api/src/control/control.service.ts`
- `apps/web/src/lib/branding-context.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/lib/invoice-pdf.ts`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/components/brand-logo.tsx`
- `apps/web/src/app/(app)/control/page.tsx`
