# Zoolyum OS — Design System

> Single reference for typography, icons, colour, surfaces, motion and the component
> primitives every internal module builds on. If a screen looks different from its
> siblings, the cause is almost always a value that did not come from this page.

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · lucide-react · Recharts 3 · Framer Motion 12

---

## 1. Typography

### 1.1 Fonts

| Role | Family | CSS variable | Notes |
|---|---|---|---|
| Body / UI | **Inter** | `--font-inter` → `--font-sans` | Everything by default |
| Headings / numbers | **Outfit** | `--font-display` → `--font-heading` | Applied automatically to `h1–h4` (see base layer) |
| Bangla + ৳ glyph | **Noto Sans Bengali** | `--font-bangla` | Fallback in `--font-sans` / `--font-heading`; renders only for Bangla code points and the taka sign |
| Mono | **Geist Mono** | `--font-geist-mono` → `--font-mono` | Invoice numbers, tokens, URLs |

Fonts are loaded in `apps/web/src/app/layout.tsx`; the `--font-*` tokens live in the
`@theme inline` block of `globals.css`.

### 1.2 The type scale (source of truth)

Defined once in `apps/web/src/app/globals.css` inside `@theme`, emitted to `:root`,
consumed as Tailwind utilities (`text-body`, `text-meta`, …).

| Utility | px | Line-height | Used for |
|---|---|---|---|
| `text-micro` | 10.5 | 1.4 | Badges, uppercase labels, chip text, micro captions |
| `text-meta` | 11.5 | 1.45 | Secondary/muted text, hints, timestamps, table meta |
| `text-body` | **12.5** | 1.5 | **Default reading size** — table cells, paragraphs, form values |
| `text-body-lg` | 13 | 1.45 | Bold values, names, modal body, primary buttons |
| `text-section` | 15 | 1.4 | Section + card headings (`SectionTitle`, card titles) |
| `text-title` | 17 | 1.3 | Modal titles, record/detail titles, compact module headers |
| `text-stat` | 22 | 1.15 | KPI numbers (`StatCard`) |
| `text-page` | 24 | 1.2 | Page titles (`PageHeader`) |
| `text-stat-lg` | 28 | 1.05 | Hero KPI number (one per page at most) |
| `text-hero` | 30 | 1.15 | Hero/banner headline (Dashboard welcome) |
| `text-display` | 42 | 1 | 404 / oversized display numerals |

**Rules**

1. Never write `text-[<number>px]`. If a size is genuinely missing, add a step to
   `@theme` — that is the only place sizes are allowed to be invented.
2. Never use named Tailwind sizes (`text-sm`, `text-lg`, `text-xl`, `text-2xl`) in
   internal modules. They are browser/rem dependent and were the reason Pulse rendered
   body copy at 14px while Accounts rendered its table at 10px.
3. `body` is set to `var(--text-body)`, so unstyled text is already correct.
4. Numbers that align in columns (KPIs, money, counts, durations) get `tabular-nums`.
5. `h1–h4` inherit `--font-heading` + `font-weight: 600` + `letter-spacing: -0.01em`
   from the base layer. Do not re-apply `font-heading` by hand.

### 1.3 Where each step is expected to appear

| Element | Size |
|---|---|
| Page title | `text-page` (People: `text-title` — deliberately slim layout, see `people/layout.tsx`) |
| Page subtitle | `text-body` + `text-muted-foreground` |
| Section/card heading | `text-section` |
| Card subtitle / hint | `text-meta` |
| Table header | `text-micro` uppercase, `tracking-wide`, muted |
| Table cell | `text-body`; first column (name/id) `text-body-lg font-semibold` |
| Input / select / textarea value | `text-body-lg` |
| Field label | `text-meta font-semibold` |
| Badge / status chip | `text-micro font-bold` |
| Button | `text-body-lg font-semibold` (large) / `text-meta` (small) |
| Stat label | `text-micro uppercase tracking-wide muted` |
| Stat value | `text-stat` (hero: `text-stat-lg`) |
| Modal title | `text-title` |
| Chart axis tick | 11.5 (inline `fontSize`) |
| Chart tooltip | 12.5 (inline `fontSize`) |

