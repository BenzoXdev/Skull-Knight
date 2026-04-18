import { writeFileSync } from "fs";
import { resolve } from "path";

async function main() {
  const args = process.argv.slice(2);
  let prefix = "plugin-signing";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      prefix = args[i + 1];
      i++;
    }
  }

  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  const privRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privBase64 = Buffer.from(privRaw).toString("base64");

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubBase64 = Buffer.from(pubRaw).toString("base64");

  const fingerprintBuf = await crypto.subtle.digest("SHA-256", pubRaw);
  const fingerprint = Buffer.from(fingerprintBuf).toString("hex");

  const keyPath = resolve(prefix + ".key");
  const pubPath = resolve(prefix + ".pub");

  writeFileSync(keyPath, privBase64 + "\n", { mode: 0o600 });
  writeFileSync(
    pubPath,
    `${pubBase64}\n# fingerprint: ${fingerprint}\n`,
    { mode: 0o644 },
  );

  console.log(`Key pair generated:`);
  console.log(`  Private key: ${keyPath}`);
  console.log(`  Public key:  ${pubPath}`);
  console.log(`  Fingerprint: ${fingerprint}`);
  console.log(``);
  console.log(`Add this fingerprint to your server config to trust plugins signed with this key:`);
  console.log(`  "plugins": { "trustedKeys": ["${fingerprint}"] }`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
