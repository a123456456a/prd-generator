# PRD 与原型生成系统 — 详细需求规格说明书

| 项 | 内容 |
|---|---|
| 文档版本 | v1.2 |
| 日期 | 2026-09-02 |
| 来源 | DeepSeek 分享对话整理 + 缺口补强 |
| 状态 | 已确认（按推荐项冻结） |

---

## 1. 项目概述

### 1.1 背景

产品经理、需求分析人员日常收到大量零散、非结构化客户输入：语音纪要、Word、PPT、PDF、聊天记录文本等。人工整理成规范 PRD，再做成可演示原型，成本高、周期长、质量依赖个人经验。

本项目构建 **AI 驱动的自动化需求分析服务**：接入多模态输入，经可控、可观测的多步工作流，输出结构化 PRD 与可交互 HTML 原型，并支持人工审阅与迭代修正。

### 1.2 一句话目标

> 用户上传/粘贴零散需求材料 → 系统自动生成可编辑的 PRD + 可预览的交互原型 → 支持流式进度、断点续传与二次精炼。

### 1.3 目标用户

| 角色 | 核心诉求 |
|---|---|
| 产品经理 | 快速把会议/客户材料变成可评审 PRD |
| 需求分析 | 功能拆解、用户故事、验收标准完整 |
| 初创/敏捷团队 | 少人力、快速出可演示原型对齐预期 |

### 1.4 成功标准（可验收）

1. 同一批样例输入（含语音 + Word + PPT）能稳定跑通端到端流程，产出 PRD JSON/Markdown 与单文件 HTML 原型。
2. 流式接口能按节点推送进度；任务中断后可用 `threadId` 恢复。
3. PRD 必填字段齐全（见 §3.3），可用 Zod 校验通过率 ≥ 95%（对标准样例集）。
4. 原型可在主流浏览器直接打开，具备至少 2 个页面切换与 3 类交互（按钮/表单/状态切换）。
5. 密钥不入库、不上日志明文；上传类型与大小限制生效。

---

## 2. 范围界定

### 2.1 本期 In Scope（MVP + 一期）

- TypeScript 全栈后端：Node.js + Fastify + LangChain.js + LangGraph.js
- 多模态文件解析（语音文件、docx、pptx、pdf、txt、xlsx）
- 四段式（可扩展）工作流：解析 → 结构化 → PRD → 原型
- REST + SSE API
- Checkpoint（开发 Memory，生产 Postgres/Redis）
- 人工审阅钩子：允许在 PRD 生成后暂停，用户编辑再继续生成原型
- 导出：PRD 为 Markdown / JSON；原型为 HTML 文件下载
- 基础鉴权（API Key）、限流、结构化日志、LangSmith 追踪

### 2.2 Out of Scope（明确不做 / 二期）

| 暂不做 | 说明 | 后续入口 |
|---|---|---|
| 独立移动端 App | 一期做响应式 Web；API 保持可复用 | 二期 `apps/mobile`（默认倾向 Capacitor） |
| 墨刀等外部原型平台深度集成 | 先以 HTML 原型为主 | 预留 Adapter |
| 实时通话流式 ASR | 本期仅文件上传语音 | 后续加 WebSocket |
| 多人实时协同编辑 | 本期单线程任务 + 导出再编辑 | 二期 |
| 自动写代码/脚手架生成 | 只出 PRD + 原型，不出工程代码 | 远期 |
| 多租户计费系统 | 仅预留 `tenantId` 字段 | 二期 |

---

## 3. 功能需求（详细）

### 3.1 多模态输入解析模块（FR-INPUT）

#### 3.1.1 功能描述

接收用户上传的一个或多个文件及可选文本说明，按类型解析，合并为统一「需求素材文本」（Markdown 优先），并保留来源溯源元数据。

#### 3.1.2 输入格式与处理策略

