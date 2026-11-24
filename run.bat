@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js 22.18 or newer, then try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist ".env.local" (
  echo.
  echo Note: .env.local is missing. The app can open, but Spotify features
  echo require the values described in README.md.
  echo.
)

echo Starting Playlist Studio at http://127.0.0.1:3000
echo Press Ctrl+C to stop the server.
echo.
call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo The development server stopped with an error.
  pause
)
