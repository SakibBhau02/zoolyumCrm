@echo off
set /p JWT_SECRET=<"%~dp0.zoolyum-demo-secret"
if "%JWT_SECRET%"=="" (
  echo Missing .zoolyum-demo-secret
  exit /b 1
)
set NODE_ENV=production
set CORS_ORIGINS=http://localhost:3000
set RATE_LIMIT_MAX=5000
cd /d "%~dp0apps\api"
node dist/main.js > "%~dp0qa-public-api.log" 2>&1
