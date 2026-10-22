@echo off
chcp 65001 >nul
title Publish survey-autofill-helper to GitHub
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish.ps1" %*
echo.
echo [log] %~dp0publish.log
pause
