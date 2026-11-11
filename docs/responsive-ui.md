# Responsive UI — phone, tablet, desktop

The app is a single codebase rendered from 360 px phones to wide desktops.
This pass made the **interaction layer** mobile-first and removed every
horizontal page overflow.

## Verification

Automated check against the production build, all 11 module routes, at
**390 px / 820 px / 1440 px**:

```
clean: no horizontal overflow at 390 / 820 / 1440 on all 11 routes
```

(`document.documentElement.scrollWidth > innerWidth` for every route.)

Plus visual review of each module with Playwright screenshots at each width.

## Foundation

| Area | Change |
|---|---|
| Page scroll | `html { overflow-x: clip }` + `overflow-x-auto` containers are now the containing block for absolute children. A stray `sr-only` node inside the 1020 px client table used to widen the whole document on phones. |
| Touch targets | Header/menu/close/notification buttons are 40–44 px; bottom-nav items are 56 px tall. |
| iOS zoom | Inputs/selects/textareas are forced to 16 px below 640 px, so focusing a field no longer zooms the page. |
| Hover | `hover:` effects are neutralised on `(hover: none)` devices; tap feedback (`active:`) is used instead. |
| Motion | All transitions/animations collapse under `prefers-reduced-motion`. |
| Safe areas | `env(safe-area-inset-bottom)` padding on the bottom nav and sheet footers (iPhone home indicator). |
| Chip strips | New `.scroll-x` / `.scroll-x-hint` utilities: one row, snap, hidden scrollbar, faded right edge. |

## Shell

- **Bottom navigation (phones/tablets < 1024 px):** Home, Pulse, Tasks,
  Capital, Clients, plus **More** which opens the full drawer. Thumb-reachable,
  permission-aware, active state, `aria-current`.
- The duplicate hamburger was removed from the phone header (More replaces it),
  freeing space for search and notifications.
- **Full-screen search** on phones (the header input was ~120 px wide and hid
  its own placeholder). 16 px input, results at 44 px row height.
- Mobile content padding clears the fixed nav.

## Sheets and drawers

- `Modal` becomes a **true full-screen sheet** on phones: `100dvh`, square
  corners, sticky header and footer, body scrolls, safe-area footer padding.
  Desktop keeps the centred dialog with its size presets.
- `Drawer` got 40 px close target, safe-area footer and `overscroll-contain`.
- Mobile nav drawer: `aria-modal`, Escape to close, focus moved into the panel,
  scroll lock, `overscroll-contain`.

## Module-by-module

| Module | Change |
|---|---|
| **Dashboard** | Hero actions wrap; KPI/flow cards stack; charts keep aspect; content clears the bottom nav. |
| **Pulse** | Already card-based; actions (`Log`, call, WhatsApp, email) remain reachable; filters stay in one row. |
| **Accounts** | Opens in **card view** on phones (table is 1020 px wide); KPI strip is 2×2; preset chips scroll horizontally; toolbar stacks (search full-width, controls scrollable). |
| **Flow** | Kanban columns are `85vw` snap cards on phones; list/grid already responsive. |
| **Tasks** | Board columns snap at `85vw`; the list hides Type/Priority/Due/Assignee/Project progressively (`sm`/`md`/`lg`) so Title + Status fit exactly; title column capped and wraps; timer/badges stay inside the row. |
| **People** | Hub + sub-nav strips scroll with an edge fade; directory hides Role/Utilization/Status on small screens so Employee + Today fit. |
| **Capital** | Tab bar scrolls horizontally instead of stacking 3 rows; KPI grid is 2 columns; cards/sections stack. |
| **Calendar** | Phones open on the **day agenda** instead of a 7-column month grid; month/week/timeline remain one tap away and scroll inside their own container. |
| **Insight** | KPI grid 2 columns on phones; report tabs scroll. |
| **Control** | Segment control scrolls; health tiles 2 columns; settings sections stack. |
| **Portal** | KPI cards stack; tables scroll inside their card. |

## Shared primitives touched

- `components/mobile-nav.tsx` (new)
- `components/app-shell.tsx`, `components/topbar.tsx`, `components/sidebar.tsx`
- `components/ui.tsx` (`Modal`, `Drawer`, `Segmented`)
- `components/table.tsx` (tighter mobile padding, scroll containment)
- `app/globals.css` (responsive/touch layer)

## Rebuilding for the public demo

```powershell
npm run build --prefix apps/api
$env:NEXT_PUBLIC_API_URL = "/api"; $env:API_PROXY_TARGET = "http://127.0.0.1:4000"
npm run build --prefix apps/web
# the launcher copies static assets into the standalone server and restarts it
powershell -ExecutionPolicy Bypass -File scripts/public-demo.ps1
```
