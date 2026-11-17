# Project Shoots + Deliverable Intelligence + Campaign Reporting

Implemented: **2026-11-14**
Scope: Flow (projects) module — new **Shoot** tab, upgraded **Deliverables**, upgraded **Reports**.
Plan: `docs/superpowers/plans/2026-11-14-project-shoot-deliverables-reporting.md`

---

## 1. What it does

### Shoot — production call-sheet (independent of deliverables)

Every project has a **Shoot** tab. A shoot is a logistics record, not a commitment:

| Field | Notes |
|---|---|
| Title, shoot date | Date is required; a shoot without a day is not a shoot |
| End date | Multi-day productions |
| Duration | Half day / Full day |
| Call time, wrap time | `HH:MM` validated |
| Date lock | Crew booked — the calendar event must not move the shoot |
| Location, maps link, location note | Gate/floor/instructions |
| Description, production notes | Concept/setups + internal notes |
| Equipment | Free-text list, trimmed + de-duplicated, max 100 |
| Campaign | Optional, must belong to the same client |
| Status | Planned / Confirmed / In progress / Wrapped / Cancelled |
| Crew | Role + source (Team / Vendor / External) + call time + fee + confirmed |

Crew roles: DoP, Cameraman, Assistant camera, Gaffer, Grip, Sound, Art director, Stylist,
Makeup, Producer, Line producer, Photographer, Drone operator, Driver, Talent, Team member,
Other.

Crew stores a **name snapshot** (`ShootCrew.name`), so the call-sheet still reads correctly
after an employee leaves or a vendor is deleted.

### Deliverables — per-item commitments

Each deliverable is one row (no quantity field) with:

- **Type**: Graphic / Video / Photo / Copy / Other
- **Topic** — what the item actually is
- **Objective** — why it exists (Awareness / Launch / Conversion…)
- **Campaign** — optional, same-client validation
- Owner, start/due date, client-visible, description
- Tasks linked — a completed task auto-marks the deliverable delivered

**Bulk paste** creates many rows in one submit with a default type/campaign/objective.
Type chips show progress per kind (`Graphic 6/8`).

### One-click assign

Select deliverables → **Assign as tasks** → choose the assignee (the only required field).

- One task per deliverable, `deliverableId` linked
- Task title = topic (fallback: title); description = objective + description
- Kind → task type: `GRAPHIC→design`, `VIDEO→video`, `PHOTO→photo`, `COPY→copy`, else `general`
- Already-linked deliverables are **skipped, never duplicated**
- Department task-type rules still apply: a blocked task is reported per item, the rest continue
- Co-assignees, priority, due-date override and client-visible are optional

### Reports

Generate from a period, optionally scoped to **one campaign**, grouped by
**Campaign / Type / Owner / Flat**.

The report is a **frozen snapshot**: editing a shoot or deliverable later never rewrites it.

Sections: summary cards, type breakdown, delivered (grouped), pending (grouped), shoots with
crew + equipment, billing snapshot, PM notes. Export to **A4 PDF** from the report card.

---

## 2. Data model

New tables: `Shoot`, `ShootCrew`.
New enums: `ShootDuration`, `ShootStatus`, `ShootCrewRole`, `ShootCrewSource`,
`DeliverableKind`, `ReportGrouping`.

`ProjectDeliverable` gained `kind`, `topic`, `objective`, `campaignId` (+ indexes).
`ProjectReport` gained `groupBy`, `campaignId`, `campaignLabel`, `summary` (Json),
`shoots` (Json snapshot).

Migration: `apps/api/prisma/migrations/20261114094933_project_shoots_deliverable_reporting`.

---

## 3. API (all under `/api/flow`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/projects/:id/shoots` | list with crew + campaign |
| POST | `/projects/:id/shoots` | create (+ calendar event) |
| GET | `/shoots/:id` | detail |
| PATCH | `/shoots/:id` | update (+ calendar resync) |
| DELETE | `/shoots/:id` | delete (+ calendar event) |
| POST | `/shoots/:id/crew` | add crew (resolves employee/vendor name + phone) |
| PATCH | `/shoots/:id/crew/:crewId` | edit / confirm |
| DELETE | `/shoots/:id/crew/:crewId` | remove |
| POST | `/projects/:id/deliverables/bulk` | paste mode (max 100) |
| POST | `/projects/:id/deliverables/assign-tasks` | one-click assign |

Existing deliverable/report endpoints accept the new fields.

**Calendar sync is one-way** (shoot → `CalendarEvent` type `SHOOT`): date, end date, call/wrap
times, location, description, team crew as attendees, project, client, campaign. Locked dates
are enforced in the shoot editor, not by the calendar.

Audit actions: `flow.shoot.create|update|delete`, `flow.shoot.crew.add|update|delete`,
`flow.deliverable.bulk_create`, `flow.deliverable.assign_tasks`.

---

## 4. UI

- `components/flow/shoot-tab.tsx` — list, summary strip, search, status filter, cards
- `components/flow/shoot-editor.tsx` — call-sheet sheet (2 columns, crew rows, equipment with
  suggestions from earlier shoots, "copy crew from last shoot")
- `components/flow/deliverables-tab.tsx` — filters, bulk paste, inline editor, selection bar
- `components/flow/assign-tasks-modal.tsx` — assignee + options + per-item result
- `components/flow/bulk-deliverables-modal.tsx` — one line per item
- `components/flow/reports-tab.tsx` — generate modal, grouped report card, notes, PDF
- `lib/project-report-pdf.ts` — A4 PDF built from the report snapshot

Flow's project workspace rail now scrolls horizontally on mobile instead of squeezing the
content into a 170px column.

---

## 5. How to verify

```powershell
# schema + data
cd apps/api
npx prisma migrate deploy        # production/staging
npm run prisma:seed              # demo data (destructive: wipes and reseeds)

# types and build
npm run typecheck                # repo root
npm run build                    # repo root

# end-to-end probe against a running API (creates + removes its own records)
npm run test:shoots
```

Scene check (manual):

1. Flow → open a project → **Shoot** → New shoot → save → Calendar shows a `SHOOT` event.
2. Move the shoot to another date → the same calendar event moves (no duplicate).
3. **Deliverables** → Bulk paste 3 lines with type Graphic → rows appear, count chip updates.
4. Select all → **Assign as tasks** → pick a person → tasks created, links visible.
5. Assign again → all skipped ("already linked").
6. **Reports** → Generate (campaign + group by type) → summary, breakdown, shoots, billing.
7. **PDF** → A4 sheet with the same numbers; edit the shoot afterwards → report unchanged.

---

## 6. Known limitations

- **Call-sheet print view** is not included (the plan marked it optional). The shoot still
  appears in the report PDF with crew and equipment.
- **Calendar sync is one-way.** Dragging the mirrored event does not move the shoot; the
  shoot editor is the source of truth.
- **PDF labels are English**; project/crew names can be Bengali (the embedded Hind Siliguri
  font covers it). Mixed-script line breaking in long paragraphs should be spot-checked.
- **Deliverable kind is nullable** for data created before this change; those rows show as
  "Other" / "Unclassified" in breakdowns.
- **No shoot-to-expense link** — crew fees are an informational field, not a payable.
