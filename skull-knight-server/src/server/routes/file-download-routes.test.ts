import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateToken } from "../../auth";
import * as clientManager from "../../clientManager";
import { createUser, deleteUser, getUserById } from "../../users";
import { handleFileDownloadRoutes } from "./file-download-routes";

const PASSWORD = "Aa1!RouteUploadTestPass123";

function makeRouteDeps(dataDir: string) {
  return {
    DATA_DIR: dataDir,
    secureHeaders: (_contentType?: string) => ({}),
    sanitizeOutputName: (name: string) => {
      const cleaned = (name || "").replace(/[^A-Za-z0-9._-]/g, "");
      if (!cleaned) throw new Error("invalid filename");
      return cleaned;
    },
    pendingHttpDownloads: new Map<string, any>(),
    downloadIntents: new Map<string, any>(),
  };
}

const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

async function createAdminToken() {
  const username = `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = await createUser(username, PASSWORD, "admin", "test");
  expect(created.success).toBe(true);
  expect(typeof created.userId).toBe("number");

  const user = getUserById(created.userId!);
  expect(user).not.toBeNull();

  const token = await generateToken(user!);
  return {
    userId: created.userId!,
    token,
  };
}

async function createTempDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skull-knight-upload-route-test-"));
}

async function removeTempDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

describe("file upload route flow", () => {
  test("stages and serves one-time upload payload for matching client", async () => {
    const auth = await createAdminToken();
    const clientId = `client-${Date.now().toString(36)}`;
    const dataDir = await createTempDataDir();

    const deps = makeRouteDeps(dataDir);
    const payload = new Uint8Array(3 * 1024 * 1024 + 123);
    crypto.getRandomValues(payload.subarray(0, Math.min(payload.length, 65536)));

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      ws: { send: () => {} },
    });

    const prevDisableAgentAuth = process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH;
    process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH = "true";

    try {
      const requestUrl = new URL("https://localhost/api/file/upload/request");
      const requestRes = await handleFileDownloadRoutes(
        new Request(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            clientId,
            path: "C:\\Games\\big.iso",
            fileName: "big.iso",
          }),
        }),
        requestUrl,
        mockServer,
        deps,
      );

      expect(requestRes).not.toBeNull();
      expect(requestRes!.status).toBe(200);
      const requestJson = await requestRes!.json() as any;
      expect(requestJson.ok).toBe(true);
      expect(typeof requestJson.uploadUrl).toBe("string");

      const stageUrl = new URL(`https://localhost${requestJson.uploadUrl}`);
      const stageRes = await handleFileDownloadRoutes(
        new Request(stageUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Bearer ${auth.token}`,
          },
          body: payload,
        }),
        stageUrl,
        mockServer,
        deps,
      );

      expect(stageRes).not.toBeNull();
      expect(stageRes!.status).toBe(200);
      const stageJson = await stageRes!.json() as any;
      expect(stageJson.ok).toBe(true);
      expect(stageJson.size).toBe(payload.length);
      expect(typeof stageJson.pullUrl).toBe("string");

      const pullUrl = new URL(stageJson.pullUrl);
      const pullRes = await handleFileDownloadRoutes(
        new Request(pullUrl, {
          method: "GET",
          headers: {
            "x-skull-knight-client-id": clientId,
          },
        }),
        pullUrl,
        mockServer,
        deps,
      );

      expect(pullRes).not.toBeNull();
      expect(pullRes!.status).toBe(200);
      const pulled = new Uint8Array(await pullRes!.arrayBuffer());
      expect(pulled.length).toBe(payload.length);
      expect(pulled[0]).toBe(payload[0]);
      expect(pulled[pulled.length - 1]).toBe(payload[payload.length - 1]);

      const uploadDir = join(dataDir, "uploads");
      const uploadEntries = await readdir(uploadDir).catch(() => [] as string[]);
      expect(uploadEntries.filter((name) => name.endsWith(".bin")).length).toBe(0);

      const pullAgainRes = await handleFileDownloadRoutes(
        new Request(pullUrl, {
          method: "GET",
          headers: {
            "x-skull-knight-client-id": clientId,
          },
        }),
        pullUrl,
        mockServer,
        deps,
      );
      expect(pullAgainRes).not.toBeNull();
      expect(pullAgainRes!.status).toBe(404);
    } finally {
      if (prevDisableAgentAuth === undefined) {
        delete process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH;
      } else {
        process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH = prevDisableAgentAuth;
      }
      clientManager.deleteClient(clientId);
      const deleted = deleteUser(auth.userId);
      expect(deleted.success).toBe(true);
      await removeTempDataDir(dataDir);
    }
  });

  test("rejects pull when client id does not match", async () => {
    const auth = await createAdminToken();
    const clientId = `client-${Date.now().toString(36)}`;
    const dataDir = await createTempDataDir();
    const deps = makeRouteDeps(dataDir);
    const payload = new TextEncoder().encode("hello");

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      ws: { send: () => {} },
    });

    const prevDisableAgentAuth = process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH;
    process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH = "true";

    try {
      const requestUrl = new URL("https://localhost/api/file/upload/request");
      const requestRes = await handleFileDownloadRoutes(
        new Request(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            clientId,
            path: "C:\\Games\\small.bin",
            fileName: "small.bin",
          }),
        }),
        requestUrl,
        mockServer,
        deps,
      );
      const requestJson = await requestRes!.json() as any;

      const stageUrl = new URL(`https://localhost${requestJson.uploadUrl}`);
      const stageRes = await handleFileDownloadRoutes(
        new Request(stageUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${auth.token}`,
          },
          body: payload,
        }),
        stageUrl,
        mockServer,
        deps,
      );
      const stageJson = await stageRes!.json() as any;

      const pullUrl = new URL(stageJson.pullUrl);
      const badPullRes = await handleFileDownloadRoutes(
        new Request(pullUrl, {
          method: "GET",
          headers: {
            "x-skull-knight-client-id": "different-client",
          },
        }),
        pullUrl,
        mockServer,
        deps,
      );

      expect(badPullRes).not.toBeNull();
      expect(badPullRes!.status).toBe(403);
    } finally {
      if (prevDisableAgentAuth === undefined) {
        delete process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH;
      } else {
        process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH = prevDisableAgentAuth;
      }
      clientManager.deleteClient(clientId);
      deleteUser(auth.userId);
      await removeTempDataDir(dataDir);
    }
  });
});
