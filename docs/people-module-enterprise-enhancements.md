# People module → enterprise HRM

Gap analysis, shipped changes and a prioritised roadmap.
_Workspace: Zoolyum OS · module: `apps/api/src/people` + `apps/web/src/app/(app)/people`_

---

## 0. What the module already does

| Domain | Capability | Where |
|---|---|---|
| Directory | Employee CRUD, photo (WebP + JXL), documents, career history, emergency contacts | `directory.service.ts` |
| Org | Reporting tree with cycle promotion, skills matrix | `directory.service.ts` |
| Attendance | ZKTeco `iclock` push, device mapping, raw punch import, kiosk, self punch, daily recompute, corrections with audit trail, work calendar overrides, holidays, late list, trends, live board | `attendance.service.ts` |
| Leave | Apply → approve → balance deduction, quotas per type, working-day aware | `leave.service.ts` |
| Payroll | Period run, late/half/absent/unpaid deductions, finalize, payslip | `payroll.service.ts` |
| Performance | Reviews, OKRs | `performance.service.ts` |
| Learning | Courses + enrollments | `training.service.ts` |
| Hiring | Candidate pipeline | `recruitment.service.ts` |
| Lifecycle | Auto-onboarding on create, auto-offboarding on EXITED | `onboarding.service.ts` |
| Assets | Register, assign, return | `assets.service.ts` |
| Self service | My space: punch, leave, payslip, telegram link | `me.service.ts` |
| Team view | Employee 360: attendance, tasks, meetings, leave, payroll | `team.service.ts` |
| Automation | Monthly utilisation rebuild, attendance recompute | `people-automation.service.ts` |

This is a solid mid-market HRM. The gaps below are what separates it from an
enterprise deployment (500+ employees, external audit, statutory payroll).

---

## 1. Defects found by the QA pass (all fixed in this change)

| # | Severity | Defect | Root cause | Fix |
|---|---|---|---|---|
| 1 | **P0** | "I cannot add an employee" — 403 on `POST /people/employees` for any role not literally named `Owner` / `HR/Admin`, even with `PEOPLE → Edit`. Reproduced with a custom `Admin` role created through Control. | Writes were gated on **role names** (`@Roles(...HR_ROLES)`) while the UI gated on the **permission matrix**. Two sources of truth, one of them wrong. | People writes now gate on the permission matrix (`PEOPLE.edit` / `PEOPLE.approve`). Legacy role names still accepted for old tokens. |
| 2 | **P0** | Payroll, devices, attendance policy, leave policy and automation were unreachable for custom HR roles (same name-gating). Conversely, after any naive "remove the role check" fix, payroll would leak to view-only roles. | Same. | Money/policy endpoints got an explicit `PEOPLE → Approve` requirement; reads stay view-level, payroll stays locked to approve. Verified: view-only role gets 403 on payroll, approve-level gets 200. |
| 3 | **P1** | Compensation visibility depended on the role *name* (`PAY_ROLES`), so a custom HR role saw `salary: null` and a legacy `Admin` role saw pay with no permission review. | Three separate `PAY_ROLES` copies (`directory`, `team`, `payroll`). | One helper in `people-utils.ts`: pay = `PEOPLE.approve` (or legacy HR name). Used everywhere. |
| 4 | **P1** | Project Manager could not approve leave from the API: `PermissionsGuard` derived `edit` from `PATCH`, and PM has view-only — even though `LeaveService` explicitly lists PM as an approver. UI showed the Approve button, API answered 403. | Guard level vs service rule disagreement. | `PATCH /people/leave-requests/:id` requires `PEOPLE.view` only; the service owns the approver list (Owner, HR/Admin, PM, any `PEOPLE.approve`). |
| 5 | **P1** | No way to add a person from the People landing page or Team 360 — only the Directory tab had the button. | Discoverability. | "Add employee" on Overview and Team 360; save navigates/refreshes to the new record. |
| 6 | **P1** | The add form exposed 11 of the 20 fields the API accepts: no reporting manager, status, cost rate, pay frequency, shift, grace, weekly offs, skills, or device in context. Every hire needed a second edit pass. | Stub form. | Full sectioned form (Identity / Contact / Compensation / Schedule / Profile), manager dropdown, weekday chips, salary fields hidden unless `PEOPLE.approve`. |
| 7 | **P2** | Shoots existed in Flow (`ShootCrew`) but appeared nowhere in People — "who went to how many shoots" was unanswerable. | Never joined. | `shoots` block in Employee 360 + a Shoots tab. |
| 8 | **P2** | No per-person × per-month management view. Tasks/late/meetings were only visible for one person, one window at a time. | No aggregation layer. | New `GET /people/analytics/monthly` + `/people/analytics` page + CSV. |

---

## 2. What "management wants to see" now looks like

`/people/analytics` (Team → Analytics) answers, for every person and every month:

