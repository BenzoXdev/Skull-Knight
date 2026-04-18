import webpush from "web-push";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { ensureDataDir } from "../paths";
import { logger } from "../logger";

let vapidKeys: { publicKey: string; privateKey: string } | null = null;

function getVapidPath(): string {
  return resolve(ensureDataDir(), "vapid-keys.json");
}

export function loadOrGenerateVapidKeys(): { publicKey: string; privateKey: string } {
  if (vapidKeys) return vapidKeys;

  const vapidPath = getVapidPath();

  if (existsSync(vapidPath)) {
    try {
      const raw = readFileSync(vapidPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        vapidKeys = { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
        logger.info("[web-push] loaded VAPID keys from " + vapidPath);
        return vapidKeys;
      }
    } catch (err) {
      logger.warn("[web-push] failed to read vapid-keys.json, regenerating", err);
    }
  }

  const generated = webpush.generateVAPIDKeys();
  vapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey };

  try {
    writeFileSync(vapidPath, JSON.stringify(vapidKeys, null, 2));
    logger.info("[web-push] generated and saved VAPID keys to " + vapidPath);
  } catch (err) {
    logger.warn("[web-push] failed to persist VAPID keys", err);
  }

  return vapidKeys;
}

export function getVapidPublicKey(): string {
  return loadOrGenerateVapidKeys().publicKey;
}

export async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<{ success: boolean; gone?: boolean; error?: string }> {
  const keys = loadOrGenerateVapidKeys();
  webpush.setVapidDetails("mailto:Skull Knight@localhost", keys.publicKey, keys.privateKey);

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
    return { success: true };
  } catch (err: any) {
    const statusCode = err?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { success: false, gone: true, error: `subscription gone (${statusCode})` };
    }
    return { success: false, error: err?.message || String(err) };
  }
}
