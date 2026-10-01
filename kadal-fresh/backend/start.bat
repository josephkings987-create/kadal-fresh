@echo off
setlocal
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
where node >nul 2>nul || (echo Node.js is required. Install Node.js LTS first.& pause & exit /b 1)
if not exist node_modules (echo Dependencies not installed. Run setup.bat first.& pause & exit /b 1)
echo Starting Kadal Fresh...
npm start
pause
