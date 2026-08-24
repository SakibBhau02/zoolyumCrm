# Zoolyum OS
# Agency Operating System — Master Product Requirements Document

**Prepared for:** Sakib, Founder & CEO, Zoolyum
**Date:** August 13, 2026
**Purpose:** This is the final, consolidated, build-ready specification for Zoolyum OS — covering every module at full implementation depth. This document is written to be handed directly to a development process (including AI-assisted/"vibe" coding) for scaffolding data models, workflows, screens, and business logic.

---

## বাংলা নির্বাহী সারসংক্ষেপ

এই ডকুমেন্টে Zoolyum OS-এর **সবগুলো মডিউল** — CRM, Client Management, Project Management, Task Management, HRM, Finance, Reports, Client Portal, এবং Admin — একই গভীরতায় (Finance module যেভাবে লেখা হয়েছিল) সম্পূর্ণ বিস্তারিতভাবে লেখা হয়েছে। প্রতিটা মডিউলে আছে:

- সম্পূর্ণ **feature specification**
- **Data model** (entities, fields, relationships)
- **Roles & permissions** table
- **Business rules & automation** table
- **Key screens**
- **Integrations**
- **Success metrics**
- **Build priority (quick win)**

এটাই ফাইনাল single document — development শুরু করার জন্য প্রস্তুত।

---

## 0. Executive Summary

**The Situation:** Zoolyum runs client work (education, healthcare, D2C) across scattered tools — spreadsheets for finance, WhatsApp/email for client updates, disconnected task trackers for delivery, manual attendance/HR tracking. As the agency scales, this fragmentation caps growth: no single source of truth for lead-to-cash, no visibility into team utilization, no professional client-facing layer.

**The Insight:** Most agencies buy 4 separate SaaS tools (CRM + PM + HRM + Accounting) and never get a unified view. The real moat isn't any single module — it's the **connective tissue**: a Lead becomes a Client becomes a Project becomes Tasks consuming Team hours that roll up into Finance and Reports, with Clients watching a slice of it live. On top of that connective loop, every module carries an **intelligence layer** — automation rules and cross-module correlation that surface decisions, not just data.

**What this document is:** The complete, final build spec for Zoolyum OS — an internal system first, architected cleanly enough to become a white-labeled product for other agencies later.

---

## 1. Product Naming & Module Map

**Product Name:** **Zoolyum OS**
**Positioning:** Not a task tool, not a CRM — an operating system. Every function an agency needs to run (sell, deliver, staff, bill, report) lives inside one connected data model.

| Module Codename | Function |
|---|---|
| **Pulse** | CRM / Lead Pipeline |
| **Accounts** | Client Management |
| **Flow** | Project Management |
| **Tasks** | Task Management |
| **People** | HRM |
| **Capital** | Finance |
| **Insight** | Reports & Analytics |
| **Portal** | Client Portal |
| **Control** | Admin & Settings |

---

## 2. Goals & Non-Goals

### 2.1 Goals
1. Single source of truth for Leads → Clients → Projects → Tasks → Time → Billing.
2. Every team member gets a daily home screen: "what do I do today, and why does it matter."
3. Owner-level real-time pulse: pipeline value, project health, team utilization, cash position, profitability per client.
4. Branded, read-only client portal — status, deliverables, invoices — cutting status-update overhead and boosting perceived professionalism.
5. HRM deep enough to fully replace manual attendance/leave/payroll tracking.
6. Finance deep enough to replace the current manual Excel-based accounting workflow with a real, live accounts management system.
7. Architecture clean enough to white-label and resell to other agencies later.

### 2.2 Non-Goals (Initial Build)
- Not a public-facing marketing automation tool (email drip campaigns, ad platform buying) — separate tool, out of scope.
- Not a statutory bookkeeping system for legal tax filing — produces clean data for an accountant, doesn't replace one.
- Not a native mobile app initially — fully responsive web first.
- Not multi-country/multi-entity consolidated accounting initially — BDT-first, USD-aware, single-entity with a lightweight business-unit tag.
- Not direct bank fund disbursement (paying salaries/vendors from the system) — records and tracks, doesn't execute transfers.

---

## 3. Users & Roles (System-Wide)

| Role | Who | Primary Need |
|---|---|---|
| **Owner/CEO** | Sakib | Full visibility and control across every module |
| **Sales/BD Lead** | BD team | Pipeline, proposals, conversion tracking |
| **Project Manager (PM)** | Delivery leads | Task assignment, project health, timelines, client comms |
| **Team Member** | Designers, editors, marketers, devs | Daily tasks, hours, attendance, leave |
| **HR/Admin** | Ops person or Sakib | Attendance, leave, payroll prep, onboarding |
| **Finance/Accounts** | Ops person or Sakib | Invoicing, expenses, reconciliation, reporting |
| **Client (External, Portal-only)** | School admins, clinic owners, D2C brand owners | Own project status, deliverables, invoices — isolated access |

**Permission model:** Role-Based Access Control (RBAC), granular per module (view/edit/approve/none), plus strict client-level data isolation — a client only ever sees records tagged to their own `client_id`.

---

## 4. Cross-Module Architecture & Data Flow

```
Pulse (lead score + forecast)
        ↓ feeds
Insight (revenue forecasting) ←──────────┐
        ↑ feeds                          │
Accounts (client health, churn risk)     │
        ↓ feeds                          │
Flow (project risk engine) ←── People (utilization, overload)
        ↓ feeds                          ↑ feeds
Tasks (smart prioritization)             │
        ↓ feeds                          │
Capital (live profitability) ────────────┘
        ↓ feeds
Portal (live client-facing status)
        ↓ feeds back
Insight (executive digest — the whole loop, summarized)
```

**Core lifecycle:**
```
LEAD (Pulse) → [Convert] → CLIENT (Accounts) → [Create Project] → PROJECT (Flow)
  → [Break into] → TASK (Tasks) → [Team logs hours] → PEOPLE
  → [Hours + cost roll up] → CAPITAL (live profitability)
  → [Invoice generated] → PORTAL (client sees status + billing)
  → [Everything rolls up] → INSIGHT (executive dashboard)
```

**What most people miss here:** Agencies that buy separate tools for each function never close this loop — profitability per client becomes a manual, monthly reconciliation exercise. Building this as one system means profitability, risk, and client health become **live numbers**, not periodic chores.

---

## 5. Module 1 — Pulse (CRM / Lead Pipeline)

### 5.1 Objective & Scope
Capture and convert every inbound/outbound lead with full pipeline visibility, predictive scoring, and revenue forecasting — replacing ad-hoc tracking in sheets/Messenger.

**In-scope:** Lead capture (manual, form, Facebook Lead Ads), pipeline management, proposal tracking, lead scoring, conversion to client, win/loss analysis, revenue forecasting.
**Out-of-scope:** Email marketing automation, paid ad campaign management (that's the client's ad account, not this CRM).

### 5.2 Feature Specification

**Lead Capture:**
- Manual entry, web form webhook, Facebook Lead Ads integration, email-to-lead forwarding
- Minimum-friction creation: name + contact + source only at creation; enrich later

