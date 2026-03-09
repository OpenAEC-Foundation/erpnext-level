@echo off
setlocal enabledelayedexpansion
title ERPNext Level - Installer
color 0A

echo.
echo  ============================================
echo       ERPNext Level - Windows Installer
echo       powered by OpenAEC Foundation
echo  ============================================
echo.

:: ─── Check Node.js ───
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is niet geinstalleerd.
    echo.
    echo  Download Node.js van: https://nodejs.org/
    echo  Kies de LTS versie en installeer deze eerst.
    echo.
    pause
    exit /b 1
)

:: Show Node version
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js gevonden: %NODE_VER%

:: ─── Check npm ───
where npm >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] npm is niet gevonden.
    echo  Herinstalleer Node.js van https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('npm -v') do set NPM_VER=%%v
echo  [OK] npm gevonden: v%NPM_VER%
echo.

:: ─── Navigate to script directory ───
cd /d "%~dp0"
echo  [INFO] Installatiemap: %cd%
echo.

:: ─── Install dependencies ───
echo  [1/3] Dependencies installeren...
echo  (dit kan een paar minuten duren)
echo.
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERROR] npm install is mislukt.
    echo  Controleer je internetverbinding en probeer opnieuw.
    pause
    exit /b 1
)
echo.
echo  [OK] Dependencies geinstalleerd.
echo.

:: ─── Build frontend ───
echo  [2/3] Frontend bouwen...
echo.
call npm run build
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERROR] Build is mislukt.
    echo  Controleer de foutmeldingen hierboven.
    pause
    exit /b 1
)
echo.
echo  [OK] Frontend gebouwd.
echo.

:: ─── Create start script ───
echo  [3/3] Startscripts aanmaken...

:: Create start.bat if not exists or update it
(
echo @echo off
echo title ERPNext Level
echo color 0B
echo.
echo echo.
echo echo  ============================================
echo echo       ERPNext Level - Starting...
echo echo       powered by OpenAEC Foundation
echo echo  ============================================
echo echo.
echo.
echo cd /d "%%~dp0"
echo.
echo :: Start backend server in background
echo echo  [INFO] Backend starten op http://localhost:3001 ...
echo start /b "" cmd /c "npx tsx server/index.ts 2>&1 | findstr /v "^$""
echo.
echo :: Wait for backend to start
echo timeout /t 3 /nobreak ^>nul
echo.
echo :: Start frontend dev server
echo echo  [INFO] Frontend starten op http://localhost:5173 ...
echo echo.
echo echo  ============================================
echo echo   Open je browser:  http://localhost:5173
echo echo  ============================================
echo echo.
echo echo  Druk Ctrl+C om te stoppen.
echo echo.
echo.
echo set USE_BACKEND=true
echo call npx vite --open
) > start.bat

:: Create start-production.bat for serving built files
(
echo @echo off
echo title ERPNext Level - Production
echo color 0B
echo.
echo echo.
echo echo  ============================================
echo echo       ERPNext Level - Production Mode
echo echo       powered by OpenAEC Foundation
echo echo  ============================================
echo echo.
echo.
echo cd /d "%%~dp0"
echo.
echo echo  [INFO] Backend starten op http://localhost:3001 ...
echo start /b "" cmd /c "npx tsx server/index.ts"
echo.
echo timeout /t 3 /nobreak ^>nul
echo.
echo echo  [INFO] Preview server starten op http://localhost:4173 ...
echo echo.
echo echo  ============================================
echo echo   Open je browser:  http://localhost:4173
echo echo  ============================================
echo echo.
echo.
echo call npx vite preview --open
) > start-production.bat

echo  [OK] start.bat aangemaakt (development)
echo  [OK] start-production.bat aangemaakt (production)
echo.

:: ─── Ask to create desktop shortcut ───
set /p CREATE_SHORTCUT="  Wil je een snelkoppeling op het bureaublad? (J/N): "
if /i "%CREATE_SHORTCUT%"=="J" (
    :: Create VBS helper to make shortcut
    set SHORTCUT_VBS=%TEMP%\create_shortcut.vbs
    (
        echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
        echo sLinkFile = oWS.SpecialFolders^("Desktop"^) ^& "\ERPNext Level.lnk"
        echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
        echo oLink.TargetPath = "%cd%\start.bat"
        echo oLink.WorkingDirectory = "%cd%"
        echo oLink.Description = "ERPNext Level Dashboard"
        echo oLink.IconLocation = "shell32.dll,14"
        echo oLink.Save
    ) > "!SHORTCUT_VBS!"
    cscript //nologo "!SHORTCUT_VBS!"
    del "!SHORTCUT_VBS!"
    echo  [OK] Snelkoppeling aangemaakt op bureaublad.
    echo.
)

:: ─── Done ───
echo.
echo  ============================================
echo       Installatie voltooid!
echo  ============================================
echo.
echo   Starten:
echo     - Development:  start.bat
echo     - Production:   start-production.bat
echo.
echo   Of via de snelkoppeling op je bureaublad.
echo.
echo   URLs:
echo     Development:  http://localhost:5173
echo     Production:   http://localhost:4173
echo     Backend API:  http://localhost:3001
echo.
echo  ============================================
echo.

set /p START_NOW="  Wil je ERPNext Level nu starten? (J/N): "
if /i "%START_NOW%"=="J" (
    call start.bat
)

endlocal
