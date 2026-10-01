@echo off
setlocal
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
where node >nul 2>nul || (echo Node.js is required. Install Node.js LTS first.& pause & exit /b 1)
echo Installing dependencies...
npm install
if errorlevel 1 (echo npm install failed.& pause & exit /b 1)
echo.
echo Setup complete. Run start.bat to launch Kadal Fresh.
pause