**Pipeline Management:**
- Customizable stages: `New → Contacted → Proposal Sent → Negotiation → Won/Lost`
- Kanban board (drag-and-drop) + list view
- Activity log per lead: calls, emails, meeting notes, manual WhatsApp note logging
- Proposal/quote attachment with version history
- Follow-up reminders, auto-task creation on stage entry

**Lead Scoring (Predictive):**
- Weighted 0–100 score based on: source quality (historical conversion rate of that channel), budget-range fit, response time to first contact, engagement signals (proposal opened, replied to follow-up), industry-vertical match to Zoolyum's strongest segments
- Ranked list view — BD works hottest leads first, not just newest

**Stale Lead Auto-Escalation:**
- Configurable SLA per stage (e.g., "Proposal Sent" idle > 5 days) auto-flags to BD lead; high-value deals also notify Owner

**Win/Loss Analysis:**
- Lost-reason tagging (price, timing, competitor, ghosted, no budget)
- Quarterly pattern report by vertical/source/deal-size band

**Proposal Engagement Tracking:**
- If proposal sent as a portal link (not just PDF), track opens, time-on-page, section-level view time

**Referral/Repeat-Client Source Tracking:**
- Distinguish cold / referred / repeat-client leads — different conversion-probability weighting in forecasting

**Revenue Forecasting:**
- Weighted pipeline value = Σ(deal size × stage-based win probability)
- Rolling "expected revenue next 90 days" figure

### 5.3 Data Model

```
Lead
  - id, name, company, contact_email, contact_phone, source (Facebook/Referral/Cold/Website/Other),
    vertical (Education/Healthcare/D2C/Other), stage, lead_score (calculated),
    estimated_deal_size, currency, assigned_to (BD user_id), created_at, converted_client_id (nullable)

LeadActivity
  - id, lead_id, type (call/email/meeting/note), content, logged_by, logged_at

Proposal
  - id, lead_id, version_number, file_url or portal_link, sent_date,
    viewed (bool), view_duration_seconds, status (Draft/Sent/Accepted/Rejected)

LostReason
  - id, lead_id, reason_category (Price/Timing/Competitor/Ghosted/No_Budget), notes, recorded_at

PipelineStage (configurable)
  - id, name, order, sla_days (for stale-lead flagging)
```

**Key relationships:** `Lead (1) ──< LeadActivity (many)`, `Lead (1) ──< Proposal (many)`, `Lead (1) ──[convert]──> Client (1)` (see Module 2).

### 5.4 Roles & Permissions

