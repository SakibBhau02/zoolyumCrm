# Branding — Logo (Dark/Light) + Gradient Sync Design

**Date:** 2026-08-24
**Status:** Approved
**Approach:** A (Lean Extend) + PDF branding
**Scope:** Settings → logo upload (black & white variants, connected data), auto-suggest gradient from logo color + manual override, global apply including Invoice/PDF, support dark & light versions.

## 1. Context & Goals

Settings থেকে logo add করা যাবে, logo color-এর সাথে overall background-এর gradient মিলে যাবে, branding overall settings থেকে change করা যাবে, black এবং white দুই version support।

Current state:
- `control/page.tsx:215 CompanyProfileSection` — only text `companyLogo` URL input, no upload/preview.
- `sidebar.tsx:64` — hard-coded `Sparkles` + static `bg-brand-gradient`, no `<img>`.
- `globals.css:88 bg-brand-gradient` + `119 bg-mesh` — static OKLCH, not reading DB.
- `BrandingConfig` — single `logoUrl` + 2 colors, no dark/light split. `Settings.companyProfile.companyLogo` duplicate source.
- No upload endpoint for branding; `apiFetch` forces JSON.

Goal: Single source of truth `BrandingConfig`, two logo variants connected, auto gradient, global sync.

## 2. Data Model

**File:** `apps/api/prisma/schema.prisma:136`

```prisma
model BrandingConfig {
  id             String   @id @default(cuid())
  logoUrl        String?  // legacy, keep for fallback
  logoDarkUrl    String?  // black version — shown on light background
  logoLightUrl   String?  // white version — shown on dark/sidebar
  appName        String?  @default("Zoolyum OS")
  primaryColor   String?  // hex e.g. #7C3AED
  secondaryColor String?  // hex e.g. #38BDF8
  invoiceNumberingFormat String @default("ZLM-{year}-{seq}")
  updatedAt      DateTime @updatedAt
}
```

Migration: `npx prisma migrate dev --name branding_dual_logo`. Keep `logoUrl` fallback: read `logoDarkUrl ?? logoUrl`. Seed fallback to `Sparkles` if null.

`Settings.companyProfile.companyLogo` remains but is treated as derived — `control.service.ts` `getSettings` will merge `BrandingConfig.logoDarkUrl` into response for backward compat.

## 3. API

**Files:** `apps/api/src/control/control.service.ts`, `control.controller.ts`, `apps/api/src/control/branding-uploads/`

- `GET /control/branding` — returns BrandingConfig (cached `control:branding`, invalidate on PATCH/UPLOAD).
- `PATCH /control/branding` — body `{ appName?, logoDarkUrl?, logoLightUrl?, primaryColor?, secondaryColor? }` validated with `class-validator` (`@IsHexColor`, `@IsUrl`, `@IsOptional`). Merges into single row via `findFirst` → `update` or `create`. Clears `control:branding` cache.
- `POST /control/branding/upload` — `FileInterceptor('file', { storage: diskStorage({ destination: 'uploads/branding', filename: uuid+ext }), limits: { fileSize: 5*1024*1024 }, fileFilter: (req,file,cb)=> ['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.mimetype) ? cb(null,true) : cb(new BadRequestException('Only image'),false) })`. Returns `{ url: '/api/control/branding/uploads/<filename>' }`. Reuses `pulse.controller.ts:222` pattern.
- `GET /control/branding/uploads/:filename` — `@Public()` `sendFile` with `filename.replace(/[^a-zA-Z0-9.\-_]/g,'')`, serve from `uploads/branding`. Old file deleted on new upload for same variant (service tracks previous URL).
- `main.ts` no change; `ControlModule` imports `MulterModule` implicitly via interceptor.

Auth: `JwtAuthGuard` + `RolesGuard` — `PATCH`/`POST` require `CONTROL` permission (existing `control.controller.ts` guard pattern).

## 4. Frontend — Branding Provider & Theme Sync

**New file:** `apps/web/src/lib/branding-context.tsx`

- `BrandingContext` with `branding: BrandingConfig | null`, `refresh()`.
- `useQuery(['branding','/control/branding'], ()=>apiFetch(...))` at `AppShell` mount.
- `useEffect` injects CSS variables:

```ts
if (branding?.primaryColor) document.documentElement.style.setProperty('--primary', branding.primaryColor);
if (branding?.secondaryColor) document.documentElement.style.setProperty('--secondary', branding.secondaryColor);
if (branding?.primaryColor && branding?.secondaryColor) {
  document.documentElement.style.setProperty('--brand-gradient', `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`);
  document.documentElement.style.setProperty('--brand-gradient-soft', `linear-gradient(135deg, ${primaryColor}14, ${secondaryColor}14)`);
  // bg-mesh radials with alpha
}
```

- `globals.css:88` `.bg-brand-gradient` changed to `background: var(--brand-gradient, linear-gradient(...))` fallback to current OKLCH.

