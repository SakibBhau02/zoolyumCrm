# EduTrack 360° — Design System & UI/UX Documentation

> সম্পূর্ণ frontend design এর বিস্তারিত ডকুমেন্টেশন — রঙ, টাইপোগ্রাফি, গ্রাফ/চার্ট, অ্যানিমেশন, কম্পোনেন্ট এবং পেজ-বাই-পেজ ডিজাইন।

**স্ট্যাক:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · shadcn/ui (`base-nova` = Base UI primitives) · Recharts 3 · Framer Motion 12 · lucide-react icons

---

## ১. Design Philosophy

| নীতি | বাস্তবায়ন |
|---|---|
| **Brand-first** | Violet→Fuchsia→Sky গ্র্যাডিয়েন্ট (EduTrack "360°" identity), সর্বত্র consistent |
| **Bangladesh-ready** | bKash/Nagad/payemnt split, বাংলা সংখ্যা ফরম্যাট (৳9.42L), BISE/MPO/BANBEIS reference |
| **Glass + Depth** | Light mode-এ glassmorphism, dark sidebar, layered shadows |
| **Motion with purpose** | Staggered entrance, hover lifts, number/count transitions — সবকিছু 0.3–1.2s easing `[0.22, 1, 0.36, 1]` |
| **Accessible contrast** | OKLCH color space, সব state-এ ring/focus visible |

---

## ২. Color System (OKLCH)

**Core tokens** — `:root` (light) & `.dark` — সংজ্ঞায়িত `src/app/globals.css`-এ।

### Light mode
```css
--background: oklch(0.985 0.004 285)   /* প্রায় সাদা, faint violet tint */
--foreground: oklch(0.22 0.03 285)     /* গাঢ় indigo-black text */
--card:       oklch(1 0 0)             /* pure white cards */
--primary:    oklch(0.52 0.22 290)     /* vibrant violet */
--muted:      oklch(0.955 0.01 285)
--border:     oklch(0.91 0.012 285)
```

### Dark mode
```css
--background: oklch(0.18 0.02 285)
--card:       oklch(0.22 0.025 285)
--primary:    oklch(0.68 0.18 290)     /* হালকা violet */
--border:     oklch(1 0 0 / 10%)       /* white-alpha borders */
```

### Chart palette (5-সিরিজ)
| Token | Light | Dark | ব্যবহার |
|---|---|---|---|
| `--chart-1` | `0.56 0.23 290` (violet) | `0.68 0.18 290` | Primary series |
| `--chart-2` | `0.62 0.14 220` (sky) | `0.68 0.12 220` | Secondary series |
| `--chart-3` | `0.66 0.16 170` (emerald) | `0.7 0.14 170` | Positive/teal |
| `--chart-4` | `0.72 0.16 70` (amber) | `0.74 0.14 70` | Warning |
| `--chart-5` | `0.62 0.21 330` (fuchsia) | `0.68 0.17 330` | Accent |

### Brand gradients (utilities)
| Utility | Direction | Stops | ব্যবহার |
|---|---|---|---|
| `bg-brand-gradient` | 135° | violet(0.56/0.23/290) → fuchsia(0.6/0.21/310) → sky(0.62/0.16/220) | Primary CTA buttons, logo, hero accents |
| `bg-brand-gradient-soft` | 135° | একই 3 রং, 10–12% alpha | Icon chips, subtle backgrounds |
| `text-gradient` | 110° | violet→fuchsia→sky | Headings, "360°" logo text |
| `text-gradient-warm` | 110° | violet→indigo→emerald | Sidebar logo tag |
| `bg-emerald-gradient` | 135° | emerald→teal | Success accents |
| `bg-mesh` | 4 radial-gradients | violet 10% / sky 10% / emerald 10% / fuchsia 8% | App main background texture |

### Semantic states
- **Success:** emerald (`emerald-500` badge bg `emerald-500/10`)
- **Warning:** amber (`amber-400/500`)
- **Danger:** rose/red (`rose-500/10`, `red-500`)
- **Info:** sky/blue
- **Brand:** violet-600 (text/icon), hover → violet-700

---

## ৩. Typography

| Font | Role | CSS var |
|---|---|---|
| **Geist** | Body UI (default sans) | `--font-sans` |
| **Geist Mono** | Code/mono | `--font-geist-mono` |
| **Space Grotesk** | Display/Headings (`font-heading`) | `--font-display` |
| **Hind Siliguri** | বাংলা টেক্সট (`font-bangla`) | `--font-bangla` |

