#!/usr/bin/env bun


import { readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import AdmZip from "adm-zip";

async function computeContentDigest(zip: InstanceType<typeof AdmZip>): Promise<string> {
  const entries = zip.getEntries();
  const fileHashes: Array<{ name: string; hash: string }> = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (name === "signature.json") continue;

    const data = entry.getData();
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const hash = Buffer.from(hashBuf).toString("hex");
    fileHashes.push({ name, hash });
  }

  fileHashes.sort((a, b) => a.name.localeCompare(b.name));
  return fileHashes.map((f) => `${f.name}:${f.hash}\n`).join("");
}

async function main() {
  const args = process.argv.slice(2);
  let keyPath = "";
  let zipPath = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key" && args[i + 1]) {
      keyPath = args[i + 1];
      i++;
    } else if (!args[i].startsWith("-")) {
      zipPath = args[i];
    }
  }

  if (!keyPath || !zipPath) {
    console.error("Usage: bun run scripts/plugin-sign.ts --key <private.key> <plugin.zip>");
    process.exit(1);
  }

  keyPath = resolve(keyPath);
  zipPath = resolve(zipPath);

  const privBase64 = readFileSync(keyPath, "utf-8").trim();
  const privBytes = Buffer.from(privBase64, "base64");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privBytes,
    { name: "Ed25519" },
    true,
    ["sign"],
  );

  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const { d: _privMaterial, ...publicJwk } = jwk;
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { ...publicJwk, key_ops: ["verify"] },
    { name: "Ed25519" },
    true,
    ["verify"],
  );
  const pubRaw = await crypto.subtle.exportKey("raw", publicKey);
  const pubBase64 = Buffer.from(pubRaw).toString("base64");

  const fingerprintBuf = await crypto.subtle.digest("SHA-256", pubRaw);
  const fingerprint = Buffer.from(fingerprintBuf).toString("hex");

  const zip = new AdmZip(zipPath);
  const digest = await computeContentDigest(zip);

  if (!digest) {
    console.error("Error: ZIP contains no signable files");
    process.exit(1);
  }

  const digestBytes = new TextEncoder().encode(digest);
  const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, digestBytes);
  const sigBase64 = Buffer.from(sigBytes).toString("base64");

  const signatureJson = JSON.stringify(
    {
      algorithm: "ed25519",
      publicKey: pubBase64,
      signature: sigBase64,
    },
    null,
    2,
  );

  try {
    zip.deleteFile("signature.json");
  } catch {}

  zip.addFile("signature.json", Buffer.from(signatureJson, "utf-8"));
  zip.writeZip(zipPath);

  console.log(`Signed: ${basename(zipPath)}`);
  console.log(`  Signer fingerprint: ${fingerprint}`);
  console.log(`  Public key (base64): ${pubBase64}`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
