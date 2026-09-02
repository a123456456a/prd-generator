import type { FastifyPluginAsync, FastifyReply } from "fastify";
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
    requireTask(taskService, request.params.threadId),
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/stream",
    async (request, reply) => {
      const task = requireTask(taskService, request.params.threadId);
      openTaskStream(reply, taskService, task);
      return reply;
    },
  );

  app.post<{ Params: ThreadParams; Body: unknown }>(
    "/thread/:threadId/resume",
    async (request) => {
      requireTask(taskService, request.params.threadId);
      const body = parseBody(ResumeTaskBodySchema, request.body);
      await taskService.resumeTask(request.params.threadId, body);
      return taskService.getTask(request.params.threadId);
    },
  );

  app.post<{ Params: ThreadParams; Body: unknown }>(
    "/thread/:threadId/regenerate",
    async (request) => {
      requireTask(taskService, request.params.threadId);
      const body = parseBody(RegenerateBodySchema, request.body);
      await taskService.regenerate(request.params.threadId, body.target);
      return taskService.getTask(request.params.threadId);
    },
  );

  app.delete<{ Params: ThreadParams }>(
    "/thread/:threadId",
    async (request, reply) => {
      requireTask(taskService, request.params.threadId);
      await taskService.cancelTask(request.params.threadId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prd.md",
    async (request, reply) => {
      const task = requireTask(taskService, request.params.threadId);
      if (!task.prdMarkdown) return reply.code(404).send();
      return reply.type("text/markdown; charset=utf-8").send(task.prdMarkdown);
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prd.json",
    async (request, reply) => {
      const task = requireTask(taskService, request.params.threadId);
      if (!task.prd) return reply.code(404).send();
      return reply.type("application/json; charset=utf-8").send(task.prd);
    },
  );

  app.get<{ Params: ThreadParams }>(
    "/thread/:threadId/export/prototype.html",
    async (request, reply) => {
      const task = requireTask(taskService, request.params.threadId);
      if (!task.prototypeHtml) return reply.code(404).send();
      return reply.type("text/html; charset=utf-8").send(task.prototypeHtml);
    },
  );
};
