# PRD 与原型生成系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 TypeScript + Fastify + LangGraph.js 服务，将多模态零散需求自动转化为结构化 PRD 与可交互 HTML 原型，并提供 SSE、人工审阅与极简预览页。

**Architecture:** Fastify 接收上传并将文件落入 `uploads/`（Storage 抽象，生产可换 S3）；LangGraph StateGraph 编排 parse → extract → generate_prd →（可选 interrupt）→ generate_prototype；State 只存路径与结构化结果；API 以异步 `threadId` + SSE 推送进度；静态 `public/` 提供上传/预览 UI。

**Tech Stack:** Node.js 22+、TypeScript 5.x ESM、Fastify 5、@langchain/langgraph、@langchain/openai、Zod、Vitest、markitdown-node（+ 降级解析器）

**Spec:** `docs/superpowers/specs/2026-09-02-prd-generator-requirements.md`（v1.2 已冻结）

## Global Constraints

- 默认语言 `zh-CN`；默认模型 PRD/原型 `gpt-4o`，抽取 `gpt-4o-mini`；均可被 `options` / 环境变量覆盖
- 人机审阅：实现完整，默认 `enableHumanReview=false`
- 单文件 ≤ 50MB，合计 ≤ 200MB，文件数 ≤ 20；MIME 白名单
- Graph State **禁止**存文件二进制，只存 `storageKey` / 路径
- 密钥仅环境变量；日志脱敏
- 包管理：pnpm（`packageManager: pnpm@11.25.0`）；`"type": "module"`；提交 `pnpm-lock.yaml` + `pnpm-workspace.yaml`（`allowBuilds.esbuild`）；不使用 npm / `package-lock.json`
- 若本机 NVM 拦截 `pnpm`（NVM4306），可用：`node $(dirname $(which node))/../installs/<ver>/node_modules/corepack/dist/pnpm.js`，或先 `nvm reshim` 信任 pnpm 入口
- 本期不做：实时 ASR、墨刀深度集成、多租户计费、生产 OCR（无文本 PDF 返回明确错误即可）
- 测试框架：Vitest；涉及 LLM 的单测用 mock model

## File Map（将创建）

```
prd-generator/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── config.ts
│   ├── types/index.ts
│   ├── schemas/prdSchema.ts
│   ├── schemas/apiSchema.ts
│   ├── storage/types.ts
│   ├── storage/localStorage.ts
│   ├── storage/index.ts
│   ├── parsers/types.ts
│   ├── parsers/textParser.ts
│   ├── parsers/documentParser.ts
│   ├── parsers/voiceParser.ts
│   ├── parsers/index.ts
│   ├── prompts/prdPrompt.ts
│   ├── prompts/extractPrompt.ts
│   ├── prompts/prototypePrompt.ts
│   ├── graph/state.ts
│   ├── graph/checkpointer.ts
│   ├── graph/nodes/parseMultimodal.ts
│   ├── graph/nodes/extractRequirements.ts
│   ├── graph/nodes/generatePRD.ts
│   ├── graph/nodes/generatePrototype.ts
│   ├── graph/workflow.ts
│   ├── services/taskService.ts
│   ├── services/sse.ts
│   ├── routes/health.ts
│   ├── routes/generate.ts
│   ├── routes/thread.ts
│   ├── middleware/auth.ts
│   ├── middleware/rateLimit.ts
│   ├── utils/logger.ts
│   ├── utils/errors.ts
│   └── utils/htmlValidate.ts
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── tests/
│   ├── unit/prdSchema.test.ts
│   ├── unit/textParser.test.ts
│   ├── unit/documentParser.test.ts
│   ├── unit/htmlValidate.test.ts
│   ├── unit/workflow.mock.test.ts
│   └── fixtures/sample-requirements.txt
└── uploads/.gitkeep
```

**本期计划范围：** 规格阶段 A（MVP）+ 阶段 B（人机审阅、导出、极简前端、API Key 限流）。阶段 C（Postgres Checkpointer、Docker、日预算）留作后续 plan，本 plan 末尾仅列接口预留。

---

### Task 1: 项目骨架与配置

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `src/config.ts`, `src/utils/logger.ts`, `src/utils/errors.ts`, `src/index.ts`, `uploads/.gitkeep`

