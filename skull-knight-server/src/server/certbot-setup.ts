import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export type CertbotSetupParams = {
  domain: string;
  email: string;
  livePath: string;
};

export type CertbotSetupResult = {
  certPath: string;
  keyPath: string;
  caPath: string;
  output: string;
};

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 12 * 60 * 1000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
    });
  });
}

function isValidDomain(domain: string): boolean {
  const value = domain.trim().toLowerCase();
  if (!value || value.length > 253) return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function runCertbotSetup(
  params: CertbotSetupParams,
): Promise<CertbotSetupResult> {
  const domain = params.domain.trim().toLowerCase();
  const email = params.email.trim();
  const livePath = params.livePath.trim() || "/etc/letsencrypt/live";

  if (!isValidDomain(domain)) {
    throw new Error("Invalid domain. Use a real FQDN like example.com");
  }

  if (!isValidEmail(email)) {
    throw new Error("Invalid email address");
  }

  const versionCheck = await runCommand("certbot", ["--version"], 30_000).catch(
    (error) => {
      throw new Error(
        `certbot is not available on this server. Install certbot first. Details: ${String(error?.message || error)}`,
      );
    },
  );

  if (versionCheck.exitCode !== 0) {
    throw new Error(`certbot --version failed: ${versionCheck.stderr || versionCheck.stdout}`);
  }

  const certbotArgs = [
    "certonly",
    "--non-interactive",
    "--agree-tos",
    "--standalone",
    "--preferred-challenges",
    "http",
    "--keep-until-expiring",
    "--email",
    email,
    "-d",
    domain,
  ];

  const certbotResult = await runCommand("certbot", certbotArgs);

  const output = `${certbotResult.stdout}\n${certbotResult.stderr}`.trim();
  if (certbotResult.exitCode !== 0) {
    throw new Error(
      `certbot failed (exit ${certbotResult.exitCode}). Ensure DNS points to this server and port 80 is reachable.\n${output}`,
    );
  }

  const certPath = path.join(livePath, domain, "fullchain.pem");
  const keyPath = path.join(livePath, domain, "privkey.pem");
  const caPath = path.join(livePath, domain, "chain.pem");

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(
      `certbot completed but expected files were not found. cert=${certPath} key=${keyPath}`,
    );
  }

  return {
    certPath,
    keyPath,
    caPath,
    output,
  };
}
