import { describe, expect, test } from "bun:test";
import {
  createUser,
  deleteUser,
  getUserByUsername,
  getUserTelegramChatId,
  getUsersWithTelegramChatId,
  setUserTelegramChatId,
  setUserClientAccessScope,
  setUserClientAccessRule,
  canUserAccessClient,
} from "./users";

const createdUserIds: number[] = [];

async function createTempUser(role: "viewer" | "operator" | "admin") {
  const username = `tg_${role.slice(0, 3)}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
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

describe("per-user Telegram settings", () => {
  test("new user has no telegram chat ID", async () => {
    try {
      const user = await createTempUser("operator");
      expect(getUserTelegramChatId(user.id)).toBeNull();
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("setUserTelegramChatId stores and retrieves chat ID", async () => {
    try {
      const user = await createTempUser("operator");

      const result = setUserTelegramChatId(user.id, "123456789");
      expect(result.success).toBe(true);

      expect(getUserTelegramChatId(user.id)).toBe("123456789");
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("setUserTelegramChatId with null clears the chat ID", async () => {
    try {
      const user = await createTempUser("viewer");

      setUserTelegramChatId(user.id, "987654321");
      expect(getUserTelegramChatId(user.id)).toBe("987654321");

      setUserTelegramChatId(user.id, null);
      expect(getUserTelegramChatId(user.id)).toBeNull();
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("getUsersWithTelegramChatId returns only users with configured chat IDs", async () => {
    try {
      const user1 = await createTempUser("operator");
      const user2 = await createTempUser("viewer");
      const user3 = await createTempUser("operator");

      setUserTelegramChatId(user1.id, "chat_111");
      // user2 has no chat ID
      setUserTelegramChatId(user3.id, "chat_333");

      const withChatId = getUsersWithTelegramChatId();
      const ourUsers = withChatId.filter((u) => [user1.id, user2.id, user3.id].includes(u.id));

      expect(ourUsers.length).toBe(2);
      expect(ourUsers.some((u) => u.id === user1.id && u.telegram_chat_id === "chat_111")).toBe(true);
      expect(ourUsers.some((u) => u.id === user3.id && u.telegram_chat_id === "chat_333")).toBe(true);
      expect(ourUsers.some((u) => u.id === user2.id)).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("getUsersWithTelegramChatId returns role and client_scope", async () => {
    try {
      const operator = await createTempUser("operator");
      setUserTelegramChatId(operator.id, "chat_op");
      setUserClientAccessScope(operator.id, "allowlist");

      const users = getUsersWithTelegramChatId();
      const found = users.find((u) => u.id === operator.id);
      expect(found).not.toBeNull();
      expect(found!.role).toBe("operator");
      expect(found!.client_scope).toBe("allowlist");
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("per-user notification filtering respects client access", async () => {
    try {
      const operator = await createTempUser("operator");
      setUserTelegramChatId(operator.id, "chat_filter");
      setUserClientAccessScope(operator.id, "allowlist");
      setUserClientAccessRule(operator.id, "allowed-client", "allow");

      // Operator should see allowed-client but not other-client
      expect(canUserAccessClient(operator.id, operator.role, "allowed-client")).toBe(true);
      expect(canUserAccessClient(operator.id, operator.role, "other-client")).toBe(false);

      // This simulates what the notification delivery does:
      // get users with chat IDs, then filter by canUserAccessClient
      const recipients = getUsersWithTelegramChatId();
      const opRecipient = recipients.find((r) => r.id === operator.id);
      expect(opRecipient).not.toBeNull();

      const canAccessAllowed = canUserAccessClient(operator.id, operator.role, "allowed-client");
      const canAccessOther = canUserAccessClient(operator.id, operator.role, "other-client");

      expect(canAccessAllowed).toBe(true);
      expect(canAccessOther).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("admin with telegram chat ID can access all clients", async () => {
    try {
      const admin = await createTempUser("admin");
      setUserTelegramChatId(admin.id, "chat_admin");

      expect(canUserAccessClient(admin.id, admin.role, "any-client-1")).toBe(true);
      expect(canUserAccessClient(admin.id, admin.role, "any-client-2")).toBe(true);

      const recipients = getUsersWithTelegramChatId();
      const adminRecipient = recipients.find((r) => r.id === admin.id);
      expect(adminRecipient).not.toBeNull();
      expect(adminRecipient!.telegram_chat_id).toBe("chat_admin");
    } finally {
      cleanupCreatedUsers();
    }
  });
});
