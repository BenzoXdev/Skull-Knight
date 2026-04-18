const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const pluginList = document.getElementById("plugin-list");
const refreshBtn = document.getElementById("refresh-btn");
const uploadStatus = document.getElementById("upload-status");

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) {
      window.location.href = "/";
      return;
    }

    const data = await res.json();
    const usernameDisplay = document.getElementById("username-display");
    const roleBadge = document.getElementById("role-badge");
    if (usernameDisplay) {
      usernameDisplay.textContent = data.username;
    }

    if (roleBadge) {
      const roleBadges = {
        admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
        operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
        viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
      };
      if (roleBadges[data.role]) {
        roleBadge.innerHTML = roleBadges[data.role];
      } else {
        roleBadge.textContent = data.role || "";
      }

      if (data.role === "admin") {
        roleBadge.classList.add(
          "bg-purple-900/50",
          "text-purple-300",
          "border",
          "border-purple-800",
        );
      } else if (data.role === "operator") {
        roleBadge.classList.add(
          "bg-blue-900/50",
          "text-blue-300",
          "border",
          "border-blue-800",
        );
      } else {
        roleBadge.classList.add(
          "bg-slate-700",
          "text-slate-300",
          "border",
          "border-slate-600",
        );
      }
    }

    if (data.role === "admin") {
      document.getElementById("build-link")?.classList.remove("hidden");
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("plugins-link")?.classList.remove("hidden");
      document.getElementById("deploy-link")?.classList.remove("hidden");
    } else if (data.role === "operator" || data.canBuild) {
      document.getElementById("build-link")?.classList.remove("hidden");
    }

    if (data.role !== "viewer") {
      document.getElementById("scripts-link")?.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    window.location.href = "/";
  }
}

function setStatus(text, isError = false) {
  uploadStatus.textContent = text;
  uploadStatus.className = `mt-3 text-sm ${isError ? "text-red-400" : "text-slate-400"}`;
}

async function fetchPlugins() {
  const res = await fetch("/api/plugins");
  if (!res.ok) {
    setStatus("Failed to load plugins", true);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data.plugins) ? data.plugins : [];
}

function getTrustBadge(sig) {
  if (!sig) return { icon: "fa-shield-halved", color: "text-orange-400 border-orange-600 bg-orange-900/30", label: "Unsigned", tooltip: "This plugin is not signed" };
  if (sig.signed && !sig.valid) return { icon: "fa-shield-xmark", color: "text-red-400 border-red-600 bg-red-900/30", label: "Invalid", tooltip: "Signature verification failed — plugin may be tampered" };
  if (sig.signed && sig.valid && sig.trusted) return { icon: "fa-shield-check", color: "text-emerald-400 border-emerald-600 bg-emerald-900/30", label: "Trusted", tooltip: `Signed by trusted key: ${sig.fingerprint || "unknown"}` };
  if (sig.signed && sig.valid && !sig.trusted) return { icon: "fa-shield", color: "text-yellow-400 border-yellow-600 bg-yellow-900/30", label: "Untrusted", tooltip: `Signed but key not trusted: ${sig.fingerprint || "unknown"}` };
  return { icon: "fa-shield-halved", color: "text-orange-400 border-orange-600 bg-orange-900/30", label: "Unsigned", tooltip: "This plugin is not signed" };
}