**Scale pattern:**
- Page title: `text-2xl font-heading font-semibold tracking-tight`
- Section title: `text-[15px] font-heading font-semibold`
- Card body: `text-[13px]` (নিয়মিত data row)
- Metadata: `text-[11px] text-muted-foreground`
- Numbers: সব KPI/মেট্রিক্সে `tabular-nums` (সংখ্যা লাইন আপ)
- Sidebar labels: `text-[10px] tracking-widest uppercase`

---

## ৪. Radius & Elevation

- Base radius: `0.75rem` (টোকেন `--radius`), scaled: `--radius-sm`(0.6×) → `--radius-4xl`(2.6×)
- **Cards:** `rounded-2xl` + `border-border/60` + `shadow-sm`
- **Buttons:** `rounded-xl` (প্রাইমারি), `rounded-lg` (সেকেন্ডারি), `rounded-full` (pills/toggles)
- **Avatar/icon chips:** `rounded-full` / `rounded-xl`
- **Hover lift (`.card-lift`):** `translateY(-4px)` + `box-shadow: 0 20px 40px -12px oklch(0.5 0.15 290 / 25%)`, transition `0.3s cubic-bezier(0.22,1,0.36,1)`
- **Glass:** `bg-white/60 + backdrop-blur-xl + border-white/40` (light) / `bg-white/5 + border-white/10` (dark)

---

## ৫. Animation & Motion (Framer Motion)

| Pattern | Spec | Location |
|---|---|---|
| **Stagger container** | `staggerChildren: 0.08` | Dashboard root |
| **Item fade-up** | `opacity 0→1, y 18→0, 0.5s, ease [0.22,1,0.36,1]` | Dashboard items |
| **`<FadeIn>` wrapper** | `opacity 0→1, y 16→0, 0.5s` + optional `delay` | সব পেজ |
| **Table row entrance** | `opacity 0→1, y 8→0, 0.35s, delay i×0.04` | Students/Exams rows |
| **List slide-in** | `opacity 0→1, x -12→0, 0.4s, delay i×0.06` | Merit list |
| **Kanban card** | `opacity 0→1, scale 0.96→1, 0.35s` | Admission pipeline |
| **Chart draw** | `animationDuration: 1000–1200ms` (Recharts native) | সব charts |
| **Heatmap cell** | `hover:scale-110`, `transition 200ms` | Dashboard heatmap |

### CSS keyframes (`globals.css`)
| Name | Spec | ব্যবহার |
|---|---|---|
| `marquee` | `translateX 0→-50%`, 40s linear infinite | Landing trust strip |
| `float` | `translateY ±14px`, 8s / 12s (slow) ease-in-out infinite | Landing hero cards |
| `shimmer` | `background-position -200%→200%`, 2.5s | Skeleton surfaces |
| `pulse-glow` | `opacity 0.55→1`, 4s ease-in-out | Hero blobs, notification ping |
| `animate-ping` (Tailwind) | — | Notification dot (violet-500) |

---

## ৬. Chart & Graph Components (`src/components/charts.tsx`)

> সব chart ResponsiveContainer-এ (parent width অনুযায়ী resize)। Unified **tooltipStyle**: dark bg `oklch(0.18 0.02 285)`, radius 12px, fontSize 12px, white text, shadow `0 16px 40px -8px rgba(0,0,0,.4)`, border `oklch(1 0 0 / 10%)`।

### ৬.১ `AttendanceAreaChart` — Daily Present vs Absent
| Property | Value |
|---|---|
| Type | Recharts `AreaChart` (2-series stackless) |
| Height | 240px · margin `{top:8, right:4, bottom:0, left:-18}` |
| Data | `[{ date, present, absent }]` — July 2026 daily |
| Fill | `linearGradient` y-অক্ষ বরাবর: Present `violet 0.35→0 opacity`, Absent `rose 0.25→0` |
| Stroke | Present `oklch(0.56 0.23 290)` 2.5px · Absent `oklch(0.66 0.15 25)` 2px |
| Curve | `type="monotone"` (smooth) |
| Grid | `strokeDasharray 3 3`, `stroke oklch(0.5 0.05 285 / 0.15)`, **vertical:false** (শুধু horizontal lines) |
| Axes | X tick fontSize 11 `interval={4}`; Y domain `[0, 520]`; axisLine/tickLine hidden |
| Hover | Tooltip custom + cursor `violet 0.4` vertical line |
| Animation | 1200ms |

