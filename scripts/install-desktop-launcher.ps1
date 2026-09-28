$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gitDir = Join-Path $repoRoot ".git"

if (-not (Test-Path $gitDir)) {
    throw "FinanceOS repository was not found at: $repoRoot"
}

$desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path $desktop)) {
    throw "Windows Desktop folder could not be resolved."
}

$launcherPath = Join-Path $desktop "FinanceOS.cmd"

$launcher = @"
@echo off
setlocal EnableExtensions
title FinanceOS Launcher

cd /d "$repoRoot"

where git >nul 2>&1
if errorlevel 1 (
  echo Git was not found in PATH.
  echo Install Git or reopen the terminal after installation.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Install Node.js or reopen the terminal after installation.
  pause
  exit /b 1
)

set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"

if defined DIRTY (
  echo.
  echo FinanceOS has local uncommitted changes.
  echo Automatic update was stopped so your work cannot be overwritten.
  echo Commit, stash, or discard the changes and run FinanceOS again.
  echo.
  git status --short
  pause
  exit /b 1
)

echo.
echo [1/4] Updating FinanceOS from GitHub...
git fetch origin --prune
if errorlevel 1 goto :fail

git switch buuk
if errorlevel 1 goto :fail

git pull --ff-only origin buuk
if errorlevel 1 goto :fail

echo.
echo [2/4] Updating dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [3/4] Checking whether FinanceOS is already running...
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto :openbrowser

echo Starting FinanceOS development server...
start "FinanceOS Dev Server" cmd /k "cd /d ""$repoRoot"" && npm run dev"

echo.
echo [4/4] Waiting for FinanceOS...
powershell.exe -NoProfile -Command "$deadline=(Get-Date).AddSeconds(45); do { try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"

if errorlevel 1 (
  echo FinanceOS did not become available on http://localhost:3000 within 45 seconds.
  echo Check the FinanceOS Dev Server window for details.
  pause
  exit /b 1
)

:openbrowser
echo Opening FinanceOS...
start "" "http://localhost:3000"
exit /b 0

:fail
echo.
echo FinanceOS update or startup failed.
echo Nothing was force-reset or overwritten.
pause
exit /b 1
"@

Set-Content -Path $launcherPath -Value $launcher -Encoding ASCII

Write-Host ""
Write-Host "Created desktop launcher:"
Write-Host $launcherPath
Write-Host ""
Write-Host "Double-click FinanceOS.cmd on your Desktop to:"
Write-Host "  1. fetch and fast-forward the buuk branch,"
Write-Host "  2. update npm dependencies,"
Write-Host "  3. start the local FinanceOS server if needed,"
Write-Host "  4. open http://localhost:3000."
