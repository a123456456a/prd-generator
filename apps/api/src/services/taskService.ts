import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { buildGraph } from "../graph/workflow.js";
import type {
  GraphConfig,
  GraphStateType,
  GraphStatus,
} from "../graph/state.js";
import type {
  CreateTaskBody,
  ResumeTaskBody,
} from "../schemas/apiSchema.js";
import type { Principal } from "../middleware/auth.js";
import type { PRD } from "../schemas/prdSchema.js";
import { type AppConfig, loadConfig } from "../config.js";
import { AppError } from "../utils/errors.js";
import type { SseEvent } from "./sse.js";
import {
  assertWithinBudget,
  CONSERVATIVE_NODE_TOKENS,
  principalKey,
  utcDay,
} from "./budget.js";
import { MemoryTaskStore, type TaskStore } from "./taskStore.js";
import { InProcessQueue, type TaskQueue } from "./taskQueue.js";
import {
  MemoryUsageStore,
  type UsageStore,
} from "./usageStore.js";
import { NoopArtifactWriter, type ArtifactWriter } from "./artifactWriter.js";
import { logger } from "../utils/logger.js";

export type TaskStatus = GraphStatus | "queued" | "running" | "cancelled";
export type TaskOwner = { kind: "user"; userId: string } | { kind: "apiKey" };