function renderPlugins(plugins) {
  pluginList.innerHTML = "";
  if (!plugins.length) {
    pluginList.innerHTML =
      '<div class="text-slate-400">No plugins installed.</div>';
    return;
  }
  for (const plugin of plugins) {
    const card = document.createElement("div");
    card.className =
      "rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 flex items-center justify-between";
    const meta = document.createElement("div");
    const titleRow = document.createElement("div");
    titleRow.className = "flex items-center gap-2";
    const title = document.createElement("span");
    title.className = "font-semibold";
    title.textContent = plugin.name || plugin.id;
    titleRow.appendChild(title);

    // Trust badge
    const badge = getTrustBadge(plugin.signature);
    const trustBadge = document.createElement("span");
    trustBadge.className = `inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${badge.color}`;
    trustBadge.innerHTML = `<i class="fa-solid ${badge.icon}"></i> ${badge.label}`;
    trustBadge.title = badge.tooltip;
    titleRow.appendChild(trustBadge);

    const subtitle = document.createElement("div");
    subtitle.className = "text-sm text-slate-400";
    subtitle.textContent = `${plugin.id}${plugin.version ? ` • v${plugin.version}` : ""}`;

    if (plugin.signature?.fingerprint) {
      const fpSpan = document.createElement("span");
      fpSpan.className = "ml-2 text-xs text-slate-500 font-mono";
      fpSpan.textContent = `${plugin.signature.fingerprint.slice(0, 16)}…`;
      fpSpan.title = `Signer fingerprint: ${plugin.signature.fingerprint}`;
      subtitle.appendChild(fpSpan);
    }

    meta.appendChild(titleRow);
    meta.appendChild(subtitle);
    const actions = document.createElement("div");
    actions.className = "flex items-center gap-2";

    const toggle = document.createElement("button");
    toggle.className =
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg border" +
      (plugin.enabled
        ? " border-emerald-600 text-emerald-200 bg-emerald-900/40"
        : " border-slate-600 text-slate-300 bg-slate-800/60");
    toggle.innerHTML = plugin.enabled
      ? '<i class="fa-solid fa-toggle-on"></i> Enabled'
      : '<i class="fa-solid fa-toggle-off"></i> Disabled';
    toggle.addEventListener("click", async () => {
      const wantEnabled = !plugin.enabled;
      try {
        const res = await fetch(`/api/plugins/${plugin.id}/enable`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: wantEnabled }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.error === "confirmation_required") {
            showPluginEnableConfirmModal(plugin, data.signature);
            return;
          }
          setStatus(`Enable failed: ${data?.error || res.statusText}`, true);
          return;
        }
        await refresh();
      } catch (err) {
        setStatus("Enable failed", true);
      }
    });

    const autoLoadBtn = document.createElement("button");
    const autoLoadDisabled = !plugin.enabled;
    autoLoadBtn.className =
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg border" +
      (autoLoadDisabled
        ? " border-slate-700 text-slate-500 bg-slate-900/40 cursor-not-allowed opacity-50"
        : plugin.autoLoad
          ? " border-amber-600 text-amber-200 bg-amber-900/40"
          : " border-slate-600 text-slate-300 bg-slate-800/60");
    autoLoadBtn.innerHTML = plugin.autoLoad
      ? '<i class="fa-solid fa-bolt"></i> Auto-load'
      : '<i class="fa-solid fa-bolt-lightning"></i> Auto-load off';
    autoLoadBtn.title = autoLoadDisabled
      ? "Plugin must be enabled before auto-load can be turned on"
      : plugin.autoLoad
        ? "Plugin will auto-load on all new client connections. Click to disable."
        : "Click to auto-load this plugin on all new client connections.";
    if (autoLoadDisabled) {
      autoLoadBtn.disabled = true;
    } else {
      autoLoadBtn.addEventListener("click", async () => {
        const res = await fetch(`/api/plugins/${plugin.id}/autoload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autoLoad: !plugin.autoLoad,
            autoStartEvents: plugin.autoStartEvents || [],
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          setStatus(`Auto-load toggle failed: ${text}`, true);
          return;
        }
        await refresh();
      });
    }

    const removeBtn = document.createElement("button");
    removeBtn.className =
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/60 hover:bg-red-800/60 text-red-100";
    removeBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Remove';
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remove plugin ${plugin.name || plugin.id}?`)) return;
      const res = await fetch(`/api/plugins/${plugin.id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Remove failed: ${text}`, true);
        return;
      }
      setStatus("Plugin removed.");
      await refresh();
    });
    actions.appendChild(toggle);
    actions.appendChild(autoLoadBtn);
    actions.appendChild(removeBtn);
    card.appendChild(meta);
    card.appendChild(actions);

    if (plugin.lastError) {
      const errorRow = document.createElement("div");
      errorRow.className = "mt-2 text-xs text-red-300";
      errorRow.textContent = `Last error: ${plugin.lastError}`;
      card.appendChild(errorRow);
    }
    pluginList.appendChild(card);
  }
}

function showPluginEnableConfirmModal(plugin, sigInfo) {
  document.getElementById("plugin-enable-confirm-modal")?.remove();

  const sig = sigInfo || {};
  let statusText = "This plugin is unsigned.";
  let statusColor = "text-orange-400";
  if (sig.signed && sig.valid && !sig.trusted) {
    statusText = "This plugin is signed but the signing key is not trusted.";
    statusColor = "text-yellow-400";
  } else if (sig.signed && !sig.valid) {
    statusText = "This plugin has an invalid signature and may have been tampered with.";
    statusColor = "text-red-400";
  }

  const overlay = document.createElement("div");
  overlay.id = "plugin-enable-confirm-modal";
  overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm";
  overlay.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
      <div class="flex items-center gap-3 mb-4">
        <i class="fa-solid fa-triangle-exclamation text-2xl ${statusColor}"></i>
        <h3 class="text-lg font-semibold text-slate-100">Enable Unverified Plugin</h3>
      </div>
      <p class="text-sm text-slate-300 mb-2">${statusText}</p>
      <p class="text-sm text-slate-400 mb-1">Plugin: <strong class="text-slate-200">${plugin.name || plugin.id}</strong></p>
      ${sig.fingerprint ? `<p class="text-xs text-slate-500 font-mono mb-3">Signer: ${sig.fingerprint}</p>` : '<p class="text-xs text-slate-500 mb-3">No signature present.</p>'}
      <p class="text-sm text-slate-400" style="margin-bottom: 16px;">Type <strong class="text-emerald-300">confirm</strong> below to enable this plugin:</p>
      <input type="text" id="plugin-enable-confirm-input" class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm focus:outline-none focus:border-emerald-500" style="margin-bottom: 16px;" placeholder="Type confirm" autocomplete="off" spellcheck="false" />
      <div class="flex justify-end gap-2">
        <button id="plugin-enable-confirm-cancel" class="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700">Cancel</button>
        <button id="plugin-enable-confirm-ok" disabled class="px-4 py-2 rounded-lg bg-emerald-900/40 border border-emerald-700/60 text-emerald-100 opacity-50 cursor-not-allowed">Enable Anyway</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = document.getElementById("plugin-enable-confirm-input");
  const okBtn = document.getElementById("plugin-enable-confirm-ok");
  const cancelBtn = document.getElementById("plugin-enable-confirm-cancel");

  input.addEventListener("input", () => {
    const match = input.value.trim().toLowerCase() === "confirm";
    okBtn.disabled = !match;
    okBtn.classList.toggle("opacity-50", !match);
    okBtn.classList.toggle("cursor-not-allowed", !match);
    okBtn.classList.toggle("hover:bg-emerald-800/60", match);
  });

  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  okBtn.addEventListener("click", async () => {
    okBtn.disabled = true;
    okBtn.textContent = "Enabling...";
    try {
      const res = await fetch(`/api/plugins/${plugin.id}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, confirmed: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Enable failed: ${text}`, true);
      }
    } catch {
      setStatus("Enable failed", true);
    }
    overlay.remove();
    await refresh();
  });

  input.focus();
}

