# 阶段 C — 外置 Postgres 生产就绪设计

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-09-03 |
| 状态 | 已确认（会话内方案 1 + 三块设计通过） |
| 关联 | `2026-09-02-prd-generator-requirements.md` §7 阶段 C；`2026-09-02-frontend-vue-auth-design.md`（会话建议落 PG） |

---

## 1. 目标与约束

### 1.1 目标

将当前「全内存」运行态升级为可生产部署的最小门禁：

1. **重启不丢任务**：LangGraph checkpoint + 任务索引进 Postgres；满足 AC-07。
2. **可控并发与成本**：进程内队列 + 按 principal 日 token 预算。
3. **双启动形态**：同一套代码支持业务机进程启动与 API Docker；**Postgres 始终外置**。

### 1.2 已确认拓扑

| 组件 | 位置 |
|---|---|
| Postgres | 另一台机器的 Docker（示例：`10.0.0.15:5432`，库 `prd_generator`，用户 `prd`） |
| API | 业务机：`pnpm start` **或** Docker 容器；通过 `DATABASE_URL` 连远程 PG |
| 上传文件 | 仍本地 `uploads/`（单实例）；多实例共享存储仅预留扩展点 |

连接串形态（真实值仅放部署机 `.env`，禁止提交仓库）：

```text
DATABASE_URL=postgresql://prd:<password>@10.0.0.15:5432/prd_generator
```

### 1.3 In Scope（方案 1）

- `DATABASE_URL` 驱动：Postgres checkpointer、`tasks` / `users` / `sessions` / `usage_daily`
- 无 `DATABASE_URL` 时保持现有 Memory 行为（开发友好）
- 生产强制 `DATABASE_URL` + 既有 `assertProductionConfig`
- 进程内 `MAX_CONCURRENT_TASKS`（默认 10）
- 任务 TTL 清理（默认 7 天）：任务行、uploads、checkpoint
- 日 token 预算（`DAILY_TOKEN_BUDGET`；`0` = 不限制）
- API `Dockerfile` + 可选 `compose.yaml`（**只起 API**，不内嵌 Postgres）
- README 生产部署说明；集成测覆盖重启续读（有 PG 时）

### 1.4 Out of Scope

- Redis / 分布式队列
- S3 / NFS 共享上传
- Compose 内嵌 Postgres
- 多 API 副本负载均衡
- OCR、无头冒烟、美元计费、完整 metrics 栈
- 开放注册 / OAuth（沿用一期预置管理员）

---

## 2. 架构

```
Browser / curl
    │
    ▼
API (single instance: process or container)
    ├── TaskService + InProcessQueue
    ├── UserStore / SessionStore / TaskStore
    ├── Local uploads/
    └── LangGraph (PostgresSaver)
            │
            ▼
Remote Postgres Docker (10.0.0.15)
    ├── users, sessions, tasks, usage_daily   (app migrations)
    └── checkpoint tables                    (PostgresSaver.setup())
```

**工厂规则**

| 条件 | Checkpointer | Users / Sessions / Tasks |
|---|---|---|
| 无 `DATABASE_URL` | `MemorySaver` | Memory 实现 |
| 有 `DATABASE_URL` | `PostgresSaver` | Postgres 实现 |
| `NODE_ENV=production` 且无 `DATABASE_URL` | 启动失败 | — |

保留现有接口：`UserStore`、`SessionStore`；新增 `TaskStore`。`TaskService` 从内存 `Map` 改为读写 `TaskStore`；SSE 订阅仍进程内（单实例）。

---

## 3. 数据模型

### 3.1 `users`

对齐 `UserRecord`：`id`、`username`（unique）、`password_hash`、`role`、`status`、`email`、`created_at`、`updated_at`。

### 3.2 `sessions`

对齐 `SessionRecord`：`id`、`user_id`（FK）、`created_at`、`expires_at`。读取时过滤过期；TTL job 可物理删除。

### 3.3 `tasks`

任务索引（API 查询 / 导出 / 鉴权 owner 用），字段至少：

| 列 | 说明 |
|---|---|
| `thread_id` | PK；同时为 LangGraph `thread_id` |
| `owner_kind` / `owner_user_id` | `user` + userId，或 `apiKey` |
| `status` / `progress` | 与现有 `TaskSnapshot` 一致 |
| `prd` (jsonb) / `prd_markdown` / `prototype_html` | 产物 |
| `error` / `gaps` / `config` / `extracted_text` / `structured_requirements` | 状态辅助 |
| `created_at` / `updated_at` / `expires_at` | TTL；进行中可为 NULL |

### 3.4 `usage_daily`

| 列 | 说明 |
|---|---|
| `principal_key` | `user:<id>` 或 `key:api` |
| `day` | UTC 日期 `YYYY-MM-DD` |
| `token_total` | 累计 token |
| PK | `(principal_key, day)` |

### 3.5 Checkpoint

由 `@langchain/langgraph-checkpoint-postgres` 的 `PostgresSaver.setup()` 创建维护；业务不手写其 DDL。`thread_id` 与 `tasks.thread_id` 一致。

### 3.6 迁移

- 使用轻量 SQL 迁移目录（如 `apps/api/migrations/*.sql`）或启动时幂等 `CREATE TABLE IF NOT EXISTS`
- 启动顺序：连接池 → 业务迁移 → `PostgresSaver.setup()` → seed admin → listen

---

## 4. 运行时行为

