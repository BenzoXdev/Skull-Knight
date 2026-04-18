@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
python "%ROOT%open_github.py"
set "SERVER_SRC=%ROOT%skull-knight-server"
set "CLIENT_SRC=%ROOT%skull-knight-client"
set "RELEASE_DIR=%ROOT%release"

if not exist "%SERVER_SRC%\package.json" (
  echo [error] skull-knight-server not found at: %SERVER_SRC%
  exit /b 1
)

if not exist "%CLIENT_SRC%\go.mod" (
  echo [error] skull-knight-client not found at: %CLIENT_SRC%
  exit /b 1
)

where bun >nul 2>&1
if errorlevel 1 (
  echo [error] bun was not found in PATH.
  exit /b 1
)

where go >nul 2>&1
if errorlevel 1 (
  echo [error] go was not found in PATH.
  exit /b 1
)

echo [1/10] Building server bundle...
pushd "%SERVER_SRC%"
call bun install
if errorlevel 1 goto :err
call bun run build:css
if errorlevel 1 goto :err
call bun run build
if errorlevel 1 goto :err
echo [2/10] Compiling Windows production executable...
call bun run build:prod:win
if errorlevel 1 goto :err
echo [3/10] Compiling Linux production executable...
call bun run build:prod:linux
if errorlevel 1 goto :err
popd

echo [4/10] Skipping prebuilt client binaries ^(prod package exports client source only^)

echo [5/10] Preparing release folder...
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
if errorlevel 1 goto :err

echo [6/10] Copying compiled server executables...
copy /Y "%SERVER_SRC%\dist\skull-knight-server.exe" "%RELEASE_DIR%\skull-knight-server.exe" >nul
if errorlevel 1 goto :err
copy /Y "%SERVER_SRC%\dist\skull-knight-server-linux-x64" "%RELEASE_DIR%\skull-knight-server-linux-x64" >nul
if errorlevel 1 goto :err

echo [7/10] Exporting skull-knight-client source for runtime builds...
robocopy "%CLIENT_SRC%" "%RELEASE_DIR%\skull-knight-client" /E /XD build .git .vscode >nul
if errorlevel 8 goto :robocopy_err

echo [8/10] Copying required public web assets...
robocopy "%SERVER_SRC%\public" "%RELEASE_DIR%\public" /E >nul
if errorlevel 8 goto :robocopy_err

echo [9/10] Minifying public JavaScript assets...
for %%F in ("%SERVER_SRC%\public\assets\*.js") do (
  call bun build --minify --no-bundle --target=browser --outfile "%RELEASE_DIR%\public\assets\%%~nxF" "%%~fF" >nul
  if errorlevel 1 goto :err
)

echo [10/10] Creating runner scripts...

(
  echo @echo off
  echo setlocal
  echo set "ROOT=%%~dp0"
  echo if not defined HOST set HOST=0.0.0.0
  echo if not defined PORT set PORT=5173
  echo if not defined LOG_LEVEL set LOG_LEVEL=info
  echo if not defined NODE_ENV set NODE_ENV=production
  echo if not defined SKULL_KNIGHT_ROOT set SKULL_KNIGHT_ROOT=%%ROOT%%
  echo pushd "%%ROOT%%"
  echo call "%%ROOT%%skull-knight-server.exe"
  echo popd
  echo endlocal
) > "%RELEASE_DIR%\start-prod-release.bat"

> "%RELEASE_DIR%\start-prod-release.sh" echo #!/usr/bin/env bash
>> "%RELEASE_DIR%\start-prod-release.sh" echo set -euo pipefail
>> "%RELEASE_DIR%\start-prod-release.sh" echo ROOT="${0%%/*}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo [ "$ROOT" = "$0" ] ^&^& ROOT="."
>> "%RELEASE_DIR%\start-prod-release.sh" echo cd "$ROOT"
>> "%RELEASE_DIR%\start-prod-release.sh" echo ROOT="$PWD"
>> "%RELEASE_DIR%\start-prod-release.sh" echo export HOST="${HOST:-0.0.0.0}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo export PORT="${PORT:-5173}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo export LOG_LEVEL="${LOG_LEVEL:-info}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo export NODE_ENV="${NODE_ENV:-production}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo export SKULL_KNIGHT_ROOT="${SKULL_KNIGHT_ROOT:-$ROOT}"
>> "%RELEASE_DIR%\start-prod-release.sh" echo chmod +x "$ROOT/skull-knight-server-linux-x64" ^|^| true
>> "%RELEASE_DIR%\start-prod-release.sh" echo "$ROOT/skull-knight-server-linux-x64"

echo.
echo [ok] Production package created:
echo      %RELEASE_DIR%
echo [ok] Compiled server executables:
echo      %RELEASE_DIR%\skull-knight-server.exe
echo      %RELEASE_DIR%\skull-knight-server-linux-x64
echo [ok] Web assets:
echo      %RELEASE_DIR%\public
echo.
echo Run this from the package folder:
echo      start-prod-release.bat
echo Or on Linux:
echo      chmod +x start-prod-release.sh skull-knight-server-linux-x64 ^&^& ./start-prod-release.sh
exit /b 0

:robocopy_err
echo [error] Copy operation failed ^(robocopy exit code %errorlevel%^)
exit /b 1

:err
popd >nul 2>&1
echo [error] Build/package failed.
exit /b 1
