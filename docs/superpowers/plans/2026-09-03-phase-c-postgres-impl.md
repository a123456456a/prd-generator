# Phase C External Postgres Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist tasks/auth/checkpoints to remote Postgres, add in-process concurrency + daily token budget + TTL cleanup, and ship API Dockerfile/docs so a single instance survives restarts (AC-07).

**Architecture:** When `DATABASE_URL` is set, share one `pg.Pool` across app migrations, Postgres `UserStore`/`SessionStore`/`TaskStore`/`UsageStore`, and `PostgresSaver`. Without it, keep Memory implementations. `TaskService` persists every snapshot to `TaskStore`; an `InProcessQueue` caps concurrent graph runs. Production requires `DATABASE_URL`.

**Tech Stack:** Node.js 22+、TypeScript ESM、Fastify 5、`pg`、`@langchain/langgraph-checkpoint-postgres`、Vitest、Docker（仅 API）

**Spec:** `docs/superpowers/specs/2026-09-03-phase-c-postgres-design.md`（v1.0 已确认）

## Global Constraints

- Postgres 始终外置（示例主机 `10.0.0.15:5432` / 库 `prd_generator`）；Compose **不**内嵌 Postgres
- 真实 `DATABASE_URL` 密码只放部署机 `.env`，仓库仅占位符
- 无 `DATABASE_URL` → Memory 行为与现网一致（C-01）；`NODE_ENV=production` 缺则启动失败（C-02）
- 单实例：队列进程内；uploads 本地盘；多实例仅注释预留
- 包管理：pnpm；`"type": "module"`；提交 `pnpm-lock.yaml`
- 测试：Vitest；有 DB 的集成测用 `DATABASE_URL` 或 skip；LLM 一律 mock
- 不做：Redis、S3、OCR、无头冒烟、美元计费、开放注册

## File Map

```
prd-generator/
├── .env.example                          # + DATABASE_URL / TASK_TTL_MS / MAX_CONCURRENT_TASKS / DAILY_TOKEN_BUDGET
├── README.md                             # 生产部署（外置 PG、进程/Docker）
├── Dockerfile                            # 多阶段 API+web
├── compose.yaml                          # 仅 api + uploads volume
├── apps/api/
│   ├── package.json                      # + pg, @types/pg, @langchain/langgraph-checkpoint-postgres
│   ├── migrations/
│   │   └── 001_init.sql                  # users, sessions, tasks, usage_daily
│   └── src/
│       ├── config.ts                     # 新字段 + 生产校验 DATABASE_URL
│       ├── db/
│       │   ├── pool.ts                   # createPool / getPool
│       │   ├── migrate.ts                # 跑 migrations/*.sql
│       │   └── bootstrap.ts              # pool → migrate → checkpointer.setup
│       ├── auth/
│       │   ├── postgresUserStore.ts
│       │   ├── postgresSessionStore.ts
│       │   └── createStores.ts           # Memory vs Postgres 工厂
│       ├── services/
│       │   ├── taskStore.ts              # TaskStore 接口 + MemoryTaskStore
│       │   ├── postgresTaskStore.ts
│       │   ├── taskQueue.ts              # TaskQueue + InProcessQueue
│       │   ├── usageStore.ts             # UsageStore + Memory + Postgres
│       │   ├── budget.ts                 # assertBudget / recordUsage
│       │   ├── ttlCleanup.ts             # 过期任务/会话/文件/checkpoint
│       │   └── taskService.ts            # 持久化 + 队列 + 预算钩子
│       ├── graph/checkpointer.ts          # async createCheckpointer(pool?)
│       ├── graph/workflow.ts             # 接受注入的 checkpointer
│       ├── index.ts                      # bootstrap + 优雅关闭 + TTL 定时
│       └── server.ts                     # 注入 stores / taskService
└── apps/api/tests/
    ├── unit/config.test.ts               # C-02
    ├── unit/inProcessQueue.test.ts
    ├── unit/budget.test.ts
    ├── unit/memoryTaskStore.test.ts
    ├── unit/ttlCleanup.test.ts
    └── integration/restartResume.test.ts # AC-07（有 DATABASE_URL 才跑）
```