| Role | Leads | Pipeline | Proposals | Forecast Reports |
|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Full |
| BD/Sales Lead | Full (own + team) | Full | Full | View |
| PM | View (converted leads → their projects only) | No access | View (own client's) | No access |
| Team Member | No access | No access | No access | No access |

### 5.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| New lead from Facebook Lead Ads | Auto-created, source-tagged, assigned by round-robin or vertical specialization |
| Lead idle beyond stage SLA | Auto-reminder to BD owner; high-value idle deals also notify Owner |
| Deal marked "Won" | Auto-triggers Client record creation + onboarding checklist + project-creation prompt |
| Deal marked "Lost" | Prompts lost-reason tagging before fully closing the record |
| Proposal viewed in portal | BD notified in real time |

### 5.6 Key Screens
1. Pipeline board (Kanban, lead-score badges, color-coded hot/warm/cold)
2. Lead detail (contact info, activity timeline, proposal history)
3. Revenue forecast dashboard (weighted pipeline by vertical/BD owner/time)
4. Win/Loss analysis report

### 5.7 Integrations
Facebook Lead Ads (Phase 1), Google Forms/website contact form webhook (Phase 1), WhatsApp Business API for activity logging (Phase 2).

### 5.8 Success Metrics
- % of leads logged in-system: 90%+
- Lead-to-client conversion rate visibility: 100% source-attributed
- Forecast accuracy (weighted pipeline vs. actual closed revenue): tracked and improved quarter over quarter

### 5.9 Build Priority
1. Lead capture + pipeline (Kanban) 2. Conversion-to-client flow 3. Lead scoring 4. Forecasting + win/loss analysis

---

## 6. Module 2 — Accounts (Client Management)

### 6.1 Objective & Scope
Permanent, structured record for every client relationship, with a live health score and renewal/churn intelligence — replaces scattered files and WhatsApp history.

**In-scope:** Client profiles, contract/document storage, multi-stakeholder contact management, health scoring, renewal tracking.
**Out-of-scope:** Contract e-signature workflow (v1 stores signed docs; native e-sign is a later integration).

### 6.2 Feature Specification

**Client Profile:**
- Company info, industry vertical, multiple key contacts (relevant for school clients with several decision-makers), assigned account owner/PM
- Linked records: all Projects, Invoices, Tasks, Communication log in one view (tabbed)

**Contract & Retainer Management:**
- Scope, billing cycle (monthly retainer / project-based / one-time), renewal date with auto-reminders
- Document vault: MOUs, signed proposals, brand assets, encrypted credential storage

**Composite Client Health Score (multi-factor, auto-calculated):**
- Weighted blend of: payment punctuality, project delivery status, engagement recency, profitability trend, scope-creep frequency
- Displayed Green/Yellow/Red **with driver called out** (e.g., "Yellow — 2 overdue invoices + declining margin over 3 months")

**Churn Risk Prediction:**
- Pattern-matches current client engagement against historically churned clients (meaningful from ~6 months of data onward)

**Renewal Intelligence:**
- Auto-surfaced renewal-readiness brief for retainer clients approaching renewal: health score, cycle profitability, scope-creep incidents, suggested talking points

**Multi-Stakeholder Relationship Mapping:**
- Per-contact engagement tracking (portal logins, response speed) to identify the real decision-maker/influencer

**Contract/SOW Deviation Tracking:**
- Flags when logged deliverables/hours materially exceed signed scope — the most common hidden profitability killer

### 6.3 Data Model

```
Client
  - id, company_name, industry_vertical, account_owner_id, health_score (calculated),
    health_score_driver (text), billing_cycle_type, currency_preference,
    contract_start_date, renewal_date, created_at

ClientContact
  - id, client_id, name, role_title, email, phone, is_primary (bool),
    portal_access_enabled (bool), last_portal_login

ClientDocument
  - id, client_id, type (MOU/Proposal/Brand_Asset/Credential), file_url,
    uploaded_by, uploaded_at, is_encrypted (bool)

ClientHealthLog (historical snapshots for trend tracking)
  - id, client_id, score, driver_summary, recorded_at

ChurnRiskFlag
  - id, client_id, risk_level, matched_pattern_description, flagged_at
```

**Key relationships:** `Client (1) ──< Project (many)`, `Client (1) ──< ClientContact (many)`, `Client (1) ──< ClientDocument (many)`, `Client (1) ──< Invoice (many)` (Module Capital).

### 6.4 Roles & Permissions

| Role | Client Profiles | Contracts/Docs | Health Score | Churn/Renewal Reports |
|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Full |
| Account Owner/PM (own clients) | Full (own) | Full (own) | View (own) | View (own) |
| Finance | View | View (contract terms only) | View | No access |
| Team Member | View (assigned projects' client only) | No access | No access | No access |
| Client (Portal) | Own profile display info only | Own documents shared with them | No access | No access |

### 6.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Health score drops to Red | Auto-notify account owner; Strategic-tier clients also notify Owner |
| Retainer renewal date − 30 days | Auto-generate renewal brief + task for account owner |
| Invoice overdue 15+ days | Health score auto-adjusts downward, account owner notified |
| Logged hours/deliverables exceed signed scope threshold | Flag for scope-change conversation |

### 6.6 Key Screens
1. Client 360° profile (health score with driver breakdown, tabbed linked records)
2. Churn risk watchlist (Yellow/Red clients ranked by revenue-at-risk)
3. Renewal pipeline calendar

### 6.7 Integrations
Document storage (S3-compatible), e-signature tool (Phase 2, e.g., for contract renewal workflow).

### 6.8 Success Metrics
- 100% of active clients with a current health score
- Renewal briefs generated for 100% of retainer clients 30 days out
- Churn prediction directionally useful within 2 quarters of data

### 6.9 Build Priority
1. Client profile + linked records 2. Health score (rule-based v1) 3. Renewal tracking 4. Churn prediction (needs data history)

---

## 7. Module 3 — Flow (Project Management)

### 7.1 Objective & Scope
Every client engagement — video production, website build, campaign, retainer month — tracked end-to-end with predictive risk flagging and resource-aware planning.

**In-scope:** Project templates, timeline/Gantt, milestones, budget tracking, risk engine, capacity planning.
**Out-of-scope:** Full enterprise-grade resource leveling algorithms (v1 uses straightforward capacity math, not complex optimization).

### 7.2 Feature Specification

**Project Setup:**
- Types: Retainer (recurring), Fixed-scope (one-off), Campaign (time-boxed)
- Template library (clone pre-built task lists — e.g., "School Video Production Package," "Website Audit + SEO Proposal") carrying historical benchmark data (typical duration, typical hours)

**Tracking Views:**
- Timeline/Gantt + Kanban
- Milestones with client-visible status (Planning / In Production / Review / Delivered)
- Budget vs. actual hours/cost, live

**Predictive Project Risk Engine:**
- Combines: task completion velocity vs. plan, assignee's cross-project utilization (from People module), budget burn rate vs. milestone progress, client approval turnaround time
- Outputs a risk score with a stated reason (e.g., "68% probability of 3+ day slip — assignee at 130% utilization")

**Resource Capacity Planning:**
- Real-time team capacity view before assigning new work — who has headroom, who's overbooked

**Scope Creep Detector:**
- Tracks tasks/hours added after scope-lock; flags fixed-scope projects growing past benchmark for a scope-change/billing conversation

**Client Approval Bottleneck Tracking:**
- Measures average client turnaround on approval requests — surfaces whether delays are team-side or client-side

**Dependency-Aware Critical Path:**
- Auto-calculates which delayed task actually delays the whole project vs. which have slack

### 7.3 Data Model

```
Project
  - id, client_id, name, type (Retainer/Fixed/Campaign), template_id (nullable),
    start_date, target_end_date, status, health_status (On_Track/At_Risk/Delayed),
    risk_score (calculated), budget_amount, currency, assigned_pm_id, created_at

ProjectTemplate
  - id, name, description, benchmark_duration_days, benchmark_hours,
    default_task_list (JSON/relational task blueprint)

Milestone
  - id, project_id, name, due_date, status, client_visible (bool), completed_at

ProjectFile
  - id, project_id, milestone_id (nullable), file_url, version_number,
    uploaded_by, uploaded_at, approval_status (Pending/Approved/Revision_Requested)

ProjectRiskLog (historical, for trend + accuracy tracking)
  - id, project_id, risk_score, primary_driver, calculated_at
```

**Key relationships:** `Client (1) ──< Project (many)`, `Project (1) ──< Task (many)` (Module Tasks), `Project (1) ──< Milestone (many)`, `Project (1) ──< ProjectFile (many)`, `Project (1) ──< Budget (0 or 1)` (Module Capital), `Project (1) ──< Invoice (many)` (Module Capital).

### 7.4 Roles & Permissions

| Role | Project Data | Templates | Risk/Capacity Views | Budget |
|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Full |
| PM | Full (own projects) | View/use | Full (own projects) | View (own) |
| Team Member | View (assigned tasks' project) | No access | No access | No access |
| Finance | View | No access | No access | Full |
| Client (Portal) | View (own, status-level only) | No access | No access | No access |

### 7.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Risk score crosses configured threshold | Notify PM, suggest reallocation from capacity view |
| Milestone marked complete | Trigger portal notification + optional invoice draft if milestone-linked billing |
| Scope creep detected (hours 20%+ over template benchmark) | Flag PM for scope-change conversation |
| Client approval pending beyond SLA | Escalate reminder to client (portal + email), log bottleneck data point |

### 7.6 Key Screens
1. Project health dashboard (risk-scored, sortable by severity)
2. Resource capacity planner (team-wide, drag-to-assign)
3. Project detail (timeline, critical path, files, budget burn)
4. Template library

### 7.7 Integrations
Google Calendar (milestone/deadline sync, Phase 2), file storage (S3-compatible).

### 7.8 Success Metrics
- 70%+ of at-risk projects flagged before deadline slip (Phase 2 target, once risk model has data)
- On-time delivery rate tracked and improved quarter over quarter
- 100% of projects with a defined budget tracked against actuals

### 7.9 Build Priority
1. Project + template + milestone core 2. Task linkage (see Module Tasks) 3. Capacity planner + rule-based risk flagging 4. Full predictive risk engine (Phase 2, needs usage data)

---

## 8. Module 4 — Tasks (Task Management)

### 8.1 Objective & Scope
Where daily work happens — task execution, time logging, and intelligent prioritization, feeding both Flow and Capital.

**In-scope:** Task/sub-task hierarchy, dependencies, time tracking, smart prioritization, recurring tasks.
**Out-of-scope:** Full enterprise workflow/BPM engine — tasks are agency-delivery-shaped, not a generic workflow builder.

### 8.2 Feature Specification

**Core Task Management:**
- Nested under Projects, assignable, with sub-tasks/checklists (e.g., script → shoot → edit → review → deliver)
- Priority, due date, status (To Do / In Progress / Review / Done / Blocked)
- Dependencies (Task B blocked until Task A done)
- Comments/@mentions per task

**Time Tracking:**
- Manual entry + start/stop timer, logged against task, rolls up to project budget vs. actual and to People (utilization) and Capital (cost/profitability)

**Smart "My Day" Prioritization:**
- Ranks tasks by due date + project risk score + dependency-blocking status + client-visibility (is this on a milestone the client is watching)
- Tells each team member what to work on first, not just what's due soonest

**Effort vs. Estimate Learning:**
- Tracks each team member's actual-vs-estimated ratio per task type over time, feeding back into more accurate future estimates and project budgeting

**Bottleneck Detection:**
- Identifies recurring structural stalls (e.g., "42% of video projects stall at Client Review for 5+ days")

**Recurring Tasks with Drift Detection:**
- Auto-creates on schedule (e.g., monthly retainer deliverables); flags if a recurring task type is consistently late

### 8.3 Data Model

```
Task
  - id, project_id, title, description, assigned_to (employee_id),
    priority, due_date, status, estimated_hours, actual_hours_logged (calculated),
    parent_task_id (nullable, for sub-tasks), is_client_visible (bool),
    is_recurring (bool), recurrence_schedule (nullable), created_at

TaskDependency
  - id, task_id, depends_on_task_id

TimeLog
  - id, task_id, employee_id, hours, date, logged_via (manual/timer), notes

TaskComment
  - id, task_id, author_id, content, mentioned_user_ids, created_at

EstimateAccuracyLog
  - id, employee_id, task_type, estimated_hours, actual_hours, variance_ratio, task_id
```

**Key relationships:** `Project (1) ──< Task (many)`, `Task (1) ──< Task (many, sub-tasks)`, `Task (1) ──< TimeLog (many)`, `Task (1) ──< TaskDependency (many)`.

### 8.4 Roles & Permissions

| Role | Tasks | Time Logs | Bottleneck/Estimate Reports |
|---|---|---|---|
| Owner/CEO | Full | Full | Full |
| PM | Full (own projects) | View (own projects) | View (own projects) |
| Team Member | Edit own assigned tasks | Log own time | No access |
| Finance | View (for billing/cost purposes) | View (for cost calc) | No access |
| Client (Portal) | View (client-visible tasks only, status-level) | No access | No access |

### 8.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Blocking dependency untouched 2+ days | Auto-escalate to PM |
| Task time logged exceeds estimate by 50%+ | Flag for PM review |
| Recurring task template date reached | Auto-generates with pre-filled checklist from history |
| Task marked Done on client-visible milestone | Portal status auto-updates |

### 8.6 Key Screens
1. "My Day" (intelligently ranked personal task list)
2. Project task board (Kanban per project)
3. Task detail (checklist, comments, time log, estimate-accuracy indicator)
4. Bottleneck report (cross-project, process-level)

### 8.7 Integrations
None required for core function; potential Google Calendar sync (Phase 2) for due-date visibility.

### 8.8 Success Metrics
- 100% of billable hours logged against tasks
- Estimate accuracy improving quarter over quarter (variance ratio trending toward 1.0)
- Bottleneck report identifies at least one actionable process fix per quarter

### 8.9 Build Priority
1. Core task/sub-task/dependency CRUD + time tracking 2. "My Day" view 3. Recurring tasks 4. Smart prioritization + estimate learning (needs usage data)

---

## 9. Module 5 — People (HRM)

### 9.1 Objective & Scope
Full HR operations — attendance through payroll — with utilization intelligence that connects directly to project risk and profitability.

**In-scope:** Attendance, leave, payroll calculation, performance reviews, onboarding, utilization/overload detection.
**Out-of-scope:** Direct bank salary disbursement (calculates and generates payslips; doesn't execute bank transfers in v1). Statutory compliance filing (PF/gratuity legal filing) — produces the data, doesn't file it.

### 9.2 Feature Specification

**Attendance:**
- Check-in/check-out (web-based; optional geofencing/IP restriction for office staff)
- Status: Present / Absent / Late / Half-day / Work-from-home
- Monthly calendar view per employee, manager approval for corrections
- Attendance pattern anomaly detection (sudden lateness increase, irregular WFH) flagged supportively for HR check-in

**Leave Management:**
- Leave types: Casual, Sick, Earned, Unpaid (configurable to Bangladesh labor norms)
- Auto-calculated balances/accrual, apply → approve workflow, team-wide leave calendar

**Real Utilization Rate:**
- Billable hours logged ÷ available working hours, per employee, per week
- Flags both under-utilization (bench risk) and over-utilization (burnout risk)

**Cross-Project Overload Detection:**
- Aggregates workload across *all* active project assignments — catches the case where an employee looks fine on every individual project but is overbooked in total
- Feeds directly into Flow's Project Risk Engine

**Payroll:**
- Salary structure per employee (basic, allowances, deductions)
- Auto-draft monthly payroll from attendance + leave (unpaid-leave deductions) + bonus/incentive entries, full audit trail to source records
- Payslip generation (PDF)
- Employee cost-rate (salary + overhead ÷ available hours) feeds directly into Capital's profitability engine

**Performance Review:**
- Quarterly/half-yearly review cycles (self + manager)
- **360° signals beyond the form:** blends review scores with objective in-system data — on-time task completion rate, client feedback sentiment (from Portal approvals), utilization trend, estimate-accuracy
- Goal-setting (OKR-lite) linked to role

**Skill/Capability Tagging:**
- Tag employees by skill (video editing, copywriting, Meta Ads, WordPress) for smarter project assignment and capacity planning

**Attrition Risk Flagging:**
- Combines utilization trend + performance trend + engagement signals (leave pattern shifts, review sentiment) into a soft risk flag for retention conversations

**Onboarding & Directory:**
- Employee profiles (role, join date, documents, reporting manager)
- Role-specific onboarding checklists (different for designer vs. BD hire)
- Org chart view

### 9.3 Data Model

```
Employee
  - id, name, role_title, department, join_date, reporting_manager_id,
    employment_status (Active/On_Leave/Exited), cost_rate (calculated, restricted access),
    skill_tags (array), documents (linked)

Attendance
  - id, employee_id, date, check_in_time, check_out_time, status,
    is_manually_corrected (bool), corrected_by

LeaveRequest
  - id, employee_id, leave_type, start_date, end_date, status (Pending/Approved/Rejected),
    approved_by, applied_at

LeaveBalance
  - id, employee_id, leave_type, balance_days, period (year)

PayrollRecord
  - id, employee_id, period (month/year), basic_salary, allowances, deductions,
    unpaid_leave_deduction (calculated), bonus, net_pay, status (Draft/Finalized/Paid),
    audit_trail (linked source records)

PerformanceReview
  - id, employee_id, review_period, self_score, manager_score,
    objective_signal_summary (JSON: task_completion_rate, utilization_trend, sentiment_score),
    goals_set (text/JSON), reviewed_by, reviewed_at

UtilizationLog (calculated, historical for trend)
  - id, employee_id, week_start_date, billable_hours, available_hours, utilization_rate

AttritionRiskFlag
  - id, employee_id, risk_level, contributing_factors (text), flagged_at
```

**Key relationships:** `Employee (1) ──< Attendance (many)`, `Employee (1) ──< LeaveRequest (many)`, `Employee (1) ──< PayrollRecord (many)`, `Employee (1) ──< TimeLog (many)` (Module Tasks), `Employee (1) ──< PerformanceReview (many)`.

### 9.4 Roles & Permissions

| Role | Own Attendance/Leave | Others' Attendance/Leave | Payroll | Performance | Utilization/Attrition Reports |
|---|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Full | Full |
| HR/Admin | Full | Full (approve) | Full | Full | Full |
| PM | Full (own) | View (own team) | No access | Submit review input for own team | View (own team) |
| Team Member | Full (own, submit only) | No access | View own payslips only | View own | No access |
| Finance | No access | No access | View (for cost integration) | No access | No access |

**Critical rule:** `cost_rate` field on Employee is restricted to Owner/HR/Finance only — never exposed to PMs or team members, even though it silently feeds calculations they see outputs of elsewhere (e.g., project margin %).

### 9.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Utilization exceeds 100%+ sustained 2+ weeks | Flag to HR/Owner as burnout risk |
| Leave balance near zero + high utilization | Suggest mandatory time-off (retention protection) |
| New hire created | Role-specific onboarding checklist auto-assigned |
| Monthly payroll date reached | Auto-draft payroll from attendance/leave/bonus records for HR review |
| Attendance anomaly detected | Flagged to HR for a supportive check-in, not punitive language |

### 9.6 Key Screens
1. Team utilization heatmap (real-time, cross-project overload view)
2. Employee 360° profile (attendance, performance signals, skill tags, payroll history)
3. Payroll run screen (monthly batch, full audit trail)
4. Attrition risk watchlist
5. Leave calendar (team-wide)

### 9.7 Integrations
Payroll bank-file export (Phase 2, for manual upload to banking portal), biometric/geofencing attendance hardware (optional, Phase 2+).

### 9.8 Success Metrics
- 100% of employees with weekly utilization tracked
- Payroll draft-to-finalize time reduced to same-day (vs. multi-day manual process)
- Burnout/overload incidents caught before attrition — tracked and reduced quarter over quarter

### 9.9 Build Priority
1. Attendance + leave core 2. Payroll draft automation 3. Utilization tracking + cross-project overload detection 4. Performance review + attrition flagging (Phase 2, needs data history)

---

## 10. Module 6 — Capital (Finance)

*This module has been specified to full build-ready depth in the standalone Finance Module document and is incorporated here in full.*

### 10.1 Objective & Scope
A professional-grade accounts management system — income, expenses, invoicing, reconciliation, budgeting, and reporting — purpose-built for a digital marketing agency's operating model, not a stripped-down invoicing tool.

**In-scope:** Chart of Accounts, Income/Revenue Management, Expense Management, Invoicing & Billing, Payments & Reconciliation, Budgeting, Real-Time Profitability Engine, Financial Reporting, multi-currency (BDT/USD).
**Out-of-scope:** Full statutory bookkeeping for legal filing (produces clean data for an accountant, isn't itself the filing system), direct bank fund disbursement, multi-entity consolidated accounting (v1 uses a lightweight business-unit tag instead).

### 10.2 Core Design Principles
1. Every taka must be traceable to its source — every invoice line, expense, and payment ties back to a Project, Client, or Employee.
2. Client-billable vs. agency-absorbed must always be explicit at the point of entry — this is the single most common source of margin confusion in an agency, especially with ad-spend pass-through.
3. Real-time, not month-end — profitability, cash position, and receivables are live calculations.
4. Approval before impact — expenses above threshold and any post-send invoice edit require approval.
5. BDT-first, USD-aware — Bangladesh is primary; USD is a first-class secondary currency for freelance/international billing and dollar-trading tracking.

### 10.3 Feature Specification

**10.3.1 Chart of Accounts (Foundation Layer)**
- Categories: Revenue accounts (Retainer/Project/Ad Management Fee/Other Income), Direct Cost accounts (Freelancer Payments/Client-Billable Ad Spend/Production Costs), Operating Expense accounts (Salaries/Software/Rent/Marketing/Travel/Bank Charges/Misc), light Asset accounts (Receivables/Cash-Bank/Advances Made), light Liability accounts (Payables/Advance Payments Received/Payroll Payable)
- Admin can add/edit/deactivate (never hard-delete, for historical integrity)
- Every transaction maps to an account, feeding the P&L structure directly

**10.3.2 Income / Revenue Management**
- Revenue types: Retainer, Project-Based, Performance/Management Fee, Ad Spend Pass-Through (non-revenue), Other Income
- **Revenue Recognition Logic (critical):** every invoice line tagged `Agency Revenue` | `Pass-Through (Non-Revenue)` | `Management Fee (Revenue)`. Pass-through amounts (client ad spend billed through Zoolyum) tracked for cash-flow but excluded from Revenue/P&L top line — only the management fee counts as real revenue. Dashboard always shows both "Total Invoiced" and "Recognized Revenue" side by side.
- Revenue tagged by Client, Project, Service Line, Type, Currency
- Recognition timing: Cash basis or Accrual-lite (configurable; accrual-lite default)

**10.3.3 Expense Management**
- Types: Client-Billable (ad spend, project-specific third-party costs — auto-links to client/project and flows to invoice), Agency-Absorbed (freelancer payments, delivery costs not passed to client), Operating/Overhead (salaries, rent, subscriptions)
- Entry fields: amount, currency, category, date, vendor/payee, payment method, receipt attachment
- Mandatory billable-or-not decision at entry, routing accordingly
- Recurring expenses (subscriptions) with renewal reminders
- Approval workflow: configurable threshold, full audit trail regardless of approval tier
- Vendor/Payee directory with spend-by-vendor reporting
- Multi-currency entries (BDT/USD) with recorded exchange rate
- Ad spend reconciliation: planned/budgeted vs. actual, variance flagged before it becomes a client billing dispute
- Expense-to-budget variance auto-check against project's allocated budget
- Bulk CSV import for batch entry (e.g., monthly ad account reconciliation)

**10.3.4 Invoicing & Billing**
- Types: One-Time/Project, Recurring Retainer, Combined (retainer + pass-through + billable expenses in one invoice), Advance/Deposit
- Line items pulled from milestones, logged billable expenses, manual entry, or retainer templates — each auto-tagged by revenue type
- Tax/VAT-AIT fields, configurable per client
- Multi-currency generation with locked exchange rate at creation
- Custom branding, custom invoice numbering (e.g., `ZLM-2026-0042`)
- Payment terms (Net 7/15/30, Due on Receipt) with auto due-date
- Lifecycle: `Draft → Sent → Viewed → Partially Paid → Paid → Overdue → Cancelled/Void`
- Recurring automation: billing day, auto-send toggle, auto-includes approved billable expenses if Combined mode is on
- Delivery via Portal notification + email PDF; client sees real-time status
- Tiered payment reminder automation (gentle, professional escalation)
- **Sent invoices require an audit-logged credit note/revision, never silent editing**

**10.3.5 Payments & Reconciliation**
- Record payment against invoice (full/partial), method, reference, date
- Advance payment/client credit balance handling, applicable to future invoices
- Semi-automated bank/MFS statement reconciliation: import statement, system suggests matches, user confirms; unmatched flagged for review
- Multi-account support (multiple bank + MFS accounts) with consolidated cash position
- Structured refund recording with reason field

**10.3.6 Financial Reporting**
- **P&L Statement:** revenue by type minus direct costs minus opex = net profit; period comparison; filterable by client/project/service-line/company-wide
- **Cash Flow Statement + 30/60/90-day Forecast:** combines confirmed invoices + payment terms + weighted sales pipeline (from Pulse) + recurring retainer schedule + known upcoming expenses
- **Receivables Aging:** 0-15/15-30/30-60/60+ day buckets, risk-weighted by (amount × client health score)
- **Payables/Upcoming Obligations:** forward view of committed outflows
- **Real-Time Profitability:** per Client, per Project, per Service Line, and a restricted-access per-Employee cost-contribution view
- **Tax Summary:** clean handoff data for external accountant/filing
- **Expense Analysis:** by category, vendor, trend, billable-vs-absorbed ratio
- All reports date-filterable, exportable (PDF/Excel), drill-down to source transactions, with scheduled delivery option

**10.3.7 Budgeting**
- Project budgets (total or by cost category) with 75/90/100% variance alerts
- Department/overhead budgets with variance tracking
- Client-level budget rollup across concurrent projects
- Lightweight business-unit tag (e.g., separating Zoolyum vs. Zoolution IT Ltd. transactions) without full multi-tenant complexity

### 10.4 Data Model

```
Account (Chart of Accounts)
  - id, name, category (Revenue/Direct_Cost/Opex/Asset/Liability), is_active

Invoice
  - id, invoice_number, client_id, project_id (nullable), currency, exchange_rate,
    issue_date, due_date, status, invoice_type (One_Time/Recurring/Advance/Combined),
    tax_applicable (bool), tax_rate, notes, created_by, created_at

InvoiceLineItem
  - id, invoice_id, description, quantity, unit_price, amount,
    revenue_tag (Agency_Revenue/Pass_Through/Management_Fee),
    linked_expense_id (nullable), linked_milestone_id (nullable)

Payment
  - id, invoice_id, amount, currency, payment_method, reference_id, payment_date,
    recorded_by, notes

CreditBalance
  - id, client_id, amount, currency, source (Advance/Refund/Overpayment),
    applied_to_invoice_id (nullable), created_at

Expense
  - id, description, amount, currency, exchange_rate, category (account_id), date,
    vendor_id, payment_method, is_client_billable (bool), client_id (nullable),
    project_id (nullable), receipt_attachment_url, approval_status (Pending/Approved/Rejected),
    approved_by, submitted_by, is_recurring (bool), recurrence_schedule (nullable)

Vendor
  - id, name, contact_info, category, total_spend_to_date (calculated)

Budget
  - id, scope_type (Project/Department), scope_id, category (nullable),
    budget_amount, currency, period_start, period_end

BankAccount
  - id, account_name, account_type (Bank/bKash/Nagad/Cash), currency,
    current_balance (calculated)

ReconciliationRecord
  - id, bank_account_id, statement_entry_date, statement_amount, statement_reference,
    matched_payment_id (nullable), match_status (Matched/Unmatched/Manual_Review)

AuditLog (Finance-specific)
  - id, entity_type, entity_id, action, performed_by, timestamp, before_value, after_value
```

**Key relationships:** `Invoice (1) ──< InvoiceLineItem (many)`, `Invoice (1) ──< Payment (many)`, `Expense (many) ──> Client/Project (0 or 1)`, `Expense (1) ──< InvoiceLineItem (0 or 1)`, `Client (1) ──< Invoice (many)`, `Project (1) ──< Budget (0 or 1)`.

### 10.5 Roles & Permissions

| Role | Income/Revenue | Expenses | Invoicing | Payments | Reports | Budgets | Approval Rights |
|---|---|---|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Full | Full, incl. per-employee cost view | Full | Final approval, any amount |
| Finance/Accounts | Full | Full | Full | Full | Full (per-employee view configurable) | Full | Approve up to configured threshold |
| PM | View (own projects) | Submit (own projects), view budget-vs-actual | View (own projects) | View only | Project-level profitability only | View own | None |
| Team Member | No access | Submit (pending approval) | No access | No access | No access | No access | None |
| Client (Portal) | N/A | N/A | View/download own invoices only | View own payment history | N/A | N/A | N/A |

**Critical rule:** Per-employee cost-rate data is visible only to Owner and Finance — never exposed to PMs/team members, even though they see calculation outputs (e.g., "Project margin: 34%").

### 10.6 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Expense submitted above approval threshold | Routed to approval queue, blocked from reports/billing until approved |
| Recurring invoice date reached | Auto-generates (draft or auto-sent per config), includes approved billable expenses if Combined mode |
| Invoice marked "Sent" | Visible in Portal, client notified |
| Payment recorded = invoice total | Status auto-updates to "Paid" |
| Payment recorded < invoice total | Status auto-updates to "Partially Paid," balance recalculated |
| Invoice due date passed, unpaid | Status auto-updates to "Overdue," reminder sequence triggered |
| Project expenses approach budget (75/90/100%) | Alert to PM + Finance |
| Bank statement imported | Auto-suggest matches against outstanding invoices/expenses |
| Client-billable expense approved | Queued as a line item for that client's next invoice (manual confirm before send) |
| Recurring subscription nearing renewal | Reminder to Finance/Owner |

### 10.7 Key Screens
1. Financial dashboard (P&L snapshot, cash position, receivables aging, top-line profitability)
2. Invoice builder (line-item editor, live preview)
3. Invoice list (status/client/date/currency filters, aging indicators)
4. Expense entry form (quick-add, mobile-friendly)
5. Expense approval queue
6. Payment recording form
7. Reconciliation workspace (statement import + match review)
8. Report center (all reports, filterable, exportable, drill-down)
9. Budget vs. Actual dashboard

### 10.8 Multi-Currency Handling
Base currency BDT; secondary USD. Exchange rate captured at transaction time (manual or optional live-rate API), stored per-transaction for historical accuracy. Reports show BDT-converted totals with USD/BDT-only view options. Realized FX gain/loss tracked as a distinct line item.

### 10.9 Integrations

| Integration | Purpose | Priority |
|---|---|---|
| bKash/Nagad Business API | Auto-pull payment confirmations | Phase 2 |
| SSLCommerz or similar | Client-side portal invoice payment | Phase 2 |
| Bank statement CSV import | Semi-automated reconciliation | Phase 1 |
| Facebook/Google Ads API (read-only) | Pull actual ad spend for pass-through reconciliation | Phase 2 |
| Exchange rate API | Live BDT/USD rate | Phase 2 (manual sufficient for Phase 1) |
| Accounting export (Excel/CSV) | Handoff to external accountant for tax filing | Phase 1 |

### 10.10 Non-Functional Requirements (Finance-Specific)
No hard deletes on financial records (soft-delete/void with audit trail only). Fixed-point decimal arithmetic throughout (never floating point). Full audit trail on every create/edit/approve/void action. Strict RBAC on reports and per-employee cost data. Daily backups minimum, with point-in-time recovery. Real-time recalculation of the profitability dashboard — no manual refresh/batch jobs.

### 10.11 Success Metrics
- Monthly P&L generation: instant/on-demand (from days manually)
- Invoice-to-payment cycle time: baseline established, reduced via reminder automation
- Expense approval turnaround: < 24 hours average
- Reconciliation auto-match rate: 80%+ by Phase 2
- Profitability visibility lag: real-time (from ~30-day manual process)
- Client-billable expenses correctly captured before invoice send: 100%

### 10.12 Build Priority
1. Chart of Accounts + Expense Management (foundation) 2. Invoicing (core cash-generating function) 3. Payments + basic reconciliation 4. Real-time profitability dashboard (highest-value output) 5. Budgeting + advanced reporting

---

## 11. Module 7 — Insight (Reports & Analytics)

### 11.1 Objective & Scope
Cross-module, CEO-level dashboards and correlation intelligence that turn raw data across every other module into decisions.

**In-scope:** Standard reports (sales/delivery/team/finance/client), custom report builder, cross-module correlation engine, executive digest.
**Out-of-scope:** General-purpose BI tool replacement (e.g., not competing with Power BI/Tableau for arbitrary data-source analysis) — scoped to Zoolyum OS's own data.

### 11.2 Feature Specification

**Standard Report Categories:**
- Sales/Pipeline: conversion rate by stage, lead source ROI, average deal size, sales cycle length
- Delivery: on-time delivery rate, project health distribution, average duration by project type
- Team: utilization rate per member, workload distribution, attendance trends
- Finance: revenue trend, receivables, profitability by client/project/service, expense breakdown
- Client: retention rate, health score distribution, renewal pipeline, churn reasons

**Cross-Module Correlation Engine (the differentiator):**
- Auto-surfaces statistically meaningful patterns across modules, e.g.:
  - "Projects using Template X have 40% higher margin than Template Y"
  - "Referral-acquired clients have 2.3x the lifetime value of cold-outreach clients"
  - "Employees at >95% utilization for 3+ consecutive weeks show elevated next-quarter attrition"
  - "Education-vertical clients have longer sales cycles but higher retention than D2C — informs BD effort allocation"
- Surfaced as dismissible "New Insight" cards on the executive dashboard, not buried in static reports

**Custom Report Builder:**
- Drag-and-drop metric/dimension selection for ad-hoc questions without developer involvement

**Automated Executive Digest:**
- Scheduled (weekly/monthly) summary: pipeline value + conversion trend, team utilization, top/bottom profitable projects, cash position + forecast, top risks flagged that period — the single artifact replacing manual number-pulling across four places

**Benchmark Tracking Over Time:**
- Every key metric tracked as a trend line, not just a snapshot — "are we getting better," not just "where do we stand"

### 11.3 Data Model

```
ReportDefinition (for custom builder)
  - id, name, created_by, metrics_selected (JSON), dimensions_selected (JSON),
    filters (JSON), schedule (nullable), last_run_at

CorrelationInsight
  - id, description, supporting_data_summary (JSON), confidence_level,
    surfaced_at, dismissed_by (nullable), dismissed_at (nullable)

ExecutiveDigestLog
  - id, period, generated_at, snapshot_data (JSON), sent_to (user_ids), delivery_status

MetricSnapshot (for benchmark trend tracking)
  - id, metric_name, scope (Company/Client/Project/Employee), scope_id (nullable),
    value, recorded_at
```

### 11.4 Roles & Permissions

| Role | Standard Reports | Custom Builder | Correlation Insights | Executive Digest |
|---|---|---|---|---|
| Owner/CEO | Full | Full | Full | Recipient |
| PM | Project/team scope only | Limited (own scope) | Own-scope insights only | No |
| Finance | Finance/client reports | Full (finance scope) | Finance-related insights | Recipient (finance summary) |
| Team Member | No access | No access | No access | No |
| Client (Portal) | No access | No access | No access | No |

### 11.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Scheduled digest date/time reached | Auto-generates and sends to configured recipients |
| Statistically significant pattern detected (n>10 data points) | Surfaced as new Insight card on executive dashboard |
| Custom report scheduled | Auto-runs and delivers on set schedule |

### 11.6 Key Screens
1. Executive dashboard ("State of Zoolyum" — real-time)
2. Custom report builder
3. Insights feed (chronological, dismissible correlation cards)
4. Standard report library (by category)

### 11.7 Integrations
Email delivery (digest), PDF/Excel export engine.

### 11.8 Success Metrics
- Executive digest saves 3-5 hours/week of manual number-pulling
- At least 1 actionable correlation insight surfaced per month by Phase 2
- 100% of standard report categories live and filterable at launch

### 11.9 Build Priority
1. Standard reports per module (built alongside each module) 2. Executive digest automation 3. Custom report builder 4. Correlation engine (Phase 2, needs data history)

---

## 12. Module 8 — Portal (Client Portal)

### 12.1 Objective & Scope
Branded, restricted-access external view giving clients live project status, deliverable approvals, and billing — replacing WhatsApp status-update overhead.

**In-scope:** Live status feed, deliverable approval workflow, invoice/billing view, document vault, comment threads.
**Out-of-scope:** Client-side project creation or task management (clients consume status, they don't manage delivery).

### 12.2 Feature Specification

**Live Status Intelligence:**
- Pulled live from Flow — "Script approved Aug 10 → Shoot scheduled Aug 15 → Currently in editing" — always accurate, zero manual PM updates needed

**Deliverable Approval Workflow:**
- Client sees deliverable versions side-by-side with revision notes, Approve/Request Revision buttons, full version history (clean audit trail for scope-dispute protection)

**Billing View:**
- Invoices (view/download), payment status, payment history — zero visibility into internal costs/profitability

**Performance Reporting Auto-Pull:**
- For retainer/campaign clients with connected ad accounts, auto-pulled campaign metrics into a client-friendly monthly summary (Phase 2, requires ad account API access)

**Communication Thread:**
- Simple per-project comment log replacing scattered WhatsApp threads with a permanent, searchable record

**Sentiment-Aware Comment Analysis (internal-facing only):**
- Lightly analyzes client comment tone for frustration/urgency signals, flags account owner same-day — feeds Accounts module's health score

**Self-Service Document Vault:**
- Signed contracts, brand guidelines, past invoices — client self-retrieves without emailing the account manager

**Multi-Stakeholder Access:**
- Each client contact gets their own restricted login (relevant for clients with multiple decision-makers, e.g., school administrations)

### 12.3 Data Model

```
PortalUser
  - id, client_contact_id (FK to ClientContact), email, access_token/auth_method,
    last_login_at, is_active

PortalActivityLog
  - id, portal_user_id, action (viewed_invoice/approved_deliverable/commented/logged_in),
    related_entity_type, related_entity_id, timestamp

ClientComment
  - id, project_id, portal_user_id (nullable, if internal), content,
    sentiment_flag (Neutral/Positive/Negative_Urgent), created_at

DeliverableApproval
  - id, project_file_id (FK to ProjectFile), portal_user_id, decision (Approved/Revision_Requested),
    revision_notes, decided_at
```

### 12.4 Roles & Permissions

| Role | Portal Config | Client Data Visible |
|---|---|---|
| Owner/CEO | Full | All clients |
| Account Owner/PM | Configure own clients' portal content | Own clients only |
| Finance | No portal config access | Invoice/billing data feed only |
| Client Contact (Portal User) | N/A | Own company's data only, strictly isolated |

### 12.5 Business Rules & Automation

| Trigger | Automated Action |
|---|---|
| Milestone status changes in Flow | Instant portal update, zero manual step |
| Client approves/requests revision | Auto-creates corresponding task back in Flow (bidirectional loop closure) |
| Negative sentiment detected in comment | Auto-flag to account owner same-day |
| New invoice sent | Portal notification to relevant client contact(s) |

### 12.6 Key Screens
1. Client home (live status feed + upcoming milestones)
2. Deliverables & approvals (with version history)
3. Billing (invoices, payment history, downloads)
4. Document vault

### 12.7 Integrations
Facebook/Google Ads API (read-only, for performance auto-pull, Phase 2), email for portal notifications.

### 12.8 Success Metrics
- Client status-update queries via WhatsApp reduced 50%+
- 100% of active projects with live-synced portal status
- Deliverable approval turnaround time tracked and visible in Flow's bottleneck detection

### 12.9 Build Priority
1. Live status feed + billing view (read-only MVP) 2. Deliverable approval workflow 3. Comment threads 4. Sentiment analysis + performance auto-pull (Phase 2)

---

## 13. Module 9 — Control (Admin & Settings)

### 13.1 Objective & Scope
System configuration, access control, and integration management underpinning every other module.

### 13.2 Feature Specification
- User & role management (RBAC configuration per module, as detailed in each module's permissions table)
- Custom fields per module (agency-specific tagging without code changes)
- Branding (logo, colors — applied to Portal and Invoice templates)
- Notification preferences (email/in-app, per role and per event type)
- Integration management (Facebook Lead Ads, payment gateways, banking, exchange rate API — connect/disconnect/credential management)
- Business-unit tagging setup (for Zoolyum vs. Zoolution IT Ltd. separation within Capital)
- System-wide audit log (who changed what, when — especially critical given financial and permission data lives here)
- Pipeline stage / task status / expense category customization

### 13.3 Data Model
```
User
  - id, name, email, role, employee_id (nullable, if internal staff), is_active, created_at

Role
  - id, name, module_permissions (JSON: per-module view/edit/approve/none)

Integration
  - id, provider_name, type (Ads/Payment/Banking/FX_Rate), status (Connected/Disconnected),
    credentials_encrypted, connected_by, connected_at

SystemAuditLog
  - id, actor_user_id, action, entity_type, entity_id, before_value, after_value, timestamp

BrandingConfig
  - id, logo_url, primary_color, secondary_color, invoice_numbering_format
```

### 13.4 Roles & Permissions
Admin/Control module access restricted to **Owner/CEO only** by default, with optional delegation to a designated Admin role for day-to-day user management (excluding role-permission changes, which remain Owner-only).

### 13.5 Key Screens
1. User & role management
2. Integrations dashboard
3. Branding settings
4. System audit log viewer

### 13.6 Build Priority
Built incrementally alongside each module (RBAC is needed from Module 1 onward), with a consolidated Control screen assembled once core modules are functional.

---

## 14. Non-Functional Requirements (System-Wide)

| Category | Requirement |
|---|---|
| Security | RBAC across all modules; strict client-data isolation; encrypted document/credential storage; audit logs on financial and permission changes |
| Performance | Dashboard loads < 2s for up to ~50 concurrent internal users and ~200 portal users |
| Availability | 99.5% uptime target |
| Scalability | Multi-tenant-ready data model from day one, even for single-tenant initial deployment, to support future white-labeling |
| Localization | Bangla + English UI toggle; BDT base currency, USD secondary |
| Mobile | Fully responsive web, mobile-first for attendance check-in, task updates, portal access |
| Backup | Daily automated backups; point-in-time recovery for financial data specifically |
| Data integrity | No hard deletes on financial or audit-relevant records — soft-delete/void with trail only |
| Precision | Fixed-point decimal arithmetic for all currency calculations |

---

## 15. Recommended Tech Stack

- **Frontend:** React (Next.js) — SSR for the client portal for fast, clean loads
- **Backend:** Node.js (NestJS) or equivalent structured framework
- **Database:** PostgreSQL — relational integrity is essential given the Client→Project→Task→Invoice dependency chains
- **Auth:** Role-based JWT auth; separate auth scope for Portal users vs. internal staff
- **File storage:** S3-compatible object storage
- **Hosting:** Single VPS/cloud instance for MVP, architected for horizontal scaling
- **Notifications:** Email (transactional) first; WhatsApp Business API integration Phase 2

---

## 16. Master Roadmap

### Phase 1 — Core Connected Loop + Foundational Intelligence
- Pulse: lead capture, pipeline, basic scoring
- Accounts: client profiles, rule-based health score
- Flow: projects, templates, milestones, capacity planner, rule-based risk flagging
- Tasks: core task/time tracking, "My Day"
- People: attendance, leave, payroll draft, real utilization rate, overload detection
- Capital: Chart of Accounts, Expense Management, Invoicing, Payments, real-time Profitability Dashboard
- Insight: standard reports per module, executive digest
- Portal: live status + billing view (read-only)
- Control: RBAC, branding, core integrations

### Phase 2 — Learning, Prediction & Depth
- Full predictive risk engine (Flow), churn/attrition prediction (Accounts/People)
- Cash flow forecasting, budget variance alerts (Capital)
- Cross-module correlation engine (Insight)
- Deliverable approval workflow + sentiment analysis (Portal)
- bKash/Nagad/SSLCommerz integrations, Facebook/Google Ads API pull

### Phase 3 — Scale & Productize
- WhatsApp Business API integration
- Mobile app
- Multi-tenant architecture finalized → white-label as a sellable SaaS product to other agencies
- Custom report builder, advanced automation (AI-assisted proposal generation)

---

## 17. Master Success Metrics

| Metric | Target |
|---|---|
| % of leads logged in-system | 90%+ |
| Client status-update queries via WhatsApp | ↓ 50%+ |
| On-time project delivery rate | Baseline established, improved quarter over quarter |
| Billable hours logged (team utilization visibility) | 100% |
| Profitability visibility lag | Real-time (from ~30-day manual process) |
| Attendance/leave disputes | Near-zero |
| Monthly P&L generation time | Instant (from days) |
| At-risk projects flagged before deadline slip | 70%+ by Phase 2 |
| Client retention rate | Baseline established, tracked for improvement |

---

## Quick Win / Overall Build Priority

Don't build all 9 modules to full depth before launch. Sequence:
1. **Pulse + Accounts + Flow + Tasks** core loop (get leads becoming tracked, delivered work)
2. **Capital's Expense + Invoicing + Profitability Dashboard** (highest-leverage single feature — replaces the current manual Excel process with the number that drives every strategic decision)
3. **People's attendance/leave/payroll + utilization tracking**
4. **Portal read-only view** (status + billing) to start reducing WhatsApp overhead early
5. **Insight's executive digest** once enough modules are live to summarize
6. Layer in every module's Phase 2 intelligence features (prediction, correlation, forecasting) once 3-6 months of real usage data exists to make them accurate

---

*End of Master PRD — Zoolyum OS. This document is final and build-ready across all modules for handoff to development.*
