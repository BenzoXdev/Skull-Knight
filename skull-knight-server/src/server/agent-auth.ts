import { logger } from "../logger";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAuthorizedAgentRequest(
  req: Request,
  url: URL,
  agentToken?: string,
): boolean {
  const disableAuth =
    String(process.env.SKULL_KNIGHT_DISABLE_AGENT_AUTH || "").toLowerCase() ===
    "true";
  if (disableAuth) {
    const nodeEnv = String(process.env.NODE_ENV || "development").toLowerCase();
    if (nodeEnv === "production") {
      logger.warn("[auth] SKULL_KNIGHT_DISABLE_AGENT_AUTH is ignored in production mode");
    } else {
      logger.info("[auth] Agent auth explicitly disabled by SKULL_KNIGHT_DISABLE_AGENT_AUTH=true (non-production mode)");
      return true;
    }
  }

  const token = agentToken?.trim();
  if (!token) {
    logger.info("[auth] Agent auth disabled");
    return true;
  }

  const headerToken = req.headers.get("x-agent-token");
  const queryToken = url.searchParams.get("token");
  const isAuthed =
    (headerToken !== null && safeCompare(headerToken, token)) ||
    (queryToken !== null && safeCompare(queryToken, token));

  if (!isAuthed) {
    logger.info("[auth] Agent auth failed");
  } else {
    logger.info("[auth] Agent authenticated successfully");
  }

  return isAuthed;
}
