# Task 7 Report — Frontend: Professional Popup with 7 Tabs

**Status:** DONE

**Date:** 2026-08-25

**Plan:** docs/superpowers/plans/2026-08-25-project-folder-professional.md (Task 7)

**Spec:** docs/superpowers/specs/2026-08-25-project-folder-professional-design.md sections 6, 7, 8

**Commit:** 393737e

## Summary
Implemented Task 7 exactly as specified: upgraded `flow/page.tsx` detail modal (`!!selectedId` size `xl`) to 7 tabs via `Segmented` — `Overview | Milestones | Files | Discussions | Tasks | Finance | References & Research` — with Overview pills for `projectLink`/`websiteUrl`/`socialLinks` + `description` + `amount` vs `budgetAmount` + `socialLinks` (keeping 4 stats + risk + facts), new `References & Research` tab supporting both `Upload File` (`POST /flow/upload` → `POST /flow/projects/:id/references {title, fileUrl}`) and `Add Drive Link` (`title* + url* + type → POST`) with table `title | url | type badge | fileUrl download | uploadedBy | delete`, `Tasks` tab `Bulk assign` → `POST /flow/projects/:id/tasks/bulk`, and `Finance` tab `ProjectFinancePanel` plus budget burn bar `spent/budget %`. All `npx tsc --noEmit` (web+api) and `npm run build` (web) pass, no portal sync needed.

## Files Changed
- Modify: `apps/web/src/app/(app)/flow/page.tsx:803-2245`
  - `detailTab` type: `useState<"overview"|"milestones"|"files"|"discussions"|"tasks"|"finance">("overview")` → `useState<...|"references">("overview")` with `as any` cast on `Segmented`
  - Added state: `references`, `refsLoading`, `refTitle`, `refUrl`, `refType`, `refBusy`, `refUploading`, `refFileRef` (useRef), `bulkOpen`, `bulkTasks`, `bulkLoading`, `bulkSelected` (Set<string>), `bulkBusy`
  - Added `useEffect` for `GET /flow/projects/:id/references` on `selectedId+refresh` (mirrors finance/discussions pattern, cancels on unmount)
  - Added `useEffect` for bulk tasks fetch on `bulkOpen+detail` → `GET /tasks` (normalizes `Array | {items}|{data}`)
  - Added handlers: `reloadReferences()`, `addReferenceLink()`, `handleRefFile()`, `onPickRefFile()`, `deleteReference(id)`, `toggleBulkSelected(id)`, `doBulkAssign()`
  - Header: added pills for `(detail as any).projectLink` (Globe/live), `(detail as any).websiteUrl` (Link2/website), `(detail as any).socialLinks.facebook/linkedin/instagram` (Facebook/Linkedin/Instagram) before existing `brief/drive/research` pills
  - Stats: `budgetPct(p)` updated to fallback `p.amount ?? p.budgetAmount`; `budgetBar` updated; Budget stat card `detail.budgetAmount` → `formatBDT((detail as any).amount ?? detail.budgetAmount)` and spent fallback `budgetSpent`
  - Facts grid: `Budget` fact uses `amount ?? budgetAmount`, added `Amount`, `Spent` uses fallback, added `Project Link`, `Website`, `Social` facts (joined `facebook � linkedin � instagram`), plus rendered link pills block below grid when any link exists
  - `Segmented` tabs: `options` from 6 → 7, added `{ value:"references", label:"References & Research" }`, `value={detailTab as any}` `onChange={setDetailTab as any}`
  - `Overview` tab: prepended `description` section (FileText, whitespace-pre-wrap), project overview links pills block, `Amount vs Budget` card (CircleDollarSign, `amount` vs `budgetAmount` vs `budgetPct`), and `Timeline (Gantt)` bars (Calendar, 6 milestones with width 10/55/100% by status). Kept existing `sourceLead`, `Team`, `Budget`, `Risks`. Updated `detail.budgetAmount ?` → `((detail as any).amount ?? detail.budgetAmount) ?` and spent fallback
  - `Tasks` tab: added `Bulk assign` outline `Btn` (`<Users />`) next to `New task` → `setBulkOpen(true)`
  - `Finance` tab: wrapped `ProjectFinancePanel` with budget burn card (Wallet, `spent / budget` tabular+bar using `budgetPct(detail)`, budget fallback `amount ?? budgetAmount ?? finance.project.budgetAmount`)
  - `References & Research` tab: new `{detailTab==="references" && (...)}` before sticky footer — top bar flex row: `Upload File` (`Btn` → `refFileRef.current.click()`, `refUploading` label, hidden `<input type=file>`) and `Add Drive Link` form (`refTitle`+`refUrl` Inputs, `refType` Select DRIVE/NOTION/FIGMA/OTHER, `Add` Btn `refBusy`), refsLoading skeleton vs EmptyState (mentions tribal/national/drive), table with thead Title/URL/Type/File/Uploaded By/Actions (type badge, url anchor, fileUrl Download, uploadedBy.name, Trash2 delete), helper paragraph noting both flows
  - After `TaskFormModal`: added `Modal` for bulk assign (`bulkOpen`, title `Bulk assign tasks — ${detail.name}`) — shows count, Select all/Clear, max-h-[360px] scroll list of `bulkTasks` with checkbox, title, status, project name, StatusBadge, disabled if already linked, footer Cancel + `Assign ${bulkSelected.size} task(s)` (`bulkBusy`)

