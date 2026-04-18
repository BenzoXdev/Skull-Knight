import {
  authenticateRequest,
  authenticateUser,
  extractTokenFromRequest,
  generateToken,
  getSessionTtlSeconds,
  getUserFromRequest,
  revokeToken,
} from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import {
  listUserSessions,
  revokeSessionById,
  revokeAllUserSessions,
  hashTokenForSession,
  persistRevokedTokenHash,
  getSessionById,
  deleteInactiveSessions,
} from "../../db";
import { logger } from "../../logger";
import {
  isRateLimited,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "../../rateLimit";
import { getUserById, canUserAccessClient, canUserAccessFeature, type FeatureName, ALL_FEATURES } from "../../users";
import { makeAuthCookie, makeAuthCookieClear } from "./auth-cookie";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

export async function handleAuthRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = server.requestIP(req)?.address || "unknown";

    const rateLimitCheck = isRateLimited(ip);
    if (rateLimitCheck.limited) {
      logAudit({
        timestamp: Date.now(),
        username: "unknown",
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: "Rate limited",
      });

      return new Response(
        JSON.stringify({
          ok: false,
          error: `Too many failed attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rateLimitCheck.retryAfter),
          },
        },
      );
    }

    try {
      const body = await req.json();
      const username = body?.user || "";
      const password = body?.pass || "";

      const user = await authenticateUser(username, password);

      if (user) {
        const userAgent = req.headers.get("User-Agent") || null;
        const token = await generateToken(user, { ip, userAgent: userAgent || undefined });
        const sessionTtlSeconds = getSessionTtlSeconds();

        logger.info(
          `[auth] User ${user.username} logged in. must_change_password =`,
          user.must_change_password,
          `(type: ${typeof user.must_change_password})`,
        );

        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.LOGIN,
          success: true,
        });

        recordSuccessfulAttempt(ip);

        return new Response(
          JSON.stringify({
            ok: true,
            token,
            user: {
              username: user.username,
              role: user.role,
              id: user.id,
              mustChangePassword: Boolean(user.must_change_password),
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": makeAuthCookie(token, sessionTtlSeconds, req),
            },
          },
        );
      }

      recordFailedAttempt(ip);
      logAudit({
        timestamp: Date.now(),
        username,
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: "Invalid credentials",
      });
    } catch (error) {
      logger.error("[auth] Login error:", error);
      logAudit({
        timestamp: Date.now(),
        username: "unknown",
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: String(error),
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const ip = server.requestIP(req)?.address || "unknown";
    const user = await getUserFromRequest(req);
    const token = extractTokenFromRequest(req);

    if (token) {
      revokeToken(token);
    }

    logAudit({
      timestamp: Date.now(),
      username: user?.username || "unknown",
      ip,
      action: AuditAction.LOGOUT,
      success: true,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": makeAuthCookieClear(req),
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const sessions = listUserSessions(user.userId);
    const currentToken = extractTokenFromRequest(req);
    const currentTokenHash = currentToken ? hashTokenForSession(currentToken) : null;

    return Response.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
        current: s.tokenHash === currentTokenHash,
      })),
    });
  }

  if (req.method === "DELETE" && url.pathname === "/api/sessions/inactive") {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const removed = deleteInactiveSessions(user.userId);

    const ip = server.requestIP(req)?.address || "unknown";
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.LOGOUT,
      details: `Removed ${removed} inactive session(s)`,
      success: true,
    });

    return Response.json({ ok: true, removed });
  }

  if (req.method === "GET" && url.pathname.match(/^\/api\/users\/\d+\/sessions$/)) {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }

    const targetUserId = parseInt(url.pathname.split("/")[3]);
    const sessions = listUserSessions(targetUserId);

    return Response.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
      })),
    });
  }

  if (req.method === "DELETE" && url.pathname.match(/^\/api\/sessions\/[^/]+$/)) {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const sessionId = url.pathname.split("/")[3];
    const session = getSessionById(sessionId);

    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.userId !== user.userId && user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = revokeSessionById(sessionId);
    if (result.tokenHash) {
      persistRevokedTokenHash(result.tokenHash, session.expiresAt);
    }

    const ip = server.requestIP(req)?.address || "unknown";
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.LOGOUT,
      details: `Revoked session ${sessionId}${session.userId !== user.userId ? ` (user ${session.userId})` : ""}`,
      success: true,
    });

    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && url.pathname.match(/^\/api\/users\/\d+\/sessions$/)) {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }

    const targetUserId = parseInt(url.pathname.split("/")[3]);

    const sessions = listUserSessions(targetUserId).filter((s) => !s.revoked);
    for (const s of sessions) {
      persistRevokedTokenHash(s.tokenHash, s.expiresAt);
    }

    const count = revokeAllUserSessions(targetUserId);

    const ip = server.requestIP(req)?.address || "unknown";
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.LOGOUT,
      details: `Revoked all ${count} sessions for user ${targetUserId}`,
      success: true,
    });

    return Response.json({ ok: true, revokedCount: count });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/feature-check") {
    const user = await authenticateRequest(req);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const feature = url.searchParams.get("feature") as FeatureName | null;
    const clientId = url.searchParams.get("clientId");

    if (!feature || !ALL_FEATURES.includes(feature as FeatureName)) {
      return Response.json({ error: "Invalid feature" }, { status: 400 });
    }

    const reasons: string[] = [];

    if (!canUserAccessFeature(user.userId, user.role, feature)) {
      reasons.push("feature");
    }

    if (clientId && !canUserAccessClient(user.userId, user.role, clientId)) {
      reasons.push("client");
    }

    if (reasons.length > 0) {
      return Response.json({ allowed: false, denied: reasons });
    }

    return Response.json({ allowed: true });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const dbUser = getUserById(user.userId);

    return new Response(
      JSON.stringify({
        username: user.username,
        role: user.role,
        userId: user.userId,
        mustChangePassword: dbUser ? Boolean(dbUser.must_change_password) : false,
        canBuild: dbUser ? Boolean(dbUser.can_build) : false,
        telegramChatId: dbUser?.telegram_chat_id || "",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return null;
}
