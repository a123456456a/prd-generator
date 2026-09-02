# Vue SPA + 用户登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成 Task 1–6 的后端上补齐双鉴权 API 与 Vue 3 工作台，替代原计划「极简静态页」，支持预置账号登录与中英 UI。

**Architecture:** API 仍留在仓库根目录（避免大搬家）；新增 `apps/web` Vue SPA。Web 用 HttpOnly 会话 Cookie；脚本继续 `Authorization: Bearer <API_KEY>`。用户/会话一期用可替换的 Memory 仓库（接口对齐，便于二期 Postgres）。生产由 Fastify 托管 `apps/web/dist`。

**Tech Stack:** Fastify 5、bcryptjs、Zod、Vitest；Vue 3 + Vite + TypeScript + Tailwind CSS、vue-router、vue-i18n、Pinia、pnpm workspace

**Spec:** `docs/superpowers/specs/2026-09-02-frontend-vue-auth-design.md`

## Global Constraints

- UI 语言：`zh-CN` | `en`（`vue-i18n` + `localStorage` key `ui_locale`）；生成语言：`options.language` 为既有 `zh-CN` | `en-US`，两套分离
- 无自助注册；种子用户来自 `ADMIN_USER` / `ADMIN_PASSWORD`
- Cookie：`HttpOnly`、`SameSite=Lax`、生产 `Secure`；名 `sid`
- 密码哈希：bcryptjs（cost 10+）；日志禁止明文密码 / Cookie / Authorization
- 中间件：有效会话用户 **或** Bearer `API_KEY`；`/api/health`、`/api/auth/login` 放行
- 限流：登录 5/min/IP；通用 20/min；生成类 5/min；Web 按 `userId`，脚本按 `apiKey`
- UI 库：一期使用 **Tailwind CSS**（Vue 3 + Vite + `@tailwindcss/vite`）；不强制组件库
- 包管理：pnpm；API 根包名保持 `prd-generator`；web 包名 `@prd/web`
- 原型预览仅 `iframe sandbox="allow-scripts"`；禁止 `v-html` 注入生成 HTML
- 本期不做：开放注册、OAuth、Postgres 用户表、UI 组件库、搬迁 `src/` 到 `apps/api`

## File Map

```
prd-generator/
├── pnpm-workspace.yaml              # packages: ['.', 'apps/*']
├── package.json                     # 根 scripts: dev / build / test
├── src/
│   ├── config.ts                    # + adminUser, adminPassword, cookieSecure, webDistDir, corsOrigin
│   ├── server.ts                    # Fastify 组装
│   ├── index.ts                     # 启动 buildServer + listen + seedAdmin
│   ├── auth/
│   │   ├── types.ts
│   │   ├── password.ts
│   │   ├── memoryUserStore.ts
│   │   ├── memorySessionStore.ts
│   │   └── seedAdmin.ts
│   ├── middleware/
│   │   ├── auth.ts                  # dual auth → request.principal
│   │   └── rateLimit.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── auth.ts
│   │   ├── generate.ts
│   │   └── thread.ts
│   └── utils/prdToMarkdown.ts       # 若尚未存在则本 plan 内补齐（导出需要）
├── apps/web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/index.ts
│   │   ├── i18n/index.ts
│   │   ├── i18n/locales/zh-CN.ts
│   │   ├── i18n/locales/en.ts
│   │   ├── api/client.ts
│   │   ├── api/sse.ts
│   │   ├── stores/auth.ts
│   │   ├── stores/job.ts
│   │   ├── components/AppHeader.vue
│   │   ├── components/LocaleSwitch.vue
│   │   ├── views/LoginView.vue
│   │   ├── views/WorkbenchView.vue
│   │   └── styles.css
│   └── ...
└── tests/unit/
    ├── password.test.ts
    ├── memoryUserStore.test.ts
    ├── authRoutes.test.ts
    ├── dualAuth.test.ts
    ├── rateLimit.test.ts
    └── prdToMarkdown.test.ts        # 若本 plan 创建该工具
```

