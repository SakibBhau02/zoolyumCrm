@echo off
set NODE_ENV=production
set NEXT_PUBLIC_API_URL=/api
set API_PROXY_TARGET=http://127.0.0.1:4000
cd /d "%~dp0"
npx --prefix apps/web next start apps/web -p 3000 > "%~dp0qa-public-web.log" 2>&1
