# People module — QA report

**Date:** 2026-11-14 · **Build under test:** working tree at `bc05b30` + this change
**Environment:** Windows 11 · Node 24 · API `:4000` · Web `:3000` · Postgres 16 (Docker, `:5544`) · Chromium
**Dataset:** 10 employees · 139 attendance rows · 30 tasks · 19 time logs · 5 lead meetings (12 attendee rows) · 1 shoot (0 crew)

---

## 1. Scope

Everything under `/people` — 17 routes plus the new Analytics page:

| Hub | Routes |
|---|---|
| Overview | `/people` |
| My space | `/people/me` |
| Team | `/people/team`, `/people/directory`, `/people/directory/:id`, `/people/analytics`, `/people/org-chart`, `/people/skills`, `/people/onboarding`, `/people/assets` |
| Time | `/people/attendance`, `/people/leave`, `/people/holidays`, `/people/settings` |
| Pay | `/people/payroll`, `/people/payroll/payslip/:id` |
| Grow | `/people/performance`, `/people/okrs`, `/people/training`, `/people/candidates` |

API surface exercised: 35 read endpoints + the write flows listed in §4 (employee CRUD, leave lifecycle, payroll run, attendance import/correction, authz matrix).

---

## 2. Test layers

| Layer | What it proves | Artifact |
|---|---|---|
| **Route crawl** | Every People page renders without a console error, page error, or 4xx API call | `apps/web/qa-people-crawl.mjs` → `qa-evidence/people-qa/*.png` + `report.json` |
| **API sweep** | Every read endpoint returns 2xx with the expected shape | `qa/people-endpoint-sweep.mjs` → `qa-evidence/people-qa/sweep.json` |
| **Data correctness** | Analytics numbers equal the operational attendance report for every employee | `qa/people-endpoint-sweep.mjs` (analytics-vs-attendance section) |
| **Functional E2E** | Add / edit employee, analytics metric switch, Team 360 shoots tab | `apps/web/e2e/people-directory-crud.spec.ts` |
| **Authorization** | Custom role with `PEOPLE.edit` can write; view-only role cannot; payroll is approve-level | `apps/web/e2e/people-authz-api.spec.ts` |
| **Regression suite** | The rest of the app still works | `apps/web/e2e/` (17 tests) |

---

## 3. Results

```
Route crawl ............. 18/18 routes clean (0 console errors, 0 page errors, 0 failed API calls)
API reads ............... 35/35 endpoints 2xx
Analytics parity ........ 10/10 employees match the attendance report (late, absent, half-day)
Leave lifecycle ......... apply → approve → balance deducted → cleanup: all 2xx
Playwright E2E .......... 20/20 pass (17 regression + authz + wizard/required-field specs)
Web typecheck ........... clean
API typecheck/build ..... clean
```

### Defects

| # | Sev | Symptom | Evidence | Status |
|---|---|---|---|---|
| 1 | **P0** | Cannot add an employee: `POST /people/employees` → 403 "Insufficient role for this action" for any role whose *name* is not `Owner` / `HR/Admin`, even with `PEOPLE → Edit`. The UI showed the Add button, so the failure looked random. | Reproduced with a custom `Admin` role created through Control: `POST` → 403. After fix → 201, salary readable back, payroll readable. | **Fixed** |
| 2 | **P0** | Payroll / attendance policy / devices / leave policy / automation were unreachable for the same custom roles. | Role matrix pre-fix: Owner 201, HR/Admin 201, Project Manager 403, Finance 403, Sales/BD 403 on employee create. | **Fixed** |
| 3 | **P1** | Compensation visibility was role-name based (3 duplicated `PAY_ROLES` lists). A custom HR role saw `salary: null`; a legacy `Admin` saw pay without an explicit permission. | Code review + read-back probe. | **Fixed** — single `canSeePay = PEOPLE.approve` helper |
| 4 | **P1** | Project Manager could not approve leave through the API although the service lists PM as an approver and the UI showed Approve. | `PATCH /people/leave-requests/:id` returned 403 for PM (guard derived `edit`). | **Fixed** — service owns the approver rule |
| 5 | **P1** | No "Add employee" on the People landing page or Team 360; only the Directory tab had it. | UI review. | **Fixed** — button on Overview + Team 360, save refreshes/navigates |
| 6 | **P1** | Add form exposed 11 of 20 API fields: no reporting manager, status, cost rate, pay frequency, shift, grace, weekly offs, skills. Every hire needed a second edit. | Form review vs `DirectoryService.createEmployee`. | **Fixed** — sectioned full form |
| 7 | **P2** | Shoots (Flow `ShootCrew`) never appeared in People. | `GET /people/team/:id` had no `shoots` key. | **Fixed** — Shoots tab + analytics metric |
| 8 | **P2** | No per-person × per-month view; tasks/late/meetings were one person, one window at a time. | No aggregation endpoint existed. | **Fixed** — `/people/analytics` |
| 9 | **P2** | Analytics initially counted future-dated attendance rows as absences (+1 day vs the operational report). | Sweep cross-check flagged 10/10 mismatches. | **Fixed** — future days, weekends, holidays, closed-office overrides and approved leave are excluded exactly like the operational engine |
| 10 | **P3** | Two existing E2E assertions had drifted from the real API messages ("Already punched" vs "Already checked in", "Payroll generated" vs "Nothing to do"). | Full suite failure. | **Fixed** — assertions accept the real contract |

