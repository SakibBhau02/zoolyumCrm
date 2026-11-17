# Rebuilds the API and the public (tunnel) web build, then restarts both.
#
# Why this exists: `next build` leaves `.next/standalone` WITHOUT `.next/static`
# and `public`, and the public demo needs the same-origin `/api` bundle. Doing
# those steps by hand is easy to forget and the result looks like "the database
# is not connected" (page loads, every API call fails).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/rebuild-public.ps1
#        powershell -ExecutionPolicy Bypass -File scripts/rebuild-public.ps1 -NoRestart
param([switch]$NoRestart)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}
function Stop-Port([int]$port) {
  $owner = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess
  if ($owner) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped :$port (pid $owner)"
    Start-Sleep -Milliseconds 800
  }
}

# 1. Stop the servers first: `next build` cannot replace .next while the
#    standalone server is running (EBUSY), and the API build rewrites dist/.
Stop-Port 3000
Stop-Port 4000

# 2. Build the API.
Write-Host "Building API ..."
npm run build --prefix apps/api
if ($LASTEXITCODE -ne 0) { throw "API build failed" }

# 3. Build the web app for the tunnel: same-origin /api, proxied to the API.
$env:NEXT_PUBLIC_API_URL = "/api"
$env:API_PROXY_TARGET = "http://127.0.0.1:4000"
Write-Host "Building web ..."
npm run build --prefix apps/web
if ($LASTEXITCODE -ne 0) { throw "Web build failed" }

# 4. Static assets are NOT copied into the standalone output by `next build`.
$web = Join-Path $root "apps\web"
$standalone = Join-Path $web ".next\standalone\apps\web"
New-Item -ItemType Directory -Force -Path (Join-Path $standalone ".next") | Out-Null
Copy-Item (Join-Path $web ".next\static") -Destination (Join-Path $standalone ".next\static") -Recurse -Force
if (Test-Path (Join-Path $web "public")) {
  Copy-Item (Join-Path $web "public") -Destination (Join-Path $standalone "public") -Recurse -Force
}
Write-Host "Copied static assets into the standalone build"

if ($NoRestart) {
  Write-Host "Done (servers left stopped because -NoRestart was passed)."
  exit 0
}

# 5. Start API then web with the demo environment (JWT secret, CORS, rate limit).
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$(Join-Path $root 'start-public-api.cmd')`"" -WindowStyle Hidden
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port 4000) { break }
}
if (-not (Test-Port 4000)) { throw "API did not start - see qa-public-api.log" }

Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$(Join-Path $root 'start-public-web.cmd')`"" -WindowStyle Hidden
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port 3000) { break }
}
if (-not (Test-Port 3000)) { throw "Web did not start - see qa-public-web.log" }

# 6. Prove the proxy really reaches the API before claiming success.
try {
  $health = Invoke-RestMethod "http://localhost:3000/api/health" -TimeoutSec 20
  Write-Host "Proxy check: http://localhost:3000/api/health -> ok=$($health.ok)" -ForegroundColor Green
} catch {
  Write-Host "Proxy check FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "The web server is up but /api is not reaching the API on :4000." -ForegroundColor Red
}

# 7. Report the tunnel URL if the tunnel is still running.
if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
  $log = Join-Path $root "qa-tunnel.log"
  if (Test-Path $log) {
    $match = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
      Select-Object -Last 1
    if ($match) { Write-Host "Public URL: $($match.Matches[-1].Value)" -ForegroundColor Cyan }
  }
} else {
  Write-Host "Tunnel is not running. Start it with: powershell -ExecutionPolicy Bypass -File scripts/public-demo.ps1"
}