| 格式 | 解析方式 | 输出 | 失败策略 |
|---|---|---|---|
| `.mp3` `.wav` `.m4a` `.webm` | Whisper API 转录 | 带时间戳可选的纯文本 | 标记该文件失败，其余继续；任务可降级为「部分成功」 |
| `.docx` | markitdown-node（或备用 mammoth） | Markdown | 同上 |
| `.pptx` | markitdown-node | 按页 Markdown | 同上 |
| `.pdf` | markitdown-node；扫描件可降级提示「可能无文本」 | Markdown | 无文本时提示用户补文字说明 |
| `.txt` `.md` | 直接读取（UTF-8，失败试 GBK） | 原文 | 编码失败则报错该文件 |
| `.xlsx` | markitdown-node 表格 | Markdown 表格 | 超大表截断并注明 |
| 纯文本字段 `textDescription` | 直接并入 | 原文 | — |

#### 3.1.3 溯源元数据（必须保留）

每个片段携带：

```ts
{
  sourceId: string;      // 文件或文本块 ID
  fileName?: string;
  mimeType?: string;
  excerpt: string;       // 提取内容
  charCount: number;
  parseStatus: "ok" | "partial" | "failed";
  errorMessage?: string;
}
```

后续 PRD 功能点应尽量关联 `sourceIds`，便于人工核对「需求从哪来」。

#### 3.1.4 统一解析接口

对外提供 `parseInputs(files, text) → { extractedText, fragments, warnings[] }`，工作流节点只依赖该接口，不感知具体库。

---

### 3.2 LangGraph 工作流引擎（FR-GRAPH）

#### 3.2.1 主流程

```
START
  → parse_multimodal          # 解析
  → clarify_or_extract        # 完整性检查 + 需求结构化（可条件分支）
  → generate_prd              # 生成 PRD
  → [可选 interrupt] human_review   # 人工确认/编辑
  → generate_prototype        # 生成原型
END
```

MVP 可将 `clarify_or_extract` 与 `human_review` 做成可配置开关：默认开结构化、人工审阅默认关（API 参数打开）。

#### 3.2.2 状态定义（逻辑字段）

| 字段 | 类型 | 说明 |
|---|---|---|
| `rawFiles` | 元数据列表 | 不含大文件二进制；文件存对象存储/本地 uploads |
| `fragments` | 溯源片段[] | 见上 |
| `extractedText` | string | 合并文本 |
| `gaps` | string[] | 缺失信息清单（如无目标用户、无优先级） |
| `structuredRequirements` | object | 结构化需求 JSON |
| `prd` | object | 符合 PRD Schema |
| `prdMarkdown` | string | 便于阅读/导出 |
| `prototypeHtml` | string | 单文件 HTML |
| `status` | enum | 见下 |
| `progress` | { node, percent, message } | SSE 用 |
| `error` | { code, message, node?, retryable } | 错误 |
| `userEdits` | object | 人工覆盖内容 |
| `threadId` | string | 会话/任务 ID |
| `config` | object | 模型、是否人工审阅、语言等 |

**status 枚举：**  
`queued` → `parsing` → `extracting` → `awaiting_clarification` → `generating_prd` → `awaiting_review` → `generating_prototype` → `completed` | `failed` | `cancelled`

#### 3.2.3 条件分支

1. **信息不足**：若 `gaps` 非空且用户开启 `requireClarification`，进入 `awaiting_clarification`，返回问题列表，待用户补充文本后再 `resume`。
2. **解析全失败**：直接 `failed`，不调用昂贵 LLM。
3. **跳过原型**：`skipPrototype=true` 时 PRD 完成后 END。
4. **仅重生原型**：已有 PRD 时从 `generate_prototype` 切入。

#### 3.2.4 节点职责与输入输出

