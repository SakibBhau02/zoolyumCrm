# Public demo (Try Cloud) — how it runs

This is a **temporary, publicly reachable demo** of Zoolyum OS. The whole stack
stays on this machine; Cloudflare only gives it a public HTTPS URL.

```
browser ──HTTPS──> Cloudflare edge ──tunnel──> cloudflared
                                                │
                                                ▼
                                   Next.js :3000  (UI + /api/* proxy)
                                                │
                                                ▼
                                   NestJS API :4000 ──> PostgreSQL :5544
                                                     └─> Redis :6380 (Docker)
```

The browser calls `/api/...` on the same origin, so the Next server proxies to
the API. That means **one public URL**, no CORS, and the API is never exposed
directly.

## Start everything

```powershell
powershell -ExecutionPolicy Bypass -File scripts/public-demo.ps1
```

It starts (or reuses) the API, the web server and the tunnel, then prints the
public URL. The URL is random and changes every time the tunnel restarts.

## Stop everything

```powershell
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -State Listen -LocalPort 3000,4000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Demo credentials

| Role | Email | Password |
| --- | --- | --- |
| Owner | sakib@zoolyum.com | zoolyum123 |
| Finance | sadia@zoolyum.com | zoolyum123 |
| Sales/BD | rahim@zoolyum.com | zoolyum123 |
| Project Manager | karim@zoolyum.com | zoolyum123 |
| Project Manager | tanvir@zoolyum.com | zoolyum123 |
| HR/Admin | nusrat@zoolyum.com | zoolyum123 |

## Read this before sharing the link

- **Anyone with the URL can sign in and write data.** It is a demo database with
  fake records — never point this at a database that holds real client or
  payroll data.
- The link is **ephemeral**: it dies when the machine sleeps, the tunnel process
  stops, or Cloudflare rotates it. Restart the script for a new URL.
- A stable custom domain requires a (free) Cloudflare account and a **named
  tunnel** (`cloudflared tunnel create`), not the quick tunnel used here.
- The Owner account can wipe demo data from Control → Danger zone. If you plan
  to leave the link open for long, run the demo against a disposable database.

## Configuration used by the public build

| Variable | Value | Where |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `/api` | baked into the web build |
| `API_PROXY_TARGET` | `http://127.0.0.1:4000` | web server (rewrites) |
| `JWT_SECRET` | `.zoolyum-demo-secret` (gitignored) | API |
| `RATE_LIMIT_MAX` | `5000` per minute | API (all traffic arrives from 127.0.0.1) |

To publish again after a code change, rebuild both apps:

```powershell
npm run build --prefix apps/api
$env:NEXT_PUBLIC_API_URL = "/api"; $env:API_PROXY_TARGET = "http://127.0.0.1:4000"
npm run build --prefix apps/web
```
