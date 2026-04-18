declare module "web-push" {
  interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }
  interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  interface RequestOptions {
    TTL?: number;
  }
  function generateVAPIDKeys(): VapidKeys;
  function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  function sendNotification(subscription: PushSubscription, payload: string | Buffer | null, options?: RequestOptions): Promise<any>;
  export { generateVAPIDKeys, setVapidDetails, sendNotification };
}
