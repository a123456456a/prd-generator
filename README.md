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
| `ADMIN_USER` / `ADMIN_PASSWORD` | 预置管理员（默认 `admin` / `admin-change-me`） |
| `API_KEY` | 脚本/自动化用 Bearer 令牌 |
| `PORT` | API 端口（默认 `3000`） |
| `CORS_ORIGIN` | 开发时 Web 源（默认 `http://localhost:5173`） |

## 鉴权

- **浏览器**：登录后 HttpOnly 会话 Cookie（`POST /api/auth/login`）。
- **脚本/CI**：请求头 `Authorization: Bearer <API_KEY>`。

生产模式下 Fastify 托管 `public/web`；未知客户端路由回退 `index.html`（Vue history mode）。
