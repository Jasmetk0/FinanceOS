@echo off
setlocal
title FinanceOS Desktop Launcher Installer

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop-launcher.ps1"

if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)

echo.
echo FinanceOS desktop launcher was created successfully.
pause