| 节点 | 输入 | 输出 | 超时建议 |
|---|---|---|---|
| parse_multimodal | 文件路径/ID | fragments, extractedText, warnings | 120s |
| extract_requirements | extractedText | structuredRequirements, gaps | 60s |
| generate_prd | structured + userEdits | prd, prdMarkdown | 90s |
| generate_prototype | prd | prototypeHtml | 120s |

每个节点必须：写 `progress`、捕获异常写入 `error`、可重试节点标记 `retryable`。

---

### 3.3 PRD 生成模块（FR-PRD）

#### 3.3.1 输出 Schema（规范）

```ts
interface PRD {
  title: string;
  version: string;               // 如 "0.1.0"
  date: string;                  // ISO 日期
  language: "zh-CN" | "en-US";
  background: string;
  objectives: string[];
  targetUsers: string[];
  assumptions: string[];         // 假设与前提
  outOfScope: string[];          // 明确不做
  functionalRequirements: Array<{
    id: string;                  // FR-001
    name: string;
    description: string;
    priority: "P0" | "P1" | "P2";
    userValue: string;
    acceptanceCriteria: string[]; // Given/When/Then 或条目列表
    sourceIds: string[];         // 溯源
  }>;
  nonFunctionalRequirements: Array<{
    id: string;
    category: "performance" | "security" | "reliability" | "usability" | "other";
    description: string;
  }>;
  userStories: Array<{
    id: string;
    asA: string;
    iWant: string;
    soThat: string;
    relatedFrIds: string[];
  }>;
  userFlows: Array<{
    name: string;
    steps: string[];
  }>;
  openQuestions: string[];       // 仍需业务确认的问题
  technicalConsiderations: string[];
  prototypeDescription: string;  // 给原型节点的页面/交互摘要
}
```

#### 3.3.2 质量要求

- 使用 `withStructuredOutput(ZodSchema)`，校验失败自动重试 ≤ 2 次（带校验错误反馈）。
- 功能需求至少 3 条（输入过短时在 `openQuestions` 中说明依据不足，仍输出草稿并标 `draftQuality: "low"`）。
- P0 必须有可测试的验收标准（≥ 1 条）。
- 禁止编造输入中完全不存在的业务事实；不确定写入 `assumptions` / `openQuestions`。

#### 3.3.3 导出

- `GET` 结果中同时提供 `prd`（JSON）与 `prdMarkdown`。
- Markdown 模板固定章节顺序，便于贴进飞书/Notion。

---

### 3.4 原型生成模块（FR-PROTO）

#### 3.4.1 输出要求

| 要求 | 细则 |
|---|---|
| 形态 | 单文件 HTML，CSS/JS 内联 |
| 导航 | 至少覆盖 `prototypeDescription` / 用户流程中的主路径页面 |
| 交互 | 按钮切换视图、简单表单校验提示、列表增删或状态切换至少一类 |
| 文案 | 全部来自 PRD，禁止占位「Lorem」 |
| 适配 | 桌面优先，移动端可基本浏览（media query） |
| 安全 | 不引入外部脚本 CDN（避免预览环境联网依赖）；不内嵌用户上传的可执行内容 |
| 体积 | 建议 &lt; 1.5MB；超限则简化样式并告警 |

#### 3.4.2 生成策略

1. 先由 PRD 抽出「页面清单 + 组件清单」中间结构（可再加一节点 `plan_prototype`，MVP 可内嵌在 prompt）。
2. 再生成 HTML；若 HTML 过短/缺 `</html>` 等，自动修复重试 1 次。
3. 可选：服务端用无头浏览器做冒烟（打开是否 200、是否有点击目标）——二期。

---

### 3.5 Fastify API 服务（FR-API）