async function refresh() {
  const plugins = await fetchPlugins();
  renderPlugins(plugins);
}

async function uploadFile(file) {
  if (!file) return;
  setStatus(`Uploading ${file.name}...`);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/plugins/upload", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    setStatus(`Upload failed: ${text}`, true);
    return;
  }
  setStatus("Upload complete.");
  await refresh();
}

if (dropzone) {
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("border-emerald-500", "text-emerald-300");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("border-emerald-500", "text-emerald-300");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("border-emerald-500", "text-emerald-300");
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });
}

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) uploadFile(file);
});

refreshBtn?.addEventListener("click", refresh);

const trustedKeysSection = document.getElementById("trusted-keys-section");
const trustedKeysList = document.getElementById("trusted-keys-list");
const addKeyBtn = document.getElementById("add-trusted-key-btn");
const newKeyInput = document.getElementById("new-trusted-key-input");

let _builtinKeys = [];

async function fetchTrustedKeys() {
  try {
    const res = await fetch("/api/plugins/trusted-keys");
    if (!res.ok) {
      if (res.status === 403) {
        if (trustedKeysSection) trustedKeysSection.classList.add("hidden");
        return [];
      }
      return [];
    }
    const data = await res.json();
    if (trustedKeysSection) trustedKeysSection.classList.remove("hidden");
    _builtinKeys = Array.isArray(data.builtinKeys) ? data.builtinKeys : [];
    return Array.isArray(data.trustedKeys) ? data.trustedKeys : [];
  } catch {
    return [];
  }
}

function renderTrustedKeys(keys) {
  if (!trustedKeysList) return;
  trustedKeysList.innerHTML = "";
  if (!keys.length) {
    trustedKeysList.innerHTML = '<div class="text-slate-500 text-sm">No trusted keys configured. All plugins will require confirmation to load.</div>';
    return;
  }
  for (const key of keys) {
    const isBuiltin = _builtinKeys.includes(key);
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/50";
    const fp = document.createElement("span");
    fp.className = "font-mono text-sm text-slate-300 flex-1 truncate";
    fp.textContent = key;
    fp.title = key;
    row.appendChild(fp);
    if (isBuiltin) {
      const badge = document.createElement("span");
      badge.className = "text-xs text-emerald-400 px-2 py-0.5 rounded bg-emerald-900/30 whitespace-nowrap";
      badge.textContent = "built-in";
      badge.title = "This key is hardcoded and always trusted";
      row.appendChild(badge);
    } else {
      const removeBtn = document.createElement("button");
      removeBtn.className = "text-red-400 hover:text-red-300 text-sm px-2 py-1";
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.title = "Remove trusted key";
      removeBtn.addEventListener("click", async () => {
        const res = await fetch(`/api/plugins/trusted-keys/${key}`, { method: "DELETE" });
        if (res.ok) {
          await refreshTrustedKeys();
          await refresh();
        }
      });
      row.appendChild(removeBtn);
    }
    trustedKeysList.appendChild(row);
  }
}

async function refreshTrustedKeys() {
  const keys = await fetchTrustedKeys();
  renderTrustedKeys(keys);
}

addKeyBtn?.addEventListener("click", async () => {
  const fp = newKeyInput?.value?.trim().toLowerCase();
  if (!fp || !/^[a-f0-9]{64}$/.test(fp)) {
    setStatus("Invalid fingerprint — must be a 64-character hex string (SHA-256)", true);
    return;
  }
  const res = await fetch("/api/plugins/trusted-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint: fp }),
  });
  if (res.ok) {
    if (newKeyInput) newKeyInput.value = "";
    setStatus("Trusted key added.");
    await refreshTrustedKeys();
    await refresh();
  } else {
    const data = await res.json().catch(() => ({}));
    setStatus(`Failed to add key: ${data.error || "unknown error"}`, true);
  }
});

checkAuth();
refresh();
refreshTrustedKeys();
