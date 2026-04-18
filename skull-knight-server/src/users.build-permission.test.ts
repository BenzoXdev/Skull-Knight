import { describe, expect, test } from "bun:test";
import {
  canBuildClients,
  createUser,
  deleteUser,
  getUserByUsername,
  hasPermission,
  setUserCanBuild,
} from "./users";

const createdUserIds: number[] = [];

async function createTempUser(role: "viewer" | "operator" | "admin") {
  const username = `bp_${role.slice(0, 3)}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
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

describe("build permission (can_build)", () => {
  test("admin always has build permission regardless of can_build flag", async () => {
    try {
      const admin = await createTempUser("admin");
      expect(canBuildClients(admin.id, admin.role)).toBe(true);

      setUserCanBuild(admin.id, false);
      // Admin role always returns true
      expect(canBuildClients(admin.id, "admin")).toBe(true);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("operator defaults to can_build = 1", async () => {
    try {
      const operator = await createTempUser("operator");
      expect(canBuildClients(operator.id, operator.role)).toBe(true);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("viewer defaults to can_build = 0", async () => {
    try {
      const viewer = await createTempUser("viewer");
      expect(canBuildClients(viewer.id, viewer.role)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("revoking build permission denies building for non-admin", async () => {
    try {
      const operator = await createTempUser("operator");
      expect(canBuildClients(operator.id, operator.role)).toBe(true);

      const result = setUserCanBuild(operator.id, false);
      expect(result.success).toBe(true);

      expect(canBuildClients(operator.id, operator.role)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("granting build permission re-enables building", async () => {
    try {
      const viewer = await createTempUser("viewer");

      expect(canBuildClients(viewer.id, viewer.role)).toBe(false);

      setUserCanBuild(viewer.id, true);
      expect(canBuildClients(viewer.id, viewer.role)).toBe(true);

      setUserCanBuild(viewer.id, false);
      expect(canBuildClients(viewer.id, viewer.role)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("hasPermission for clients:build uses userId when provided", async () => {
    try {
      const operator = await createTempUser("operator");

      expect(hasPermission(operator.role, "clients:build", operator.id)).toBe(true);

      setUserCanBuild(operator.id, false);
      expect(hasPermission(operator.role, "clients:build", operator.id)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("hasPermission for clients:build without userId falls back to role check", () => {
    expect(hasPermission("admin", "clients:build")).toBe(true);
    expect(hasPermission("operator", "clients:build")).toBe(true);
    expect(hasPermission("viewer", "clients:build")).toBe(false);
  });

  test("other permissions are unaffected by can_build", async () => {
    try {
      const operator = await createTempUser("operator");
      setUserCanBuild(operator.id, false);

      expect(hasPermission(operator.role, "clients:control", operator.id)).toBe(true);
      expect(hasPermission(operator.role, "users:manage", operator.id)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });
});
