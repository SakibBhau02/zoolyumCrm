# Keeps the local Zoolyum demo stack alive for a share link:
#   - API  (dist/main.js)          on :4000
#   - Web  (next dev)              on :3000
#   - cloudflared quick tunnel     -> http://localhost:3000
# Loop forever, restart whatever is missing. Tunnel URL is written to
# qa-tunnel-url.txt every time a new tunnel starts.
$ErrorActionPreference = "SilentlyContinue"
$root = "E:\open code\zoolyumCrm"

function Test-Port([int]$port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return [bool]$c
}

function Start-Api {
  $cmd = "cmd.exe /c cd /d `"$root\apps\api`" && node dist/main.js > `"$root\qa-api.log`" 2>&1"
  [void]([wmiclass]"Win32_Process").Create($cmd, $root, $null)
  "$(Get-Date -Format s) started api" | Add-Content "$root\qa-keepalive.log"
}

function Start-Web {
  Remove-Item "$root\apps\web\.next\dev\lock" -Force -ErrorAction SilentlyContinue
  $cmd = "cmd.exe /c cd /d `"$root\apps\web`" && npm run dev > `"$root\qa-web.log`" 2>&1"
  [void]([wmiclass]"Win32_Process").Create($cmd, $root, $null)
  "$(Get-Date -Format s) started web" | Add-Content "$root\qa-keepalive.log"
}

function Start-Tunnel {
  $cmd = "cmd.exe /c `"$root\start-tunnel.cmd`""
  [void]([wmiclass]"Win32_Process").Create($cmd, $root, $null)
  "$(Get-Date -Format s) started tunnel" | Add-Content "$root\qa-keepalive.log"
}

while ($true) {
  if (-not (Test-Port 4000)) { Start-Api; Start-Sleep -Seconds 12 }
  if (-not (Test-Port 3000)) { Start-Web; Start-Sleep -Seconds 20 }
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) { Start-Tunnel; Start-Sleep -Seconds 15 }

  $m = Select-String -Path "$root\qa-tunnel.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
       Select-Object -Last 1
  if ($m -and $m.Matches.Count -gt 0) { $m.Matches[0].Value | Set-Content "$root\qa-tunnel-url.txt" }

  Start-Sleep -Seconds 20
}
