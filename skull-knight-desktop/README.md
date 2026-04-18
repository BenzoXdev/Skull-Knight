# Skull Knight Desktop

A native desktop (fat) client for the Skull Knight server, built with [Electron](https://electronjs.org). Use this instead of a browser to connect to your Skull Knight instance.

## Features

- Native desktop window with a connection screen
- Remembers your last server address across launches
- TLS toggle for connecting to HTTPS or HTTP servers
- Accepts self-signed certificates
- Full keyboard shortcut support (cut/copy/paste)
- Cross-platform (macOS, Windows, Linux)

## Prerequisites

- [Node.js](https://nodejs.org) or [Bun](https://bun.sh) installed

## Quick Start

```bash
cd skull-knight-Desktop
npm install    # or: bun install
npm start      # or: npx electron .
```

This will:
1. Show a connect screen where you enter the Skull Knight server's IP/hostname and port
2. Click **Connect** to load the Skull Knight web UI inside the native window
3. Your connection details are saved automatically for next launch

## Building for Distribution

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## Configuration

On first connect, the app saves your connection to the Electron userData directory:
- **Windows:** `%APPDATA%/skull-knight-desktop/connection.json`
- **macOS:** `~/Library/Application Support/skull-knight-desktop/connection.json`
- **Linux:** `~/.config/skull-knight-desktop/connection.json`

Defaults:
- **Port:** 5173
- **TLS:** Enabled
