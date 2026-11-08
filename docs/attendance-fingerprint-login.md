# Attendance, Fingerprint Login & Dashboard Time Clock

> Implemented: 2026-11-05

## 1. What the user gets

### Dashboard — Time Clock card (every employee-linked account)
- Today's **check-in / check-out**, live **worked** duration (updates every 30s) and **late** minutes.
- **Today's punches** timeline, labelled by source:
  - `Fingerprint machine` — punches pushed automatically by the ZKTeco device.
  - `Kiosk` — shared attendance screen.
  - `Web` — dashboard / self-service punch.
- **Browser login time** (last successful sign-in) and **last synced punch**.
- **Machine linked** badge when the employee has a device PIN (`employee.deviceId`).
- Actions:
  - **Clock in / Clock out** — one click (auto-picks the correct action).
  - **Fingerprint clock in / out** — verify with Windows Hello / Touch ID, then punch.
  - **Enable fingerprint** — one-time WebAuthn registration for this device.
  - Manage / remove registered fingerprint devices.

### Login page — passwordless fingerprint sign-in
- “Sign in with fingerprint” button under the password form.
- Uses the device platform authenticator (Windows Hello, Touch ID, Android biometrics).
- After a successful assertion the server issues a normal session (same JWT /
  permission model) **and the client punches attendance automatically** based on
  today's state (checked out → clock in; checked in → clock out).
- Email-first fallback: typing the account email narrows the credential list;
  leaving it empty uses discoverable credentials (usernameless).

### Physical fingerprint machine (unchanged, now visible)
- ZKTeco ADMS/iClock keeps pushing punches to `POST /api/iclock/cdata`.
- Punches appear in the dashboard timeline instantly after sync.
- Device status, last-seen and unmatched punches remain in People → Attendance → Devices.

## 2. API surface

All under `/api`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/webauthn/register/options` | staff | registration challenge |
| POST | `/auth/webauthn/register/verify` | staff | store public key |
| GET | `/auth/webauthn/credentials` | staff | list registered devices |
| DELETE | `/auth/webauthn/credentials/:id` | staff | remove a device |
| POST | `/auth/webauthn/login/options` | public | usernameless / email-scoped challenge |
| POST | `/auth/webauthn/login/verify` | public | verify assertion → JWT session |
| POST | `/auth/webauthn/clock/options` | staff | challenge for biometric punch |
| POST | `/auth/webauthn/clock/verify` | staff | verify assertion before punch |
| POST | `/people/attendance/kiosk` | staff | record `{ action: "in"\|"out", mode: "self" }` |
| GET | `/people/attendance/today` | staff | `mine` includes check-in/out, status, `punches[]` |

Database: `WebAuthnCredential` (user, credential id, public key, counter,
transports, device label, last used). Migration
`20261105180000_webauthn_credentials`.

## 3. Environment

```env
WEBAUTHN_RP_NAME="Zoolyum OS"
WEBAUTHN_RP_ID=localhost          # production: app.example.com
WEBAUTHN_ORIGIN=http://localhost:3000  # production: https://app.example.com
```

WebAuthn requires a **secure context**: `https://` or `http://localhost`.

## 4. Enrolment steps for staff

1. Sign in with email + password.
2. On the dashboard, click **Enable fingerprint** → approve the Windows Hello /
   Touch ID prompt.
3. Sign out, then use **Sign in with fingerprint** — it signs in and punches in.
4. The card now shows both web punches and machine punches.

## 5. Security notes

- Only the public key is stored; the fingerprint never leaves the device.
- Challenges are single-use and expire after 5 minutes.
- `verifyAuthenticationResponse` requires user verification.
- A WebAuthn sign-in issues the same `tokenVersion`-checked JWT as a password
  login, so deactivation and password resets revoke it immediately.
- The physical machine API (`/api/iclock`) stays public by protocol design; put
  it behind a VPN / reverse-proxy allowlist in production.

## 6. Limit of the browser fingerprint vs the physical terminal

A standalone ZKTeco terminal cannot log a browser session in by itself — it
only pushes attendance. The browser fingerprint button uses the **computer's**
sensor. If the requirement is “walk up to a shared terminal, touch the physical
reader and get a logged-in session”, that needs a small kiosk bridge
(terminal app or WebAuthn terminal). The current implementation deliberately
keeps the two channels separate:

- physical reader → automatic attendance punches;
- device sensor / Windows Hello → passwordless web login + punch.