**Interfaces:**
- Produces: `loadConfig(): AppConfig`；`logger`；`AppError`；pnpm scripts `dev` / `test` / `build`

- [ ] **Step 1: 初始化 package.json 与 tsconfig**

```json
{
  "name": "prd-generator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: 安装依赖**

Run:

```bash
pnpm add fastify @fastify/multipart @fastify/static @fastify/cors dotenv zod pino pino-pretty uuid
pnpm add langchain @langchain/core @langchain/openai @langchain/langgraph @langchain/langgraph-checkpoint
pnpm add -D typescript tsx vitest @types/node @types/uuid
```

若 `markitdown-node` 安装失败，先跳过，Task 4 用降级库 `mammoth` `pdf-parse` 等顶上，并在 `documentParser` 注明。

- [ ] **Step 3: 实现 config / logger / errors**

`src/config.ts` 至少包含：

```ts
export type AppConfig = {
  port: number;
  apiKey: string;
  openaiApiKey: string;
  extractModel: string;
  prdModel: string;
  uploadDir: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  langsmithTracing: boolean;
};

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    apiKey: process.env.API_KEY ?? "dev-api-key",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    extractModel: process.env.EXTRACT_MODEL ?? "gpt-4o-mini",
    prdModel: process.env.PRD_MODEL ?? "gpt-4o",
    uploadDir: process.env.UPLOAD_DIR ?? "uploads",
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
    maxFiles: 20,
    langsmithTracing: process.env.LANGSMITH_TRACING === "true",
  };
}
```

`.env.example`:

```env
PORT=3000
API_KEY=dev-api-key
OPENAI_API_KEY=
EXTRACT_MODEL=gpt-4o-mini
PRD_MODEL=gpt-4o
UPLOAD_DIR=uploads
LANGSMITH_TRACING=false
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=prd-generator
```

- [ ] **Step 4: 入口占位**

`src/index.ts` 加载 dotenv + config，`console.log` 端口；真正 listen 在 Task 7 接上 `buildServer`。

- [ ] **Step 5: 跑通空测试配置**

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Run: `npx vitest run`  
Expected: 无测试文件时 exit 0 或 “No test files found”（随后 Task 2 会有测试）

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .env.example .gitignore src uploads/.gitkeep
git commit -m "chore: scaffold TypeScript project and config"
```

---

### Task 2: PRD Zod Schema 与类型

**Files:**
- Create: `src/schemas/prdSchema.ts`, `src/types/index.ts`, `tests/unit/prdSchema.test.ts`

**Interfaces:**
- Produces: `PRDSchema`（Zod）、`type PRD = z.infer<typeof PRDSchema>`、`GenerateOptionsSchema`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/prdSchema.test.ts
import { describe, it, expect } from "vitest";
import { PRDSchema } from "../../src/schemas/prdSchema.js";

