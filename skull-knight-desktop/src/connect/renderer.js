const form = document.getElementById("connect-form");
const hostInput = document.getElementById("host");
const portInput = document.getElementById("port");
const tlsCheckbox = document.getElementById("use-tls");
const connectBtn = document.getElementById("connect-btn");
const statusEl = document.getElementById("status");

function setStatus(msg, type = "info") {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = msg;
}

// Load saved connection on startup and surface any pending error from a
// previous session (e.g. the server dropped mid-session and we bounced back).
(async () => {
  try {
    const saved = await window.Skull Knight.getSavedConnection();
    if (saved) {
      hostInput.value = saved.host;
      portInput.value = String(saved.port);
      tlsCheckbox.checked = saved.useTLS;
    }
  } catch {
    // first run, no saved data
  }

  try {
    const err = await window.Skull Knight.getPendingError();
    if (err) setStatus(err, "error");
  } catch {
    // ignore
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const host = hostInput.value.trim();
  const port = parseInt(portInput.value, 10);
  const useTLS = tlsCheckbox.checked;

  if (!host) {
    setStatus("Please enter a host address.", "error");
    return;
  }
  if (isNaN(port) || port < 1 || port > 65535) {
    setStatus("Port must be between 1 and 65535.", "error");
    return;
  }

  connectBtn.disabled = true;
  connectBtn.querySelector(".btn-text").textContent = "Connecting…";
  setStatus('<span class="spinner"></span> Connecting…', "info");

  try {
    const result = await window.Skull Knight.connectToServer({ host, port, useTLS });

    if (result.success) {
      setStatus("Connected! Loading Skull Knight…", "ok");
    } else {
      setStatus(result.error || "Connection failed.", "error");
      connectBtn.disabled = false;
      connectBtn.querySelector(".btn-text").textContent = "Connect";
    }
  } catch (err) {
    setStatus(err?.message || "Connection failed.", "error");
    connectBtn.disabled = false;
    connectBtn.querySelector(".btn-text").textContent = "Connect";
  }
});
