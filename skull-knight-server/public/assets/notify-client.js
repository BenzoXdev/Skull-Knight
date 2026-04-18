import { decodeMsgpack } from "./msgpack-helpers.js";

const STORAGE_KEY = "SKULL_KNIGHT_notifications_enabled";
const UNREAD_KEY = "SKULL_KNIGHT_notifications_unread";
const DESKTOP_NOTIF_KEY = "SKULL_KNIGHT_desktop_notifications_enabled";
const PUSH_SUBSCRIBED_KEY = "SKULL_KNIGHT_push_subscribed";
const CLIENT_EVENT_KEYS = {
  client_online: "SKULL_KNIGHT_desktop_notify_client_online",
  client_offline: "SKULL_KNIGHT_desktop_notify_client_offline",
  client_purgatory: "SKULL_KNIGHT_desktop_notify_client_purgatory",
};

let enabled = localStorage.getItem(STORAGE_KEY);
if (enabled === null) {
  enabled = "1";
  localStorage.setItem(STORAGE_KEY, enabled);
}
if (localStorage.getItem(UNREAD_KEY) === null) {
  localStorage.setItem(UNREAD_KEY, "0");
}

if (
  localStorage.getItem(DESKTOP_NOTIF_KEY) === null &&
  typeof Notification !== "undefined" &&
  Notification.permission === "granted"
) {
  localStorage.setItem(DESKTOP_NOTIF_KEY, "1");
}
let ws = null;
let started = false;
let swRegistration = null;
let readyHandlers = new Set();
let notificationHandlers = new Set();
let statusHandlers = new Set();
let unreadHandlers = new Set();
let clientEventHandlers = new Set();
let lastHistory = [];

function emitStatus(status) {
  for (const handler of statusHandlers) {
    try {
      handler(status);
    } catch {}
  }
}

function emitReady(history) {
  lastHistory = Array.isArray(history) ? history : [];
  for (const handler of readyHandlers) {
    try {
      handler(lastHistory);
    } catch {}
  }
}

function emitNotification(item) {
  for (const handler of notificationHandlers) {
    try {
      handler(item);
    } catch {}
  }
}

function emitClientEvent(item) {
  for (const handler of clientEventHandlers) {
    try {
      handler(item);
    } catch {}
  }
}

function shouldNotify() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getUnreadCount() {
  return Number(localStorage.getItem(UNREAD_KEY) || "0");
}

function setUnreadCount(value) {
  const next = Math.max(0, Number(value) || 0);
  localStorage.setItem(UNREAD_KEY, String(next));
  for (const handler of unreadHandlers) {
    try {
      handler(next);
    } catch {}
  }
}

function incrementUnread() {
  setUnreadCount(getUnreadCount() + 1);
}

export function getDesktopNotificationsEnabled() {
  const stored = localStorage.getItem(DESKTOP_NOTIF_KEY);
  if (stored === null) {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  }
  return stored === "1";
}

export function setDesktopNotificationsEnabled(value) {
  localStorage.setItem(DESKTOP_NOTIF_KEY, value ? "1" : "0");
  if (value) {
    subscribeToPush();
  } else {
    unsubscribeFromPush();
  }
}

export function getClientEventNotificationEnabled(eventType) {
  const key = CLIENT_EVENT_KEYS[eventType];
  if (!key) return false;
  const stored = localStorage.getItem(key);
  return stored === null ? true : stored === "1";
}

export function setClientEventNotificationEnabled(eventType, value) {
  const key = CLIENT_EVENT_KEYS[eventType];
  if (!key) return;
  localStorage.setItem(key, value ? "1" : "0");
}

export async function requestDesktopNotificationPermission() {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getSwRegistration() {
  if (swRegistration) return swRegistration;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    swRegistration = await navigator.serviceWorker.ready;
    return swRegistration;
  } catch {
    return null;
  }
}

async function subscribeToPush() {
  try {
    const reg = await getSwRegistration();
    if (!reg || !reg.pushManager) return;

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      if (localStorage.getItem(PUSH_SUBSCRIBED_KEY) === "1") return;
      await sendSubscriptionToServer(existing);
      return;
    }

    const res = await fetch("/api/notifications/vapid-public-key");
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (!publicKey) return;

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await sendSubscriptionToServer(subscription);
  } catch (err) {
    console.warn("[notifications] push subscribe failed", err);
  }
}

async function sendSubscriptionToServer(subscription) {
  try {
    const res = await fetch("/api/notifications/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (res.ok) {
      localStorage.setItem(PUSH_SUBSCRIBED_KEY, "1");
    }
  } catch (err) {
    console.warn("[notifications] failed to send push subscription to server", err);
  }
}

async function unsubscribeFromPush() {
  try {
    const reg = await getSwRegistration();
    if (!reg || !reg.pushManager) return;

    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;

    await fetch("/api/notifications/push-subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});

    await subscription.unsubscribe().catch(() => {});
    localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
  } catch (err) {
    console.warn("[notifications] push unsubscribe failed", err);
  }
}

async function fireNotification(title, body, tag, clickUrl) {
  const reg = await getSwRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, {
        body,
        icon: "/assets/skull-knight.png",
        tag,
        data: { url: clickUrl || "/notifications" },
        requireInteraction: false,
      });
      return;
    } catch {}
  }
  fireNotificationFallback(title, body, tag, clickUrl);
}