#### 3.5.1 端点一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/generate` | 同步/异步提交（默认异步返回 `threadId`） |
| `POST` | `/api/generate/stream` | multipart + SSE 推送节点进度与最终结果 |
| `GET` | `/api/thread/:threadId` | 状态与当前产物 |
| `GET` | `/api/thread/:threadId/stream` | 订阅已有任务进度 |
| `POST` | `/api/thread/:threadId/resume` | 补充澄清信息 / 提交人工编辑后继续 |
| `POST` | `/api/thread/:threadId/regenerate` | 局部重生：`prd` \| `prototype` |
| `DELETE` | `/api/thread/:threadId` | 取消运行中任务或删除结果 |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/thread/:threadId/export/prd.md` | 下载 Markdown |
| `GET` | `/api/thread/:threadId/export/prototype.html` | 下载原型 |

#### 3.5.2 `POST /api/generate` 请求（逻辑字段）

```ts
{
  files: File[];                 // multipart
  textDescription?: string;
  options?: {
    language?: "zh-CN" | "en-US";
    model?: string;              // 覆盖默认模型
    requireClarification?: boolean;
    enableHumanReview?: boolean;
    skipPrototype?: boolean;
    async?: boolean;             // 默认 true
  };
}
```

**响应（异步）：** `{ threadId, status: "queued" }`  
**响应（同步，仅短任务/测试）：** 完整结果；超时则建议客户端改异步。

#### 3.5.3 SSE 事件约定

```text
event: progress
data: {"node":"generate_prd","percent":60,"message":"正在生成功能列表"}

event: status
data: {"status":"awaiting_review"}

event: result
data: {"prd":{...},"prdMarkdown":"...","prototypeHtml":"..."}

event: error
data: {"code":"LLM_TIMEOUT","message":"...","retryable":true}

