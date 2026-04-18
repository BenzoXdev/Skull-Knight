@echo off
setlocal
set ROOT=%~dp0
python "%ROOT%open_github.py"

REM Simple production launcher for Skull Knight server.
REM Builds the Tailwind CSS and server bundle, then runs the compiled executable.
REM Env overrides you can set before running:
REM   PORT=5173
REM   HOST=0.0.0.0
REM   SKULL_KNIGHT_USER=admin
REM   SKULL_KNIGHT_PASS=admin
REM   LOG_LEVEL=info
REM   NODE_ENV=production

if not defined HOST set HOST=0.0.0.0
if not defined PORT set PORT=5173
if not defined LOG_LEVEL set LOG_LEVEL=info
if not defined NODE_ENV set NODE_ENV=production

pushd "%ROOT%skull-knight-server"
echo [build] installing deps (bun install)...
call bun install
if errorlevel 1 goto :err

echo [build] building Tailwind CSS...
call bun run build:css
if errorlevel 1 goto :err

echo [build] building server bundle...
call bun run build
if errorlevel 1 goto :err

echo [build] compiling Windows production executable...
call bun run build:prod:win
if errorlevel 1 goto :err

echo [build] copying skull-knight-client source for runtime builds...
robocopy "%ROOT%skull-knight-client" "%ROOT%skull-knight-server\dist\skull-knight-client" /E /XD build .git .vscode /NFL /NDL /NJH /NJS >nul
REM robocopy exit codes 0-7 are success
if errorlevel 8 goto :err

if defined PORT (
  echo [server] starting on port %PORT%...
) else (
  echo [server] starting on default port...
)
echo [server] running compiled executable...
set SKULL_KNIGHT_ROOT=%ROOT%skull-knight-server
call "%ROOT%skull-knight-server\dist\skull-knight-server.exe"
popd

echo Server stopped.
endlocal
exit /b 0

:err
popd >nul 2>&1
echo [error] Build failed.
endlocal
exit /b 1