Chart sizes are raw numbers inside `components/charts.tsx` because Recharts takes
numbers, not classes — keep them in sync with `meta`/`body` manually.

---

## 2. Icons

`lucide-react`, always sized with an explicit utility class. **Four sizes only:**

| Class | px | Tier | Examples |
|---|---|---|---|
| `size-3` | 12 | Badge / micro | Inline glyphs inside `text-micro` chips and badges |
| `size-3.5` | 14 | Inline action | **Default** — table row actions, buttons, breadcrumbs, meta rows |
| `size-4` | 16 | Tile / nav / modal | Sidebar nav, tab headers, icon chips (`size-8/9/10` wrapper), stat cards, modal close |
| `size-5` | 20 | Hero / empty state | Empty-state hero glyph, oversized banner icons |

**How to choose:** if the icon sits in a fixed wrapper, wrapper ≥ 32px → `size-4`,
wrapper ≥ 24px → `size-3.5`. Otherwise `icon={<…/>}` props and first-child positions
→ `size-4`; inline text/accompanying actions → `size-3.5`; inside a `text-micro`
badge → `size-3`.

Rules:
- Never leave an icon without a size class, and never use `w-*`/`h-*` or inline width.
- No `strokeWidth` overrides — lucide's default (2) is the house weight.
- Do not use emoji as icons (`⚑ ⚠ 📅 ✓ ↗`). Use `Flag`, `AlertTriangle`,
  `CalendarDays`, `Check`, `ArrowUpRight`. Emoji are fine only where they *are* the
  content (e.g. the reaction picker in Tasks) or inside prose.

---

## 3. Colour

OKLCH, all tokens in `globals.css`.

