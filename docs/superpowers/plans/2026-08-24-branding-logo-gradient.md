# Branding Logo Gradient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable logo (dark/light variants) upload from Settings, auto-suggest gradient from logo color with manual override, and apply branding globally (sidebar, bg-mesh, buttons, PDF) with black/white support.

**Architecture:** Extend `BrandingConfig` with dual logo URLs, add `POST /control/branding/upload` (multer diskStorage) and `GET` serve, create `BrandingContext` that fetches branding and injects CSS variables (`--primary`, `--brand-gradient`) into `document.documentElement`, update consumers to use dynamic logo/gradient with fallback.

**Tech Stack:** Next.js 16 (App Router, Tailwind v4), NestJS 11, Prisma PostgreSQL, multer, Framer Motion (existing), canvas API for color extraction

**Spec:** `docs/superpowers/specs/2026-08-24-branding-logo-gradient-design.md`

## Global Constraints

- Prisma migration must be additive nullable columns, no data loss, keep `logoUrl` for fallback.
- Upload limit 5MB, mime only `image/png, image/jpeg, image/webp, image/svg+xml`, store under `uploads/branding`.
- `apiFetch` default is JSON — upload must use `apiFetchFormData` without Content-Type header.
- Dark/light variants: `logoDarkUrl` shown on light background, `logoLightUrl` shown on dark/sidebar — both optional, fallback to `Sparkles` icon.
- CSS variables must have fallback OKLCH gradients in `globals.css` if branding fetch fails.
- PDF must fallback to text logo if image fetch fails.

---

## File Structure

- Modify: `apps/api/prisma/schema.prisma:136-143` — add `logoDarkUrl`, `logoLightUrl`, `appName`
- Modify: `apps/api/prisma/seed.ts:892` — seed new fields
- Modify: `apps/api/src/control/control.service.ts:116-176` — branding logic, cache invalidation, old file cleanup
- Modify: `apps/api/src/control/control.controller.ts:19-27` — add upload + serve endpoints, validation
- Create: `apps/web/src/lib/branding-context.tsx` — BrandingContext, provider, CSS injection
- Modify: `apps/web/src/lib/api.ts:16` — add `apiFetchFormData`
- Create: `apps/web/src/components/brand-logo.tsx` — variant-aware logo component
- Modify: `apps/web/src/app/globals.css:88,119` — make gradients use CSS variables with fallback
- Modify: `apps/web/src/components/sidebar.tsx:62` — use BrandLogo + dynamic gradient
- Modify: `apps/web/src/components/app-shell.tsx:1` — wrap with BrandingProvider or fetch there
- Modify: `apps/web/src/app/(app)/control/page.tsx:22,215` — add BrandingSection with dual upload + color pickers + preview
- Modify: `apps/web/src/lib/invoice-pdf.ts:36` — accept branding param, hex→RGB, addImage
- Modify: `apps/web/src/app/login/page.tsx:47`, `portal-login/page.tsx:63`, `page.tsx:57` — use BrandLogo
- Test: `apps/api/test/control-branding.spec.ts`, `apps/web/e2e/control-branding.spec.ts`

---

### Task 1: Prisma Data Model Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:136-143`
- Modify: `apps/api/prisma/seed.ts:892-893`

**Interfaces:**
- Consumes: existing BrandingConfig model
- Produces: `logoDarkUrl: string | null`, `logoLightUrl: string | null`, `appName: string | null` fields available for API

- [ ] **Step 1: Write failing test — migration should add columns**

```bash
npx prisma validate
# expected: error if schema invalid
```

- [ ] **Step 2: Run to verify schema valid**

Run: `npx prisma validate` in `apps/api`
Expected: PASS after edit

- [ ] **Step 3: Modify schema.prisma**

