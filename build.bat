@echo off
setlocal

cd /d "%~dp0"

where wails >nul 2>nul
if errorlevel 1 (
  echo Wails CLI was not found. Install it with:
  echo   go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
  exit /b 1
)

echo Building Codex Manager...
wails build
if errorlevel 1 (
  set "BUILD_EXIT=%ERRORLEVEL%"
  echo.
  echo Build failed.
  exit /b %BUILD_EXIT%
)

echo.
echo Build succeeded. Output: build\bin\CodexManager.exe
endlocal