---

### Task 1: Config + dependencies + production DATABASE_URL

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/tests/unit/config.test.ts`
- Modify: `.env.example`
- Modify: `apps/api/.env.example`（若与根示例重复，同步占位符）

**Interfaces:**
- Produces: `AppConfig.databaseUrl: string | null`、`taskTtlMs`、`maxConcurrentTasks`、`dailyTokenBudget`；`assertProductionConfig` 在生产拒绝空 `databaseUrl`

- [ ] **Step 1: Write the failing production config test**

在 `apps/api/tests/unit/config.test.ts` 的 `baseConfig` 增加：

```ts
databaseUrl: "postgresql://prd:prd@10.0.0.15:5432/prd_generator",
taskTtlMs: 7 * 24 * 60 * 60 * 1000,
maxConcurrentTasks: 10,
dailyTokenBudget: 500_000,
```

新增用例：

```ts
it("rejects missing DATABASE_URL in production config", () => {
  expect(() =>
    assertProductionConfig({ ...baseConfig, databaseUrl: null }),
  ).toThrow(/DATABASE_URL/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prd/api test -- tests/unit/config.test.ts`

Expected: FAIL（`databaseUrl` 尚不存在于类型/实现，或未校验）

- [ ] **Step 3: Install dependencies**

```bash
pnpm --filter @prd/api add pg @langchain/langgraph-checkpoint-postgres
pnpm --filter @prd/api add -D @types/pg
```

- [ ] **Step 4: Extend `loadConfig` / `assertProductionConfig`**

```ts
// apps/api/src/config.ts — 新增字段与校验片段
databaseUrl: process.env.DATABASE_URL?.trim() || null,
taskTtlMs: Number(process.env.TASK_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
maxConcurrentTasks: Number(process.env.MAX_CONCURRENT_TASKS ?? 10),
dailyTokenBudget: Number(process.env.DAILY_TOKEN_BUDGET ?? 500_000),

// assertProductionConfig:
if (!config.databaseUrl) {
  errors.push("DATABASE_URL must be set");
}
```

- [ ] **Step 5: Update `.env.example` placeholders**

```env
DATABASE_URL=
TASK_TTL_MS=604800000
MAX_CONCURRENT_TASKS=10
DAILY_TOKEN_BUDGET=500000
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @prd/api test -- tests/unit/config.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/config.ts apps/api/tests/unit/config.test.ts .env.example pnpm-lock.yaml apps/api/.env.example
git commit -m "feat: require DATABASE_URL and add phase-C config knobs"
```

---

### Task 2: Pool, migrations, Postgres user/session stores

**Files:**
- Create: `apps/api/migrations/001_init.sql`
- Create: `apps/api/src/db/pool.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/bootstrap.ts`
- Create: `apps/api/src/auth/postgresUserStore.ts`
- Create: `apps/api/src/auth/postgresSessionStore.ts`
- Create: `apps/api/src/auth/createStores.ts`
- Create: `apps/api/tests/unit/postgresUserStore.test.ts`（无 `DATABASE_URL` 时 `describe.skip`）
- Modify: `apps/api/src/index.ts`（接入 bootstrap + createStores；本 Task 可先只换 users/sessions）

**Interfaces:**
- Consumes: `AppConfig.databaseUrl`
- Produces: `createPool(url): Pool`；`runMigrations(pool)`；`createAuthStores(config, pool?): { users, sessions }`；`PostgresUserStore` / `PostgresSessionStore` 实现现有 `UserStore` / `SessionStore`

- [ ] **Step 1: Add migration SQL**

```sql
-- apps/api/migrations/001_init.sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  thread_id UUID PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'apiKey')),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  prd JSONB,
  prd_markdown TEXT NOT NULL DEFAULT '',
  prototype_html TEXT NOT NULL DEFAULT '',
  error TEXT,
  gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_text TEXT NOT NULL DEFAULT '',
  structured_requirements JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage_daily (
  principal_key TEXT NOT NULL,
  day DATE NOT NULL,
  token_total BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_key, day)
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS tasks_expires_at_idx ON tasks (expires_at);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
```

- [ ] **Step 2: Implement pool + migrate**

```ts
// apps/api/src/db/pool.ts
import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}
```

```ts
// apps/api/src/db/migrate.ts
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { API_ROOT } from "../paths.js";

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const dir = path.join(API_ROOT, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const exists = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE id = $1`,
      [file],
    );
    if (exists.rowCount) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [
        file,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 3: Write PostgresUserStore test (skip without DB)**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { PostgresUserStore } from "../../src/auth/postgresUserStore.js";

const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("PostgresUserStore", () => {
  const pool = createPool(url!);
  const users = new PostgresUserStore(pool);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates and finds admin by username", async () => {
    const user = await users.ensureAdmin(
      `admin-${Date.now()}`,
      "test-password-not-for-prod",
    );
    const found = await users.findByUsername(user.username);
    expect(found?.id).toBe(user.id);
    expect(found?.role).toBe("admin");
  });
});
```

- [ ] **Step 4: Implement Postgres stores + factory**

`PostgresUserStore` / `PostgresSessionStore` 方法签名必须与 `UserStore` / `SessionStore` 一致（见 `apps/api/src/auth/types.ts`）。`create` 用 `randomUUID()` 写入 `id`。`SessionStore.get` 对过期行返回 `null` 并可删除。

```ts
// apps/api/src/auth/createStores.ts
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { MemorySessionStore } from "./memorySessionStore.js";
import { MemoryUserStore } from "./memoryUserStore.js";
import { PostgresSessionStore } from "./postgresSessionStore.js";
import { PostgresUserStore } from "./postgresUserStore.js";
import type { SessionStore, UserStore } from "./types.js";

export function createAuthStores(
  config: AppConfig,
  pool: Pool | null,
): { users: UserStore; sessions: SessionStore } {
  if (pool) {
    return {
      users: new PostgresUserStore(pool),
      sessions: new PostgresSessionStore(pool),
    };
  }
  return {
    users: new MemoryUserStore(),
    sessions: new MemorySessionStore(),
  };
}
```

- [ ] **Step 5: Wire `index.ts` bootstrap (users/sessions only)**

```ts
// 伪代码片段 — 替换 Memory* 硬编码
const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
if (pool) await runMigrations(pool);
const { users, sessions } = createAuthStores(config, pool);
await seedAdmin(users, config);
const app = await buildServer({ config, users, sessions });
```

- [ ] **Step 6: Run unit tests + optional DB test**

Run: `pnpm --filter @prd/api test`

Expected: 现有单测 PASS；有 `DATABASE_URL` 时 postgres store 测 PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations apps/api/src/db apps/api/src/auth apps/api/src/index.ts apps/api/tests/unit/postgresUserStore.test.ts
git commit -m "feat: add Postgres pool migrations and auth stores"
```

---

### Task 3: TaskStore + persist TaskService snapshots

**Files:**
- Create: `apps/api/src/services/taskStore.ts`
- Create: `apps/api/src/services/postgresTaskStore.ts`
- Create: `apps/api/tests/unit/memoryTaskStore.test.ts`
- Modify: `apps/api/src/services/taskService.ts`
- Modify: `apps/api/tests/unit/taskService.test.ts`
- Modify: `apps/api/src/server.ts` / `apps/api/src/index.ts`（注入 TaskStore）

**Interfaces:**
- Produces:

```ts
export interface TaskStore {
  save(task: TaskSnapshot): Promise<void>;
  get(threadId: string): Promise<TaskSnapshot | null>;
  delete(threadId: string): Promise<void>;
  listExpired(now: Date): Promise<TaskSnapshot[]>;
}
```

- Consumes: `TaskSnapshot` from `taskService.ts`
- `TaskService` 构造：`new TaskService({ runner?, store?, queue?, usage?, config? })`；每次 `create`/`applyUpdate`/终态调用 `store.save`

- [ ] **Step 1: Write MemoryTaskStore failing test**

```ts
import { describe, expect, it } from "vitest";
import { MemoryTaskStore } from "../../src/services/taskStore.js";

describe("MemoryTaskStore", () => {
  it("round-trips a task snapshot", async () => {
    const store = new MemoryTaskStore();
    const now = new Date().toISOString();
    const task = {
      threadId: "11111111-1111-1111-1111-111111111111",
      owner: { kind: "apiKey" as const },
      status: "queued" as const,
      progress: 0,
      prdMarkdown: "",
      prototypeHtml: "",
      gaps: [],
      config: {},
      extractedText: "",
      createdAt: now,
      updatedAt: now,
    };
    await store.save(task);
    expect(await store.get(task.threadId)).toEqual(task);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @prd/api test -- tests/unit/memoryTaskStore.test.ts`

- [ ] **Step 3: Implement MemoryTaskStore + interface in `taskStore.ts`**

- [ ] **Step 4: Implement `PostgresTaskStore`**

映射列：`owner_kind` / `owner_user_id`、`prd` jsonb、`gaps` jsonb、`config` jsonb、`expires_at`（非终态 `null`）。`save` 用 `INSERT ... ON CONFLICT (thread_id) DO UPDATE`。

- [ ] **Step 5: Refactor TaskService to use TaskStore**

关键改动点：

1. 删除 `private readonly tasks = new Map...`（或仅作缓存可选；推荐以 store 为准，进程内可保留 Map 加速 SSE，但 `getTask` 在 miss 时 `await store.get`）。
2. **推荐简单方案（YAGNI）：** 内存 Map 仍作热缓存；每次变更 `await this.store.save(snapshot)`；`getTask` 先 Map 再 `store.get` 并回填 Map。
3. `createTask` / `applyUpdate` / `cancelTask` / resume 路径全部 save。
4. 终态设置 `expiresAt`（扩展 `TaskSnapshot` 可选字段 `expiresAt?: string`）= `now + taskTtlMs`。

扩展类型：

```ts
export interface TaskSnapshot {
  // ...existing fields
  expiresAt?: string;
}
```

- [ ] **Step 6: Update existing taskService tests if constructors changed**

注入 `store: new MemoryTaskStore()`。

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @prd/api test`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/taskStore.ts apps/api/src/services/postgresTaskStore.ts apps/api/src/services/taskService.ts apps/api/src/server.ts apps/api/src/index.ts apps/api/tests/unit/memoryTaskStore.test.ts apps/api/tests/unit/taskService.test.ts
git commit -m "feat: persist task snapshots via TaskStore"
```

---

### Task 4: PostgresSaver checkpointer wiring

**Files:**
- Modify: `apps/api/src/graph/checkpointer.ts`
- Modify: `apps/api/src/graph/workflow.ts`
- Modify: `apps/api/src/db/bootstrap.ts`
- Modify: `apps/api/src/services/taskService.ts`（`LangGraphRunner` / `buildGraph` 注入 checkpointer）
- Create: `apps/api/tests/unit/checkpointerFactory.test.ts`

**Interfaces:**
- Produces: `async function createCheckpointer(pool: Pool | null): Promise<MemorySaver | PostgresSaver>`
- `buildGraph({ checkpointer, ...deps })` 使用注入的 checkpointer，不再内部 `createCheckpointer()` 无参调用

- [ ] **Step 1: Write factory test**

```ts
import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { createCheckpointer } from "../../src/graph/checkpointer.js";

describe("createCheckpointer", () => {
  it("returns MemorySaver when pool is null", async () => {
    const cp = await createCheckpointer(null);
    expect(cp).toBeInstanceOf(MemorySaver);
  });
});
```

- [ ] **Step 2: Run — expect FAIL（签名仍同步无参）**

- [ ] **Step 3: Implement**

```ts
// apps/api/src/graph/checkpointer.ts
import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";

export async function createCheckpointer(pool: Pool | null) {
  if (!pool) return new MemorySaver();
  const saver = new PostgresSaver(pool);
  await saver.setup();
  return saver;
}
```

```ts
// workflow.ts — compile 使用 deps.checkpointer ?? await 不可在同步 buildGraph
// 改为：buildGraph 要求传入已 setup 的 checkpointer
export function buildGraph(
  deps: GraphDependencies & { checkpointer: unknown } ,
) {
  // ...
  .compile({ checkpointer: deps.checkpointer });
}
```

`bootstrap.ts`：

```ts
export async function bootstrapPersistence(config: AppConfig) {
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  if (pool) await runMigrations(pool);
  const checkpointer = await createCheckpointer(pool);
  return { pool, checkpointer };
}
```

- [ ] **Step 4: Wire index → TaskService/LangGraphRunner with shared checkpointer**

确保同一 `pool` 实例用于 stores 与 `PostgresSaver`。

- [ ] **Step 5: Run unit tests**

Run: `pnpm --filter @prd/api test`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/graph apps/api/src/db/bootstrap.ts apps/api/src/index.ts apps/api/src/services/taskService.ts apps/api/tests/unit/checkpointerFactory.test.ts
git commit -m "feat: wire PostgresSaver when DATABASE_URL is set"
```

---

### Task 5: InProcessQueue concurrency limit

**Files:**
- Create: `apps/api/src/services/taskQueue.ts`
- Create: `apps/api/tests/unit/inProcessQueue.test.ts`
- Modify: `apps/api/src/services/taskService.ts`

**Interfaces:**
- Produces:

```ts
export interface TaskQueue {
  /** Run fn when a slot is available; resolves after fn completes. */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  get pending(): number;
  get active(): number;
}

export class InProcessQueue implements TaskQueue {
  constructor(private readonly maxConcurrent: number) {}
  // ...
}
```

- Comment in file: `// Future: RedisTaskQueue for multi-instance`

- [ ] **Step 1: Write queue test**

```ts
import { describe, expect, it } from "vitest";
import { InProcessQueue } from "../../src/services/taskQueue.js";

describe("InProcessQueue", () => {
  it("never runs more than maxConcurrent jobs", async () => {
    const queue = new InProcessQueue(2);
    let active = 0;
    let maxActive = 0;
    const job = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
    };
    await Promise.all([
      queue.schedule(job),
      queue.schedule(job),
      queue.schedule(job),
      queue.schedule(job),
    ]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement InProcessQueue**

用计数 + Promise 链/等待队列即可。

- [ ] **Step 4: Integrate into TaskService.execute**

`createTask` 后 `void this.queue.schedule(() => this.execute(request))`；超限时快照保持 `queued` 直到 slot 获得后改 `running` 并 SSE。

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter @prd/api test
git add apps/api/src/services/taskQueue.ts apps/api/src/services/taskService.ts apps/api/tests/unit/inProcessQueue.test.ts
git commit -m "feat: limit concurrent graph runs with InProcessQueue"
```

---

### Task 6: Daily token budget

**Files:**
- Create: `apps/api/src/services/usageStore.ts`
- Create: `apps/api/src/services/budget.ts`
- Create: `apps/api/tests/unit/budget.test.ts`
- Modify: `apps/api/src/services/taskService.ts`（create 前检查；节点后累加——若节点暂无 usage，先用可注入的 `usageEstimator` 或在 runner 更新时可选 `tokenDelta`）
- Modify: `apps/api/src/routes/generate.ts`（捕获 `BUDGET_EXCEEDED` → 429）

**Interfaces:**
- Produces:

```ts
export interface UsageStore {
  getTokens(principalKey: string, day: string): Promise<number>;
  addTokens(principalKey: string, day: string, delta: number): Promise<number>;
}

export function principalKey(principal: Principal): string;
export function utcDay(d?: Date): string; // YYYY-MM-DD
export async function assertWithinBudget(
  store: UsageStore,
  principalKey: string,
  budget: number,
): Promise<void>; // throws AppError BUDGET_EXCEEDED when budget > 0 && used >= budget
```

**YAGNI note:** 若当前 ChatOpenAI 调用未解析 token usage，本 Task 先实现 store + `assertWithinBudget` + 在 `createTask` 入口检查；并增加 `TaskService.recordTokenUsage(principalKey, tokens)` 供后续节点挂钩。可在 mock runner 测试中直接调用 `addTokens`。在 `generatePRD`/`extract`/`prototype` 节点用 `callbacks` 或返回值里的 usage **若易取则接上**；否则在 plan 执行时用保守估算（如每节点 +4000）并在代码注释标明可替换为真实 usage——优先真实 usage：检查 `AIMessage.usage_metadata`。

- [ ] **Step 1: Budget unit test**

```ts
it("throws BUDGET_EXCEEDED when usage reaches limit", async () => {
  const store = new MemoryUsageStore();
  await store.addTokens("key:api", "2026-09-03", 100);
  await expect(
    assertWithinBudget(store, "key:api", 100),
  ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
});

it("skips when budget is 0", async () => {
  const store = new MemoryUsageStore();
  await store.addTokens("key:api", "2026-09-03", 999_999);
  await expect(assertWithinBudget(store, "key:api", 0)).resolves.toBeUndefined();
});
```

- [ ] **Step 2–4: Implement Memory + Postgres UsageStore, budget helpers, wire createTask**

`PostgresUsageStore.addTokens`:

```sql
INSERT INTO usage_daily (principal_key, day, token_total)
VALUES ($1, $2::date, $3)
ON CONFLICT (principal_key, day)
DO UPDATE SET token_total = usage_daily.token_total + EXCLUDED.token_total
RETURNING token_total
```

- [ ] **Step 5: Run tests + commit**

```bash
git commit -m "feat: enforce daily token budget per principal"
```

---

### Task 7: TTL cleanup job

**Files:**
- Create: `apps/api/src/services/ttlCleanup.ts`
- Create: `apps/api/tests/unit/ttlCleanup.test.ts`
- Modify: `apps/api/src/index.ts`（`setInterval` 每小时；SIGTERM clearInterval）

**Interfaces:**
- Produces: `runTtlCleanup(args: { taskStore, sessionStore?, storage, checkpointer, now? }): Promise<{ tasksRemoved: number }>`
- 对每个过期 task：`storage` 无法枚举时，至少删 task 行；若 snapshot 含 `rawFiles` 路径则删文件——当前 `TaskSnapshot` 无 files 列表时：**删 tasks 行 + `checkpointer.deleteThread?.(threadId)`**（PostgresSaver 支持 `deleteThread`）
- Sessions：`DELETE FROM sessions WHERE expires_at < now()`（PostgresSessionStore 增 `deleteExpired()`）

- [ ] **Step 1: Test with MemoryTaskStore**

预置 `expiresAt` 在过去的任务 → cleanup 后 `get` 为 null。

- [ ] **Step 2: Implement + wire hourly timer in index**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: expire tasks sessions and checkpoints on TTL"
```

---

### Task 8: Dockerfile, compose (API only), README, graceful shutdown

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Modify: `README.md`
- Modify: `apps/api/src/index.ts`（SIGTERM：`app.close()`、`pool.end()`、停 TTL timer、停收新任务标志可选）

**Interfaces:**
- Compose 服务名 `api`；环境从 `.env`；volume `uploads_data:/app/uploads`；**无 postgres service**

- [ ] **Step 1: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@prd/api", "start"]
```

（若生产镜像需更瘦，可再拆只拷 `node_modules` 与 `dist`/`public/web`；本步以可运行为先。）

- [ ] **Step 2: compose.yaml**

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      NODE_ENV: production
    volumes:
      - uploads_data:/app/uploads
volumes:
  uploads_data:
```

- [ ] **Step 3: README 增加「生产部署」**

写明：外置 `DATABASE_URL`、进程 vs `docker compose up --build`、防火墙、C-0x 验收要点；**不要**写入真实密码。

- [ ] **Step 4: Graceful shutdown in index.ts**

```ts
const shutdown = async () => {
  clearInterval(ttlTimer);
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile compose.yaml .dockerignore README.md apps/api/src/index.ts
git commit -m "chore: add API Docker deploy docs for external Postgres"
```

---

### Task 9: Integration test AC-07 restart resume

**Files:**
- Create: `apps/api/tests/integration/restartResume.test.ts`
- Modify: `apps/api/vitest.config.ts`（若需把 integration 纳入或单独 script）

**Interfaces:**
- 仅当 `process.env.DATABASE_URL` 存在时运行
- Mock `TaskGraphRunner`：第一次 `create` 流式更新到 `awaiting_review` 并写 store；丢弃旧 `TaskService` 实例；新 `TaskService({ store: same PostgresTaskStore, runner })`；`getTask` 仍能读到；`resumeTask(approve)` 成功

- [ ] **Step 1: Write integration test**

```ts
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("AC-07 restart resume", () => {
  it("reloads awaiting_review task from Postgres after new TaskService", async () => {
    // bootstrap pool + migrations + PostgresTaskStore
    // service1.createTask → mock runner sets awaiting_review + store.save
    // service2 = new TaskService({ store, runner })
    // expect(service2.getTask(threadId)?.status).toBe("awaiting_review")
    // await service2.resumeTask(threadId, { action: "approve" })
  });
});
```

- [ ] **Step 2: Run without DB — skipped; with DB — PASS**

```bash
pnpm --filter @prd/api test
# 可选：
# DATABASE_URL=postgresql://prd:prd@10.0.0.15:5432/prd_generator pnpm --filter @prd/api test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test: cover AC-07 task resume after process restart"
```

---

## Spec Coverage Self-Review

| 设计项 | Task |
|---|---|
| DATABASE_URL / 生产强制 / 配置旋钮 | Task 1 |
| migrations + users/sessions PG | Task 2 |
| tasks 持久化 + TaskService | Task 3 |
| PostgresSaver | Task 4 |
| 进程内队列 | Task 5 |
| usage_daily + 日预算 | Task 6 |
| TTL 清理 | Task 7 |
| Dockerfile / compose / README / SIGTERM | Task 8 |
| AC-07 集成测 | Task 9 |
| 不做 Redis/S3/内嵌 PG | 全局约束 + Task 8 compose |

## Placeholder Scan

无 TBD；预算节点真实 usage 在 Task 6 标明优先 `usage_metadata`，否则可注入累加 API，避免阻塞。

## Type Consistency

- `TaskSnapshot.threadId` / LangGraph `thread_id` / `tasks.thread_id` 同一 UUID 字符串
- `UserStore` / `SessionStore` 接口不变
- `AppConfig.databaseUrl: string | null`
- 错误码：`BUDGET_EXCEEDED`、既有 `AUTH_*` / `TASK_*`

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-phase-c-postgres-impl.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 Task 派生子代理，Task 间审查，迭代快

**2. Inline Execution** — 本会话按 executing-plans 连续执行，设检查点

**Which approach?**
