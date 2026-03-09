@echo off
setlocal
title ERPNext Level - Build EXE
color 0B

echo.
echo  ============================================
echo       ERPNext Level - EXE Builder
echo       powered by OpenAEC Foundation
echo  ============================================
echo.

cd /d "%~dp0"

:: ─── Check prerequisites ───
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js niet gevonden. Installeer Node.js van https://nodejs.org/
    pause
    exit /b 1
)

echo  [OK] Node.js gevonden
echo.

:: ─── Install dependencies if needed ───
if not exist node_modules (
    echo  [1/5] Dependencies installeren...
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo  [ERROR] npm install mislukt.
        pause
        exit /b 1
    )
) else (
    echo  [1/5] Dependencies al aanwezig.
)
echo.

:: ─── Build frontend ───
echo  [2/5] Frontend bouwen (Vite)...
call npx tsc -b
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] TypeScript compilatie mislukt.
    pause
    exit /b 1
)
call npx vite build
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Vite build mislukt.
    pause
    exit /b 1
)
echo  [OK] Frontend gebouwd.
echo.

:: ─── Bundle Electron main process ───
echo  [3/5] Electron main process bundelen...
call node scripts/build-electron.mjs
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Electron bundle mislukt.
    pause
    exit /b 1
)
echo  [OK] Electron gebundeld.
echo.

:: ─── Build EXE ───
echo  [4/5] Windows EXE bouwen...
echo  (dit kan enkele minuten duren bij eerste keer)
echo.
call npx electron-builder --win
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERROR] electron-builder mislukt.
    echo  Controleer de foutmeldingen hierboven.
    pause
    exit /b 1
)
echo.
echo  [OK] EXE gebouwd.
echo.

:: ─── Done ───
echo  [5/5] Klaar!
echo.
echo  ============================================
echo       Build voltooid!
echo  ============================================
echo.
echo   Output: release\
echo.

:: List output files
dir /b release\*.exe 2>nul
if %errorlevel% equ 0 (
    echo.
    echo   ^ Open de release map om je EXE te vinden.
)
echo.

:: Open release folder
explorer release

pause
endlocal
