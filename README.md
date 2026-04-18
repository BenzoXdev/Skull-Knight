<p align="center">
  <img src="https://raw.githubusercontent.com/benzoXdev/Skull-Knight/refs/heads/main/skull-knight-server/public/assets/skull-knight.png" alt="Skull Knight Logo" width="350" />
</p>

<h1 align="center">Skull Knight</h1>

<p align="center">
  <strong>A high-performance, cross-platform Remote Administration Tool (RAT) designed for modularity and stealth.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.8.8-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/Language-Go%20%2F%20TypeScript-blue.svg" alt="Languages" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-red.svg" alt="License" />
  <img src="https://img.shields.io/badge/Author-benzoXdev-orange.svg" alt="Author" />
</p>

---

## ⚡ Overview

**Skull Knight** is an advanced C2 (Command & Control) framework built on a modern stack. It features a lightweight **Go-based agent** and a high-concurrency **Bun-powered server**. Designed for security professionals and authorized administrators, it provides a comprehensive suite of tools for remote management, monitoring, and forensic analysis.

> [!IMPORTANT]
> **Disclaimer**: This tool is for authorized educational and professional use only. Usage of Skull Knight for attacking targets without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state, and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program.

---

## 🚀 Key Features

### 🖥️ Remote Management
*   **HVNC (Hidden VNC)**: Access a completely hidden desktop session without the user's knowledge.
*   **Real-time Screen Capture**: High-frame-rate streaming of remote displays.
*   **Remote Shell**: Full terminal access across Windows, Linux, and macOS.
*   **File Manager**: Comprehensive upload, download, and file system exploration.

### 🕵️ Monitoring & Surveillance
*   **Advanced Keylogger**: Real-time keystroke monitoring with offline buffering.
*   **Audio Capture**: Remote microphone access and live streaming.
*   **Webcam Monitoring**: Live video feed from integrated cameras.
*   **Process Manager**: View, terminate, and monitor remote processes.

### 🛠️ Infrastructure & Security
*   **Stealth Persistence**: Multiple methods to maintain access (Registry, Task Scheduler, Startup, WMI).
*   **Mutual TLS (mTLS)**: Secure, encrypted communication between agents and the C2 server.
*   **SOCKS5 Proxy**: Tunnel traffic through remote agents for network pivoting.
*   **Modular Plugin System**: Extend server functionality without core modifications.
*   **Automated Tasks**: Deploy scripts and binaries automatically upon client enrollment.

---

## 📦 Installation & Setup

### 🐳 Method 1: Docker (Recommended)
The fastest way to deploy Skull Knight is using Docker Compose.

1.  **Deployment**:
    ```bash
    # For Linux
    docker compose up -d

    # For Windows / macOS
    docker compose -f docker-compose.windows.yml up -d
    ```
2.  **Access**: Navigate to `https://localhost:5173` in your browser.
3.  **Authentication**: Default credentials are `admin` / `admin` (change these immediately in `data/save.json`).

### 🛠️ Method 2: Native Setup
Requires [Bun](https://bun.sh) and [Go 1.22+](https://go.dev).

**Windows**:
```bat
start-prod.bat
```

**Linux / macOS**:
```bash
chmod +x start-prod.sh
./start-prod.sh
```

---

## 🛠️ Build System

Skull Knight features a robust build pipeline for generating custom agents.

*   **Build Agents**: Use `build-clients.bat` to generate binaries for Windows, Linux, macOS, and Android.
*   **Build Desktop Client**: Use `build-desktop.bat` for the Electron-based fat client.
*   **Build HVNC DLLs**: Use `build-hvnc-dll.bat` (requires MSVC/MinGW).

---

<p align="center">
  Developed with ❤️ by <strong>benzoXdev</strong>
</p>
