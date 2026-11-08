# Dashboard & Notification Center — Redesign Notes

> Implemented: 2026-11-05

## 1. Role-aware dashboard

One route (`/dashboard`), one API call (`GET /dashboard/home`), five presentations.
The server decides what data the role may see; the page only decides how to lay it out.

| Role | View | Headline content |
|---|---|---|
| Owner / Admin | Command center | Revenue, collections, outstanding, pipeline, projects, utilization, revenue trend, pipeline stages, attention list, top clients, inbox |
| Finance | Finance desk | Collected, outstanding, overdue, expenses MTD, cash position, collection rate, cash trend, payment mix, overdue receivables, top clients |
| Manager (PM/Team) | Delivery & team | Active projects, at-risk, open/due tasks, utilization, project health, at-risk list, my tasks, today's events |
| HR / People | People operations | Headcount, present/on-leave, utilization, overloaded, attendance snapshot, pending leave, my tasks |
| Sales / BD | Revenue pipeline | My pipeline, weighted forecast, active/hot leads, follow-ups, my leads, pipeline stages |
| Employee | My workspace | My day (clock in/out), open/due/overdue tasks, follow-ups, events, my leave |

API narrowing (`DashboardService.home`):

- Owner/Admin → full company snapshot.
- Finance → capital + clients + project summary (no people/pulse).
- Manager → flow + tasks + people + pipeline summary.
- HR → people + tasks + project risk summary.
- Sales → pulse + client renewals + task counts.
- Employee → personal tasks/leads/events/leaves + minimal company counters.

Personal data comes from `myDay(userId)` and is included for every role, so the
employee layout never needs a second request.

## 2. Notification center

### API
- `GET /notifications` supports `limit`, `skip`, `unread=true`, `category=tasks|finance|people|business|system`.
- `GET /notifications/summary` returns `{ total, unread, today, thisWeek, categories }`.
- Cache keys are per-filter and invalidated on create/read/delete/broadcast.

### Dropdown (bell)
- Wider inbox panel with unread/date header.
- Category chips with unread counts.
- Date grouping (Today / Yesterday / Earlier).
- Unread accent bar + dot; hover actions (mark read, delete).
- Footer: preferences + weekly volume.
- Preferences panel: per-type In-app / Telegram toggles.

### Full page (`/notifications`)
- Tabs: **Inbox** and **Preferences**.
- Stat strip: Unread, Today, This week, Total.
- Left rail: category filters + "Unread only" switch.
- Search, mark-all-read, clear, load-more pagination.
- Grouped list with per-row actions.
- Preferences matrix: 20+ notification types grouped by category × 3 channels (In-app, Email, Telegram).

## 3. Verification
- `tsc --noEmit` clean (web + api).
- Owner/Finance/Sales/Employee layouts rendered via real role logins.
- Finance API payload excludes people/pipeline; employee payload contains no company finance.
- Unread badge appears after a new notification, mark-all-read clears it.
- Dropdown categories, preferences, and the full inbox render without console errors.