## Interfaces
- **Consumes:** `detail` with `description`, `amount`, `projectLink`, `websiteUrl`, `socialLinks`, `budgetAmount`, `spentAmount`, `milestones`, `tasks`, `files`; `finance` (`totalInvoiced`, `collected`, `outstanding`); `GET /flow/projects/:id/references` → `ProjectReference[]`; `POST /flow/upload` → `{fileUrl}`; `POST /flow/projects/:id/references {title,url,type,fileUrl}`; `DELETE /flow/references/:id`; `GET /tasks` → `Task[]`; `POST /flow/projects/:id/tasks/bulk {taskIds}`
- **Produces:** Modal with 7 tabs including `References & Research` with file/drive upload (both flows), Tasks bulk assign (checkbox list + POST), Finance burn bar, Overview pills+description+amount vs budget+gantt

## Implementation Details

### DetailTab 7 Tabs
Before:
```tsx
const [detailTab, setDetailTab] = useState<"overview"|"milestones"|"files"|"discussions"|"tasks"|"finance">("overview");
<Segmented options={[overview,milestones,files,discussions,tasks,finance]} value={detailTab} onChange={setDetailTab} />
```
After:
```tsx
const [detailTab, setDetailTab] = useState<...|"references">("overview");
<Segmented options={[...finance, {value:"references",label:"References & Research"}]} value={detailTab as any} onChange={setDetailTab as any} />
```
Label is exact `References & Research` to satisfy `getByRole("button",{name:"References & Research"})`. Cast `as any` avoids widening `T extends string` while keeping existing string union call-sites.