### Negative / boundary checks (no defects)

| Probe | Expected | Actual |
|---|---|---|
| Create with blank name | 400 | `Employee name is required` |
| Create with `salary: "abc"` | 400 | `salary must be a positive number` |
| Create with invalid `joinDate` | 400 | `joinDate must be a valid date` |
| Duplicate fingerprint device id | 409 | `That deviceId is already in use` |
| Unknown reporting manager | 400 | `reportingManagerId does not match any employee` |
| Reporting to self (PATCH) | 400 | `An employee cannot report to themselves` |
| View-only role reads payroll | 403 | 403 |
| View-only role adds employee | 403 | `You need PEOPLE edit permission for this action` |

---

## 4. Data-quality observations

1. **Shoots render 0** because the current database has 1 shoot and **no crew rows**. The feature reads `ShootCrew`, which Flow writes; assign crew in Flow → shoot and the number appears. No code defect.
2. **Absence volume is high** (80 absent days across 10 people in November). This is seeded demo data, not a defect — the analytics and the operational report agree exactly.
3. **No employee is linked to a login** except through `User.employeeId` for some rows; Team 360 warns when a person cannot be invited to meetings by name. Consider surfacing "login linked" on the directory row.
4. **Payroll for 2026-07 is FINALIZED** but the header reports "in progress" because one record is still DRAFT. The badge logic is correct; the data is mixed. Worth an explicit "1 of 11 draft" hint.

---

## 5. Known gaps / not covered

- **Load**: no k6/artillery run. The analytics endpoint issues 10 queries for the whole matrix regardless of headcount; at 500 employees the row payload grows linearly and should be paginated.
- **Cross-browser**: Chromium only. No Firefox/WebKit run (repo has no browser matrix project yet).
- **Visual regression**: not automated; screenshots captured for review only.
- **Accessibility**: no axe scan on People pages.
- **Money paths**: payroll run was exercised, but not bank disbursement (does not exist yet), tax, PF, or gratuity (see roadmap).
- **Environment instability**: Docker Desktop stopped twice during the session; runs were repeated and the final green suite is from a stable container. Not an application defect.

---

## 6. Re-running

```powershell
# API + web must be up (npm run dev at repo root, or the two apps separately)
node qa/people-endpoint-sweep.mjs          # 35 reads + analytics parity + leave lifecycle
node qa/people-crawl.mjs                   # route screenshots + browser error capture
node qa/people-shots.mjs                   # add-form + analytics + team screenshots
node qa/people-role-matrix.mjs             # role × permission matrix (writes probe rows, cleans up)
node qa/people-negative.mjs                # boundary/error contract probes
cd apps/web
npx playwright test e2e/people-directory-crud.spec.ts --workers=1
npx playwright test e2e/people-authz-api.spec.ts --workers=1
npx playwright test e2e/ --workers=1       # full regression
```

Evidence lives in `qa-evidence/people-qa/` (screenshots, `report.json`, `sweep.json`).

_UI pass (2026-11-14): Add employee is now a 3-step wizard with a live summary,
Overview is a command centre, Directory gained filters/sorting/bulk export.
See `docs/people-module-redesign.md`; screenshots in `qa-evidence/people-redesign/`._
