@echo off
"E:\tools\cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate > "%~dp0qa-tunnel.log" 2>&1