**依赖关系：** 原 impl Task 7（纯 API Key 静态页）由本 plan Task 4–6 替代并扩展；原 Task 8 由 Task 7–9 替代。

---

### Task 1: pnpm workspace + Vue 脚手架

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`, `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/App.vue`, `apps/web/src/vite-env.d.ts`, `apps/web/src/styles.css`

**Interfaces:**
- Produces: `@prd/web` 可 `pnpm --filter @prd/web dev`；Vite proxy `/api` → `http://localhost:3000`

- [ ] **Step 1: 更新 workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "."
  - "apps/*"

allowBuilds:
  esbuild: true
```

根 `package.json` scripts 改为：

```json
{
  "scripts": {
    "dev": "pnpm run --parallel /^dev:/",
    "dev:api": "tsx watch src/index.ts",
    "dev:web": "pnpm --filter @prd/web dev",
    "build": "pnpm --filter @prd/web build && tsc -p tsconfig.json",
    "build:api": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:web": "pnpm --filter @prd/web test"
  }
}
```

- [ ] **Step 2: 创建 `apps/web/package.json`**

```json
{
  "name": "@prd/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "pinia": "^3.0.1",
    "vue": "^3.5.13",
    "vue-i18n": "^11.1.2",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.6",
    "jsdom": "^26.0.0",
    "typescript": "^5.8.2",
    "vite": "^6.2.0",
    "vitest": "^3.0.8",
    "vue-tsc": "^2.2.8"
  }
}
```

- [ ] **Step 3: Vite 配置（proxy + 产出目录）**

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../../public/web"),
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 4: 最小 `App.vue` + `main.ts` + `index.html`**，页面显示 `PRD Generator` 占位

- [ ] **Step 5: 安装依赖并冒烟**

```bash
pnpm install
pnpm --filter @prd/web build
```

Expected: `public/web/index.html` 生成成功

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json apps/web pnpm-lock.yaml
git commit -m "chore: scaffold Vue web app in pnpm workspace"
```

---

### Task 2: 用户/会话 Memory 仓库 + 密码哈希 + 配置