**Helper:** `apps/web/src/lib/api.ts` add `apiFetchFormData(url, formData)` without `Content-Type` header (reuse pulse upload fetch pattern).

**Logo component:** `apps/web/src/components/brand-logo.tsx` (new) — `<BrandLogo variant="dark|light" height={32} />` picks `logoDarkUrl` for light BG, `logoLightUrl` for dark sidebar (`document.documentElement.classList.contains('dark')` or `useTheme`). Fallback to `Sparkles` if null.

## 5. Settings UI

**File:** `apps/web/src/app/(app)/control/page.tsx`

- `SECTIONS` add `branding: { label: 'Branding', icon: Palette }`.
- New `BrandingSection`:
  - `appName` Input
  - Two upload cards side-by-side: **Dark Logo (black, for light BG)** + **Light Logo (white, for dark BG)** — drag-drop area, preview `<img>` with checkerboard bg, file input hidden, 5MB limit, client mime check, `apiFetchFormData` → `POST /control/branding/upload` → set `logoDarkUrl`/`logoLightUrl` state.
  - Two `ColorInput` (reuse `control/page.tsx:132` component) for `primaryColor`/`secondaryColor` with auto-suggest button: create hidden `canvas`, draw uploaded logo image, `getImageData` sampling dominant color (skip transparent/white), suggest as primary, secondary = lighten/darken 20%. Manual override always allowed.
  - Gradient preview bar `height 48 rounded-xl` with `background: linear-gradient(135deg, primary, secondary)`.
  - Save button → `PATCH /control/branding` with all fields, `notify('Branding updated')`, `qc.invalidateQueries(['branding'])`.

## 6. Consumers

- `sidebar.tsx:64` — replace `Sparkles` block with `<BrandLogo />` + `bg` uses `var(--brand-gradient)` via inline style or `bg-brand-gradient` (now variable). Text `Zoolyum OS` replaced with `branding.appName ?? 'Zoolyum OS'`.
- `app-shell.tsx:30` — `bg-mesh` now dynamic via variables, no code change needed after provider injection.
- `login/page.tsx:47`, `portal-login/page.tsx:63`, `page.tsx:57` — same `BrandLogo` header.
- `globals.css:96,119` — gradients read variables, fallback to existing OKLCH.

## 7. PDF Integration

**File:** `apps/web/src/lib/invoice-pdf.ts:36`

- Change `buildInvoicePdf(invoice, branding?)` signature: `branding?: { primaryColor?: string; logoDarkUrl?: string; appName?: string }`.
- Parse `primaryColor` hex → RGB for `ACCENT`, replace hard-coded `[124,58,237]`.
- If `logoDarkUrl` present, fetch image (via `fetch` → blob → base64), `doc.addImage(logoBase64, ...)` at header left, else fallback text `appName`.
- `people/payslip/[id]/page.tsx`, `portal-client/page.tsx`, `flow` project onboarding PDF call sites pass `branding` from context/query.

Backend `people/payroll.service.ts:23` already fetches `brandingConfig.findFirst()` — keep, ensure it returns new fields.

## 8. Validation, Errors, Edge Cases

- Upload: reject >5MB, non-image, log `SystemAuditLog`. Old file deleted only after new upload succeeds.
- Colors: regex `^#[0-9A-Fa-f]{6}$`, normalize to uppercase.
- Both logos optional — if only one uploaded, other reuses same URL (or fallback icon).
- Cache invalidation: `control:branding` + `control:settings` on write.
- No breaking change: existing `logoUrl` still served.

## 9. Migration & Rollback

- Migration is additive nullable columns — rollback is `prisma migrate` down or keep columns. No data loss.
- Feature flag: if `BrandingConfig` fetch fails, provider returns null and UI falls back to static gradient/icon.

## 10. Testing

- `npx tsc --noEmit` (web), `npm run build` (api)
- Manual: upload dark+light png/svg in Branding section → preview both → auto-suggest → manual pick → Save → check Sidebar logo switches with theme toggle, `bg-mesh` gradient matches, hard refresh persists.
- PDF: create invoice → download → verify header logo/color.
- Playwright: `control-branding.spec.ts` upload + color change + sidebar assertion.
- RBAC: non-Control role cannot PATCH/UPLOAD (403).

## 11. Files Touched

- `apps/api/prisma/schema.prisma`, `seed.ts`
- `apps/api/src/control/control.service.ts`, `control.controller.ts`
- `apps/web/src/lib/api.ts`, `lib/branding-context.tsx`, `components/brand-logo.tsx`
- `apps/web/src/app/globals.css`, `components/sidebar.tsx`, `components/app-shell.tsx`, `app/(app)/control/page.tsx`, `lib/invoice-pdf.ts`, `app/login/page.tsx` etc.
- `docs/superpowers/specs/2026-08-24-branding-logo-gradient-design.md` (this file)
