import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Principal } from "../middleware/auth.js";
import {
  RegenerateBodySchema,
  ResumeTaskBodySchema,
} from "../schemas/apiSchema.js";
import { sendSseEvent, writeSseHeaders } from "../services/sse.js";
import type { TaskService, TaskSnapshot } from "../services/taskService.js";
import { AppError } from "../utils/errors.js";

type ThreadParams = { threadId: string };
type ThreadRoutesOptions = { taskService: TaskService };

function requireTask(taskService: TaskService, threadId: string): TaskSnapshot {
  const task = taskService.getTask(threadId);
  if (!task) {
    throw new AppError("TASK_NOT_FOUND", `任务不存在：${threadId}`, 404);
  }
  return task;
}

function requireAuthorizedTask(
  taskService: TaskService,
  threadId: string,
  principal: Principal | null,
): TaskSnapshot {
  const task = requireTask(taskService, threadId);
  // API keys are trusted automation credentials with global task access.
  if (
    principal?.kind === "apiKey" ||
    (principal?.kind === "user" &&
      task.owner.kind === "user" &&
      task.owner.userId === principal.userId)
  ) {
    return task;
  }
  throw new AppError(
    "FORBIDDEN",
    "You do not have access to this task",
    403,
  );
}

function parseBody<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_REQUEST",
      parsed.error.issues.map((issue) => issue.message).join("; "),
      400,
    );
  }
  return parsed.data;
}

function openTaskStream(
  reply: FastifyReply,
  taskService: TaskService,
  task: TaskSnapshot,
): void {
  reply.hijack();
  writeSseHeaders(reply);
  sendSseEvent(reply, "status", {
    threadId: task.threadId,
    status: task.status,
    progress: task.progress,
  });

  if (["completed", "failed", "cancelled"].includes(task.status)) {
    sendSseEvent(reply, "done", task);
    reply.raw.end();
    return;
  }

  let unsubscribe = () => {};
  unsubscribe = taskService.subscribe(task.threadId, (event, data) => {
    sendSseEvent(reply, event, data);
    if (event === "done") {
      unsubscribe();
      reply.raw.end();
    }
  });
  reply.raw.on("close", unsubscribe);
}

export const threadRoutes: FastifyPluginAsync<ThreadRoutesOptions> = async (
  app,
  { taskService },
) => {
  app.get<{ Params: ThreadParams }>("/thread/:threadId", async (request) =>
    requireAuthorizedTask(
      taskService,
      request.params.threadId,
      request.principal,
    ),
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/stream",
    async (request, reply) => {
      const task = requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      openTaskStream(reply, taskService, task);
      return reply;
    },
  );

  app.post<{ Params: ThreadParams; Body: unknown }>(
    "/thread/:threadId/resume",
    async (request) => {
      requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      const body = parseBody(ResumeTaskBodySchema, request.body);
      await taskService.resumeTask(request.params.threadId, body);
      return taskService.getTask(request.params.threadId);
    },
  );

  app.post<{ Params: ThreadParams; Body: unknown }>(
    "/thread/:threadId/regenerate",
    async (request) => {
      requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      const body = parseBody(RegenerateBodySchema, request.body);
      await taskService.regenerate(request.params.threadId, body.target);
      return taskService.getTask(request.params.threadId);
    },
  );

  app.delete<{ Params: ThreadParams }>(
    "/thread/:threadId",
    async (request, reply) => {
      requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      await taskService.cancelTask(request.params.threadId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prd.md",
    async (request, reply) => {
      const task = requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      if (!task.prdMarkdown) {
        throw new AppError("NOT_FOUND", "PRD Markdown export is not available", 404);
      }
      return reply.type("text/markdown; charset=utf-8").send(task.prdMarkdown);
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prd.json",
    async (request, reply) => {
      const task = requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      if (!task.prd) {
        throw new AppError("NOT_FOUND", "PRD JSON export is not available", 404);
      }
      return reply.type("application/json; charset=utf-8").send(task.prd);
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prototype.html",
    async (request, reply) => {
      const task = requireAuthorizedTask(
        taskService,
        request.params.threadId,
        request.principal,
      );
      if (!task.prototypeHtml) {
        throw new AppError("NOT_FOUND", "Prototype HTML export is not available", 404);
      }
      return reply.type("text/html; charset=utf-8").send(task.prototypeHtml);
    },
  );
};