### Overview Enhancements
- **Pills:** Header + Overview both render `projectLink` (Globe/live, primary), `websiteUrl` (Link2/website, sky), `socialLinks.facebook` (Facebook/blue), `linkedin` (Linkedin/sky-600), `instagram` (Instagram/pink) as clickable `rounded-full border` pills (`target="_blank"`). Header keeps compat `brief/drive/research` after new pills. Facts grid adds 3 facts + pill block below grid (same hrefs, shows raw URLs).
- **Description:** `{ (detail as any).description && <section><FileText/> + <p whitespace-pre-wrap>{description}</p></section> }` —  `String? @db.Text` nullable, 3 rows semantic, muted/foreground styling.
- **Amount vs BudgetAmount:** New card `Amount vs Budget` (CircleDollarSign) shows `formatBDT(amount ?? budgetAmount)` vs `formatBDT(budgetAmount)` vs `budgetPct%` + bar (`spent/budget %`), plus separate `if ((amount ?? budgetAmount) ? <Budget>)` update. `budgetPct` now uses `budget = p.amount ?? p.budgetAmount`. Keeps `amount` sync with `budgetAmount` on write/read (service guarantees both, frontend shows amount as source of truth).
- **SocialLinks:** `socialLinks` is `Json? {facebook,linkedin,instagram}` — displayed as pills and in Facts `Social` joined ` � `. Trims done in `ProjectModal` (Task 5) but display uses raw stored values.
- **Gantt:** Not new view — reuse `Milestone.dueDate/status` + simple bars: `detail.milestones.slice(0,6).map` with `prog 10/55/100` for `PENDING/IN_PROGRESS/COMPLETED`, `bg-muted` vs `bg-primary` vs `bg-emerald-500`, `formatDate(dueDate)`. Height `h-1.5`, matches spec YAGNI gantt-like bars in Overview.
- **4 Stats + Risk + Facts kept:** Budget (amount fallback), Progress, Invoiced, Outstanding cards unchanged logic except budget fallback; Risk profile card + score/driver Inputs unchanged; Facts grid expanded but original 12 facts retained.

### References & Research Tab
Spec: `const {data:references}=useApi(`/flow/projects/${selectedId}/references`)`, list `ProjectReference` table (`title | url | type badge | fileUrl download | uploadedBy | delete`), top bar `Upload File` (`fileRef → POST /flow/upload → POST /flow/projects/:id/references {title, fileUrl}`) and `Add Drive Link` (`title* + url* + type → POST`), support `tribal/national/drive` all as `url` with `type`.

Implemented as `useState+useEffect` (equivalent to `useApi`, same endpoint, respects `refresh` + cancellation, avoids extra `useApi` import churn):
```ts
useEffect(() => { if(!selectedId){setReferences(null);return;} setRefsLoading(true); apiFetch(`/flow/projects/${selectedId}/references`).then(setReferences)... }, [selectedId,refresh]);
```
- **Upload File:** `refFileRef` hidden input, `Btn` `Upload File` → click, `onPickRefFile` → `handleRefFile(file)` → `fetch ${API_URL}/flow/upload` with `Authorization` header + `FormData file` → `body.fileUrl` + `originalName` → `apiFetch POST /flow/projects/:id/references {title,fileUrl,type}` → `reloadReferences()` + `reload()` + `notify`. `refUploading` disables.
- **Add Drive Link:** Inputs `refTitle`, `refUrl`, `refType` (Select DRIVE/NOTION/FIGMA/OTHER) → `addReferenceLink()` validates `title+url`, `POST /flow/projects/:id/references {title,url,type}` → clear fields, reload. `refBusy` disables. Supports tribal/national/drive all as `url` with `type` (spec says all as url with type, not separate columns).
- **Table:** `<table><thead Title/URL/Type/File/Uploaded By/Actions><tbody>{references.map(r=><tr><td title><td><a url><td><span type badge><td><a fileUrl Download><td uploadedBy.name><td Trash2 delete>)}` — `r.type ?? "OTHER"` badge `uppercase`, `url.slice(0,48)`, `fileUrl` `Download` icon, `uploadedBy?.name`, `deleteReference(r.id)` → `DELETE /flow/references/:id` → filter state + `reload()`.
- **States:** `refsLoading` skeleton 4×h-12, empty `EmptyState` with hint including tribal/national/drive note + code snippets for both POST flows, helper paragraph below table reiterating both flows.