**Files:**
- Create: `src/auth/types.ts`, `src/auth/password.ts`, `src/auth/memoryUserStore.ts`, `src/auth/memorySessionStore.ts`, `src/auth/seedAdmin.ts`
- Modify: `src/config.ts`, `.env.example`（若存在）
- Test: `tests/unit/password.test.ts`, `tests/unit/memoryUserStore.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `UserRecord { id, username, passwordHash, role: 'admin'|'user', status: 'active'|'disabled', email: string | null, createdAt, updatedAt }`
  - `UserStore { findByUsername, findById, create, ensureAdmin(username, password) }`
  - `SessionRecord { id, userId, createdAt, expiresAt }`
  - `SessionStore { create(userId, ttlMs), get(id), delete(id) }`
  - `loadConfig()` 增加：`adminUser`, `adminPassword`, `sessionTtlMs`, `cookieSecure`, `webDistDir`, `corsOrigin`

- [ ] **Step 1: 写失败测试 `tests/unit/password.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("secret-pass");
    expect(hash).not.toContain("secret-pass");
    expect(await verifyPassword("secret-pass", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm test -- tests/unit/password.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `password.ts`（bcryptjs）并装依赖**

```bash
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

```ts
import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: 写 `memoryUserStore` 测试并实现**

测试要点：`ensureAdmin` 幂等；同名第二次 create 抛 `AppError('USER_EXISTS', ..., 409)`；`status=disabled` 仍可查出（鉴权层拒绝）。

`MemoryUserStore.ensureAdmin`:

```ts
async ensureAdmin(username: string, password: string): Promise<UserRecord> {
  const existing = await this.findByUsername(username);
  if (existing) return existing;
  return this.create({
    username,
    passwordHash: await hashPassword(password),
    role: "admin",
    status: "active",
    email: null,
  });
}
```

`MemorySessionStore.create` 返回随机 `id`（`randomUUID`），默认 TTL 来自参数。

- [ ] **Step 5: 扩展 `loadConfig`**

```ts
adminUser: process.env.ADMIN_USER ?? "admin",
adminPassword: process.env.ADMIN_PASSWORD ?? "admin-change-me",
sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
cookieSecure: process.env.COOKIE_SECURE === "true",
webDistDir: process.env.WEB_DIST_DIR ?? "public/web",
corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
```

- [ ] **Step 6: 跑测试通过并 Commit**

```bash
pnpm test -- tests/unit/password.test.ts tests/unit/memoryUserStore.test.ts
git add src/auth src/config.ts tests/unit/password.test.ts tests/unit/memoryUserStore.test.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat: add memory user and session stores"
```

---

### Task 3: Auth 路由（login / logout / me）

**Files:**
- Create: `src/routes/auth.ts`
- Modify: （稍后 Task 5 挂到 server；本任务可对 Fastify 实例做 inject 测试）
- Test: `tests/unit/authRoutes.test.ts`

**Interfaces:**
- Consumes: `UserStore`, `SessionStore`, `AppConfig`
- Produces:
  - `POST /api/auth/login` body `{ username, password }` → 200 `{ user: { id, username, role } }` + `Set-Cookie: sid=...; HttpOnly; Path=/; SameSite=Lax`
  - 失败统一 401 `{ code: "AUTH_INVALID", message: "Invalid credentials" }`（不区分用户不存在/密码错）
  - `POST /api/auth/logout` → 清 cookie + delete session
  - `GET /api/auth/me` → 200 用户或 401
  - `POST /api/auth/register` → **501** `{ code: "NOT_IMPLEMENTED" }`（预留）

- [ ] **Step 1: 写 inject 测试骨架**（用 `fastify()` 仅注册 auth 插件）

```ts
it("logs in with seed admin and returns me", async () => {
  const app = await buildAuthTestApp(); // 测试 helper：Memory stores + seed
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "admin-change-me" },
  });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies.find((c) => c.name === "sid");
  expect(cookie?.value).toBeTruthy();

  const me = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    cookies: { sid: cookie!.value },
  });
  expect(me.statusCode).toBe(200);
  expect(me.json().user.username).toBe("admin");
});

it("rejects bad password with AUTH_INVALID", async () => {
  const app = await buildAuthTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "nope" },
  });
  expect(res.statusCode).toBe(401);
  expect(res.json().code).toBe("AUTH_INVALID");
});
```

- [ ] **Step 2: 运行确认失败 → 实现 `registerAuthRoutes(app, deps)`**

Cookie 序列化示例：

```ts
reply.setCookie("sid", session.id, {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: config.cookieSecure,
  maxAge: Math.floor(config.sessionTtlMs / 1000),
});
```

依赖：`pnpm add @fastify/cookie`

禁用用户：`status !== 'active'` → 同 `AUTH_INVALID`。

- [ ] **Step 3: 测试通过并 Commit**

```bash
pnpm test -- tests/unit/authRoutes.test.ts
git commit -m "feat: add login logout and me auth routes"
```

---

### Task 4: 双鉴权中间件 + 限流

**Files:**
- Create: `src/middleware/auth.ts`, `src/middleware/rateLimit.ts`
- Test: `tests/unit/dualAuth.test.ts`, `tests/unit/rateLimit.test.ts`

**Interfaces:**
- Produces:
  - `Principal = { kind: 'user', userId: string, username: string, role: 'admin'|'user' } | { kind: 'apiKey' }`
  - `decorateRequest('principal', null)`；`requireAuth` preHandler
  - 解析顺序：Cookie `sid` → SessionStore → UserStore（active）→ user principal；否则 `Authorization: Bearer <token>` 且 `token === config.apiKey` → apiKey principal；否则 401 `AUTH_REQUIRED`
  - 公开路径集合：`/api/health`, `/api/auth/login`（精确匹配）
  - `createRateLimiter({ windowMs, max, keyFn })`；登录用 IP；生成用 `user:<id>` 或 `key:api`

- [ ] **Step 1: 双鉴权失败测试**

```ts
it("allows bearer api key", async () => { /* inject protected route */ });
it("allows session cookie", async () => { /* login then hit /api/protected */ });
it("rejects anonymous", async () => {
  const res = await app.inject({ method: "GET", url: "/api/protected" });
  expect(res.statusCode).toBe(401);
  expect(res.json().code).toBe("AUTH_REQUIRED");
});
```

- [ ] **Step 2: 实现 middleware → 测试通过**

- [ ] **Step 3: 限流测试** — 同一 key 超过 max 返回 429 `{ code: 'RATE_LIMITED' }`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: dual auth middleware and rate limiting"
```

---

### Task 5: Fastify server + health + generate/thread 路由

**Files:**
- Create: `src/server.ts`, `src/routes/health.ts`, `src/routes/generate.ts`, `src/routes/thread.ts`, `src/utils/prdToMarkdown.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/prdToMarkdown.test.ts`；路由可用 inject 冒烟（mock TaskService）

**Interfaces:**
- Consumes: `TaskService`, Storage, auth/session stores, config
- Produces: `buildServer(deps): Promise<FastifyInstance>`
- 路由（均需 auth，除 health/login）：
  - `GET /api/health` → `{ ok: true }`
  - `POST /api/generate` multipart → 存文件 → `taskService.create` → `{ threadId, status }`
  - `POST /api/generate/stream` → 同上 + SSE（`writeSseHeaders` / `sendSseEvent`）
  - `GET /api/thread/:threadId`
  - `GET /api/thread/:threadId/stream`
  - `POST /api/thread/:threadId/resume`
  - `POST /api/thread/:threadId/regenerate`
  - `DELETE /api/thread/:threadId`
  - `GET /api/thread/:threadId/export/prd.md`
  - `GET /api/thread/:threadId/export/prd.json`
  - `GET /api/thread/:threadId/export/prototype.html`
- CORS：`@fastify/cors` origin=`config.corsOrigin`, `credentials: true`
- Static：`@fastify/static` root=`config.webDistDir`（目录不存在时跳过或仅 warn）
- 启动：`seedAdmin` 后 `listen(config.port)`

- [ ] **Step 1: `prdToMarkdown` TDD** — 输入最小合法 PRD，断言含 `# ` 标题与 `## Background`（或中文章节名与现有 prompt 约定一致；**固定英文 section header 便于测试**，正文语言跟随 PRD）

- [ ] **Step 2: 实现 `buildServer`**

multipart 解析：校验 `config.maxFiles` / `maxFileBytes` / `maxTotalBytes`；MIME 白名单与规格一致；`options` 从字段 JSON 字符串解析为 `GenerateOptionsSchema`。

SSE 流：订阅 `taskService` 事件，结束发 `done`；错误发 `error` + 关流。

- [ ] **Step 3: 修改 `index.ts`**

```ts
import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { MemoryUserStore } from "./auth/memoryUserStore.js";
import { MemorySessionStore } from "./auth/memorySessionStore.js";
import { seedAdmin } from "./auth/seedAdmin.js";
// ... TaskService / storage wiring

const config = loadConfig();
const users = new MemoryUserStore();
const sessions = new MemorySessionStore();
await seedAdmin(users, config);
const app = await buildServer({ config, users, sessions, /* taskService, storage */ });
await app.listen({ port: config.port, host: "0.0.0.0" });
```

- [ ] **Step 4: 手工冒烟**

```bash
pnpm run dev:api
curl -s http://localhost:3000/api/health
curl -s -X POST http://localhost:3000/api/auth/login -H "content-type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin-change-me\"}" -c cookies.txt
curl -s -b cookies.txt -F "textDescription=做一个待办App" -F "options={\"language\":\"zh-CN\"}" http://localhost:3000/api/generate
curl -s -H "Authorization: Bearer dev-api-key" -F "textDescription=todo app" http://localhost:3000/api/generate
```

Expected: health ok；两种鉴权都能返回 `threadId`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: expose Fastify APIs with session and API key auth"
```

---

### Task 6: Vue i18n + 路由守卫 + Auth store + 登录页

**Files:**
- Create: `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/locales/zh-CN.ts`, `apps/web/src/i18n/locales/en.ts`, `apps/web/src/router/index.ts`, `apps/web/src/api/client.ts`, `apps/web/src/stores/auth.ts`, `apps/web/src/components/LocaleSwitch.vue`, `apps/web/src/components/AppHeader.vue`, `apps/web/src/views/LoginView.vue`
- Modify: `apps/web/src/main.ts`, `apps/web/src/App.vue`
- Test: `apps/web/src/router/router.spec.ts`（未登录访问 `/` → `/login`）

**Interfaces:**
- `apiFetch(path, init)`：`credentials: 'include'`；401 时清 auth store
- `useAuthStore`: `user`, `loadMe()`, `login(u,p)`, `logout()`
- 路由：`/login`、`/`（meta.requiresAuth）、catch-all → `/`
- i18n messages 至少含：`app.title`, `login.*`, `workbench.*`, `errors.AUTH_INVALID`, `errors.AUTH_REQUIRED`, `errors.RATE_LIMITED`, `errors.UNKNOWN`

- [ ] **Step 1: 实现 i18n**

```ts
// apps/web/src/i18n/index.ts
const saved = localStorage.getItem("ui_locale");
const locale = saved === "en" || saved === "zh-CN" ? saved : "zh-CN";
```

`LocaleSwitch` 切换时 `locale.value = next; localStorage.setItem('ui_locale', next)`。

- [ ] **Step 2: Auth store + client**

```ts
export async function login(username: string, password: string) {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  // set user from JSON
}
```

- [ ] **Step 3: Router guard**

```ts
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const auth = useAuthStore();
  if (!auth.user) await auth.loadMe();
  if (!auth.user) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  return true;
});
```

- [ ] **Step 4: `LoginView.vue`** — 用户名、密码、提交、错误用 `t('errors.' + code)`；成功 `router.replace(redirect || '/')`

- [ ] **Step 5: 组件测试或手工** — 打开 `pnpm dev`，未登录打开 `http://localhost:5173/` 应到登录页；中/英切换文案变化

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add Vue login page with i18n and route guards"
```

---

### Task 7: 工作台（上传、选项、SSE、审阅、预览、导出）

**Files:**
- Create: `apps/web/src/api/sse.ts`, `apps/web/src/stores/job.ts`, `apps/web/src/views/WorkbenchView.vue`
- Modify: `apps/web/src/router/index.ts`, `apps/web/src/i18n/locales/*.ts`

**Interfaces:**
- `parseSseStream(response: Response, onEvent: (event, data) => void): Promise<void>` — 读 `ReadableStream`，按 `\n\n` 分帧，解析 `event:` / `data:`
- `job` store：`threadId`, `phase`, `events[]`, `prd`, `prdMarkdown`, `prototypeHtml`, `uiError`, `outputLanguage`（`zh-CN`|`en-US`，默认 `zh-CN`，**不**绑定 UI locale）
- `startGenerate({ files, textDescription, enableHumanReview, skipPrototype, language })` → `FormData` POST `/api/generate/stream`
- review：`approve` / `edit`+`prdPatch` / `reject`+`feedback` → `/api/thread/:id/resume`
- 导出：`fetch` blob 下载（带 credentials）
- 原型：`<iframe sandbox="allow-scripts" :srcdoc="prototypeHtml" />`（空则不渲染）

- [ ] **Step 1: 实现并单测 `parseSseStream`**（用 `new Response(stream)` fixture）

```ts
it("parses progress and done", async () => {
  const body = "event: progress\ndata: {\"percent\":10}\n\nevent: done\ndata: {}\n\n";
  const events: string[] = [];
  await parseSseStream(new Response(body), (e) => events.push(e));
  expect(events).toEqual(["progress", "done"]);
});
```

- [ ] **Step 2: Workbench UI 区块**（全部走 i18n）

1. 文件多选 + 文本框  
2. checkbox：人机审阅、跳过原型  
3. select：输出语言 `zh-CN` / `en-US`  
4. 开始按钮  
5. 进度日志列表  
6. PRD：Tab Markdown（`<pre>` 或简单渲染）/ JSON  
7. 审阅表单（仅 `phase === 'awaiting_review'`）  
8. 原型 iframe  
9. 导出按钮组  

- [ ] **Step 3: `threadId` 写入 `localStorage` key `prd_thread_id`；进入页时若存在可 `GET /api/thread/:id` 恢复快照**

- [ ] **Step 4: 手工主路径**（需 `OPENAI_API_KEY` 或接受 queued/失败但仍验证 SSE/UI）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add Vue workbench with SSE review and export"
```

---

### Task 8: 生产静态托管 + SPA fallback + 安全收尾

**Files:**
- Modify: `src/server.ts`, `apps/web/vite.config.ts`（若需）, `README.md`（若存在则更新启动说明；无则在本步创建简短 `README.md` 仅文档启动/账号）

**Interfaces:**
- `@fastify/static` 托管 `public/web`
- 非 `/api/*` 的 GET 回退 `index.html`（Vue history mode）
- 确认 login 限流挂上；生成路由挂 user/apiKey 限流

- [ ] **Step 1: static + fallback**

```ts
app.setNotFoundHandler((req, reply) => {
  if (req.method === "GET" && !req.url.startsWith("/api/")) {
    return reply.sendFile("index.html");
  }
  return reply.status(404).send({ code: "NOT_FOUND" });
});
```

- [ ] **Step 2: `pnpm build && pnpm start`**，浏览器打开 `http://localhost:3000` 验证登录页

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: serve Vue build from Fastify with SPA fallback"
```

---

### Task 9: 规格交叉验收清单（手工 + 自动化回归）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-prd-generator-requirements.md` 仅在「极简前端」处加一句指向新设计（可选一行）
- 无新功能代码

- [ ] **Step 1: 跑全量测试**

```bash
pnpm test
pnpm --filter @prd/web test
```

Expected: 全部 PASS

- [ ] **Step 2: 按设计 §9 勾选验收**

| # | 项 | 结果 |
|---|---|---|
| 1 | 未登录进工作台 → 登录页 | |
| 2 | 种子用户登录成功 / 错密失败 | |
| 3 | Cookie 生成 + Bearer API Key 生成 | |
| 4 | UI 中/英切换 | |
| 5 | 输出语言与 UI 可不同 | |
| 6 | SSE + resume（有 key 时） | |
| 7 | iframe sandbox，无 v-html | |
| 8 | 日志无密码/Authorization 明文 | |

- [ ] **Step 3: Commit 文档（若有修改）**

```bash
git commit -m "docs: point requirements frontend note to Vue auth design"
```

---

## Self-Review（写作时已核对）

| Spec 项 | 对应 Task |
|---|---|
| Vue3+Vite+i18n SPA | 1, 6, 7 |
| 登录页 + 预置用户 | 2, 3, 6 |
| 会话 Cookie + API Key 并存 | 4, 5 |
| register 预留 501 | 3 |
| 工作台上传/SSE/审阅/导出/iframe | 5, 7 |
| UI vs options.language 分离 | 6, 7 |
| Fastify 托管前端 | 1 build outDir, 8 |
| 限流 / CORS credentials | 4, 5 |
| 不搬迁 apps/api | File Map / Constraints |

无 TBD 占位；生成语言枚举与代码库 `en-US` 对齐（设计口语「en」映射为 UI `en` + 选项 `en-US`）。