### 4.1 任务生命周期

1. `createTask`：写入 `tasks`（`queued`）→ 入队。
2. 队列有空位：标 `running`，stream graph；每次有意义的 update upsert `tasks`。
3. 终态 `completed` / `failed` / `cancelled`：写回产物与错误，设置 `expires_at = now + TASK_TTL_MS`（默认 7 天）。
4. 客户端：进行中靠 SSE；重连或重启后用 `GET /thread/:id` / `/stream` 读库中快照。
5. `resume` / `regenerate`：从 `TaskStore` 取快照 + Postgres checkpoint 续跑。

### 4.2 进程内队列

- `MAX_CONCURRENT_TASKS` 默认 `10`
- 超限任务保持 `queued`，SSE 推送 `status: queued`
- 抽象 `TaskQueue`；默认 `InProcessQueue`。代码注释预留 Redis 实现，本期不写

### 4.3 日预算

- `DAILY_TOKEN_BUDGET`：默认建议 `500000`；`0` 表示不限制
- 每个 LLM 节点结束后累加 `usage_daily`
- 超限：进行中任务可 `failed` 并保留已生成部分；新 `generate` 返回明确错误码（如 `BUDGET_EXCEEDED` / 429）
- 一期只计 token，不算美元

### 4.4 TTL 清理

- 定时任务（如每小时）：删除 `expires_at < now` 的任务；删除对应 `uploads` 文件；删除该 `thread_id` 的 checkpoint 行（按官方 API / SQL）
- 清理过期 `sessions`

### 4.5 优雅关闭

- SIGTERM：停收新任务；等待进行中 ≤ 30s；依赖 checkpoint 下次恢复

---

## 5. 配置

新增 / 强调的环境变量：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Postgres 连接串；生产必填 |
| `TASK_TTL_MS` | 完成后可查窗口，默认 `604800000`（7 天） |
| `MAX_CONCURRENT_TASKS` | 默认 `10` |
| `DAILY_TOKEN_BUDGET` | 默认 `500000`；`0` = 关闭 |

既有生产校验保持：`API_KEY`、`ADMIN_PASSWORD`、`COOKIE_SECURE`；并增加生产必须 `DATABASE_URL`。

`.env.example` 只写占位符，不写真实主机密码。

---

## 6. 部署

### 6.1 进程模式

```bash
pnpm build && NODE_ENV=production pnpm start
```

业务机可访问 `10.0.0.15:5432`；防火墙仅放行业务机 IP。

### 6.2 Docker 模式

- 多阶段 `Dockerfile`：install → build web + api → 运行 `node` 入口
- 可选 `compose.yaml`：仅 `api` 服务 + `uploads` volume；`DATABASE_URL` 指向外置主机
- **不**在 Compose 中定义 `postgres` 服务

### 6.3 Postgres 侧

- 库与用户预先创建（示例库名 `prd_generator`）
- 端口映射与 `pg_hba` 允许业务机
- 应用自动迁移；无需手工建 checkpoint 表

---

## 7. 测试与验收

### 7.1 自动化

- 单测：Postgres store（可 testcontainers / 有 DB 才跑）、队列信号量、预算、TTL 逻辑
- 集成：mock LLM + 真 Postgres — 创建任务 → 杀逻辑重启 store → 同一 `threadId` 可读；`awaiting_review` 可 resume

### 7.2 验收表

| ID | 场景 | 期望 |
|---|---|---|
| AC-07 | 中途杀 API 再启动 | 同 `threadId` 可查；审阅态可 resume |
| C-01 | 无 `DATABASE_URL` | Memory 路径与现行为一致 |
| C-02 | 生产缺 `DATABASE_URL` | 启动失败并明确报错 |
| C-03 | 并发超过上限 | 多余任务 `queued`，有空位再跑 |
| C-04 | 日 token 超预算 | 拒绝或中止 + `BUDGET_EXCEEDED` |
| C-05 | TTL 到期 | 任务、uploads、checkpoint 清理 |
| C-06 | Docker API → `10.0.0.15` | health + 登录 + 一次 generate |

---

## 8. 实现切分（供后续 plan）

建议独立实施任务顺序：

1. 依赖与 `DATABASE_URL` / 生产校验 / 连接池
2. 业务迁移 + Postgres `UserStore` / `SessionStore` + seed
3. `TaskStore` + `TaskService` 持久化改造
4. `PostgresSaver` 替换 `createCheckpointer`
5. `InProcessQueue` + SSE queued 状态
6. `usage_daily` + 预算钩子
7. TTL 清理 job
8. Dockerfile / compose（仅 API）+ README
9. 集成测试 AC-07 / C-0x

---

## 9. 已确认决策

| # | 事项 | 结论 |
|---|---|---|
| 1 | 范围 | 方案 1：最小生产门禁，非规格全文 |
| 2 | Postgres | 外置 Docker（他机），不内嵌 Compose |
| 3 | API 部署 | 进程与 Docker 双支持 |
| 4 | 规模 | 先单实例；队列/存储留多实例扩展点 |
| 5 | 文件 | 继续本地 `uploads/` |
| 6 | 预算 | 仅 token 日限额 |
| 7 | 凭证 | 真实 `DATABASE_URL` 不入库 |

---

**文档维护：** 行为范围以本文 + 需求规格阶段 C 为准；实现仅允许缺陷级澄清，不擅自纳入 §1.4 Out of Scope 项。
