import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../utils/errors.js";

type Bucket = {
  tokens: number;
  updatedAt: number;
};

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPeriodMs = 60_000,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    const previous = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    const elapsed = Math.max(0, now - previous.updatedAt);
    const tokens = Math.min(
      this.capacity,
      previous.tokens + (elapsed * this.capacity) / this.refillPeriodMs,
    );

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      const waitMs = ((1 - tokens) * this.refillPeriodMs) / this.capacity;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    }

    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfter: 0 };
  }
}

export type RateLimiterOptions = {
  windowMs: number;
  max: number;
  keyFn: (request: FastifyRequest) => string;
};

/**
 * Generic rate limiter factory.
 * Login routes should key by client IP; generate routes by `user:<id>` or `key:api`.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const bucket = new TokenBucketRateLimiter(options.max, options.windowMs);

  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const result = bucket.consume(options.keyFn(request));
    if (!result.allowed) {
      reply.header("Retry-After", result.retryAfter);
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "Too many requests",
      });
    }
  };
}

export function createRateLimitHook() {
  const general = new TokenBucketRateLimiter(20);
  const generate = new TokenBucketRateLimiter(5);

  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const apiKey = request.headers.authorization ?? "anonymous";
    const generalResult = general.consume(apiKey);
    if (!generalResult.allowed) {
      reply.header("Retry-After", generalResult.retryAfter);
      throw new AppError("RATE_LIMITED", "请求过于频繁", 429);
    }

    const path = request.url.split("?", 1)[0];
    if (path.startsWith("/api/generate")) {
      const generateResult = generate.consume(apiKey);
      if (!generateResult.allowed) {
        reply.header("Retry-After", generateResult.retryAfter);
        throw new AppError("RATE_LIMITED", "生成请求过于频繁", 429);
      }
    }
  };
}
