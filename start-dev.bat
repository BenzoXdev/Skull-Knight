@echo off
setlocal enabledelayedexpansion

REM Rebranding to Skull Knight
set ROOT=%~dp0

echo [Skull Knight] Starting development environment...
python "%ROOT%open_github.py"

REM Start Server
pushd "%ROOT%skull-knight-server"
echo [server] starting...
REM In dev, we can just run bun src/index.ts
popd

REM Start Client
pushd "%ROOT%skull-knight-client"
echo [client] starting...
popd

REM We use 'start' to run them in separate windows on Windows
REM Set some default dev env vars
set SKULL_KNIGHT_AGENT_TOKEN=dev-token-insecure-local-only
set SKULL_KNIGHT_DISABLE_AGENT_AUTH=true

echo [Skull Knight] launching server and client windows...
start "Skull-Knight-Server" cmd /k "cd /d %ROOT%skull-knight-server && set SKULL_KNIGHT_DISABLE_AGENT_AUTH=true && set SKULL_KNIGHT_AGENT_TOKEN=dev-token-insecure-local-only && set LOG_LEVEL=debug && set NODE_ENV=development && bun install && bun run start"

start "Skull-Knight-Client" cmd /k "cd /d %ROOT%skull-knight-client && set SKULL_KNIGHT_SERVER=wss://localhost:5173 && set SKULL_KNIGHT_AGENT_TOKEN=dev-token-insecure-local-only && set SKULL_KNIGHT_TLS_INSECURE_SKIP_VERIFY=true && set SKULL_KNIGHT_MODE=dev && set GOINSECURE=* && set GOSUMDB=off && set GOPROXY=https://proxy.golang.org,direct && go mod tidy && go run ./cmd/agent"

echo Done. Terminals stay open (/k) for logs.
endlocal
