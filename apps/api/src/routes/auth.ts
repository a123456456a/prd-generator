import type { FastifyInstance } from "fastify";
import { verifyPassword } from "../auth/password.js";
import type { SessionStore, UserRecord, UserStore } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

export type AuthRoutesDeps = {
  config: AppConfig;
  users: UserStore;
  sessions: SessionStore;
};

type LoginBody = {
  username?: string;
  password?: string;
};

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

function authInvalid(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(401).send({
    code: "AUTH_INVALID",
    message: "Invalid credentials",
  });
}

function cookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  };
}

async function resolveActiveUser(
  sid: string | undefined,
  deps: AuthRoutesDeps,
): Promise<UserRecord | null> {
  if (!sid) return null;
  const session = await deps.sessions.get(sid);
  if (!session) return null;
  const user = await deps.users.findById(session.userId);
  if (!user || user.status !== "active") return null;
  return user;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): Promise<void> {
  const limitLogin = createRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: (request) => request.ip,
  });

  app.post(
    "/api/auth/login",
    { preHandler: limitLogin },
    async (request, reply) => {
      const body = request.body as LoginBody;
      const username = body.username?.trim() ?? "";
      const password = body.password ?? "";

      const user = await deps.users.findByUsername(username);
      if (!user || user.status !== "active") {
        return authInvalid(reply);
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return authInvalid(reply);
      }

      const session = await deps.sessions.create(
        user.id,
        deps.config.sessionTtlMs,
      );
      reply.setCookie("sid", session.id, cookieOptions(deps.config));
      return reply.send({ user: publicUser(user) });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const sid = request.cookies.sid;
    if (sid) {
      await deps.sessions.delete(sid);
    }
    reply.clearCookie("sid", { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await resolveActiveUser(request.cookies.sid, deps);
    if (!user) {
      return authInvalid(reply);
    }
    return reply.send({ user: publicUser(user) });
  });

  app.post("/api/auth/register", async (_request, reply) => {
    return reply.code(501).send({
      code: "NOT_IMPLEMENTED",
      message: "Registration is not available in this release",
    });
  });
}