event: done
data: {"threadId":"...","status":"completed"}
```

#### 3.5.4 鉴权与限流

- Header：`Authorization: Bearer <API_KEY>`（一期）
- 限流：按 API Key 令牌桶（默认 20 次/分钟；生成类 5 次/分钟）
- 可选 `Idempotency-Key`：相同 Key 60s 内返回同一 `threadId`

---

### 3.6 Checkpoint 与任务生命周期（FR-CKPT）

| 环境 | 实现 | 说明 |
|---|---|---|
| 开发 | MemorySaver | 进程重启丢失，可接受 |
| 生产 | PostgresSaver（推荐）或 RedisSaver | 多实例共享 |

能力：

- `thread_id` 关联一次用户任务
- 中断后 `resume` 从最近 checkpoint 继续
- 保留最近 N 次状态快照（默认 20）供排查
- 任务 TTL：完成后 7 天可查，到期清理文件与 checkpoint（可配）

---

### 3.7 人工审阅与二次精炼（FR-HUMAN）— 原方案缺失，本期补齐

1. `enableHumanReview=true` 时，PRD 生成后图进入 interrupt，`status=awaiting_review`。
2. 用户 `POST .../resume` 提交：
   - `action: "approve"` 直接继续；
   - `action: "edit"` + `prdPatch`（JSON Merge Patch）后继续；
   - `action: "reject"` + `feedback` 则回到 `generate_prd` 并带上反馈。
3. `regenerate` 支持只改原型或只改 PRD，避免重复解析、节省 Token。

---

## 4. 非功能需求

### 4.1 性能

| 指标 | 目标 |
|---|---|
| 健康检查 | &lt; 50ms |
| 非 LLM API | &lt; 500ms |
| 文档解析（单文件 ≤10MB） | &lt; 10s |
| 端到端（含 LLM，中等材料） | PRD &lt; 60s；原型 &lt; 90s；合计常见 &lt; 3min |
| 并发 | ≥ 50 连接；LLM 并发由队列限制（默认 10） |

长任务一律异步 + SSE，避免网关超时。

### 4.2 可靠性

- 节点级重试：网络/429/5xx 指数退避，最多 3 次。
- 不可重试错误（校验失败、不支持格式）立即失败并给可读原因。
- 优雅关闭：停收新任务，等待进行中任务 ≤ 30s，再依赖 checkpoint 恢复。
- 部分文件失败 → `partial` 警告，不阻塞全流程（除非全部失败）。

### 4.3 安全

- 密钥仅环境变量 / 密钥管理服务。
- 上传：类型白名单 + 魔数校验；单文件 ≤ 50MB；单次合计 ≤ 200MB；文件数 ≤ 20。
- 上传文件存储于隔离目录/对象存储，不经 LLM 提供商以外的第三方；保留期与任务 TTL 对齐。
- 日志脱敏：API Key、Authorization、文件正文默认不打满文（可打 hash 与长度）。
- HTML 原型预览使用 `sandbox` iframe（若提供简易前端）。
- 基础防护：请求体大小限制、CORS 白名单、Rate limit。

### 4.4 可观测性

- LangSmith：每次 run 绑定 `threadId`。
- 日志字段：`requestId`、`threadId`、`node`、`latencyMs`、`tokenUsage`、`status`。
- 指标：成功率、队列长度、节点耗时、Token 消耗、错误码分布。

### 4.5 可扩展性

- Parser 插件接口：`canParse(mime) / parse(buffer)`。
- Model Router：按 `options.model` 或环境默认切换 OpenAI / Azure / 兼容 API。
- 节点注册表：新增节点不改主流程编排以外的核心代码。

### 4.6 国际化

- 默认 `zh-CN`；`options.language` 控制 PRD/原型文案语言。
- Prompt 与输出语言一致。

---

## 5. 技术架构（实现约束）

### 5.1 推荐技术栈

| 类别 | 选型 |
|---|---|
| 运行时 | Node.js 22+ LTS |
| 语言 | TypeScript 5.x，ESM |
| HTTP | Fastify 5.x |
| 编排 | `@langchain/langgraph` |
| LLM | `@langchain/openai`（可扩 community） |
| 解析 | `markitdown-node` + 备用解析器 |
| 校验 | Zod（以当前生态兼容版本为准，锁定 package） |
| 测试 | Vitest |
| 容器 | Docker + docker-compose（API + Postgres） |

### 5.2 逻辑分层（Monorepo）

```
prd-generator/
├── apps/api/     # @prd/api — Fastify + LangGraph + parsers
├── apps/web/     # @prd/web — Vue 3 + Vite + Tailwind
├── public/       # 静态与 web 构建产物
└── uploads/
```

API 内部分层：

```
API 层（routes） → 应用服务（task service）→ Graph 编排 → Nodes
                                      ↘ Parsers / Prompts / Schemas