describe("PRDSchema", () => {
  it("accepts a minimal valid PRD", () => {
    const parsed = PRDSchema.parse({
      title: "示例",
      version: "0.1.0",
      date: "2026-09-02",
      language: "zh-CN",
      background: "背景",
      objectives: ["目标1"],
      targetUsers: ["产品经理"],
      assumptions: [],
      outOfScope: [],
      functionalRequirements: [
        {
          id: "FR-001",
          name: "上传",
          description: "上传需求文件",
          priority: "P0",
          userValue: "节省整理时间",
          acceptanceCriteria: ["可上传 docx"],
          sourceIds: ["src-1"],
        },
      ],
      nonFunctionalRequirements: [],
      userStories: [],
      userFlows: [],
      openQuestions: [],
      technicalConsiderations: [],
      prototypeDescription: "首页+上传页",
    });
    expect(parsed.title).toBe("示例");
  });

  it("rejects invalid priority", () => {
    expect(() =>
      PRDSchema.parse({
        title: "x",
        version: "0.1.0",
        date: "2026-09-02",
        language: "zh-CN",
        background: "b",
        objectives: [],
        targetUsers: [],
        assumptions: [],
        outOfScope: [],
        functionalRequirements: [
          {
            id: "FR-001",
            name: "n",
            description: "d",
            priority: "P9",
            userValue: "v",
            acceptanceCriteria: ["a"],
            sourceIds: [],
          },
        ],
        nonFunctionalRequirements: [],
        userStories: [],
        userFlows: [],
        openQuestions: [],
        technicalConsiderations: [],
        prototypeDescription: "p",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run 确认失败**

Run: `npx vitest run tests/unit/prdSchema.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 Schema（对齐规格 §3.3.1）**

在 `src/schemas/prdSchema.ts` 用 Zod 完整定义规格中的 `PRD` 字段；`priority` 为 `z.enum(["P0","P1","P2"])`；`language` 为 `z.enum(["zh-CN","en-US"])`。

- [ ] **Step 4: Run 确认通过**

Run: `npx vitest run tests/unit/prdSchema.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas/prdSchema.ts src/types/index.ts tests/unit/prdSchema.test.ts
git commit -m "feat: add PRD Zod schema and types"
```

---

### Task 3: Storage 抽象（本地 uploads）

**Files:**
- Create: `src/storage/types.ts`, `src/storage/localStorage.ts`, `src/storage/index.ts`
- Test: `tests/unit/localStorage.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StoredFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  absolutePath: string;
}

export interface Storage {
  save(input: { buffer: Buffer; originalName: string; mimeType: string }): Promise<StoredFile>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}
```

- [ ] **Step 1: 写测试** — 保存再读回 buffer 内容一致；非法 key `remove` 不抛未捕获异常（或抛 `AppError` 可断言）

- [ ] **Step 2: 实现 `LocalStorage`** — 根目录 `config.uploadDir`；文件名用 `uuid` + 保留扩展名；禁止 `..` 路径穿越

- [ ] **Step 3: `createStorage()` 工厂当前只返回 LocalStorage**（注释预留 S3）

- [ ] **Step 4: 测试通过后 Commit**

```bash
git commit -m "feat: add local file storage abstraction"
```

---

### Task 4: 多模态解析器

**Files:**
- Create: `src/parsers/types.ts`, `textParser.ts`, `documentParser.ts`, `voiceParser.ts`, `index.ts`
- Test: `tests/unit/textParser.test.ts`, `tests/unit/documentParser.test.ts`
- Create: `tests/fixtures/sample-requirements.txt`

**Interfaces:**
- Produces:

```ts
export type ParseFragment = {
  sourceId: string;
  fileName?: string;
  mimeType?: string;
  excerpt: string;
  charCount: number;
  parseStatus: "ok" | "partial" | "failed";
  errorMessage?: string;
};

export type ParseResult = {
  extractedText: string;
  fragments: ParseFragment[];
  warnings: string[];
};

export function parseInputs(args: {
  files: StoredFile[];
  textDescription?: string;
  transcribe?: (file: StoredFile) => Promise<string>;
}): Promise<ParseResult>;
```

- [ ] **Step 1: textParser 测试** — UTF-8 txt 合并；可选 GBK 样例若方便

- [ ] **Step 2: documentParser** — 优先尝试 `markitdown-node`；失败则：
  - docx → `mammoth.extractRawText`
  - pdf → `pdf-parse`
  - pptx → 用 `jszip` 读 `ppt/slides/slide*.xml` 抽文本（可简化）
  - xlsx → 可先标 `partial` + warning「暂以 CSV/markdown 降级或跳过」，或加 `xlsx` 包

- [ ] **Step 3: voiceParser** — 封装 Whisper：通过 `@langchain/openai` 或 OpenAI SDK `audio.transcriptions.create`；单测 mock `transcribe`

- [ ] **Step 4: `parseInputs` 聚合** — 全部失败则 `extractedText === ""` 且 warnings 含说明；部分失败不阻断

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add multimodal parsers with fallbacks"
```

---

### Task 5: Graph State、节点与工作流

**Files:**
- Create: `src/graph/state.ts`, `checkpointer.ts`, `nodes/*.ts`, `workflow.ts`, `prompts/*.ts`, `utils/htmlValidate.ts`
- Test: `tests/unit/htmlValidate.test.ts`, `tests/unit/workflow.mock.test.ts`

**Interfaces:**
- Produces: `buildGraph(deps)`, `compiledGraph`；节点更新部分 State

State 字段对齐规格：`rawFiles`, `fragments`, `extractedText`, `gaps`, `structuredRequirements`, `prd`, `prdMarkdown`, `prototypeHtml`, `status`, `progress`, `error`, `userEdits`, `config`

- [ ] **Step 1: `htmlValidate.ts`** — 检查含 `<!DOCTYPE html` 或 `<html`、`</html>`；导出 `assertPrototypeHtml(html: string): { ok: boolean; reason?: string }`

- [ ] **Step 2: 用 `Annotation.Root` 定义 State**（reducer 规则：数组 concat 仅 `rawFiles`/`fragments`；其余 overwrite）

- [ ] **Step 3: 实现四节点**（依赖注入 model，便于测试）

  - `parseMultimodal` → 调 `parseInputs`
  - `extractRequirements` → 廉价模型 + JSON；产出 `gaps: string[]`
  - `generatePRD` → `withStructuredOutput(PRDSchema)`；失败重试 2 次；再生成 `prdMarkdown`
  - `generatePrototype` → 生成 HTML；`assertPrototypeHtml` 失败则重试 1 次

- [ ] **Step 4: 条件边**

  - 解析后若无文本 → `failed` END
  - `requireClarification && gaps.length` → 设 `awaiting_clarification` 并 END（或 interrupt）
  - `enableHumanReview` → PRD 后 `interrupt` / 自定义等待状态（LangGraph `interrupt` API；若版本不熟，可用外部 `taskService` 在 PRD 后暂停不调原型节点，语义等价）
  - `skipPrototype` → PRD 后 END

- [ ] **Step 5: MemorySaver checkpointer；`compile({ checkpointer })`**

- [ ] **Step 6: mock 测试** — 不调真实 OpenAI：注入 fake nodes 或 mock `ChatOpenAI`，断言从 parse 到 completed 状态迁移（至少测 parse 全失败短路）

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: implement LangGraph PRD generation workflow"
```

---

### Task 6: TaskService + SSE 工具

**Files:**
- Create: `src/services/taskService.ts`, `src/services/sse.ts`
- Create: `src/schemas/apiSchema.ts`

**Interfaces:**
- Produces:

```ts
createTask(input): Promise<{ threadId: string }>
getTask(threadId): TaskSnapshot | undefined
resumeTask(threadId, body): Promise<void>
regenerate(threadId, target: "prd" | "prototype"): Promise<void>
cancelTask(threadId): Promise<void>
subscribe(threadId, send: (event, data) => void): Unsubscribe
```

- [ ] **Step 1: 内存 `Map<threadId, TaskSnapshot>`** 存状态副本（除 checkpoint 外便于 GET）

- [ ] **Step 2: `runGraph` 使用 `graph.astream(..., { streamMode: "updates" })`，每步更新 snapshot 并 fan-out SSE**

- [ ] **Step 3: SSE helper** 写标准头与 `event:`/`data:` 行；`done`/`error` 事件对齐规格 §3.5.3

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add task service and SSE helpers"
```

---

### Task 7: Fastify 路由、鉴权、限流

**Files:**
- Create: `src/server.ts`, `src/routes/health.ts`, `generate.ts`, `thread.ts`, `middleware/auth.ts`, `middleware/rateLimit.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: TaskService、Storage、config
- Produces: `buildServer(): FastifyInstance`

- [ ] **Step 1: `auth` 中间件** — 校验 `Authorization: Bearer <API_KEY>`；`/api/health` 与静态页除外

- [ ] **Step 2: 简易令牌桶限流** — 通用 20/min，`/api/generate*` 5/min（按 API Key）

- [ ] **Step 3: 路由**

  - `GET /api/health` → `{ ok: true }`
  - `POST /api/generate` multipart：校验大小/类型 → storage.save → createTask → 默认返回 `{ threadId, status: "queued" }`
  - `POST /api/generate/stream` → 同上并挂 SSE
  - `GET /api/thread/:threadId`
  - `GET /api/thread/:threadId/stream`
  - `POST /api/thread/:threadId/resume` — `{ action, prdPatch?, feedback?, clarificationText? }`
  - `POST /api/thread/:threadId/regenerate` — `{ target: "prd"|"prototype" }`
  - `DELETE /api/thread/:threadId`
  - `GET /api/thread/:threadId/export/prd.md`
  - `GET /api/thread/:threadId/export/prototype.html`

- [ ] **Step 4: `@fastify/static` 挂载 `public/`**

- [ ] **Step 5: 手工冒烟**

```bash
pnpm run dev
curl -s http://localhost:3000/api/health
curl -s -H "Authorization: Bearer dev-api-key" -F "textDescription=做一个待办App" http://localhost:3000/api/generate
```

Expected: health ok；generate 返回 threadId（无 key 时 LLM 节点可能 fail，但路由应 200/queued）

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: expose Fastify generate/thread APIs with auth"
```

---

### Task 8: 极简前端预览页

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/styles.css`

**Interfaces:**
- Consumes: 浏览器调 API（需在页面可配置或写死开发用 API Key 输入框）

- [ ] **Step 1: UI 区块** — API Key 输入、多文件选择、文本框、选项（人机审阅 checkbox、跳过原型）、开始按钮、进度日志、PRD Markdown/`<pre>` JSON、原型 `iframe sandbox="allow-scripts"`

- [ ] **Step 2: 用 fetch + ReadableStream 解析 SSE**（或 `EventSource` 仅适用于 GET；生成用 POST stream 手写解析）

- [ ] **Step 3: awaiting_review 时显示「批准 / 提交修改」表单，调 resume

- [ ] **Step 4: 提供导出链接按钮（拼 export URL + Authorization 不便时改为先 GET JSON 再 blob 下载）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add minimal upload and preview UI"
```

---

### Task 9: Markdown 导出与 PRD→MD 渲染

**Files:**
- Create: `src/utils/prdToMarkdown.ts`
- Test: `tests/unit/prdToMarkdown.test.ts`
- Modify: generatePRD 节点与 export 路由使用该函数

- [ ] **Step 1: 固定章节顺序渲染**（背景/目标/用户/功能/NFR/用户故事/流程/待确认/技术考量）

- [ ] **Step 2: 测试快照或关键标题存在**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: render PRD JSON to Markdown export"
```

---

### Task 10: 端到端样例与 README

**Files:**
- Create: `README.md`, `tests/fixtures/sample-requirements.txt`
- Modify: 如需 `.gitignore` 忽略 `uploads/*` 保留 `.gitkeep`

- [ ] **Step 1: fixture 文本** 写一段「内部待办协作工具」需求（中文，含角色与 3+ 功能）

- [ ] **Step 2: README** — 环境变量、启动、curl 示例、人机审阅用法、目录说明；指向规格与本 plan

- [ ] **Step 3: 若有 OPENAI_API_KEY，手工跑通一次完整生成并记录注意点到 README「验收」**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: add README and sample fixture"
```

---

### Task 11: 阶段 C 预留（本 plan 不实现，只留扩展点）

**Files:**
- Modify: `src/graph/checkpointer.ts`, `src/storage/index.ts`（注释 + 工厂分支）

- [ ] **Step 1: checkpointer 工厂**

```ts
export async function createCheckpointer() {
  if (process.env.CHECKPOINT_POSTGRES_URL) {
    // TODO(phase-C): PostgresSaver.fromConnString(...)
    throw new Error("Postgres checkpointer not implemented yet");
  }
  return new MemorySaver();
}
```

- [ ] **Step 2: Storage 工厂注释 S3 环境变量 `S3_BUCKET` 等**

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: reserve phase-C checkpointer and S3 hooks"
```

---

## Spec Coverage Self-Review

| 规格项 | 对应 Task |
|---|---|
| 多模态解析 + 降级 | Task 4 |
| LangGraph 四节点 + 状态 | Task 5 |
| PRD Schema / 结构化输出 | Task 2, 5 |
| 原型 HTML + 校验 | Task 5 |
| Fastify API / SSE / export | Task 6, 7, 9 |
| 人机审阅 / resume / regenerate | Task 5, 6, 7, 8 |
| 本地 uploads + 抽象 | Task 3, 11 |
| API Key + 限流 | Task 7 |
| 极简前端 | Task 8 |
| 默认模型 / zh-CN | Task 1 Global + config |
| Postgres / Docker / 日预算 | Task 11 预留，**不在本 plan 交付** |

## Placeholder Scan

无 TBD 实现步骤；阶段 C 明确标为后续 plan。

## Type Consistency

- 统一 `threadId: string`、`StoredFile`、`ParseResult`、`PRD`
- 状态 `status` 枚举与规格一致
- 路由路径与规格 §3.5.1 一致

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-prd-generator-impl.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每任务派一个子代理，任务间复查，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 连续执行，设检查点  

你更倾向哪一种？
