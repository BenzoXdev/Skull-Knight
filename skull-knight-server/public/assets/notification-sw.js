self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : "/notifications";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          try {
            const clientUrl = new URL(client.url);
            if (clientUrl.origin === self.location.origin) {
              client.navigate(targetUrl);
              return client.focus();
            }
          } catch {}
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Skull Knight", body: event.data.text() };
  }

  const title = String(data.title || "Skull Knight Notification");
  const options = {
    body: String(data.body || ""),
    icon: "/assets/skull-knight.png",
    badge: "/assets/skull-knight.png",
    tag: data.tag || `skull-knight-push-${Date.now()}`,
    data: { url: data.url || "/notifications" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "show_notification") return;

  const title = String(data.title || "Skull Knight Notification");
  const options = {
    body: String(data.body || ""),
    icon: data.icon || "/assets/skull-knight.png",
    badge: "/assets/skull-knight.png",
    tag: data.tag || `skull-knight-${Date.now()}`,
    data: { url: data.url || "/notifications" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
