import { afterAll, describe, expect, test } from "bun:test";
import {
  saveBuild,
  getBuild,
  getBuildByTag,
  getAllBuilds,
  deleteBuild,
  type BuildRecord,
} from "./db";
import {
  canUserAccessClient,
  createUser,
  deleteUser,
  getUserByUsername,
  getUserClientAccessScope,
  listUserClientAccessRules,
  setUserClientAccessScope,
} from "./users";

const createdUserIds: number[] = [];
const createdBuildIds: string[] = [];

async function createTempUser(role: "viewer" | "operator" | "admin") {
  const username = `bt_${role.slice(0, 3)}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  const result = await createUser(username, "Aa1!VeryLongTestPassword_2026", role, "test");
  expect(result.success).toBe(true);
  const user = getUserByUsername(username);
  expect(user).not.toBeNull();
  createdUserIds.push(user!.id);
  return user!;
}

function cleanupCreatedUsers() {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    if (typeof id === "number") {
      deleteUser(id);
    }
  }
}

function cleanupCreatedBuilds() {
  while (createdBuildIds.length > 0) {
    const id = createdBuildIds.pop();
    if (typeof id === "string") {
      deleteBuild(id);
    }
  }
}

function saveTempBuild(overrides: Partial<BuildRecord> = {}): BuildRecord {
  const build: BuildRecord = {
    id: `test-build-${Date.now().toString(36)}${Math.floor(Math.random() * 10000).toString(36)}`,
    status: "completed",
    startTime: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    files: [{ name: "agent", filename: "agent.exe", platform: "windows/amd64", size: 1024 }],
    ...overrides,
  };
  saveBuild(build);
  createdBuildIds.push(build.id);
  return build;
}

afterAll(() => {
  cleanupCreatedBuilds();
  cleanupCreatedUsers();
});

describe("build tag DB operations", () => {
  test("saveBuild stores buildTag and builtByUserId", async () => {
    try {
      const operator = await createTempUser("operator");
      const build = saveTempBuild({
        buildTag: "test-tag-abc123",
        builtByUserId: operator.id,
      });

      const retrieved = getBuild(build.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.buildTag).toBe("test-tag-abc123");
      expect(retrieved!.builtByUserId).toBe(operator.id);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("getBuildByTag finds build by its tag", async () => {
    try {
      const operator = await createTempUser("operator");
      const tag = `tag-${Date.now().toString(36)}`;
      saveTempBuild({
        buildTag: tag,
        builtByUserId: operator.id,
      });

      const found = getBuildByTag(tag);
      expect(found).not.toBeNull();
      expect(found!.buildTag).toBe(tag);
      expect(found!.builtByUserId).toBe(operator.id);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("getBuildByTag returns null for unknown tag", () => {
    const found = getBuildByTag("nonexistent-tag-xyz");
    expect(found).toBeNull();
  });

  test("getAllBuilds includes buildTag and builtByUserId", async () => {
    try {
      const operator = await createTempUser("operator");
      const tag = `alltag-${Date.now().toString(36)}`;
      const build = saveTempBuild({
        buildTag: tag,
        builtByUserId: operator.id,
      });

      const all = getAllBuilds();
      const found = all.find((b) => b.id === build.id);
      expect(found).not.toBeNull();
      expect(found!.buildTag).toBe(tag);
      expect(found!.builtByUserId).toBe(operator.id);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("build without tag has undefined buildTag", () => {
    const build = saveTempBuild();
    const retrieved = getBuild(build.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.buildTag).toBeUndefined();
    expect(retrieved!.builtByUserId).toBeUndefined();
    cleanupCreatedBuilds();
  });
});

describe("build tag auto-allowlist logic", () => {
  test("operator with scope 'none' gets upgraded to 'allowlist' when build connects", async () => {
    try {
      const operator = await createTempUser("operator");
      expect(getUserClientAccessScope(operator.id)).toBe("none");

      const tag = `auto-${Date.now().toString(36)}`;
      saveTempBuild({
        buildTag: tag,
        builtByUserId: operator.id,
      });

      const build = getBuildByTag(tag);
      expect(build).not.toBeNull();
      expect(build!.builtByUserId).toBe(operator.id);

      // Simulate what handleBuildTagConnection does:
      // 1. Look up the build by tag
      // 2. If scope is "none", upgrade to "allowlist"
      // 3. Add client to allowlist
      const clientId = `test-client-${Date.now().toString(36)}`;
      const currentScope = getUserClientAccessScope(operator.id);
      if (currentScope === "none") {
        setUserClientAccessScope(operator.id, "allowlist");
      }
      const { setUserClientAccessRule } = await import("./users");
      setUserClientAccessRule(operator.id, clientId, "allow");

      expect(getUserClientAccessScope(operator.id)).toBe("allowlist");
      expect(canUserAccessClient(operator.id, operator.role, clientId)).toBe(true);
      // Other clients should NOT be accessible
      expect(canUserAccessClient(operator.id, operator.role, "other-client")).toBe(false);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("operator with existing allowlist gets new client added without scope change", async () => {
    try {
      const operator = await createTempUser("operator");
      setUserClientAccessScope(operator.id, "allowlist");

      const { setUserClientAccessRule } = await import("./users");
      setUserClientAccessRule(operator.id, "existing-client", "allow");

      // Now simulate build tag connection adding a new client
      const newClientId = `new-client-${Date.now().toString(36)}`;
      const currentScope = getUserClientAccessScope(operator.id);
      expect(currentScope).toBe("allowlist");

      setUserClientAccessRule(operator.id, newClientId, "allow");

      expect(canUserAccessClient(operator.id, operator.role, "existing-client")).toBe(true);
      expect(canUserAccessClient(operator.id, operator.role, newClientId)).toBe(true);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("viewer with denylist scope is unmodified on build tag connection", async () => {
    try {
      const viewer = await createTempUser("viewer");
      setUserClientAccessScope(viewer.id, "denylist");

      const { setUserClientAccessRule } = await import("./users");
      setUserClientAccessRule(viewer.id, "blocked-client", "deny");

      const clientId = `new-auto-${Date.now().toString(36)}`;
      const currentScope = getUserClientAccessScope(viewer.id);
      // With denylist, handleBuildTagConnection does nothing (client allowed by default)
      expect(currentScope).toBe("denylist");
      expect(canUserAccessClient(viewer.id, viewer.role, clientId)).toBe(true);
      expect(canUserAccessClient(viewer.id, viewer.role, "blocked-client")).toBe(false);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });

  test("admin does not get rules added (already has full access)", async () => {
    try {
      const admin = await createTempUser("admin");
      const tag = `admin-tag-${Date.now().toString(36)}`;
      saveTempBuild({
        buildTag: tag,
        builtByUserId: admin.id,
      });

      // handleBuildTagConnection returns early for admin
      expect(getUserClientAccessScope(admin.id)).toBe("all");
      const rules = listUserClientAccessRules(admin.id);
      expect(rules.length).toBe(0);
    } finally {
      cleanupCreatedBuilds();
      cleanupCreatedUsers();
    }
  });
});