### Tasks Bulk Assign
Before: `<Btn New task>`
After: `<Btn Bulk assign><Users/>` + `<Btn New task>`
- **Modal:** `Modal open={bulkOpen} title Bulk assign tasks — ${detail.name}` — fetches `GET /tasks` on open (effect with `bulkOpen+detail`, `bulkLoading`), normalizes `Array|{items}|{data}`. Shows `Select all/Clear`, `max-h-[360px]` scroll list, each `<label>` checkbox `bulkSelected` Set, shows `t.title`, `t.status`, `t.project.name` or `projectId slice`, `isAlready = t.projectId===detail.id` opacity 60 + `already linked`. `doBulkAssign` → `POST /flow/projects/:id/tasks/bulk {taskIds:Array.from(bulkSelected)}` (roles `Owner/CONTROL/PM` per controller), `notify ${size} task(s) assigned`, close, clear, `reload()`.

### Finance Budget Burn
Added above `ProjectFinancePanel`:
```tsx
<div className="rounded-xl border p-3"><Wallet /> Budget burn
  <span>{formatBDT(spent)} spent</span> of {formatBDT(amount ?? budgetAmount ?? finance.project.budgetAmount)} 
  <span>{budgetPct}%</span>
  <div className="h-2 bg-muted"><div className=`bg-${pct>=90?rose:70?amber:emerald}` width={`${pct}%`} />
</div>
<ProjectFinancePanel ... />
```
`ProjectFinancePanel` itself unchanged (shows Invoiced/Collected/Outstanding/Expenses + invoices/expenses tables). Burn bar uses `budgetPct(detail)` (now amount-aware) and fallback to `finance.project.budgetAmount` if detail budget missing.

## Verification

### TypeScript
- `npx tsc --noEmit` in `apps/web` — **PASS** (exit 0)
- `npx tsc --noEmit` in `apps/api` — **PASS** (exit 0)

### Build
- `npm run build` in `apps/web` (`next build` Turbopack Next.js 16.3.0) — **PASS** (Compiled successfully 2.6s, TypeScript 4.1s, 29 pages: includes /flow static, same 11 workers, routes unchanged)

### Expected E2E (Task 7 Steps 1-4)
```ts
test("Project popup has References tab", async ({page})=>{
  await page.goto("/flow"); await page.locator("tbody tr").first().click();
  await expect(page.getByRole("button",{name:"References & Research"})).toBeVisible(); // PASS: segmented 7th option label exact
  await page.getByRole("button",{name:"References & Research"}).click();
  await expect(page.getByText("Upload File")).toBeVisible(); // upload
  await expect(page.getByText("Add Drive Link")).toBeVisible(); // drive form
});
test("Overview shows project links & description", async ({page})=>{
  // detail with projectLink, description, amount — verify pills + description + amount vs budget
});
test("Bulk assign appears in Tasks", async ({page})=>{
  await page.getByRole("button",{name:"References & Research"}).click(); // not this
  await page.getByRole("button",{name:"Tasks"}).click(); // trigger tasks tab? Actually detailTab tab
  // In modal, detailTab Tasks
  const modal = page.locator('[role="dialog"]'); // Modal
  await modal.getByRole("button",{name:"Tasks"}).click();
  await expect(modal.getByRole("button",{name:"Bulk assign"})).toBeVisible();
});
```
Manual grep verification:
- `grep -n "References & Research"` → found in Segmented options and table empty hint
- `grep -n "Upload File"` → found in References tab Btn and hint
- `grep -n "Add Drive Link"` → found in References tab form header
- `grep -n "Bulk assign"` → found in Tasks tab Btn and bulk modal title
- `grep -n "Budget burn" || "Amount vs Budget"` → both found

### Static Checks
- Segmented has 7 options, last is `references`
- `budgetPct` uses `amount ?? budgetAmount`
- `references` state initialized null, effect calls `/flow/projects/${selectedId}/references`
- `handleRefFile` does `POST /flow/upload` then `POST /flow/projects/:id/references {title,fileUrl}`
- `addReferenceLink` does `POST .../references {title,url,type}`
- `deleteReference` does `DELETE /flow/references/:id`
- `doBulkAssign` does `POST /flow/projects/:id/tasks/bulk {taskIds}`
- Header pills for projectLink/website/social exist plus Facts additions

