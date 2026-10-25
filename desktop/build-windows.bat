@echo off
rem AgriTrace - fabrication complete de l'installateur Windows (a lancer par double-clic ou dans une invite de commandes).
rem Prerequis : Node.js 22, Visual Studio Build Tools (C++), Inno Setup 6, connexion Internet.
setlocal
set VERSION=%1
if "%VERSION%"=="" set VERSION=0.2.0
set ROOT=%~dp0..
cd /d "%ROOT%"

where node >nul 2>&1 || (echo Node.js est introuvable : installez Node.js 22 puis relancez. & goto fin)

echo === 1/5 Serveur (backend) ===
cd /d "%ROOT%\backend"
call npm ci || goto erreur
call npm run build || goto erreur

echo === 2/5 Portail web ===
cd /d "%ROOT%\web"
call npm ci || goto erreur
call npm run build || goto erreur

echo === 3/5 Application de bureau ===
cd /d "%ROOT%\desktop"
call npm ci || goto erreur
node scripts\prepare-payload.js || goto erreur
call npm run dist:dir || goto erreur
if not exist "dist\win-unpacked\AgriTrace.exe" (echo dist\win-unpacked\AgriTrace.exe n'a pas ete cree. & goto erreur)

echo === 4/5 Installateur Inno Setup ===
set ISCC=
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe
if "%ISCC%"=="" (echo Inno Setup 6 est introuvable : installez-le puis relancez. & goto fin)
"%ISCC%" installer\agritrace.iss /DAppVersion=%VERSION% || goto erreur

echo === 5/5 Termine ===
echo Installateur : %ROOT%\desktop\dist\AgriTrace-Setup-%VERSION%.exe
goto fin

:erreur
echo.
echo *** Echec : lisez le message ci-dessus. ***
:fin
pause
