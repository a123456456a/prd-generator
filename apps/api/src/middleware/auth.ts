import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionStore, UserStore } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../utils/errors.js";

export type Principal =
  | {
      kind: "user";
      userId: string;
      username: string;
      role: "admin" | "user";
    }
  | { kind: "apiKey" };

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login"]);

export type RequireAuthDeps = {
  config: Pick<AppConfig, "apiKey">;
  users: UserStore;
  sessions: SessionStore;
};

function matchesSecret(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export function registerPrincipal(app: FastifyInstance): void {
  app.decorateRequest("principal", null);
}

export function requireAuth(deps: RequireAuthDeps) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = request.url.split("?", 1)[0];
    if (PUBLIC_PATHS.has(path)) {
      return;
    }

    const sid = request.cookies.sid;
    if (sid) {
      const session = await deps.sessions.get(sid);
      if (session) {
        const user = await deps.users.findById(session.userId);
        if (user && user.status === "active") {
          request.principal = {
            kind: "user",
            userId: user.id,
            username: user.username,
            role: user.role,
          };
          return;
        }
      }
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (token && matchesSecret(token, deps.config.apiKey)) {
      request.principal = { kind: "apiKey" };
      return;
    }

    return reply.code(401).send({
      code: "AUTH_REQUIRED",
      message: "Authentication required",
    });
  };
}

/** @deprecated Task 5 will switch server wiring to requireAuth. */
export function createAuthHook(apiKey: string) {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!token || !matchesSecret(token, apiKey)) {
      throw new AppError("UNAUTHORIZED", "缺少或无效的 Bearer API Key", 401);
    }
  };
}
