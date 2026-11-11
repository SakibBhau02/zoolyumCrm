@echo off
set NODE_ENV=production
set PORT=3000
set HOSTNAME=0.0.0.0
cd /d "%~dp0apps\web\.next\standalone"
node apps/web/server.js > "%~dp0qa-public-web.log" 2>&1