export interface TaskSnapshot {
  threadId: string;
  owner: TaskOwner;
  status: TaskStatus;
  progress: number;
  prd?: PRD;
  prdMarkdown: string;
  prototypeHtml: string;
  error?: string;
  gaps: string[];
  config: GraphConfig;
  extractedText: string;
  structuredRequirements?: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export type GraphUpdate = Partial<GraphStateType>;

export type UsageEstimator = (update: GraphUpdate) => number;

/** Conservative per-LLM-node estimate; replace with real usage_metadata when available. */
export function defaultUsageEstimator(update: GraphUpdate): number {
  if (Object.hasOwn(update, "structuredRequirements")) {
    return CONSERVATIVE_NODE_TOKENS;
  }
  if (Object.hasOwn(update, "prd") && update.prd !== null) {
    return CONSERVATIVE_NODE_TOKENS;
  }
  if (Object.hasOwn(update, "prototypeHtml") && update.prototypeHtml) {
    return CONSERVATIVE_NODE_TOKENS;
  }
  return 0;
}

export type GraphRunRequest =
  | {
      kind: "create";
      threadId: string;
      input: Partial<GraphStateType>;
    }
  | {
      kind: "resume";
      threadId: string;
      snapshot: TaskSnapshot;
      body: ResumeTaskBody;
    }
  | {
      kind: "regenerate";
      threadId: string;
      snapshot: TaskSnapshot;
      target: "prd" | "prototype";
    };

export interface TaskGraphRunner {
  run(request: GraphRunRequest): AsyncIterable<GraphUpdate>;
}

type Subscriber = (event: SseEvent, data: unknown) => void;

interface CompiledTaskGraph {
  stream(
    input: Partial<GraphStateType> | null,
    options: {
      streamMode: "updates";
      configurable: { thread_id: string };
    },
  ): AsyncIterable<unknown>;
  updateState(
    options: { configurable: { thread_id: string } },
    values: Partial<GraphStateType>,
    asNode?: string,
  ): Promise<unknown>;
}

function graphConfig(threadId: string) {
  return {
    streamMode: "updates" as const,
    configurable: { thread_id: threadId },
  };
}

function isGraphUpdate(value: unknown): value is GraphUpdate {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function* flattenUpdates(
  stream: AsyncIterable<unknown>,
): AsyncGenerator<GraphUpdate> {
  for await (const chunk of stream) {
    if (!isGraphUpdate(chunk)) continue;
    for (const update of Object.values(chunk)) {
      if (isGraphUpdate(update)) yield update;
    }
  }
}

function mergePrd(prd: PRD | undefined, patch: Record<string, unknown>): PRD {
  return { ...(prd ?? {}), ...patch } as PRD;
}

function isCancelled(task: TaskSnapshot): boolean {
  return task.status === "cancelled";
}

const TERMINAL_STATUSES: TaskStatus[] = ["completed", "failed", "cancelled"];

function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class LangGraphRunner implements TaskGraphRunner {
  private readonly graph: CompiledTaskGraph;

  constructor(
    graphOrCheckpointer:
      | CompiledTaskGraph
      | { checkpointer: BaseCheckpointSaver<number> } = { checkpointer: new MemorySaver() },
  ) {
    this.graph =
      "stream" in graphOrCheckpointer
        ? graphOrCheckpointer
        : (buildGraph({
            checkpointer: graphOrCheckpointer.checkpointer,
          }) as unknown as CompiledTaskGraph);
  }

  async *run(request: GraphRunRequest): AsyncGenerator<GraphUpdate> {
    const config = graphConfig(request.threadId);
    if (request.kind === "create") {
      yield* flattenUpdates(await this.graph.stream(request.input, config));
      return;
    }

    const { values, asNode } =
      request.kind === "resume"
        ? this.resumeState(request.snapshot, request.body)
        : this.regenerateState(request.snapshot, request.target);
    await this.graph.updateState(config, values, asNode);
    yield values;
    yield* flattenUpdates(await this.graph.stream(null, config));
  }

  private resumeState(
    snapshot: TaskSnapshot,
    body: ResumeTaskBody,
  ): { values: GraphUpdate; asNode: string } {
    if (snapshot.status === "awaiting_clarification") {
      if (body.action !== "approve" || !body.clarificationText) {
        throw new Error("待澄清任务需要 clarificationText");
      }
      return {
        values: {
          extractedText: [snapshot.extractedText, body.clarificationText]
            .filter(Boolean)
            .join("\n\n"),
          gaps: [],
          status: "extracting",
          progress: 25,
          error: "",
          config: { ...snapshot.config, requireClarification: false },
        },
        asNode: "parse_multimodal",
      };
    }

    if (snapshot.status !== "awaiting_review") {
      throw new Error(`任务状态 ${snapshot.status} 不可恢复`);
    }
    if (body.action === "reject") {
      return {
        values: {
          extractedText: [snapshot.extractedText, `评审反馈：${body.feedback}`]
            .filter(Boolean)
            .join("\n\n"),
          status: "generating_prd",
          progress: 50,
          prd: null,
          prdMarkdown: "",
          prototypeHtml: "",
          error: "",
        },
        asNode: "extract_requirements",
      };
    }

    const prd =
      body.action === "edit"
        ? mergePrd(snapshot.prd, body.prdPatch)
        : snapshot.prd;
    const skipPrototype = Boolean(snapshot.config.skipPrototype);
    return {
      values: {
        prd,
        status: skipPrototype ? "completed" : "generating_prototype",
        progress: skipPrototype ? 100 : 75,
        prototypeHtml: "",
        error: "",
        config: { ...snapshot.config, enableHumanReview: false },
      },
      asNode: "generate_prd",
    };
  }

  private regenerateState(
    snapshot: TaskSnapshot,
    target: "prd" | "prototype",
  ): { values: GraphUpdate; asNode: string } {
    if (target === "prd") {
      return {
        values: {
          status: "generating_prd",
          progress: 50,
          prd: null,
          prdMarkdown: "",
          prototypeHtml: "",
          error: "",
        },
        asNode: "extract_requirements",
      };
    }
    if (!snapshot.prd) {
      throw new Error("缺少 PRD，无法重新生成原型");
    }
    return {
      values: {
        status: "generating_prototype",
        progress: 75,
        prototypeHtml: "",
        error: "",
      },
      asNode: "generate_prd",
    };
  }
}

export class TaskService {
  private readonly tasks = new Map<string, TaskSnapshot>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly activeRuns = new Set<string>();
  private readonly runner: TaskGraphRunner;
  private readonly store: TaskStore;
  private readonly usageStore: UsageStore;
  private readonly config: AppConfig;
  private readonly queue: TaskQueue;
  private readonly usageEstimator: UsageEstimator;
  private readonly artifactWriter: ArtifactWriter;

  constructor(
    options: {
      runner?: TaskGraphRunner;
      store?: TaskStore;
      usageStore?: UsageStore;
      config?: AppConfig;
      checkpointer?: BaseCheckpointSaver<number>;
      queue?: TaskQueue;
      usageEstimator?: UsageEstimator;
      /** Persists deliverables to disk (e.g. `outputs/<threadId>/`). Defaults to a no-op. */
      artifactWriter?: ArtifactWriter;
    } = {},
  ) {
    this.runner =
      options.runner ??
      new LangGraphRunner({ checkpointer: options.checkpointer ?? new MemorySaver() });
    this.store = options.store ?? new MemoryTaskStore();
    this.usageStore = options.usageStore ?? new MemoryUsageStore();
    this.config = options.config ?? loadConfig();
    this.queue =
      options.queue ?? new InProcessQueue(this.config.maxConcurrentTasks);
    this.usageEstimator = options.usageEstimator ?? defaultUsageEstimator;
    this.artifactWriter = options.artifactWriter ?? new NoopArtifactWriter();
  }

  async createTask(
    input: CreateTaskBody,
    principal: Principal,
  ): Promise<{ threadId: string }> {
    await assertWithinBudget(
      this.usageStore,
      principalKey(principal),
      this.config.dailyTokenBudget,
    );

    const threadId = randomUUID();
    const now = new Date().toISOString();
    const config = this.createConfig(input);
    const snapshot: TaskSnapshot = {
      threadId,
      owner:
        principal.kind === "user"
          ? { kind: "user", userId: principal.userId }
          : { kind: "apiKey" },
      status: "queued",
      progress: 0,
      prdMarkdown: "",
      prototypeHtml: "",
      gaps: [],
      config,
      extractedText: "",
      createdAt: now,
      updatedAt: now,
    };
    await this.persist(snapshot);

    const request: GraphRunRequest = {
      kind: "create",
      threadId,
      input: { rawFiles: input.files, config },
    };
    void this.queue.schedule(() => this.execute(request));
    return { threadId };
  }

  async recordTokenUsage(
    principalKeyValue: string,
    tokens: number,
    day = utcDay(),
  ): Promise<number> {
    if (tokens <= 0) return this.usageStore.getTokens(principalKeyValue, day);
    return this.usageStore.addTokens(principalKeyValue, day, tokens);
  }

  async getTask(threadId: string): Promise<TaskSnapshot | undefined> {
    let task = this.tasks.get(threadId);
    if (!task) {
      const stored = await this.store.get(threadId);
      if (stored) {
        this.tasks.set(threadId, stored);
        task = stored;
      }
    }
    return task ? { ...task } : undefined;
  }

  async resumeTask(threadId: string, body: ResumeTaskBody): Promise<void> {
    const snapshot = await this.requireTask(threadId);
    this.assertNotRunning(threadId);
    this.assertResumable(snapshot, body);
    const checkpointSnapshot = { ...snapshot };
    if (snapshot.status === "awaiting_clarification" && body.action === "approve") {
      snapshot.extractedText = [snapshot.extractedText, body.clarificationText]
        .filter(Boolean)
        .join("\n\n");
      snapshot.gaps = [];
    } else if (snapshot.status === "awaiting_review" && body.action === "edit") {
      snapshot.prd = mergePrd(snapshot.prd, body.prdPatch);
      snapshot.prototypeHtml = "";
    } else if (snapshot.status === "awaiting_review" && body.action === "reject") {
      snapshot.extractedText = [
        snapshot.extractedText,
        `评审反馈：${body.feedback}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      snapshot.prd = undefined;
      snapshot.prdMarkdown = "";
      snapshot.prototypeHtml = "";
    }
    await this.prepareForRun(snapshot, body.action === "reject" ? 50 : 75);
    await this.execute({
      kind: "resume",
      threadId,
      snapshot: checkpointSnapshot,
      body,
    });
  }

  async regenerate(
    threadId: string,
    target: "prd" | "prototype",
  ): Promise<void> {
    const snapshot = await this.requireTask(threadId);
    this.assertNotRunning(threadId);
    this.assertRegenerable(snapshot, target);
    await this.prepareForRun(snapshot, target === "prd" ? 50 : 75);
    if (target === "prd") {
      snapshot.prd = undefined;
      snapshot.prdMarkdown = "";
    }
    snapshot.prototypeHtml = "";
    await this.execute({
      kind: "regenerate",
      threadId,
      snapshot: { ...snapshot },
      target,
    });
  }

  async cancelTask(threadId: string): Promise<void> {
    const task = await this.requireTask(threadId);
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    await this.persist(task);
    this.emit(threadId, "status", { status: "cancelled" });
    this.emit(threadId, "done", this.resultPayload(task));
    this.subscribers.delete(threadId);
  }

  subscribe(threadId: string, send: Subscriber): () => void {
    if (!this.tasks.has(threadId)) {
      throw new Error(`任务不存在：${threadId}`);
    }
    const subscribers = this.subscribers.get(threadId) ?? new Set<Subscriber>();
    subscribers.add(send);
    this.subscribers.set(threadId, subscribers);
    return () => {
      subscribers.delete(send);
      if (subscribers.size === 0) this.subscribers.delete(threadId);
    };
  }

  private createConfig(input: CreateTaskBody): GraphConfig {
    const options = input.options;
    return {
      language: options?.language,
      requireClarification: options?.requireClarification,
      enableHumanReview: options?.enableHumanReview,
      skipPrototype: options?.skipPrototype,
      extractModel: options?.model,
      prdModel: options?.model,
      prototypeModel: options?.model,
      textDescription: input.textDescription,
    };
  }

  private async prepareForRun(
    task: TaskSnapshot,
    progress: number,
  ): Promise<void> {
    task.status = "running";
    task.progress = progress;
    task.error = undefined;
    task.updatedAt = new Date().toISOString();
    await this.persist(task);
    this.emit(task.threadId, "status", { status: task.status });
  }

  private async execute(request: GraphRunRequest): Promise<void> {
    const task = await this.requireTask(request.threadId);
    if (isCancelled(task)) return;
    if (this.activeRuns.has(request.threadId)) {
      throw new AppError(
        "TASK_ALREADY_RUNNING",
        `任务正在运行：${request.threadId}`,
        409,
      );
    }
    this.activeRuns.add(request.threadId);
    if (task.status === "queued") {
      task.status = "running";
      task.updatedAt = new Date().toISOString();
      await this.persist(task);
      this.emit(task.threadId, "status", { status: "running" });
    }

    try {
      for await (const update of this.runner.run(request)) {
        if (isCancelled(task)) return;
        await this.applyUpdate(task, update);
      }
      if (!isCancelled(task)) {
        this.emit(task.threadId, "done", this.resultPayload(task));
      }
    } catch (error) {
      if (isCancelled(task)) return;
      task.status = "failed";
      task.progress = 100;
      task.error = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date().toISOString();
      await this.persist(task);
      this.emit(task.threadId, "status", { status: "failed" });
      this.emit(task.threadId, "error", { error: task.error });
      this.emit(task.threadId, "done", this.resultPayload(task));
    } finally {
      this.activeRuns.delete(request.threadId);
    }
  }

  private async applyUpdate(
    task: TaskSnapshot,
    update: GraphUpdate,
  ): Promise<void> {
    const previousStatus = task.status;
    const previousProgress = task.progress;
    Object.assign(task, update, { updatedAt: new Date().toISOString() });
    if (update.prd === null) task.prd = undefined;
    if (update.error === "") task.error = undefined;

    if (task.status !== previousStatus) {
      this.emit(task.threadId, "status", { status: task.status });
    }
    if (task.progress !== previousProgress) {
      this.emit(task.threadId, "progress", { progress: task.progress });
    }
    if (
      Object.hasOwn(update, "prd") ||
      Object.hasOwn(update, "prdMarkdown") ||
      Object.hasOwn(update, "prototypeHtml")
    ) {
      this.emit(task.threadId, "result", this.resultPayload(task));
    }
    if (task.error) {
      this.emit(task.threadId, "error", { error: task.error });
    }
    const tokenDelta = this.usageEstimator(update);
    if (tokenDelta > 0) {
      await this.recordTokenUsage(principalKey(task.owner), tokenDelta);
    }
    await this.persist(task);
  }

  private async persist(task: TaskSnapshot): Promise<void> {
    if (isTerminalStatus(task.status)) {
      task.expiresAt = new Date(
        Date.now() + this.config.taskTtlMs,
      ).toISOString();
    } else {
      task.expiresAt = undefined;
    }
    this.tasks.set(task.threadId, task);
    await this.store.save({ ...task });
    try {
      await this.artifactWriter.write(task);
    } catch (error) {
      logger.error({ error, threadId: task.threadId }, "Failed to persist task artifacts to disk");
    }
  }

  private resultPayload(task: TaskSnapshot) {
    return {
      threadId: task.threadId,
      status: task.status,
      progress: task.progress,
      prd: task.prd,
      prdMarkdown: task.prdMarkdown,
      prototypeHtml: task.prototypeHtml,
      error: task.error,
      gaps: task.gaps,
    };
  }

  private emit(threadId: string, event: SseEvent, data: unknown): void {
    for (const subscriber of this.subscribers.get(threadId) ?? []) {
      subscriber(event, data);
    }
  }

  private async requireTask(threadId: string): Promise<TaskSnapshot> {
    let task = this.tasks.get(threadId);
    if (!task) {
      const stored = await this.store.get(threadId);
      if (stored) {
        this.tasks.set(threadId, stored);
        task = stored;
      }
    }
    if (!task) throw new Error(`任务不存在：${threadId}`);
    return task;
  }

  private assertNotRunning(threadId: string): void {
    if (this.activeRuns.has(threadId)) {
      throw new AppError(
        "TASK_ALREADY_RUNNING",
        `任务正在运行：${threadId}`,
        409,
      );
    }
  }

  private assertResumable(task: TaskSnapshot, body: ResumeTaskBody): void {
    const validClarification =
      task.status === "awaiting_clarification" &&
      body.action === "approve" &&
      Boolean(body.clarificationText);
    const validReview =
      task.status === "awaiting_review" &&
      ["approve", "edit", "reject"].includes(body.action);
    if (!validClarification && !validReview) {
      throw new AppError(
        "TASK_NOT_RESUMABLE",
        `任务状态 ${task.status} 不可恢复`,
        409,
      );
    }
  }

  private assertRegenerable(
    task: TaskSnapshot,
    target: "prd" | "prototype",
  ): void {
    if (!["completed", "awaiting_review", "failed"].includes(task.status)) {
      throw new AppError(
        "TASK_NOT_REGENERABLE",
        `任务状态 ${task.status} 不可重新生成`,
        409,
      );
    }
    if (target === "prototype" && !task.prd) {
      throw new AppError("PRD_REQUIRED", "缺少 PRD，无法重新生成原型", 409);
    }
  }
}