持久化：Uploads 存储 + Checkpointer +（可选）任务索引表
```

### 5.3 项目目录（目标结构）

```
prd-generator/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── routes/
│   ├── graph/
│   │   ├── state.ts
│   │   ├── workflow.ts
│   │   ├── nodes/
│   │   └── checkpointer.ts
│   ├── parsers/
│   ├── prompts/
│   ├── schemas/
│   ├── services/
│   ├── types/
│   └── utils/
├── tests/
└── docs/
```

---

## 6. 原方案不足之处与解决办法

> 以下针对 DeepSeek 初稿与「仅技术可行」描述中的缺口，给出可落地对策。标注优先级：P0 必须进一期，P1 建议一期，P2 二期。

### 6.1 产品与流程类

| # | 不足 | 影响 | 解决办法 | 优先级 |
|---|---|---|---|---|
| G1 | 只有「一次生成」，无人工审阅/纠错闭环 | PRD 错了原型跟着错，业务不可用 | 增加 interrupt + `/resume` 编辑/驳回重生成（§3.7） | P0 |
| G2 | 信息不完整时仍硬生成，幻觉风险高 | 假需求进入研发 | `gaps` 检测 + 可选澄清问答；不确定进 `openQuestions`/`assumptions` | P0 |
| G3 | 未定义多文件冲突、重复、矛盾时如何处理 | 输出自相矛盾 | 结构化节点增加「冲突列表」；PRD 中单列「待确认冲突」；可选让用户选择采信来源 | P1 |
| G4 | 无局部重生，任何改动都全量重跑 | 成本高、体验差 | `/regenerate` 指定 `prd`/`prototype`；解析结果缓存 | P0 |
| G5 | 无导出与版本 | 难进入现有文档流 | Markdown/HTML 导出；`prd.version` + 每次 regenerate 递增 patch 版本 | P1 |
| G6 | 目标仅 API，无最小可用体验 | 难演示、难验收 | 一期附带极简静态页：上传 → 进度 → PRD 预览 → 原型 iframe | P1 |
| G7 | 实时语音、墨刀集成写了又虚 | 范围漂移 | 明确 Out of Scope；接口预留 Adapter，不做实现 | P0（范围管理） |

### 6.2 技术与工程类

| # | 不足 | 影响 | 解决办法 | 优先级 |
|---|---|---|---|---|
| G8 | 长耗时同步 API 易被网关超时 | 生产不稳定 | 默认异步任务 + SSE；同步仅用于测试开关 | P0 |
| G9 | 仅 MemorySaver，多实例/重启丢任务 | 无法生产 | 一期可 Memory；上线前必须 Postgres/Redis Checkpointer + 任务索引 | P0（上线门禁） |
| G10 | `markitdown-node` 成熟度存疑 | 解析失败率高 | Parser 插件化；主路径 markitdown，失败降级 mammoth/`pdf-parse`/pptx 专用库；样例回归集 | P0 |
| G11 | 依赖版本（如 Zod 4）可能与文档不符 | 安装失败 | 以官方当前兼容矩阵锁定版本；`pnpm`/`npm` lockfile 必提交 | P0 |
| G12 | 无任务队列，LLM 并发打满 | 429、级联失败 | 内存或 Redis 队列限制并行 graph run；超限排队并 SSE 报 `queued` | P1 |
| G13 | 文件二进制塞进 Graph State | Checkpoint 膨胀、性能差 | 文件落盘/对象存储，State 只存路径与 hash | P0 |
| G14 | 原型质量无校验 | 白屏/半截 HTML | 结构校验（DOCTYPE、主容器、页面数量）；失败自动重试；二期无头冒烟 | P1 |
| G15 | 可观测性只点名 LangSmith | 不好运维 | 统一 `requestId` 日志 + Token/耗时指标；错误码枚举 | P1 |

### 6.3 质量、成本与安全类

| # | 不足 | 影响 | 解决办法 | 优先级 |
|---|---|---|---|---|
| G16 | 无 Token/成本控制 | 费用失控 | 每任务估算+上限；超限中止并返回已生成部分；按 Key 日预算 | P1 |
| G17 | 无样例集与自动评测 | 改 Prompt 无回归 | 建立 10+ 黄金样例（含语音/办公文档）；断言 Schema、关键章节、禁止词 | P1 |
| G18 | 扫描件 PDF/图片需求未覆盖 | 常见输入失败 | 检测无文本 PDF → 返回明确错误与建议；二期加 OCR 节点 | P1（提示）/ P2（OCR） |
| G19 | HTML 原型 XSS/外链风险 | 预览安全问题 | 禁止外部脚本；预览 sandbox；消毒策略（去掉 `javascript:` URL） | P0 |
| G20 | 鉴权过弱（初稿几乎没有） | 接口裸奔 | 一期 API Key + 限流；二期用户体系 | P0 |

### 6.4 需求文档本身的不足（已在本文消化）

| # | 不足 | 解决办法 |
|---|---|---|
| D1 | 验收标准模糊 | §1.4、§8 给出可测条目 |
| D2 | MVP 与完整方案边界不清 | §2 In/Out + §7 分期 |
| D3 | 状态机不完整 | §3.2.2 status 枚举与分支 |
| D4 | API 不足以支持澄清/审阅 | 增补 resume/regenerate/export |
| D5 | PRD 结构偏简 | 增补 assumptions、outOfScope、userFlows、sourceIds、openQuestions |

---

## 7. 分期计划与交付物

### 阶段 A — MVP（约 2–3 周）

- TS + Fastify 骨架、环境变量、健康检查  
- 文档解析（至少 docx/pptx/pdf/txt）+ 语音文件转录  
- 四节点图（可暂无 human review）  
- `/api/generate/stream` + `/api/thread/:id`  
- MemorySaver、Zod PRD、HTML 原型  
- 单元测试：parser + schema  

**MVP 验收：** 一套固定样例端到端成功；SSE 可见四节点进度。

### 阶段 B — 可用一期（约 +2 周）

- human review + resume + regenerate  
- 澄清 gaps（可选开关）  
- 解析降级链、文件落盘、API Key 限流  
- 导出 Markdown/HTML  
- 极简预览页  
- LangSmith + 结构化日志  

### 阶段 C — 生产就绪（约 +2 周）

- Postgres Checkpointer、任务 TTL 清理  
- 队列限流、日预算  
- Docker Compose、部署文档  
- 集成测试 + 样例回归  
- （可选）OCR、无头冒烟  

---

## 8. 验收用例（摘要）

| ID | 场景 | 期望 |
|---|---|---|
| AC-01 | 仅上传一段需求 txt | 产出合法 PRD JSON + Markdown |
| AC-02 | docx + pptx 混合 | fragments 含双来源；功能带 sourceIds |
| AC-03 | 语音 mp3 | 转录文本进入 extractedText |
| AC-04 | 不支持的 `.exe` | 400，明确错误，不入队列 |
| AC-05 | 超大文件 &gt;50MB | 拒绝上传 |
| AC-06 | SSE 全流程 | 依次收到各节点 progress 与 done |
| AC-07 | 进程中杀进程后 resume（生产 ckpt） | 可从 checkpoint 续跑 |
| AC-08 | enableHumanReview | 停在 awaiting_review，编辑后原型反映修改 |
| AC-09 | regenerate prototype | 不重新解析，PRD 不变，HTML 更新 |
| AC-10 | 故意矛盾的两份材料 | openQuestions 或冲突列表非空 |

---

## 9. 风险清单（汇总）

| 风险 | 应对 |
|---|---|
| LLM 输出不稳 | 结构化输出 + 重试 + 人工审阅 + 样例回归 |
| 解析库能力不足 | 多解析器降级 + 失败可见 |
| 耗时与超时 | 异步 + SSE + 队列 |
| 成本飙升 | Token 上限、日预算、局部重生 |
| 依赖升级破坏 API | lockfile、最小版本矩阵、CI 安装验证 |
| 安全合规 | 白名单上传、脱敏、sandbox、密钥管理 |

---

## 10. 已确认决策（2026-09-02）

| # | 事项 | 冻结结论 |
|---|---|---|
| 1 | 人机审阅 | 一期实现；默认关闭，通过 `options.enableHumanReview=true` 开启 |
| 2 | 默认模型 | PRD/原型用 `gpt-4o`；需求抽取可用更便宜模型（如 `gpt-4o-mini`），均可配置覆盖 |
| 3 | 文件存储 | 开发/单机用本地 `uploads/`；生产切换 S3 兼容存储（接口抽象） |
| 4 | 极简前端 | 要：上传 → 进度 → PRD 预览 → 原型 iframe |
| 5 | 输出语言 | 默认 `zh-CN`，支持 `options.language` 切换 |

---

## 11. 参考

- 对话来源：https://chat.deepseek.com/share/f351jdnz0ikyl83qqc  
- LangChain.js / LangGraph.js 官方文档  
- markitdown 系文档解析方案  

---

**文档维护：** v1.2 行为范围已冻结；实现过程中仅允许缺陷级澄清，不擅自扩大 Out of Scope 中的项目。
