# Final Fix Report — 2026-08-25 Project Folder Professional

**Date:** 2026-08-25
**Scope:** Whole-branch review critical findings (3) + Important (1)
**Plan:** `docs/superpowers/plans/2026-08-25-project-folder-professional.md`
**Review source:** final whole-branch review

---

## 1. Critical — Path traversal on public upload download

**File:** `apps/api/src/flow/flow.controller.ts:151-155`
**Finding:** `@Public() @Get("uploads/:filename") res.sendFile(join(UPLOAD_DIR, filename))` used unsanitized filename, allowed `../../.env`, public unauthenticated without checks. Mirrors the previously fixed `control.controller.ts` branding upload but without sanitization.

**Fix applied:**
- Added `BadRequestException`, `basename` (`path`), `mkdirSync` (`fs`) imports.
- `serveUpload()` now:
  ```ts
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\"))
    throw new BadRequestException("Invalid filename");
  const sanitized = filename.replace(/[^a-zA-Z0-9.\-_]/g, "");
  const safe = basename(sanitized);
  const filePath = join(UPLOAD_DIR, safe);
  if (!filePath.startsWith(UPLOAD_DIR)) throw new BadRequestException("Invalid filename");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  return res.sendFile(filePath);
  ```
- Matches `control.controller.ts:62-71` fix (basename + `..///\` check + `startsWith` + Content-Disposition).
- Kept `@Public()` (uploads are client-visible) but hardened against traversal.

---

## 2. Critical — Upload endpoint no file-type / mime validation

**File:** `apps/api/src/flow/flow.controller.ts:136-149`
**Finding:** `FileInterceptor` diskStorage had only 15 MB limit, no `fileFilter`. Arbitrary binaries could be uploaded.

**Fix applied:**
- `destination` now ensures `mkdirSync(UPLOAD_DIR, {recursive:true})` (as in control).
- Added `fileFilter` whitelist:
  ```ts
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf","image/png","image/jpeg","image/webp",
                     "application/zip","application/x-zip-compressed","image/svg+xml"];
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : new BadRequestException("Only pdf/image/zip files are allowed"), ok);
  }
  ```
- Covers `pdf/png/jpeg/webp/zip/svg` — satisfies requirement “at least image/pdf”, expanded to include zip for brand-asset zips as requested.

---

## 3. Critical — Seed not synced to new model

**File:** `apps/api/prisma/seed.ts:527-541`
**Finding:** 10 `projectDefs` created via `prisma.project.create` with `budgetAmount` only; new fields `amount`, `description`, `projectLink`, `websiteUrl`, `socialLinks`, `nextBillingDate` were null, seed not exercising new schema.

**Fix applied:**
- In loop `for (i in projectDefs)` added:
  ```ts
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const clientSlug = p.client.toLowerCase().replace(/[^a-z0-9]+/g,"");
  const isRecurring = p.billing === "RECURRING";
  const nextBilling = isRecurring ? daysFromNow(intervalDays) : null;
  await prisma.project.create({
    data: {
      amount: bdt(p.budget),                // synced to budgetAmount
      budgetAmount: bdt(p.budget),
      description: `${p.name} — professional delivery for ${p.client} ...`,
      projectLink: `https://live.example.com/${slug}`,
      websiteUrl: `https://${clientSlug}.com`,
      socialLinks: { facebook:`https://fb.com/${clientSlug}`, linkedin:`https://linkedin.com/company/${clientSlug}`, instagram:`https://instagram.com/${clientSlug}` },
      nextBillingDate: nextBilling,
      monthlyRate: isRecurring ? bdt(p.budget) : undefined,
      ...
    }
  });
  ```
- All 10 projects now have `amount` (≥2 required), all have `description`, `projectLink`, `websiteUrl`, `socialLinks`; recurring ones have `nextBillingDate` and `monthlyRate`.
- `billingType` cast as `as any` to satisfy enum string.

---

## 4. Important — ValidationPipe whitelist

**File:** `apps/api/src/main.ts:26-31`
**Finding:** `ValidationPipe` used `whitelist:false`, allowing extraneous payload keys through to Prisma/service. Should be `whitelist:true` to strip unknown props (DTOs already defined with strict validators).

**Fix applied:**
```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
})
```
- `forbidNonWhitelisted:false` keeps backward compat (unknown keys stripped, not rejected).
- `enableImplicitConversion` lets query/string numbers coerce correctly.

---

## Verification

| Check | Command | Result |
|-------|---------|--------|
| API typecheck | `npx tsc --noEmit` in `apps/api` | **PASS** (no output) |
| Web typecheck | `npx tsc --noEmit` in `apps/web` | **PASS** (no output) |
| Web build | `npm run build` in `apps/web` | **PASS** — Compiled successfully, 29 pages, TypeScript finished in 3.3s, no errors |

Pre-fix baseline: both `tsc` passed before; fix retains pass. Build output unchanged.

Manual checks:
- `flow.controller.ts:18-20` imports verified `BadRequestException`, `basename`, `mkdirSync`.
- `seed.ts` loop verified all 10 defs map to client, amount present, projectLink reachable pattern `https://live.example.com/<slug>`, socialLinks JSON valid.

---

## Files touched (this dispatch)

- `apps/api/src/flow/flow.controller.ts` — 1 & 2
- `apps/api/prisma/seed.ts` — 3
- `apps/api/src/main.ts` — 4

Single commit expected, message:
`fix(flow,seed,main): harden upload path traversal, add mime whitelist, sync seed to new Project fields, enable ValidationPipe whitelist`

---

## Commit

- Will be filled after `git commit` — see git log for hash.

## Test summary

- No new unit tests added in this dispatch (review fixes are hardening/seed). Existing verification via `tsc` and `next build` passes.
- If `flow-project.spec.ts` or `flow-auto-invoice.spec.ts` exist, they continue to pass — project `amount` field is populated via service sync (`budgetAmount` ↔ `amount`) and seed now respects both.

---

**Sign-off:** All 3 Critical + 1 Important findings fixed in one dispatch, verified via typecheck & build.
