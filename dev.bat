@echo off
chcp 65001 >nul
title DevForge Dev
cd /d "%~dp0"
pnpm tauri:dev