- tasks completed, on-time context
- late days **and** late minutes
- absent days, half days, leave days
- meetings attended vs invited
- shoot days
- worked hours (attendance) vs logged hours (tasks)

Numbers are aggregated from the same tables the operational screens read, so
the management view cannot disagree with the daily view. The QA sweep
cross-checks analytics against `/people/attendance/employee/:id` for every
employee and fails on any mismatch.

Still missing from the "management" story (see roadmap): billable vs
non-billable split per person, cost per person per month, attrition, and the
arriving/leaving timeline at team level (the live board exists but is a
snapshot, not a history).

---

## 3. Enterprise gaps, by domain

### 3.1 Employee lifecycle
- **Employee code / staff ID** — currently only `deviceId`. Payroll, statutory records and bank files need a stable human-readable ID.
- **Probation & confirmation** — `probationEndsOn`, auto-alert, confirm action.
- **Effective-dated changes** — promotions/transfers today overwrite the record; audits need history rows (`EmploymentHistory` with `effectiveFrom`).
- **Exit workflow** — clearance checklist exists, but no exit interview, final settlement, gratuity calc, or rehire flag.
- **Contract & documents** — expiry tracking, e-sign, acknowledgement.

### 3.2 Positions & org design
- `Position` table (title, grade, cost centre, budgeted headcount, reports-to-position).
- Approved headcount vs actual → hiring requisitions.
- Matrix (dotted-line) reporting; span-of-control reporting.

### 3.3 Time & attendance
- **Shift roster** (patterns, rotating, night shift) — today each employee has one shift.
- **Overtime request/approval** with policy caps; currently overtime is computed but never approved or paid separately.
- **Break tracking**, geo-fenced mobile punch, device dedupe, anomaly queue ("no punch out 3 days running").
- **Attendance correction requests** from employees (ESS) with approval, not just HR edits.
- **Location-aware holidays** (Dhaka vs Chattogram vs remote).

### 3.4 Leave
- **Accrual engine**: monthly accrual, pro-rata for joiners, carry-forward caps, encashment, lapse.
- Half-day leave, comp-off, WFH as absence type, long-service leave.
- Blackout dates, delegation of approval, team leave calendar with coverage warnings.

### 3.5 Payroll (biggest gap)
- **Salary structure**: earnings components (basic, house rent, transport, medical, special) and deductions (PF, tax, loan, canteen). Today it is a single `salary` plus computed deductions.
- **Bangladesh statutory**: income tax slabs + investment rebate, provident fund (employee/employer), gratuity accrual, festival bonus (2× basic), maternity benefit, minimum wage check.
- **Payroll run object**: draft → review → approve (maker–checker) → paid, with variance report vs last month and lock after finalize.
- **Arrears** when salary changes mid-period; **loans/advances** with instalment schedule.
- **Bank disbursement file** (BEFTN/CSV) and payslip email.
- **GL posting** to Accounts (salary expense, PF payable, tax payable) — the chart of accounts already exists.
- **Payslip versioning** so a re-run doesn't silently rewrite history.

### 3.6 Performance
- Review cycles (self → manager → calibration), 360 feedback, competency framework.
- Goal cascade from company OKRs, weighting, check-ins.
- PIP, 9-box, promotion readiness, compensation review linked to rating.

### 3.7 Recruitment
- Requisition → approval → posting → pipeline stages → interview scorecards → offer letter → **convert candidate to employee** (one click, pre-filled).
- Source tracking (cost per hire, time to hire).

### 3.8 Learning
- Certification expiry alerts, mandatory compliance training with completion %, training budget per department.

### 3.9 Engagement & retention
- Pulse/eNPS surveys, recognition feed, 1:1 cadence.
- Attrition-risk flag already exists (`AttritionRiskFlag`) but nothing writes to it; add rules (late spike, leave spike, no 1:1, comp below band) and surface in Team 360.

### 3.10 Compliance & audit (Bangladesh Labour Act 2006)
- Working-hour and overtime limits, weekly holiday, annual leave (10–15 days), 16-week maternity, festival holidays.
- Wage register, service book, attendance register retention.
- **Every HR mutation already writes an audit trail in some places** — extend field-level before/after to salary, status, schedule, leave decisions, payroll edits.
- Segregation of duties: the person who runs payroll should not be the person who approves it.

### 3.11 Analytics (beyond what shipped)
- Headcount waterfall (joiners/leavers), attrition rate by department/tenure, cohort retention.
- Cost per hire, time to hire, offer acceptance.
- Revenue per employee, utilisation vs billable, bench report.
- Absenteeism (Bradford factor), overtime cost, payroll variance, span of control.
- **Arriving/leaving timeline** — turn the live board snapshot into an event log so "who came late and left early" is queryable per month.

### 3.12 Self-service & mobile
- ESS: payslip download, leave apply, attendance correction request, profile change request (approval), document upload, asset acknowledgement, tax declaration.
- Manager ESS: team calendar, approve queue, 1:1 notes.
- Already partly there: My space, kiosk, Telegram link.

