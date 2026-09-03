# PRD Generator

多模态需求材料 → 结构化 PRD + 可交互 HTML 原型。Monorepo：`apps/api`（Fastify + LangGraph）+ `apps/web`（Vue 3 SPA）。

## 快速开始

```bash
pnpm install
pnpm dev          # API :3000 + Vite :5173（/api 代理到 API）
pnpm build        # 构建 web 到 public/web，再编译 API
pnpm start        # 生产：Fastify 托管 SPA + API
pnpm test         # API 单元测试（pnpm test:web 为前端测试）
```

## 环境变量

复制 `apps/api/.env.example` 到仓库根 `.env` 或 `apps/api/.env` 并按需修改。

| 变量 | 说明 |
|------|------|
| `NODE_ENV` | 生产部署必须设为 `production` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 预置管理员；生产环境必须设置非默认密码 |
| `API_KEY` | 脚本/自动化用 Bearer 令牌；生产环境必须设置非默认值 |
| `OPENAI_API_KEY` | LLM Key（OpenAI 或兼容厂商，如 DeepSeek） |
| `OPENAI_BASE_URL` | 可选；兼容端点，DeepSeek 用 `https://api.deepseek.com` |
| `EXTRACT_MODEL` / `PRD_MODEL` | 抽取与 PRD 模型名；DeepSeek 可用 `deepseek-v4-flash` |
| `COOKIE_SECURE` | 生产环境必须设为 `true` |
| `PORT` | API 端口（默认 `3000`） |
| `CORS_ORIGIN` | 开发时 Web 源（默认 `http://localhost:5173`） |

### 使用 DeepSeek

DeepSeek 提供 OpenAI 兼容 Chat Completions。在 `.env` 中：

```
OPENAI_API_KEY=sk-你的DeepSeek密钥
OPENAI_BASE_URL=https://api.deepseek.com
EXTRACT_MODEL=deepseek-v4-flash
PRD_MODEL=deepseek-v4-flash
```

语音 Whisper 转录仍依赖 OpenAI Audio API；仅配 DeepSeek 时语音文件会解析失败，其它材料可继续。

DeepSeek 不支持 OpenAI 的 `json_schema` response_format，且默认 thinking 模式会拒绝 `tool_choice`。本项目在检测到 DeepSeek base URL 时会关闭 thinking，并自动改用 `functionCalling` 结构化输出。也可通过 `STRUCTURED_OUTPUT_METHOD` 强制指定。

生产启动会拒绝空值、`dev-api-key`、`admin-change-me` 和非 Secure
Cookie。可使用 Node.js 生成高熵凭据：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

分别生成 `API_KEY` 和 `ADMIN_PASSWORD`，不要将真实值提交到仓库。

## 鉴权

- **浏览器**：登录后 HttpOnly 会话 Cookie（`POST /api/auth/login`）。
- **脚本/CI**：请求头 `Authorization: Bearer <API_KEY>`。

生产模式下 Fastify 托管 `public/web`；未知客户端路由回退 `index.html`（Vue history mode）。

## 生产部署

Phase C 要求外置 PostgreSQL（Compose **不**包含 Postgres 服务）。在业务机上配置 `.env`（从 `.env.example` 复制），将 `DATABASE_URL` 指向远程库，例如：

```
DATABASE_URL=postgresql://prd:<password>@10.0.0.15:5432/prd_generator
```

将 `<password>` 替换为部署机上的真实密码；**不要**把真实连接串提交到仓库。

生产必填项：`NODE_ENV=production`、`DATABASE_URL`、非默认 `API_KEY` / `ADMIN_PASSWORD`、`COOKIE_SECURE=true`，以及 `OPENAI_API_KEY`。

### 方式一：本机进程

```bash
pnpm install
pnpm build
NODE_ENV=production pnpm start
```

监听 `0.0.0.0:3000`（或 `PORT`）。上传目录默认为仓库内 `uploads/`。

### 方式二：Docker Compose（仅 API）

```bash
cp .env.example .env   # 编辑 DATABASE_URL 与外置 PG 地址
docker compose up --build -d
```

- 服务名 `api`，端口 `3000:3000`
- 环境变量从 `.env` 加载；`uploads` 持久化在命名卷 `uploads_data`（挂载 `/app/uploads`）
- 容器内 `DATABASE_URL` 须能访问外置 Postgres（如 `10.0.0.15:5432`）

### 网络与防火墙

- 业务机 → Postgres：放行 TCP `5432`（或实际端口）；Postgres 侧 `pg_hba` 允许业务机 IP
- 客户端 → API：放行 `3000`（或反向代理后的 HTTPS 端口）
- 仅内网暴露管理端口；生产 Cookie 需 HTTPS（`COOKIE_SECURE=true`）

### 验收要点（C-0x）

| ID | 场景 | 期望 |
|------|------|------|
| C-01 | 无 `DATABASE_URL`（开发） | Memory 路径，行为与升级前一致 |
| C-02 | 生产缺 `DATABASE_URL` | 启动失败，明确报错 |
| C-03 | 并发超过 `MAX_CONCURRENT_TASKS` | 多余任务 `queued`，有空位再跑 |
| C-04 | 日 token 超 `DAILY_TOKEN_BUDGET` | 拒绝或中止，`BUDGET_EXCEEDED` |
| C-05 | `TASK_TTL_MS` 到期 | 任务、会话、checkpoint 清理 |
| C-06 | Docker API 连外置 PG | `GET /api/health`、登录、一次 generate 成功 |
| AC-07 | 中途停止 API 再启动 | 同 `threadId` 可查；审阅态可 resume |

健康检查：`GET /api/health`。容器收到 `SIGTERM`/`SIGINT` 时会停止 TTL 定时器、关闭 HTTP 服务并释放数据库连接池。
