#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT/skull-knight-server"
BUN_BIN="${BUN_BIN:-bun}"
python3 "$ROOT/open_github.py" &

cd "$SERVER_DIR"
if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
	echo "[server] bun not found. Set BUN_BIN to your bun binary or install bun for this environment." >&2
	exit 1
fi
echo "[server] using bun at: $(command -v $BUN_BIN)"

echo "[build] bun install..."
"$BUN_BIN" install

echo "[build] building Tailwind CSS..."
"$BUN_BIN" run build:css

echo "[build] building server bundle..."
"$BUN_BIN" run build

echo "[build] compiling Linux production executable..."
"$BUN_BIN" run build:prod:linux

echo "[build] copying skull-knight-client source for runtime builds..."
mkdir -p "$SERVER_DIR/dist/skull-knight-client"
rsync -a --exclude='build' --exclude='.git' --exclude='.vscode' "$ROOT/skull-knight-client/" "$SERVER_DIR/dist/skull-knight-client/" 2>/dev/null \
	|| {
		rm -rf "$SERVER_DIR/dist/skull-knight-client"
		cp -a "$ROOT/skull-knight-client" "$SERVER_DIR/dist/skull-knight-client"
		rm -rf "$SERVER_DIR/dist/skull-knight-client/build" "$SERVER_DIR/dist/skull-knight-client/.git" "$SERVER_DIR/dist/skull-knight-client/.vscode"
	}

echo "[server] starting compiled executable..."
PORT="${PORT:-5173}" \
HOST="${HOST:-0.0.0.0}" \
SKULL_KNIGHT_USER="${SKULL_KNIGHT_USER:-admin}" \
SKULL_KNIGHT_PASS="${SKULL_KNIGHT_PASS:-admin}" \
LOG_LEVEL="${LOG_LEVEL:-info}" \
NODE_ENV="${NODE_ENV:-production}" \
SKULL_KNIGHT_ROOT="$SERVER_DIR" \
"$SERVER_DIR/dist/skull-knight-server-linux-x64"