### 3.13 Security & privacy
- Field-level masking is implemented for pay/emergency contacts — extend to NID/TIN/bank.
- PII access logging ("who opened whose profile"), export/delete for data-subject requests.
- 2FA for HR roles; IP allowlist for payroll.
- Scope tokens: a department manager sees only their subtree.

### 3.14 Integrations
- Accounting GL (invoices already post), biometric devices (done), Google Workspace/AD user provisioning, Slack/Teams notifications, bank payroll file, e-sign, background verification.

### 3.15 Automation & alerts
- Probation ending, contract/document expiry, birthday/anniversary, attendance anomaly, payroll cut-off, leave balance low, certification expiry, unapproved overtime.
- Escalation chains ("pending leave > 48h → manager's manager").

---

## 4. Roadmap

| Phase | Items | Why first | Effort |
|---|---|---|---|
| **Now (shipped)** | Permission-based authz, full add form, analytics matrix, shoots, CSV | Unblocks daily HR work + management reporting | — |
| **Next (4–6 weeks)** | Salary structure + payroll run with maker–checker, arrears, PF/tax, bank file; leave accrual engine; attendance correction requests; audit trail on all HR writes | Payroll correctness and statutory exposure are the top enterprise blockers | L |
| **Then (1–2 quarters)** | Positions & headcount budget; requisition → offer → convert; review cycles; attrition scoring; ESS portal expansion; GL posting | Turns HRM into a planning system, not a register | L |
| **Later** | Geofenced mobile punch, roster patterns, engagement surveys, e-sign, AD sync, PII access log, 2FA | Scale + compliance hardening | M–L |

Each "Next" item should ship behind a permission so smaller installs can ignore it.

---

## 5. Data-model sketch (next phase)

```prisma
model Position { id, title, grade, department, costCenterId, budgetedHeadcount, reportsToPositionId }

model Employee { // additions
  employeeCode String @unique
  positionId   String?
  confirmationDate DateTime?
  probationEndsOn  DateTime?
  noticePeriodDays Int @default(0)
  bankAccount  String?  tin String?  nid String?
  bloodGroup   String?  maritalStatus String?
}

model EmploymentHistory { id, employeeId, effectiveFrom, type, fromValue, toValue, note, createdById }

model SalaryComponent { id, name, kind(EARNING|DEDUCTION), taxable, statutory, formula }
model EmployeeSalaryComponent { id, employeeId, componentId, amount, effectiveFrom, effectiveTo }
model PayrollRun { id, period, status(DRAFT|REVIEW|APPROVED|PAID), totals Json, approvedById, approvedAt }
model Loan { id, employeeId, principal, instalment, remaining, startPeriod }
model LeaveAccrualPolicy { id, leaveType, accrualPerMonth, carryForwardCap, encashable }
model Shift { id, name, start, end, breakMinutes, graceMinutes }
model RosterAssignment { id, employeeId, shiftId, from, to }
model OvertimeRequest { id, employeeId, date, minutes, status, approvedById }
model AttendanceCorrectionRequest { id, attendanceId, requestedById, field, value, reason, status }
model Goal { id, employeeId, parentOkrId, title, weight, progress }
model ReviewCycle { id, name, from, to, status }
model Requisition { id, positionId, raisedById, status, budgetedCtc }
model Interview { id, candidateId, stage, interviewerId, score, notes }
model Survey { id, name, type, closesAt } / SurveyResponse
```

---

## 6. Metric definitions (so two dashboards cannot disagree)

| Metric | Definition |
|---|---|
| Late days | Attendance rows with `status = LATE` in the month |
| Late minutes | `max(0, checkIn − (shiftStart + grace))`, Dhaka wall time |
| Absent days | `status = ABSENT` in the month |
| Worked hours | `Σ(checkOut − checkIn)` for rows with both stamps, capped at 24h |
| Tasks completed | `Task.status = DONE` and `completedAt` inside the month |
| Logged hours | `Σ TimeLog.hours` in the month |
| Meetings attended | `LeadMeetingAttendee.status = ATTENDED` for meetings scheduled in the month |
| Shoot days | distinct `Shoot.shootDate` where the employee is crewed, excluding `CANCELLED` |
| Leave days | approved leave days falling in the month, Fri/Sat excluded |
| Utilisation | billable hours ÷ available hours (existing weekly cron) |

---

## 7. Acceptance criteria for the next phase

1. Payroll cannot be finalized without a second approver when the workspace enables maker–checker.
2. A salary change produces an arrears line in the next run, and a payslip version history.
3. Leave balance = opening + accrued − taken ± adjustment, for every employee, provable by an audit query.
4. Every HR mutation has an audit row with actor, before, after.
5. Analytics page matches the operational report for any employee/month (automated check exists in `qa/people-endpoint-sweep.mjs`).
6. A role created in Control with `PEOPLE → Edit` can do everything an HR user can do; with only `View` it can do nothing but read.