### ৬.২ `FeeBarChart` — Collected vs Due (৳'000)
| Property | Value |
|---|---|
| Type | `BarChart` grouped, `barGap={3}` |
| Height | 240px · margin left `-14` |
| Data | `[{ month, collected, due }]` |
| Fill | collected: violet→sky gradient; due: `rose 0.5→0.15 alpha` gradient |
| Radius | `[6,6,0,0]` (top-rounded bars) |
| Grid | dashed, horizontal only |
| Y domain | `[0, 550]` |
| Cursor | `fill oklch(0.5 0.05 285 / 0.08)` (column highlight) |
| Animation | 1000ms |

### ৬.৩ `MfsDonut` — Payment Split (bKash/Nagad/Cash)
| Property | Value |
|---|---|
| Type | `PieChart` donut |
| Size | 170×170px · innerRadius 52 · outerRadius 72 |
| Styling | `paddingAngle={4}` (slice gap), `cornerRadius={8}` (rounded ends), `strokeWidth={0}` |
| Colors | Per-slice data-defined (bKash pink `#E2136E`-family, Nagad orange, cash emerald), gradient 0.85→1 opacity |
| Legend | Beside chart (flex), dot 2.5px round + name + bold value%, `tabular-nums` |
| Animation | 1100ms |
| Layout | `flex items-center gap-6` — chart + legend side-by-side |

### ৬.৪ `SubjectBarChart` — Pass Rate by Subject
| Property | Value |
|---|---|
| Type | `BarChart` **horizontal (layout="vertical")** |
| Height | 260px · Y-axis width 92 (subject names) |
| Data | `[{ subject, passRate }]` |
| Fill | violet→sky horizontal gradient |
| Radius | `[0,6,6,0]` (right-rounded) |
| X domain | `[0, 100]` with `unit="%"` |
| Grid | dashed, **horizontal:false** |
| Tooltip formatter | `["{v}%", "Pass Rate"]` |

### ৬.৫ `AttendanceHeatmap` — Class × Month Matrix
| Property | Value |
|---|---|
| Type | Custom HTML table (Recharts নয়) — `border-separate`, `border-spacing 1.5` |
| Data | `number[][]` (class × month), min-width 480px + `overflow-x-auto` |
| Cell | `aspect-square` rounded-lg, 10px bold white text, shadow-sm |
| Color scale | ≥95% `bg-emerald-500` · 90–94% `bg-emerald-400` · 85–89% `bg-amber-400` · <85% `bg-rose-500` |
| Hover | `scale-110` + full tooltip `title="Class · Month — N%"` |
| Legend | Right-aligned 4-step dots (rose→emerald), 11px muted |

### ৬.৬ Custom SVG Progress Ring (Exams page)
| Property | Value |
|---|---|
| Type | Inline `<svg viewBox="0 0 64 64">`, 64px (size-16) |
| Track | Circle r=28, `stroke oklch(0.9 0.01 285)` width 6 |
| Value arc | `strokeDasharray = 2π×28`, Framer `motion.circle` animate `strokeDashoffset → (1-0.72)×C`, **1.2s** ease `[0.22,1,0.36,1]`, `strokeLinecap="round"` |
| Gradient | violet→sky linearGradient `#gpaGrad` |
| Center label | Absolute 13px bold `tabular-nums` (e.g. 72%) |

---

## ৭. Core UI Components

### Layout shell (`src/app/(app)/layout.tsx`)
- `flex h-screen overflow-hidden` — sidebar (fixed 256px) + main column
- Main: `flex-1 overflow-y-auto bg-mesh` + `max-w-7xl p-6 lg:p-8` content container

### Sidebar (`sidebar.tsx`)
- Dark: `bg-sidebar oklch(0.21 0.035 285)`, w-64, `border-r border-sidebar-border`
- Header: 36px brand-gradient logo (Sparkles icon) + "EduTrack **360°**" (`text-gradient-warm`)
- Nav: grouped sections (`text-[10px] uppercase tracking-widest` labels), 15 icons (lucide)
- **Active state:** `bg-sidebar-primary` violet + `shadow-lg shadow-violet-600/25` + white icon
- Hover: `bg-sidebar-accent` (white 8%), icon `scale-110` on group-hover
- Badges (notification counts): `bg-violet-500/15 text-violet-300` / active-এ `bg-white/25`
- Footer: school info chip — amber gradient avatar "SI" + shortName + EIIN · year

