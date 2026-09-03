import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Principal } from "../middleware/auth.js";
import { CreateTaskBodySchema, type CreateTaskBody } from "../schemas/apiSchema.js";
import { sendSseEvent, writeSseHeaders } from "../services/sse.js";
import type { TaskService } from "../services/taskService.js";
import type { Storage, StoredFile } from "../storage/index.js";
import { AppError } from "../utils/errors.js";

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

type GenerateRoutesOptions = {
  taskService: TaskService;
  storage: Storage;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
};

type PendingFile = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
};

function isAllowedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("text/") ||
    DOCUMENT_MIME_TYPES.has(mimeType)
  );
}

function requirePrincipal(request: FastifyRequest) {
  if (!request.principal) {
    throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  }
  return request.principal;
}

async function cleanupSavedFiles(
  storage: Storage,
  files: StoredFile[],
): Promise<void> {
  await Promise.allSettled(
    files.map((file) => storage.remove(file.storageKey)),
  );
}

async function readGenerateInput(
  request: FastifyRequest,
  options: GenerateRoutesOptions,
) {
  if (!request.isMultipart()) {
    throw new AppError(
      "MULTIPART_REQUIRED",
      "请求必须使用 multipart/form-data",
      415,
    );
  }

  const pendingFiles: PendingFile[] = [];
  let totalBytes = 0;
  let textDescription: string | undefined;
  let rawOptions: unknown;

  for await (const part of request.parts({
    limits: {
      fileSize: options.maxFileBytes,
      files: options.maxFiles,
      fields: 20,
    },
  })) {
    if (part.type === "field") {
      if (part.valueTruncated) {
        throw new AppError("FIELD_TOO_LARGE", `字段过大：${part.fieldname}`, 413);
      }
      if (part.fieldname === "textDescription") {
        textDescription = String(part.value);
      } else if (part.fieldname === "options") {
        try {
          rawOptions = JSON.parse(String(part.value));
        } catch {
          throw new AppError("INVALID_OPTIONS", "options 必须是 JSON 对象", 400);
        }
      }
      continue;
    }

    if (!isAllowedMimeType(part.mimetype)) {
      part.file.resume();
      throw new AppError(
        "UNSUPPORTED_FILE_TYPE",
        `不支持的文件类型：${part.mimetype}`,
        415,
      );
    }

    const chunks: Buffer[] = [];
    for await (const chunk of part.file) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      totalBytes += buffer.length;
      if (totalBytes > options.maxTotalBytes) {
        throw new AppError("TOTAL_UPLOAD_TOO_LARGE", "上传文件总大小超出限制", 413);
      }
    }
    if (part.file.truncated) {
      throw new AppError("FILE_TOO_LARGE", `文件过大：${part.filename}`, 413);
    }
    pendingFiles.push({
      buffer: Buffer.concat(chunks),
      originalName: part.filename,
      mimeType: part.mimetype,
    });
  }

  const files = await Promise.all(
    pendingFiles.map((file) => options.storage.save(file)),
  );
  const parsed = CreateTaskBodySchema.safeParse({
    files,
    textDescription,
    options: rawOptions,
  });
  if (!parsed.success) {
    await cleanupSavedFiles(options.storage, files);
    throw new AppError(
      "INVALID_GENERATE_REQUEST",
      parsed.error.issues.map((issue) => issue.message).join("; "),
      400,
    );
  }
  return parsed.data;
}

function streamTask(
  reply: FastifyReply,
  taskService: TaskService,
  threadId: string,
): void {
  reply.hijack();
  writeSseHeaders(reply);
  sendSseEvent(reply, "status", { status: "queued", threadId });

  let unsubscribe = () => {};
  unsubscribe = taskService.subscribe(threadId, (event, data) => {
    sendSseEvent(reply, event, data);
    if (event === "done") {
      unsubscribe();
      reply.raw.end();
    }
  });
  reply.raw.on("close", unsubscribe);
}

async function createTaskWithBudgetCheck(
  taskService: TaskService,
  input: CreateTaskBody,
  principal: Principal,
): Promise<{ threadId: string }> {
  try {
    return await taskService.createTask(input, principal);
  } catch (error) {
    if (error instanceof AppError && error.code === "BUDGET_EXCEEDED") {
      throw new AppError("BUDGET_EXCEEDED", error.message, 429);
    }
    throw error;
  }
}

export const generateRoutes: FastifyPluginAsync<GenerateRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/generate", async (request) => {
    const input = await readGenerateInput(request, options);
    const { threadId } = await createTaskWithBudgetCheck(
      options.taskService,
      input,
      requirePrincipal(request),
    );
    return { threadId, status: "queued" as const };
  });

  app.post("/generate/stream", async (request, reply) => {
    const input = await readGenerateInput(request, options);
    const { threadId } = await createTaskWithBudgetCheck(
      options.taskService,
      input,
      requirePrincipal(request),
    );
    streamTask(reply, options.taskService, threadId);
    return reply;
  });
};
