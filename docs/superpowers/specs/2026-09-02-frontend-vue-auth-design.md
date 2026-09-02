# 前端 SPA + 用户登录 — 设计说明

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-09-02 |
| 状态 | 已确认（会话内 §1–§4 通过） |
| 关联 | `2026-09-02-prd-generator-requirements.md`（原「极简静态页」升级为本设计） |

---

## 1. 目标与范围

### 1.1 目标

将一期前端从「`public/` 极简静态页」升级为 **Vue 3 SPA**：完整中英 UI、独立登录页、账号密码鉴权（管理员预置用户），并保留非浏览器客户端的 API Key 通路。

### 1.2 目标用户（前端）

- 主要：国内产品/需求同学（对内工具）
- 次要：英文同事偶尔使用同一界面（需完整英文 UI）

### 1.3 In Scope

- Monorepo：`apps/api`（现有 Fastify/LangGraph）+ `apps/web`（Vue 3）
- 登录页（用户名 + 密码）、工作台（上传 → SSE 进度 → PRD/原型 → 人机审阅 → 导出）
- `vue-i18n`：`zh-CN` / `en` 完整界面文案
- 会话 Cookie 鉴权（Web）与 `API_KEY` Bearer（脚本/curl）并存
- 种子管理员账号；无自助注册（为二期预留字段与接口位）

### 1.4 Out of Scope（一期不做）

- 开放注册、邮箱验证、管理员审批流（仅预留）
- 完整设计系统 / 重型 UI 库
- OAuth / SSO
- 多人实时协同编辑
- 第三种界面语言

---

## 2. 工程结构与技术栈

### 2.1 仓库布局

```
prd-generator/
├── apps/
│   ├── api/                 # 现有后端迁入（Fastify + LangGraph）
│   └── web/                 # Vue 3 + Vite + TypeScript
├── packages/                # 可选：共享类型（后期再抽）
├── pnpm-workspace.yaml
└── package.json             # 根脚本：dev / build / test
```

一期也可先在仓库根保留 api、仅新增 `apps/web`，再在实现 plan 中安排迁入；**对外契约以「api + web 两应用」为准**。

### 2.2 Web 技术栈

| 项 | 选择 |
|---|---|
| 框架 | Vue 3 + Vite + TypeScript |
| 路由 | `vue-router` |
| i18n | `vue-i18n`（`zh-CN` / `en`） |
| 状态 | Pinia 或等价轻量模块（`user` / `thread` / `job`） |
| HTTP | `fetch` + `credentials: 'include'` |
| SSE | 自研 composable：`useSseStream`（POST + `ReadableStream` 解析） |
| UI 库 | 一期不强制；页面少，优先自写样式 |

### 2.3 开发与部署

- **开发**：Vite dev server；`/api` proxy 到 Fastify；cookie 需代理正确转发
- **生产**：`apps/web` build 产物由 `@fastify/static` 托管（例如输出到 api 的 `public/`）；浏览器同源访问，API 前缀 `/api/*`
- 根脚本建议：`pnpm dev` 并行起 api + web；`pnpm build` 先 web 再 api

---

## 3. 页面与路由

| 路由 | 鉴权 | 说明 |
|---|---|---|
| `/login` | 访客 | 用户名、密码、语言切换、错误提示 |
| `/` | 需登录 | 工作台：密钥区不再展示 API Key；上传、选项、进度、PRD、原型、审阅、导出 |
| 其他 | — | 未匹配 → 简单 404 或回工作台 |

**路由守卫**：无有效会话 → `/login?redirect=<原路径>`。顶栏：用户名、退出、UI 语言切换。

**不做**：注册页。二期可增 `/register`；一期不实现路由与 handler（或显式 501）。

---

## 4. 鉴权设计

### 4.1 两种调用方

| 调用方 | 鉴权方式 |
|---|---|
| Web SPA | 用户名密码登录 → **HttpOnly** 会话 Cookie |
| curl / 脚本 / 自动化 | `Authorization: Bearer <API_KEY>`（环境变量 `API_KEY`） |

中间件顺序建议：若存在有效会话用户 → 通过；否则若 Bearer 匹配 `API_KEY` → 通过；否则 401。  
`/api/health`、`/api/auth/login`、静态资源除外（login 自身需限流）。

### 4.2 用户模型（一期）

最小字段：

- `id`（uuid）
- `username`（唯一）
- `passwordHash`
- `role`：`admin` \| `user`
- `status`：`active` \| `disabled`（预留禁用）
- `email`（可空，预留）
- `createdAt` / `updatedAt`

**供应方式**：仅管理员预置。启动时或脚本用 `ADMIN_USER` / `ADMIN_PASSWORD` 确保至少一名 admin。无自助注册。