### Topbar (`topbar.tsx`)
- Sticky, `bg-background/70 backdrop-blur-xl`, h-16, `border-b`
- Date pill: rounded-full `border bg-card/60` — "Sun, 2 Aug 2026 · Term 2" + "July 2026" pill button
- Global search (w-72, hidden md): rounded input, search icon, placeholder "Search students, teachers, invoices…"
- Right cluster: dark-mode toggle (Moon/Sun), notification bell with **double-dot ping** (animate-ping violet + solid dot), divider, profile chip (gradient avatar "SR" + Sadia Rahman/School Admin + ChevronDown)

### `shared.tsx` — Building blocks
| Component | Spec |
|---|---|
| `FadeIn` | Entrance motion wrapper (delay prop) |
| `PageHeader` | Title 2xl font-heading + subtitle + action cluster, `mb-6` |
| `StatCard` | Corner glow blob (gradient 20%→30% on hover), icon chip `bg-muted/70` hover scale-110, delta pill (emerald, SVG triangle), 2xl bold `tabular-nums` value |
| `CardShell` | Card container: `card-lift rounded-2xl border-border/60 bg-card p-5 shadow-sm` |
| `SectionTitle` | 15px font-heading + subtitle 12px + optional action |
| `GradientBadge` | Brand-gradient pill, white 11px semibold, `shadow-violet-500/25` |
| `AvatarGroup` | Overlapping avatars `-space-x-2`, `ring-2 ring-card`, 5 preset gradients |

### Table pattern (Students / Exams / Fees)
- `CardShell !p-0 overflow-hidden` — borderless inside
- Header row: `hover:bg-transparent`, `pl-5` first cell
- Body rows: motion entrance, hover `bg-violet-50/40 dark:bg-violet-950/30`
- Progress-in-cell: 1.5px rounded bar (14/16 width) + gradient by threshold
- Footer: `border-t` — count text + pagination/action buttons (`rounded-lg` xs)

---

## ৮. Page-by-Page Design

### ৮.১ Landing (`/`)
- **Nav:** glass navbar, logo + "360°" gradient, Get Started pill CTA (`render={<Link/>}` pattern)
- **Hero:** `bg-brand-gradient-soft` chip "Assalamu Alaikum!"-style greeting → headline `text-4xl→6xl` with `text-gradient`, sub-copy, dual CTA (primary gradient + ghost). 3 পিস floating glass dashboard mockup cards (`animate-float` 8s/12s) — GPA ring, attendance sparkline, fee bar — each with "Live" pulsing dot
- **Background:** 3 pulse-glow blobs (violet/sky/emerald), `bg-mesh`
- **Stats band:** gradient-number strip (schools/students/SMS/uptime) — `text-gradient`, 3xl–4xl bold
- **Features grid (6):** icon chips 44px gradient per-feature, corner glow blob (8%→18% on hover), icon `scale-110 rotate-3` hover
- **Marquee trust strip:** `animate-marquee` 40s, duplicated content, brand-gradient-soft pills ("MPO Data Ready", "BISE Export", "bKash Integration"…)
- **CTA section:** dark panel `bg-sidebar`, pulse-glow blobs, `grid-pattern` overlay, gradient CTA
- **Footer:** brand logo, muted links, "Made for every school in Bangladesh"

### ৮.২ Dashboard (`/dashboard`)
- **Hero banner:** `bg-sidebar` rounded-3xl — 2 pulse-glow blobs (violet/indigo), `grid-pattern` right half (6% opacity), `GradientBadge` year chip, "Assalamu Alaikum, Sadia! 👋" 2xl–3xl, white/60 sub copy with emerald highlight, 2 glass/gradient CTAs (Take Attendance, Collect Fee)
- **Stat cards (4):** violet/sky/emerald/amber icon gradient + glow blob; deltas +3.2%, +2, +0.8%, +5.1%
- **Charts row:** Attendance Area (2-col span) + MfsDonut, hover links "View full report →"
- **Middle row:** Fee Bar (2-col) + Risk Flags feed (rose/amber/sky gradient icons, Flame for Critical, attendance % colored)
- **Bottom row:** Heatmap + Today's Schedule (period chip white bg 11px bold violet, Break italic) + Notice Board (icon `bg-brand-gradient-soft`, unread dot glow `shadow-violet-400/50`, amber Exam countdown card with gradient Progress bar 72%)
- **Merit strip:** full-width card, `bg-brand-gradient` top 4px accent bar, 5 rank cards (rank-1 amber gradient "🏆 Topper" floating badge, 2xl violet GPA)

