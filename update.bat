@echo off
setlocal
title ERPNext Level - Updater
color 0B

echo.
echo  ============================================
echo       ERPNext Level - Update
echo  ============================================
echo.

cd /d "%~dp0"

:: ─── Pull latest from git ───
where git >nul 2>&1
if %errorlevel% equ 0 (
    echo  [1/3] Laatste versie ophalen van GitHub...
    git pull
    if %errorlevel% neq 0 (
        echo  [WARN] git pull mislukt. Ga je door met lokale versie? (J/N^)
        set /p CONTINUE=
        if /i not "!CONTINUE!"=="J" exit /b 1
    )
    echo  [OK] Code bijgewerkt.
) else (
    echo  [SKIP] Git niet gevonden, code update overgeslagen.
)
echo.

:: ─── Update dependencies ───
echo  [2/3] Dependencies bijwerken...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] npm install mislukt.
    pause
    exit /b 1
)
echo  [OK] Dependencies bijgewerkt.
echo.

:: ─── Rebuild ───
echo  [3/3] Frontend opnieuw bouwen...
call npm run build
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Build mislukt.
    pause
    exit /b 1
)
echo  [OK] Build voltooid.
echo.

echo  ============================================
echo       Update voltooid!
echo  ============================================
echo.
echo  Start ERPNext Level met: start.bat
echo.

pause
endlocal