| Token | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.985 0.004 285)` | `oklch(0.18 0.02 285)` |
| `--foreground` | `oklch(0.22 0.03 285)` | `oklch(0.94 0.01 285)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.22 0.025 285)` |
| `--primary` | `oklch(0.52 0.22 290)` | `oklch(0.68 0.18 290)` |
| `--secondary` | `oklch(0.62 0.14 220)` | `oklch(0.68 0.12 220)` |
| `--muted` | `oklch(0.955 0.01 285)` | `oklch(0.26 0.02 285)` |
| `--muted-foreground` | `oklch(0.52 0.03 285)` | `oklch(0.7 0.02 285)` |
| `--border` | `oklch(0.91 0.012 285)` | `oklch(1 0 0 / 10%)` |
| `--sidebar` | `oklch(0.21 0.035 285)` | same (always dark) |

Chart series: `--chart-1` violet · `--chart-2` sky · `--chart-3` emerald ·
`--chart-4` amber · `--chart-5` fuchsia.

Semantic states use Tailwind hues, not new tokens:
success `emerald-500`, warning `amber-500`, danger `rose-500`, info `sky-500`,
each as `bg-*-500/10` + `text-*-600 dark:text-*-400`.

Utility classes: `bg-brand-gradient` (solid `--primary`, no gradients on primary
buttons by branding decision), `bg-brand-gradient-soft`, `text-gradient`,
`bg-emerald-gradient`, `bg-mesh`.

---

## 4. Surfaces, radius, elevation

- `--radius: 0.75rem`; cards `rounded-2xl`, buttons `rounded-xl`, inputs `rounded-xl`,
  chips/pills `rounded-full`.
- Card: `border border-border/60 bg-card shadow-sm`, padding `p-4`/`p-5`.
- `.card-lift`: `translateY(-4px)` + soft primary shadow on hover (0.3s).
- `.glass`: translucent + `backdrop-blur-xl` (topbar, popovers).
- `.grid-pattern`, `.bg-mesh` for hero/background texture.

---

## 5. Motion

| Pattern | Spec |
|---|---|
| `<FadeIn>` | opacity 0→1, y 16→0, 0.5s, `cubic-bezier(0.22,1,0.36,1)` |
| Stagger | `staggerChildren: 0.08` |
| Row entrance | opacity 0→1, y 8→0, 0.35s, delay `i × 0.04` |
| Charts | Recharts `animationDuration` 1000–1200ms |
| Keyframes | `marquee` 40s, `float` 8s/12s, `shimmer` 2.5s, `pulse-glow` 4s, `pop-in` 160ms |

Respect `prefers-reduced-motion` for new keyframe animations (see `.animate-pop-in`).

---

## 6. Component primitives

| File | Exports | Notes |
|---|---|---|
| `components/shared.tsx` | `PageHeader`, `SectionTitle`, `StatCard`, `StatusBadge`, `EmptyState`, `Avatar`, `FadeIn`, `SkeletonBlock`, `cn` | `PageHeader` = `text-page` title + `text-body` subtitle + action cluster |
| `components/table.tsx` | `TableShell`, `THead`, `Th`, `Td`, `Tr`, `Btn` | Header `text-micro` uppercase; cells `text-body` |
| `components/ui.tsx` | `Modal`, `Field`, `FieldLabel`, `ChipGroup`, `FormActions`, `inputCls` | Modal title `text-title`; field labels `text-meta` |
| `components/charts.tsx` | `SourceBarChart`, `StageBarChart`, others | Shared `tooltipStyle`, `gridStyle` |
| `components/sidebar.tsx` | Module nav | Dark rail, `text-micro` section labels, `size-4` icons |
| `components/topbar.tsx` | Sticky bar | `text-meta` chips, `size-3.5` icon buttons |
| `components/app-shell.tsx` | Auth-gated shell | |
| `components/brand-logo.tsx` | Logo mark | |

Module-specific kit lives under `components/<module>/` and
`app/(app)/<module>/_components/`.

---

## 7. Module map (internal app)

Sidebar order, all under `app/(app)/`:

| Module | Route | Group |
|---|---|---|
| Dashboard | `/dashboard` | Overview |
| Pulse | `/pulse` | Business — CRM |
| Accounts | `/accounts` | Business — Clients |
| Flow | `/flow` | Business — Projects |
| Tasks | `/tasks` | Business |
| People | `/people/*` | Operations — HRM |
| Capital | `/capital/*` | Operations — Finance |
| Insight | `/insight` | Operations — Reports |
| Calendar | `/calendar` | Operations |
| Portal (internal preview) | `/portal` | Operations — Client |
| Control | `/control/*` | System — Admin |
| Notifications | `/notifications` | System |

**Out of scope for this system:** the client-facing portal (`/portal-client`,
`/portal-login`, `/p`), print/PDF output (`invoice-print-view.tsx`, `lib/*-pdf.ts`)
and the marketing landing page (`app/page.tsx`). They intentionally use their own
sizes (`text-[Npx]`, `text-4xl md:text-6xl`) because they are rendered for
non-app contexts (print sheet, public marketing page).

---

## 8. Conventions checklist

Before shipping a UI change:

- [ ] No `text-[Npx]`, no `text-sm/lg/xl/2xl` in internal modules.
- [ ] Every lucide icon has one of `size-3 / size-3.5 / size-4 / size-5`.
- [ ] No emoji standing in for an icon.
- [ ] `h1–h4` untouched (base layer styles them).
- [ ] Numbers that line up use `tabular-nums`.
- [ ] Dark mode checked (`dark:` variants for tinted badges).
- [ ] 1440×900 and 1366×768 both render without horizontal scroll on tables.

---

## 9. Migration notes

The typography and icon normalisation was applied with one-shot scripts kept in
`scripts/` for reference:

| Script | Does |
|---|---|
| `ui-typography-codemod.mjs` | `text-[Npx]` → semantic token, with per-size mapping and exclude list |
| `ui-typography-named.mjs` | Named Tailwind sizes (`text-sm`, `text-xl`, …) → token by role |
| `ui-icons.mjs` | Normalises every lucide size to the 4-tier scale (wrapper → prop → dominant size) |
| `ui-audit*.mjs`, `ui-emoji.mjs`, `ui-grep.mjs` | Verification: raw-px census, named-size census, icon-size distribution, emoji scan |

Re-running the audits should report **zero** raw px and **four** icon sizes inside
`app/(app)/` and `components/` (portal and print files excepted).