**密码**：argon2 或 bcrypt；禁止日志记录明文密码、Cookie、Authorization。

### 4.3 会话

- `POST /api/auth/login` `{ username, password }` → Set-Cookie；失败统一文案（防枚举）
- `POST /api/auth/logout` → 清会话
- `GET /api/auth/me` → 当前用户（前端启动/刷新用）
- Cookie：`HttpOnly`、`SameSite=Lax`（或 Strict）、生产 `Secure`
- 存储：开发可用 Memory；**建议与后续 Checkpointer 一并落 Postgres 会话/用户表**（避免二迁）

### 4.4 与原规格关系

- 原「页面输入 API Key」对 Web **取消**
- 原 API Key + 限流对非浏览器客户端 **保留**
- `OPENAI_API_KEY` / 模型密钥 **仅服务端**，永不下发前端
- 规格风险项 G20「二期用户体系」提前到本设计一期 Web 路径

### 4.5 二期注册预留（不实现）

- 表已含 `email`、`status`、`role`
- 文档标明可增：`POST /api/auth/register`、审批流；一期返回 404/501

---

## 5. 工作台功能（对齐原 Task 8，迁到 Vue）

1. 多文件选择 + 文本说明  
2. 选项：人机审阅、跳过原型、**输出语言** `options.language`  
3. 开始生成 → SSE 进度日志  
4. `awaiting_review`：批准 / 提交修改 → resume  
5. PRD：Markdown 预览 + JSON 切换  
6. 原型：`iframe` 且 `sandbox`（至少 `allow-scripts`；按安全评审可再收紧）  
7. 导出：已鉴权下载（Cookie 或脚本侧 Bearer）

生成 HTML **禁止** 用 `v-html` 注入父页面。

---

## 6. 语言策略

### 6.1 两套语言分离

| 维度 | 机制 | 默认 |
|---|---|---|
| UI 语言 | `vue-i18n` + `localStorage`（`ui_locale`） | `zh-CN` |
| 生成语言 | 请求 `options.language` | `zh-CN`（可选 `en`） |

UI 切换不自动改生成语言；生成语言不自动改 UI。允许「界面英文 + 产出中文 PRD」。

### 6.2 文案与错误

- 登录页与工作台全部可见字符串进 i18n 资源包  
- 后端错误带稳定 `code`；前端按 code 翻译；未知错误用通用文案 + 可折叠原始 message  
- 不按 `Accept-Language` 自动设置生成语言

---

## 7. 数据流与前端状态

```
Login → Cookie
  → Workbench submit (multipart + options) → POST /api/generate
  → SSE progress events
  → [optional] review → POST /api/threads/:id/resume
  → load PRD + prototype → export
```

状态至少包含：`user`、`threadId`、`phase`、`events[]`、`prd`、`prototypeHtml`、`uiError`。  
`threadId` 可写入 `localStorage` 以便刷新后尝试恢复（与现有 thread/checkpoint 能力对齐）。

---

## 8. 错误与安全

| 场景 | 行为 |
|---|---|
| 401 | 清前端用户态 → 跳转登录 |
| 429 | 限流提示 + 可重试提示 |
| 上传不合规 | 前端先校验类型/大小，服务端再校验 |
| 登录暴力尝试 | `/api/auth/login` 单独更严限流 |
| 生成限流 | Web 按 `userId`；脚本按 `API_KEY` |
| CORS | 生产同源或显式白名单，且支持 credentials |

---

## 9. 测试要点

- 未登录访问工作台 → 重定向登录  
- 种子用户登录成功 / 错误密码失败  
- Cookie 会话下生成与导出；Bearer `API_KEY` 脚本通路仍可用  
- 中/英 UI 切换无缺失 key（抽检）  
- SSE 主路径与 review resume  
- 原型 iframe 不污染父文档  
- 密码与 Authorization 不出现在日志明文

---

## 10. 对原计划的影响

| 原项 | 变更 |
|---|---|
| Task 8：`public/index.html` + `app.js` | 改为 `apps/web` Vue SPA |
| 仅 API Key 鉴权 | Web 会话 + API Key 双通路 |
| 无登录页 | 新增 `/login` 与用户/会话存储 |
| 实现 plan | 需另写/修订 frontend + auth 实现计划后再编码 |

---

## 11. 已确认决策摘要

1. 方案三：Vue 3 + Vite SPA + 完整中英 i18n  
2. 登录：账号密码；仅预置用户；后续可能开放注册（预留）  
3. Web 用会话 Cookie；`API_KEY` 留给非浏览器客户端；接受该拆分  
4. UI 语言与 `options.language` 分离  
5. 工程为 api + web；生产由 Fastify 托管前端构建产物  
|