function fireNotificationFallback(title, body, tag, clickUrl) {
  try {
    const n = new Notification(title, {
      body,
      icon: "/assets/skull-knight.png",
      tag,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      if (clickUrl && window.location.pathname !== clickUrl) {
        window.location.href = clickUrl;
      }
    };
  } catch (err) {
    console.warn("[notifications] desktop notification failed", err);
  }
}

function showDesktopNotification(item) {
  if (!getDesktopNotificationsEnabled()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = item.keyword
    ? `Skull Knight \u2014 ${item.keyword}`
    : "Skull Knight \u2014 Notification";
  const lines = [item.title];
  if (item.user) lines.push(`User: ${item.user}`);
  if (item.host) lines.push(`Host: ${item.host}`);
  if (item.process) lines.push(`Process: ${item.process}`);
  const body = lines.filter(Boolean).join("\n");

  fireNotification(title, body, `skull-knight-${item.id || Date.now()}`, "/notifications");
}

const CLIENT_EVENT_LABELS = {
  client_online: "\u{1F7E2} Client Online",
  client_offline: "\u{1F534} Client Offline",
  client_purgatory: "\u{1F7E1} Client Awaiting Approval",
};

function showClientEventDesktopNotification(item) {
  if (!getDesktopNotificationsEnabled()) return;
  if (!getClientEventNotificationEnabled(item.event)) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = CLIENT_EVENT_LABELS[item.event] || "Skull Knight \u2014 Client Event";
  const lines = [];
  if (item.host) lines.push(`Host: ${item.host}`);
  if (item.user) lines.push(`User: ${item.user}`);
  if (item.os) lines.push(`OS: ${item.os}`);
  if (item.clientId) lines.push(`ID: ${item.clientId}`);
  const body = lines.join("\n") || item.clientId || "";
  const dest = item.event === "client_purgatory" ? "/purgatory" : "/";

  fireNotification(
    title,
    body,
    `skull-knight-client-${item.event}-${item.clientId || Date.now()}`,
    dest,
  );
}

function handleMessage(payload) {
  if (!payload || typeof payload.type !== "string") return;
  if (payload.type === "ready") {
    emitReady(payload.history || []);
    return;
  }
  if (payload.type === "notification" && payload.item) {
    console.log("[notifications] received", payload.item);
    emitNotification(payload.item);
    if (shouldNotify()) {
      incrementUnread();
    }
    showDesktopNotification(payload.item);
  }
  if (payload.type === "client_event" && payload.event) {
    console.log("[notifications] client event", payload.event, payload.clientId);
    emitClientEvent(payload);
    showClientEventDesktopNotification(payload);
  }
}

let msgpackLoadPromise = null;
function ensureMsgpackrLoaded() {
  const globalObj = typeof globalThis !== "undefined" ? globalThis : window;
  if (globalObj.msgpackr) {
    return Promise.resolve();
  }
  if (msgpackLoadPromise) return msgpackLoadPromise;
  msgpackLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/msgpackr@1.11.8/dist/index.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
  return msgpackLoadPromise;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/notifications/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[notifications] ws open", wsUrl);
    emitStatus("connected");
  };

  ws.onmessage = (event) => {
    console.log("[notifications] ws message", event.data);
    if (typeof event.data === "string") {
      let parsed = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        parsed = decodeMsgpack(event.data);
      }
      if (parsed) handleMessage(parsed);
      return;
    }

    if (event.data instanceof Blob) {
      event.data
        .arrayBuffer()
        .then((buf) => {
          const parsed = decodeMsgpack(buf);
          if (parsed) handleMessage(parsed);
        })
        .catch(() => {});
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      const parsed = decodeMsgpack(event.data);
      if (parsed) handleMessage(parsed);
    }
  };

  ws.onerror = () => {
    console.warn("[notifications] ws error");
    emitStatus("error");
  };

  ws.onclose = () => {
    console.warn("[notifications] ws closed");
    emitStatus("disconnected");
    setTimeout(connect, 3000);
  };
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    const res = await fetch("/assets/notification-sw.js");
    if (!res.ok) return null;
    const reg = await navigator.serviceWorker.register("/assets/notification-sw.js", { scope: "/" });
    swRegistration = reg;
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function startNotificationClient() {
  if (started) return;
  started = true;
  console.log("[notifications] start client");
  try {
    await ensureMsgpackrLoaded();
  } catch (err) {
    console.warn("[notifications] failed to load msgpackr", err);
  }

  await registerServiceWorker();

  if (getDesktopNotificationsEnabled()) {
    const perm = await requestDesktopNotificationPermission();
    if (perm !== "granted") {
      setDesktopNotificationsEnabled(false);
    } else {
      subscribeToPush();
    }
  }

  connect();
}

export function subscribeNotifications(handler) {
  notificationHandlers.add(handler);
  return () => notificationHandlers.delete(handler);
}

export function subscribeClientEvents(handler) {
  clientEventHandlers.add(handler);
  return () => clientEventHandlers.delete(handler);
}

export function subscribeUnread(handler) {
  unreadHandlers.add(handler);
  try {
    handler(getUnreadCount());
  } catch {}
  return () => unreadHandlers.delete(handler);
}

export function subscribeReady(handler) {
  readyHandlers.add(handler);
  if (lastHistory.length) {
    try {
      handler(lastHistory);
    } catch {}
  }
  return () => readyHandlers.delete(handler);
}

export function subscribeStatus(handler) {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

export function setNotificationsEnabled(value) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
}

export function getNotificationsEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function markAllNotificationsRead() {
  setUnreadCount(0);
}