### ৮.৩ Students (`/students`) — **live API**
- Header: Excel Import / Export / **Add Student** (gradient)
- Filter bar: search input (icon) + status Tabs (All/Active/Promoted/TC Issued) + Filters
- Table: Student (gradient avatar initials) · Class·Roll · Guardian · Admission · Status (emerald/sky/rose/amber badges, `ring-1`) · Actions
- Add Student dialog (`sm:max-w-md rounded-2xl`): name, gender+section Selects, father/mother grid, gradient submit, `DialogFooter` sticky bar
- Footer pagination: "Showing X–Y of N" + Prev/Next with page indicator
- Skeletons during loading; empty state message

### ৮.৪ Attendance (`/attendance`)
- Date navigation + stat chips; class/section table with PRESENT/ABSENT/LATE/LEAVE cell states, summary bars, SMS alert toggle per absent row

### ৮.৫ Exams (`/exams`)
- Header: BISE Export / **Embargo On** (rose) / Enter Marks
- **Progress ring** (72%) + 4 stat clusters (emerald/amber/violet/sky) + Trophy gradient badge "Result publish: Aug 15"
- Subject pass-rate horizontal bars + Merit List Top-5 (gold/silver/bronze rank circles: amber gradient/slate/amber-dark; rank-1 card amber gradient bg)
- Violet "Pass/Fail/Improvement" analysis card (3 white mini-cards)
- Subject table: animated inline progress bars (emerald/sky/amber by threshold) + status badges (Excellent/Good/Review), footer "+2.3% vs last term" + Export CSV / Preview marksheet

### ৮.৬ Fees (`/fees`)
- KPI cards with delta badges; FeeBarChart (2-col) + MfsDonut; collector table with method badges (bKash/Nagad/cash), status chips

### ৮.৭ Admissions (`/admissions`) — **Kanban**
- 5 columns (Applied/Shortlisted/Test Scheduled/Offer Sent/Admitted), each `w-[290px] shrink-0 snap-start` horizontal scroll (`snap-x overflow-x-auto`), colored column dot + count badge
- Cards: `cursor-grab`, avatar+name+phone, class badge (violet) + status badge (sky=New, emerald=Docs, amber=Sibling, slate=Other), **hover-reveal actions** (View + ArrowRight, opacity 0→100)
- Dashed "Add manually" button per column; bottom analytics strip (4 colored counts + Open Dashboard)

---

## ৯. Responsive Behavior
| Breakpoint | Behavior |
|---|---|
| `<lg` | Sidebar hidden (`hidden lg:block`); main full-width |
| `<md` | Topbar search hidden; stat grids → 2 col → 1 col |
| `xl` | 4 stat cards এক সারিতে |
| Tables | `overflow-x-auto` (heatmap min-w 480px) |
| Kanban | `snap-x` horizontal scroll (290px columns) |
| Dialogs | `max-w-[calc(100%-2rem)]` → `sm:max-w-sm/md` |

## ১০. Dark Mode
- Class-based: `@custom-variant dark` — `document.documentElement.classList.toggle("dark")` (Topbar toggle)
- সব token-এ `.dark` override; `bg-mesh`, `glass`, `card-lift` utilities-এ `dark:` variants
- Table hover `dark:hover:bg-violet-950/30`, badges `dark:text-*-300` (হালকা-রকম brightness)

## ১১. File Map
```
src/app/globals.css            → tokens, gradients, keyframes, scrollbar
src/app/layout.tsx             → fonts (Geist, Space Grotesk, Hind Siliguri)
src/app/page.tsx               → landing
src/app/(app)/layout.tsx       → shell (sidebar+topbar+bg-mesh)
src/app/(app)/dashboard/page.tsx
src/app/(app)/students/page.tsx  → live API (useEffect + debounce + pagination)
src/app/(app)/attendance/page.tsx
src/app/(app)/exams/page.tsx
src/app/(app)/fees/page.tsx
src/app/(app)/admissions/page.tsx
src/app/login/page.tsx         → glass card auth, brand mesh bg
src/components/sidebar.tsx     → dark nav
src/components/topbar.tsx      → glass sticky bar
src/components/shared.tsx      → FadeIn, StatCard, CardShell, PageHeader…
src/components/charts.tsx      → 5 chart components + tooltipStyle
src/lib/mock-data.ts           → chart/page data (real API-তে migrate চলছে)
```
