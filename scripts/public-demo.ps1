# Starts the full stack and exposes it through a Cloudflare quick tunnel.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/public-demo.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# 1. Stable JWT secret for this demo (gitignored, never committed).
$secretFile = Join-Path $root ".zoolyum-demo-secret"
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -Path $secretFile -NoNewline
  Write-Host "Created $secretFile"
}

# 2. API
if (Test-Port 4000) {
  Write-Host "API already listening on :4000"
} else {
  Write-Host "Starting API on :4000 ..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$root\start-public-api.cmd`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 750
    if (Test-Port 4000) { break }
  }
  if (-not (Test-Port 4000)) { throw "API did not start - see qa-public-api.log" }
}

# 3. Web
if (Test-Port 3000) {
  Write-Host "Web already listening on :3000"
} else {
  Write-Host "Starting web on :3000 ..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$root\start-public-web.cmd`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 750
    if (Test-Port 3000) { break }
  }
  if (-not (Test-Port 3000)) { throw "Web did not start - see qa-public-web.log" }
}

# 4. Tunnel
$tunnelLog = Join-Path $root "qa-tunnel.log"
if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "Opening Cloudflare quick tunnel ..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$root\start-tunnel.cmd`"" -WindowStyle Hidden
}

$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $tunnelLog) {
    $match = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
      Select-Object -Last 1
    if ($match) { $url = $match.Matches[-1].Value; break }
  }
}
if (-not $url) { throw "Tunnel URL not found - see qa-tunnel.log" }

Write-Host ""
Write-Host "Public demo is live:" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Cyan
Write-Host ""
Write-Host "Owner login: sakib@zoolyum.com / zoolyum123"
Write-Host "Stop: Get-Process cloudflared | Stop-Process -Force"