```prisma
model BrandingConfig {
  id             String   @id @default(cuid())
  logoUrl        String?
  logoDarkUrl    String?
  logoLightUrl   String?
  appName        String?  @default("Zoolyum OS")
  primaryColor   String?
  secondaryColor String?
  invoiceNumberingFormat String @default("ZLM-{year}-{seq}")
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 4: Create and run migration**

Run: `npx prisma migrate dev --name branding_dual_logo` in `apps/api`
Expected: migration file created, DB updated

- [ ] **Step 5: Update seed.ts**

```ts
branding: {
  logoDarkUrl: "/brand/zoolyum-logo-dark.svg",
  logoLightUrl: "/brand/zoolyum-logo-light.svg",
  appName: "Zoolyum OS",
  primaryColor: "#7C3AED",
  secondaryColor: "#38BDF8",
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/seed.ts apps/api/prisma/migrations/*
git commit -m "feat(branding): add dual logo and appName to BrandingConfig"
```

### Task 2: Control API — Upload & Branding Endpoints

**Files:**
- Modify: `apps/api/src/control/control.service.ts:1-134`
- Modify: `apps/api/src/control/control.controller.ts:1-107`
- Test: `apps/api/test/control-branding.spec.ts`

**Interfaces:**
- Consumes: BrandingConfig model from Task 1
- Produces: `POST /api/control/branding/upload -> { url: string }`, `GET /api/control/branding/uploads/:filename`, `PATCH /api/control/branding` with validation

- [ ] **Step 1: Write failing test for upload endpoint**

```ts
// apps/api/test/control-branding.spec.ts
import request from 'supertest';
describe('POST /control/branding/upload', () => {
  it('should reject non-image', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/control/branding/upload')
      .attach('file', Buffer.from('not image'), 'test.txt');
    expect(res.status).toBe(400);
  });
  it('should accept png and return url', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/control/branding/upload')
      .attach('file', Buffer.from([0x89,0x50,0x4E,0x47]), 'test.png');
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/\/api\/control\/branding\/uploads\//);
  });
});
```

- [ ] **Step 2: Run test to verify fail (endpoint not exists -> 404)**

Run: `npm test -- control-branding.spec.ts` in `apps/api`
Expected: FAIL 404

- [ ] **Step 3: Implement service changes**

In `control.service.ts`:
```ts
async getBranding() { return this.prisma.brandingConfig.findFirst(); }
async updateBranding(dto: { appName?, logoDarkUrl?, logoLightUrl?, primaryColor?, secondaryColor? }) {
  const existing = await this.prisma.brandingConfig.findFirst();
  if (existing) return this.prisma.brandingConfig.update({ where: { id: existing.id }, data: dto });
  return this.prisma.brandingConfig.create({ data: dto });
}
// add cleanup for old file if url changed
```

- [ ] **Step 4: Implement controller upload**

In `control.controller.ts`:
```ts
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { join } from 'path';

const BRANDING_UPLOADS_DIR = join(process.cwd(), 'uploads/branding');

@Post('branding/upload')
@UseInterceptors(FileInterceptor('file', {
  storage: diskStorage({
    destination: (req,file,cb)=>{ require('fs').mkdirSync(BRANDING_UPLOADS_DIR,{recursive:true}); cb(null,BRANDING_UPLOADS_DIR); },
    filename: (req,file,cb)=> cb(null, `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g,'')}`)
  }),
  limits: { fileSize: 5*1024*1024 },
  fileFilter: (req,file,cb)=> { const ok=['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.mimetype); cb(ok?null:new BadRequestException('Only image'): null, ok); }
}))
async uploadBrandingLogo(@UploadedFile() file: Express.Multer.File) {
  return { url: `/api/control/branding/uploads/${file.filename}` };
}

@Get('branding/uploads/:filename')
@Public()
serveBrandingFile(@Param('filename') filename: string, @Res() res) {
  const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g,'');
  return res.sendFile(join(BRANDING_UPLOADS_DIR, safe));
}
```

Add validation DTO for PATCH: `class UpdateBrandingDto { @IsOptional() @IsString() appName?; @IsOptional() @IsUrl() logoDarkUrl?; @IsOptional() @IsUrl() logoLightUrl?; @IsOptional() @IsHexColor() primaryColor?; @IsOptional() @IsHexColor() secondaryColor?; }`

- [ ] **Step 5: Run test to verify pass**

Run: `npm test -- control-branding.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/control/* apps/api/test/control-branding.spec.ts
git commit -m "feat(api): add branding logo upload and dual variant endpoints"
```

### Task 3: BrandingContext & CSS Variable Injection

**Files:**
- Create: `apps/web/src/lib/branding-context.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `GET /control/branding` API from Task 2
- Produces: `BrandingContext { branding, refresh }`, CSS variables `--primary`, `--brand-gradient` injected, `apiFetchFormData` helper

- [ ] **Step 1: Write failing test — context provides branding**

```ts
// apps/web/src/lib/branding-context.test.tsx (or e2e)
// expect branding.primaryColor to be applied as CSS var
```

- [ ] **Step 2: Implement apiFetchFormData**

In `apps/web/src/lib/api.ts`:
```ts
export async function apiFetchFormData<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

- [ ] **Step 3: Create branding-context.tsx**

```tsx
"use client";
import { createContext, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
export const BrandingContext = createContext<any>(null);
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: ()=>apiFetch('/control/branding') });
  useEffect(()=>{
    if (branding?.primaryColor) document.documentElement.style.setProperty('--primary', branding.primaryColor);
    if (branding?.secondaryColor) document.documentElement.style.setProperty('--secondary', branding.secondaryColor);
    if (branding?.primaryColor && branding?.secondaryColor) {
      document.documentElement.style.setProperty('--brand-gradient', `linear-gradient(135deg, ${branding.primaryColor}, ${branding.secondaryColor})`);
    }
  },[branding]);
  return <BrandingContext.Provider value={{ branding }}>{children}</BrandingContext.Provider>;
}
export const useBranding = ()=> useContext(BrandingContext);
```

- [ ] **Step 4: Update globals.css**

Change `.bg-brand-gradient` to `background: var(--brand-gradient, linear-gradient(135deg, oklch(0.56 0.23 290), oklch(0.6 0.21 310), oklch(0.62 0.16 220)))` and `.bg-mesh` radials to use `var(--primary)` with alpha fallback.

- [ ] **Step 5: Wrap AppShell**

In `apps/web/src/app/(app)/layout.tsx` wrap with `<BrandingProvider><AppShell>...</AppShell></BrandingProvider>`.

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, open `/control` → check `document.documentElement.style.getPropertyValue('--brand-gradient')` changes after branding fetch.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/branding-context.tsx apps/web/src/lib/api.ts apps/web/src/app/globals.css apps/web/src/components/app-shell.tsx
git commit -m "feat(web): add BrandingContext with CSS variable sync"
```

### Task 4: BrandingSection UI in Control

**Files:**
- Modify: `apps/web/src/app/(app)/control/page.tsx`
- Test: `apps/web/e2e/control-branding.spec.ts`

**Interfaces:**
- Consumes: BrandingContext, `POST /control/branding/upload`, `PATCH /control/branding`
- Produces: Branding settings UI with dual upload + preview + color pickers + gradient preview

- [ ] **Step 1: Write failing e2e test**

```ts
test('branding upload dark/light', async ({ page })=>{
  await page.goto('/control?section=branding');
  await expect(page.getByText('Dark Logo')).toBeVisible();
  await expect(page.getByText('Light Logo')).toBeVisible();
});
```

- [ ] **Step 2: Implement BrandingSection**

Add to `SECTIONS` array: `{ id: 'branding', label: 'Branding', icon: Palette }`.

Create component `BrandingSection` with:
- `appName` Input bound to `branding.appName`
- Two cards: Dark Logo / Light Logo — each with `<img src={preview}>` on checkerboard, `<input type="file" accept="image/*">` drag-drop, onChange → `FormData` → `apiFetchFormData('/control/branding/upload', fd)` → set `logoDarkUrl`/`logoLightUrl` state, show preview.
- Canvas auto-suggest: `const img=new Image(); img.src=preview; img.onload=()=>{ const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0); const data=ctx.getImageData(0,0,c.width,c.height).data; // sample every 10px, count dominant non-white/transparent, pick mode }` → set primaryColor, secondary = lighten 20%.
- Two `ColorInput` (reuse from line 132) for `primaryColor`/`secondaryColor`.
- Gradient preview `<div style={{background: `linear-gradient(135deg, ${primary}, ${secondary})`}} className="h-12 rounded-xl" />`.
- Save button → `apiFetch('/control/branding', {method:'PATCH', body: JSON.stringify({appName, logoDarkUrl, logoLightUrl, primaryColor, secondaryColor}) })`, `notify('Branding updated')`, `queryClient.invalidateQueries(['branding'])`.

- [ ] **Step 3: Run e2e to verify pass**

Run: `npx playwright test e2e/control-branding.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(app)/control/page.tsx apps/web/e2e/control-branding.spec.ts
git commit -m "feat(control): add BrandingSection with dual logo upload and gradient preview"
```

### Task 5: Consumer Updates (Sidebar, Login, etc.)

**Files:**
- Create: `apps/web/src/components/brand-logo.tsx`
- Modify: `apps/web/src/components/sidebar.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/portal-login/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: BrandingContext from Task 3
- Produces: Dynamic logo rendering with dark/light variant selection

- [ ] **Step 1: Create brand-logo.tsx**

```tsx
"use client";
import { useBranding } from "@/lib/branding-context";
import { Sparkles } from "lucide-react";
export function BrandLogo({ height=32 }: { height?: number }) {
  const { branding } = useBranding() ?? {};
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const src = isDark ? branding?.logoLightUrl : branding?.logoDarkUrl ?? branding?.logoUrl;
  const appName = branding?.appName ?? "Zoolyum OS";
  if (!src) return <><span className="flex size-9 items-center justify-center rounded-xl" style={{background:'var(--brand-gradient)'}}><Sparkles className="size-4.5 text-white"/></span><span>{appName}</span></>;
  return <img src={src} alt={appName} style={{height}} className="object-contain" />;
}
```

- [ ] **Step 2: Update sidebar.tsx:62**

Replace hard-coded `Sparkles` block with `<BrandLogo />` and change `bg-brand-gradient` div to `style={{background:'var(--brand-gradient)'}}`. Display `appName`.

- [ ] **Step 3: Update login/portal pages similarly**

Replace `bg-brand-gradient` + `Sparkles` header with `<BrandLogo height={36} />`.

- [ ] **Step 4: Manual verification**

Toggle dark/light in topbar → check logo switches (white on dark sidebar, black on light).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/brand-logo.tsx apps/web/src/components/sidebar.tsx apps/web/src/app/login/page.tsx
git commit -m "feat(brand): dynamic logo with dark/light variants"
```

### Task 6: PDF Integration

**Files:**
- Modify: `apps/web/src/lib/invoice-pdf.ts`
- Modify: `apps/web/src/app/(app)/people/payslip/[id]/page.tsx`
- Modify: `apps/api/src/people/payroll.service.ts` (ensure new fields returned)

**Interfaces:**
- Consumes: branding from context/API
- Produces: `buildInvoicePdf(invoice, branding)` with dynamic ACCENT and logo image

- [ ] **Step 1: Write failing test — PDF uses branding color**

```ts
const pdf = buildInvoicePdf(mockInvoice, { primaryColor: '#FF0000', logoDarkUrl: '...' });
expect(pdf).toContain('FF0000'); // check ACCENT override
```

- [ ] **Step 2: Implement invoice-pdf.ts**

```ts
export function buildInvoicePdf(invoice: Invoice, branding?: { primaryColor?: string; logoDarkUrl?: string; appName?: string }) {
  const accent = branding?.primaryColor ? hexToRgb(branding.primaryColor) : [124,58,237];
  // use accent for header, gradient
  if (branding?.logoDarkUrl) {
    try { const img = await fetch(logoDarkUrl).then(r=>r.arrayBuffer()); doc.addImage(img, 'PNG', 10,10,40,12); } catch { doc.text(branding.appName ?? 'Zoolyum', 10,10); }
  }
}
function hexToRgb(hex: string): [number,number,number] { const n=parseInt(hex.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
```

- [ ] **Step 3: Update call sites to pass branding**

In `payslip/[id]/page.tsx` and `capital` invoice download, get `branding` via `useBranding` or `GET /control/branding` and pass to `buildInvoicePdf`.

- [ ] **Step 4: Verify PDF download shows logo/color**

Manual: create invoice → download → check header.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/invoice-pdf.ts apps/web/src/app/(app)/people/payslip/[id]/page.tsx
git commit -m "feat(pdf): use branding color and logo in invoice pdf"
```

### Task 7: Final Verification & Cleanup

**Files:**
- Test: `npx tsc --noEmit` (web), `npm run build` (api)

- [ ] **Step 1: Run web typecheck**

Run: `npx tsc --noEmit` in `apps/web`
Expected: no error

- [ ] **Step 2: Run api build**

Run: `npm run build` in `apps/api`
Expected: no error

- [ ] **Step 3: Run e2e**

Run: `npx playwright test e2e/control-branding.spec.ts e2e/pulse.spec.ts`
Expected: all pass

- [ ] **Step 4: Manual smoke — Settings branding flow**

Upload dark PNG → upload light PNG → auto-suggest → manual pick → Save → toggle theme → verify sidebar logo + mesh gradient + button gradients + PDF.

- [ ] **Step 5: Commit docs**

```bash
git add docs/superpowers/plans/2026-08-24-branding-logo-gradient.md
git commit -m "docs: add branding implementation plan"
```

