# People module — Add Employee + Overview + Directory redesign

**Decision log from the review session (2026-11-14)**

| Question | Answer |
|---|---|
| Scope this pass | Add employee + Overview + Directory |
| Add-employee pattern | 3-step wizard with a live summary |
| Required at creation | Minimum 4 fields (name, role, department, join date) |
| Typography density | Unchanged — keep the existing 12px house scale |

Research used: NN/g *Website Forms Usability: Top 10 Recommendations* (single
column, no placeholder-as-label, explicit required/optional, visible field-level
errors; the cited CHI'14 study: 78% first-try submission on compliant forms vs
42% on non-compliant), NN/g *Wizards* (use for infrequent processes; enforce
order; save state; label steps), NN/g *Progressive Disclosure* (core first,
advanced later).

---

## 1. Add employee

**Before:** one scroll with 21 fields, 1231px of content inside an 810px sheet,
0 native `required` attributes, errors only in one paragraph at the bottom, no
draft, no duplicate check, no photo, two columns even at 390px.

**After:** three steps, four required fields, live summary, inline errors.

| Step | Fields | Notes |
|---|---|---|
| **Who** | Full name\*, Role\*, Department\*, Joined date\*, Employment type, Photo | `*` required; Save now available from here |
| **Job** | Reporting manager (search + select), Work location, Email, Phone, Status, Skills | Optional; manager search filters by name/role |
| **Pay** (HR only) | Salary, Pay frequency, Cost rate, Device ID, Shift start/end, Grace, Weekly offs, Emergency contact | Hidden entirely without `PEOPLE → Approve` |

Behaviour:
- **Inline validation** per field, with the error under that field and
  `aria-invalid`; the step does not advance until it is clean.
- **Draft autosave** to `localStorage`; reopening offers the draft with a
  "Start fresh" escape hatch.
- **Duplicate warning** when name / email / device ID already exists — a warning,
  not a block (two people can share a name).
- **Live summary** rail: avatar, name, role · department, joined date, type,
  status, manager, location, salary (pay-permission only), plus "what happens
  next" (profile, 8-step onboarding checklist, login later).
- **Save now** on step 1 → creates with the minimum four fields. "Finish the
  rest later" is a real path, not a promise.
- **Success state**: instead of silently closing, it confirms with the record
  summary and offers *Open profile*, *Add another*, *Done*. "Add another" keeps
  department + location (HR hires in batches).
- **Keyboard**: Enter = next, Ctrl/Cmd+Enter = create from anywhere, Escape
  closes (draft preserved).
- **Photo** is uploaded after the record is created; a failed photo is a soft
  warning, never a failed hire.
- **Mobile**: single column, step rail collapses, footer keeps 1/3 + Save/Continue.

Files: `apps/web/src/app/(app)/people/_components/modals/employee-form.tsx`.

---

## 2. Overview → command centre

Question it answers: *what needs me today, and how is the month shaped?*

1. **KPI strip** — people, present, late, absent, on leave, pending leave.
2. **Needs your attention** — a single prioritised queue, each row one click from
   the fix: pending leave, not checked in, payroll not run this month,
   onboarding/offboarding open (with stale count), profiles missing an email,
   employees without a fingerprint device. Empty state is a green "all clear".
3. **Right now** — inside / left / not-in, then the latest arrivals with times
   and a link to the live board.
4. **Attendance rate** — six months, bars; months without attendance show a
   dashed "—" instead of a misleading red 0%; average is computed only over
   months with data. Below it, this month's late days / absent / leave / meetings.
5. **Departments** — headcount share per team.
6. **Upcoming** — next holiday from the calendar.
7. **Team snapshot** — six people with today's state, linking to the profile.

Payroll items and the payroll fetch are gated on `PEOPLE → Approve`, so a
view-only role never sees "payroll not run" or fires a 403.

Files: `apps/web/src/app/(app)/people/page.tsx`, `_components/hero.tsx`
(stats now a 2-column grid on phones instead of five stacked full-width tiles).

---

## 3. Directory

- **Search** across name, role, department, email.
- **Filters**: department, status, plus one-tap chips — Late today, Not logged,
  On leave, No device, Missing email; "Clear all" appears when anything is on.
- **Sortable columns**: employee, role, department, manager, status, device,
  salary (pay-permission only), utilization — with direction arrows.
- **Bulk select** per page with CSV export of the selection (or the whole
  filtered set).
- **Profile gaps are visible**: "no email" and a missing device ID render amber,
  matching the quick filters.
- **Row actions**: attendance for that person, open profile. Whole row is
  clickable and keyboard-operable; checkbox and action cells stop propagation.
- **Manager column** replaced the low-signal employment-type column.
- Empty state is context aware ("no employees yet" vs "no match — clear filters").

Files: `apps/web/src/app/(app)/people/directory/page.tsx`.

---

## 4. Verified

```
Playwright: 20/20 pass (incl. wizard happy path, required-field blocking,
             edit + persistence, analytics, team shoots, payroll, authz)
Typecheck: API + web clean
Visual: qa-evidence/people-redesign/*.png (desktop + mobile, steps 1–3, success)
```

The wizard is covered by `e2e/people-directory-crud.spec.ts`:
- step 1 blocks with three inline errors when empty;
- full path creates via API (201), shows the success card, opens the profile;
- the probe record is removed afterwards.

---

## 5. Deliberately not in this pass

- Employee 360 tabs (Overview / Attendance / Leave / Pay / Tasks / Shoots /
  Assets / Documents) — next pass.
- Employee code (`EMP-001`) and login invite from the wizard — needs a schema
  migration / user provisioning.
- Directory peek drawer, saved views, column chooser.
- Attendance/Payroll visual polish.

The existing 12px scale, card radius, and colour tokens were kept exactly as the
design system specifies; no new typography was introduced.
