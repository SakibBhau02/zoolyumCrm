# Task 6 Report — PDF Integration

**Plan:** `docs/superpowers/plans/2026-08-24-branding-logo-gradient.md` Task 6
**Spec:** Section 7 PDF (`docs/superpowers/specs/2026-08-24-branding-logo-gradient-design.md`)

## Summary
Implemented branding-aware PDF generation: `buildInvoicePdf(invoice, branding)` now uses dynamic ACCENT (primaryColor hex→RGB) and appName text logo with fallback, plus `buildInvoicePdfAsync` for remote logo image fetch via `fetch → arrayBuffer → base64 → doc.addImage` with graceful fallback to text.

## Files Modified
- `apps/web/src/lib/invoice-pdf.ts:1-308` — Added `InvoiceBranding` type, `hexToRgb`, `resolveAccent`/`resolveAppName`, updated `buildInvoicePdf(inv, branding?)` to use `accent` and `appName` (uppercase), added sync logo handling for `logoBase64` or `data:` URL (`addImage` with format detection), updated footer to use branded appName, added `buildInvoicePdfAsync` with `fetch` + header check + `arrayBufferToBase64` + `detectImageFormat`, fallback to text if fetch fails. Backwards compatible (branding optional).
- `apps/web/src/app/(app)/capital/page.tsx:1-10,482-532` — Import `useBranding` + `buildInvoicePdfAsync`, added `const { branding } = useBranding()` in `InvoiceDrawer`, rewrote `doPdf` to build `pdfBranding` from context and await `buildInvoicePdfAsync` when `logoDarkUrl` present, else sync `buildInvoicePdf`.
- `apps/web/src/app/portal-client/page.tsx:28-30,367-391` — Import `buildInvoicePdfAsync`, rewrote `doInvoicePdf` to fetch branding via `pfetch("/portal-client/branding")` (best-effort, catch to null) and use async path when logo present.
- `apps/web/src/app/(app)/people/payroll/payslip/[id]/page.tsx:1-13,23-67` — Import `useBranding`, derive `payslipBranding = data.company?.branding ?? contextBranding`, render `brandingLogo` (`logoDarkUrl ?? logoUrl`) as `<img>` when present else fallback `Building2` icon, use `brandingAppName` for header text. Handles payroll.service branding payload.
- `apps/api/src/people/payroll.service.ts:17-24` — No change needed; `prisma.brandingConfig.findFirst()` already returns all fields (`logoDarkUrl`, `logoLightUrl`, `appName`, `primaryColor`, `secondaryColor`) since no select filter. Verified.

## Files Not Modified (Reason)
- `apps/web/src/app/(app)/people/payslip/[id]/page.tsx` — redirect stub; no PDF call site. Task requirement covered via payroll payslip page.
- `apps/api/src/people/payroll.service.ts` — already returns new fields.

## Key Decisions
- Keep `buildInvoicePdf` synchronous for backwards compatibility (capital & portal previously called sync). Added `buildInvoicePdfAsync` for remote URL fetch path — this avoids breaking existing callers that ignore Promise.
- Sync path handles `logoBase64` or `data:` URL immediately via `addImage`; async path fetches remote `logoDarkUrl`, converts to `data:mime;base64`, then delegates to sync. On any error (network, bad image, CORS) fallback to text logo per Global Constraints.
- `hexToRgb` validates `^#[0-9A-Fa-f]{6}$`, trims, returns null on invalid → fallback to OKLCH-equivalent `ACCENT [124,58,237]`.
- Portal-client branding fetch is best-effort (`catch => null`) since portal API may not expose `/portal-client/branding`; falls back to no-branding PDF rather than failing.
- Payslip branding uses API payload `data.company.branding` (server source of truth) with `useBranding` context as fallback for consistency.

## Verification
- `npx tsc --noEmit` in `apps/web` → PASS (no output)
- `npx tsc --noEmit` in `apps/api` → PASS
- Manual Node verification (`node --experimental-strip-types`):
  - `hexToRgb('#FF0000') === [255,0,0]` PASS
  - `hexToRgb('#7C3AED') === [124,58,237]` PASS
  - `hexToRgb('bad') === null` fallback PASS
  - `buildInvoicePdf(mockInvoice, {primaryColor:'#FF0000', appName:'TestCo'})` → raw PDF contains `TESTCO` PASS, default `ZOOLYUM` PASS
  - `buildInvoicePdf` with tiny `data:` PNG logo → contains `LOGOCO` and no crash PASS
  - `buildInvoicePdfAsync` with nonexistent remote URL → fallback to `FALLBACKCO` PASS, no crash
- `git status` shows modified files staged for commit.

## How to Test Manually
1. `npm run dev` web + api.
2. Settings → Control → Branding: upload dark logo, set primaryColor `#FF0000`, save.
3. Capital → open invoice → Download PDF → header shows `Test appName` in red accent and logo image at `16,14`.
4. Disconnect logo URL (invalid) → PDF still shows text logo with red accent (fallback).
5. Remove primaryColor (clear DB) → PDF shows default violet `124,58,237` OKLCH fallback.
6. People → Payroll → Payslip → header shows branding logo/appName.

## Risks / Follow-ups
- Portal `/portal-client/branding` endpoint not yet implemented — currently best-effort fetch, will gracefully fallback. If desired, add `GET /portal-client/branding` in API to expose `BrandingConfig` to portal users.
- `addImage` with SVG may not render in all jsPDF versions (SVG support limited) — fallback to text works, but PNG/JPEG preferred.
- Logo sizing `36x10mm` fixed; for very wide logos may need aspect ratio calc (deferred).
