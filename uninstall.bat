@echo off
setlocal enabledelayedexpansion
title ERPNext Level - Uninstaller
color 0E

echo.
echo  ============================================
echo       ERPNext Level - Uninstaller
echo  ============================================
echo.
echo  Dit verwijdert:
echo    - node_modules map
echo    - dist map (build output)
echo    - start.bat en start-production.bat
echo    - Bureaublad snelkoppeling
echo.
echo  De broncode en configuratie blijven behouden.
echo.

set /p CONFIRM="  Weet je het zeker? (J/N): "
if /i not "%CONFIRM%"=="J" (
    echo  Geannuleerd.
    pause
    exit /b 0
)

cd /d "%~dp0"

echo.
echo  [1/4] node_modules verwijderen...
if exist node_modules (
    rmdir /s /q node_modules
    echo  [OK] node_modules verwijderd.
) else (
    echo  [SKIP] node_modules bestaat niet.
)

echo  [2/4] Build output verwijderen...
if exist dist (
    rmdir /s /q dist
    echo  [OK] dist verwijderd.
) else (
    echo  [SKIP] dist bestaat niet.
)

echo  [3/4] Startscripts verwijderen...
if exist start.bat del start.bat && echo  [OK] start.bat verwijderd.
if exist start-production.bat del start-production.bat && echo  [OK] start-production.bat verwijderd.

echo  [4/4] Bureaublad snelkoppeling verwijderen...
set DESKTOP_LINK="%USERPROFILE%\Desktop\ERPNext Level.lnk"
if exist %DESKTOP_LINK% (
    del %DESKTOP_LINK%
    echo  [OK] Snelkoppeling verwijderd.
) else (
    echo  [SKIP] Geen snelkoppeling gevonden.
)

echo.
echo  ============================================
echo       Verwijdering voltooid!
echo  ============================================
echo.
echo  Om opnieuw te installeren: install.bat
echo.

pause
endlocal
