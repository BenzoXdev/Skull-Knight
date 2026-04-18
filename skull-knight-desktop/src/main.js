const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

// ── Persistence ──────────────────────────────────────────────
app.setAppUserModelId("com.Skull Knight.desktop");

const CONFIG_DIR = path.join(app.getPath("userData"), "skull-knight-desktop");
const CONFIG_FILE = path.join(CONFIG_DIR, "connection.json");

function loadSavedConnection() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (raw && typeof raw.host === "string" && typeof raw.port === "number") {
        return {
          host: raw.host,
          port: raw.port,
          useTLS: raw.useTLS !== false,
        };
      }
    }
  } catch {
    // ignore corrupt config
  }
  return null;
}

function saveConnection(conn) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(conn, null, 2));
}

// ── Window ───────────────────────────────────────────────────
let win;
let serverBaseUrl = null; // e.g. "https://1.2.3.4:5173"
let pendingError = null;  // error message to show on the connect page after a failed load

// ── Server probe ─────────────────────────────────────────────
// Checks whether a server is reachable before telling Electron to navigate to it.
function probeServer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { rejectUnauthorized: false, timeout: 8000 }, (res) => {
      res.resume(); // drain so the socket can be reused
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Skull Knight",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "connect", "index.html"));

  // Allow self-signed certs on the target Skull Knight server
  win.webContents.session.setCertificateVerifyProc((_req, cb) => cb(0));

  // If the server URL fails to load mid-session (e.g. server stopped), bounce back
  // to the connect screen with a helpful error instead of showing a white page.
  win.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL) => {
    // ERR_ABORTED (-3) fires on normal navigation cancellations – ignore it.
    if (errorCode === -3) return;
    if (serverBaseUrl && validatedURL && validatedURL.startsWith(serverBaseUrl)) {
      pendingError =
        "Lost connection to the Skull Knight server. " +
        "Make sure the server is still running, then try connecting again. " +
        "See the README if you need help starting the server.";
      serverBaseUrl = null;
      win.loadFile(path.join(__dirname, "connect", "index.html"));
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC handlers ─────────────────────────────────────────────
ipcMain.handle("get-saved-connection", () => {
  return loadSavedConnection();
});

ipcMain.handle("get-pending-error", () => {
  const err = pendingError;
  pendingError = null;
  return err;
});

ipcMain.handle("connect-to-server", async (_event, { host, port, useTLS }) => {
  if (!host || host.trim().length === 0) {
    return { success: false, error: "Host is required" };
  }
  if (port < 1 || port > 65535) {
    return { success: false, error: "Port must be between 1 and 65535" };
  }

  const protocol = useTLS ? "https" : "http";
  const url = `${protocol}://${host.trim()}:${port}`;

  // Probe the server before navigating so we never end up on a white screen.
  try {
    await probeServer(url);
  } catch {
    return {
      success: false,
      error:
        "Cannot reach the Skull Knight server at that address. " +
        "Make sure the server is running before connecting — " +
        "see the README for setup instructions.",
    };
  }

  saveConnection({ host: host.trim(), port, useTLS });
  serverBaseUrl = url;
  win.loadURL(url);

  return { success: true };
});

ipcMain.handle("go-back-to-connect", () => {
  serverBaseUrl = null;
  win.loadFile(path.join(__dirname, "connect", "index.html"));
});