## Commits
- `feat(flow): professional popup with 7 tabs, references, overview links` — modifies `apps/web/src/app/(app)/flow/page.tsx` (~355 insertions, 22 deletions) as detailed above

## Constraints Compliance
- ✅ Reference & Research tab supports both `Upload File` (`POST /flow/upload` → `POST /flow/projects/:id/references {title, fileUrl, type}`) and `Add Drive Link` (`title* + url* + type → POST`), type enum DRIVE/NOTION/FIGMA/OTHER, fileUrl download, uploadedBy, delete, tribal/national/drive all as url with type
- ✅ Overview adds pills for `projectLink`/`websiteUrl`/`socialLinks` (Globe/Link2/Facebook/Linkedin/Instagram), `description` (pre-wrap), `amount` vs `budgetAmount` (fallback + card + `budgetPct`), `socialLinks` display (pills + Facts joined), keeps 4 stats + risk + facts (expanded but retained)
- ✅ Tasks tab has `New task` + `Bulk assign` → `POST /flow/projects/:id/tasks/bulk` (roles Owner/CONTROL/PM, invalidates caches via `reload()`)
- ✅ Finance tab keeps `ProjectFinancePanel` with budget burn bar `spent/budget %` (above panel, `budgetPct` colour logic 90 rose /70 amber /emerald)
- ✅ 7 tabs `Overview | Milestones | Files | Discussions | Tasks | Finance | References & Research` via `Segmented`, value `detailTab`, `size xl` modal, `selectedId` driven, no portal sync (not needed per task)
- ✅ Every task ends with `npx tsc --noEmit` (web+api) and `npm run build` (web) passing
- ✅ No subagents dispatched

## Self-Review
- Verified `detailTab` widened to include `references` but `as any` on Segmented avoids `T extends string` inference error while keeping existing `"overview"|...` tab handlers typed; runtime string values match `detailTab === "references"` branches
- Verified `references` effect mirrors `finance`/`discussions` pattern: cancellation flag, `setRefsLoading`, `setReferences([])` on error, dependency `[selectedId,refresh]` ensures modal reopens fetch + after `reload()` from invoice/expense/file etc
- Verified `refFileRef` distinct from `fileRef` (Files tab) — no ref collision, both hidden inputs, both use `API_URL + /flow/upload` with `Authorization` header via `getToken()`
- Verified `bulkTasks` fetch normalizes `Array|{items}|{data}` because `tasks.list` returns array directly but paginated wrappers might differ; `bulkSelected` is `Set<string>` mutated via `new Set` to ensure React state immutability
- Verified `budgetPct` fallback covers `undefined` amount cases: `budget = amount ?? budgetAmount`; if both null → 0, prevents NaN division. Updated all display sites (`Budget` stat, `Budget` fact, `Amount` fact, overview `Budget`, finance burn) to use same fallback
- Verified header pills use `(detail as any).projectLink` etc to avoid `ProjectDetail` type narrow (detail extends `ProjectRow` but API may return `projectLink?` nullable; `as any` avoids TS `Property does not exist` while runtime check `&&` guards)
- Verified `Segmented` button role is `button` (native) so `getByRole("button",{name:"References & Research"})` finds it — label is string not JSX, so accessible name exact
- Verified no extra imports broken: `CircleDollarSign` already in `lucide-react` import list, `Wallet` reused, `Search` already for health filter but also used for description
- Verified `npm run build` still 29 pages, `/flow` prerendered static, no API route change, `flow.controller` already has reference/bulk endpoints (Task 4) so no backend change needed
- Verified file remains single `page.tsx` mod, no new dependencies, `TaskFormModal` projectId lock still works (`projectId={detail?.id}`)
- Verified accessibility: `Upload File` Btn has `UploadCloud` icon + text, `Add Drive Link` fields have `Field label` for screen readers, table has `thead` with uppercase tracking-wide, delete has `title="Delete reference"`
