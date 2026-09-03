# 用户自助配置模型提供商（BYOK）— 需求规格说明书

| 项 | 内容 |
|---|---|
| 文档版本 | v0.1（草稿，待评审） |
| 日期 | 2026-09-03 |
| 状态 | 待确认（用于讨论与拍板，未冻结） |
| 关联 | `2026-09-02-prd-generator-requirements.md`（§5.1/§6.4/G20 模型与鉴权基线）、`2026-09-02-frontend-vue-auth-design.md`（§4.4 现状：模型密钥仅服务端 env，不下发前端 —— 本文档提出的变更将修订此约束） |
| 提出人 | 用户需求（本轮对话） |

---

## 0. 一句话描述

> 让登录用户在「设置」页自助添加/管理自己的模型提供商（DeepSeek、智谱 GLM、阿里云百炼/通义千问、OpenAI、Anthropic Claude 等，及自定义 OpenAI 兼容端点），系统按提供商自动确定 `baseURL`；用户只需粘贴自己的 API Key；Key 一旦保存，后端**加密存储**，前端与任何接口响应中**永不回显明文**，仅展示掩码（如 `sk-ab********wxyz`）。

---

## 1. 背景与动机

### 1.1 现状（改造前）

- 现有实现（`apps/api/src/config.ts`、`apps/api/src/graph/workflow.ts`）里模型访问方式是**唯一、全局、服务端**的：
  - 只支持 OpenAI（`new ChatOpenAI({ model })`），Key 来自进程环境变量 `OPENAI_API_KEY`。
  - 模型名通过 `EXTRACT_MODEL` / `PRD_MODEL` 两个环境变量配置，所有用户共用同一份 Key、同一个账单。
  - 《前端 SPA + 用户登录设计》§4.4 明确写着："`OPENAI_API_KEY` / 模型密钥仅服务端，永不下发前端"——当时的设计前提是**没有自助配置 Key 的入口**，密钥只能由运维改环境变量。
- 系统已具备多用户模型（`users` 表，`role: admin|user`），但模型调用与用户身份无关联，无法做到"各用户用各自的 Key/额度"。

### 1.2 问题

1. 只能用 OpenAI，且必须由部署方统一开户/付费，团队内其他人无法用自己已有的 DeepSeek / 智谱 / 阿里百炼 / Claude 账号。
2. 无法按用户区分成本与配额，所有 token 消耗都记在同一个 Key 上。
3. 换供应商、换 Key 需要改环境变量并重启进程，运维成本高，普通用户无法自主操作。

### 1.3 目标

- 允许任意登录用户在页面上**自助添加、编辑、删除、测试、启用/停用**自己的模型提供商配置。
- 预置常见提供商（DeepSeek、智谱 GLM、阿里云百炼/通义千问、OpenAI、Anthropic Claude），选择后自动带出对应的 `baseURL`（只读展示，不需要用户自己去查文档）；同时支持"自定义 OpenAI 兼容"类型让用户手填 `baseURL`（用于私有部署 / 中转网关 / 其它兼容供应商）。
- 用户只需粘贴自己的 API Key。**Key 全生命周期不以明文形式出现在**：页面渲染、任何 API 响应体、服务端日志、错误信息。
- 生成任务（`/api/generate` 等）默认使用发起用户自己配置的、标记为"默认"的提供商与模型；用户未配置任何提供商时，回退到系统级环境变量配置（保持向后兼容，不破坏现有部署）。

---

## 2. 范围界定

### 2.1 本期 In Scope

- 「模型提供商」管理页面（新增路由，如 `/settings/providers`），登录用户可见、仅管理自己的配置。
- 预置提供商元数据（名称、`baseURL`、认证方式、默认/可选模型列表）：OpenAI、DeepSeek、智谱 GLM（Zhipu / BigModel）、阿里云百炼（DashScope / 通义千问 Qwen，OpenAI 兼容模式）、Anthropic Claude；以及一个「自定义（OpenAI 兼容）」类型。
- 新增/编辑/删除/设为默认/启用停用/测试连接 API + UI。
- Key 的**加密存储**、**掩码展示**、**只写不回读明文**。
- 生成任务的模型选择逻辑改造：优先用户默认提供商 → 回退系统默认（env）。
- 每个提供商配置可覆盖具体模型名（如 `deepseek-chat`、`glm-4.6`、`qwen-plus`、`gpt-4o`、`claude-sonnet-4.5` 等），支持任务级临时覆盖（沿用现有 `options.model` 语义）。
- 后端模型工厂（`modelFactory`）改造为可按 `provider + baseURL + apiKey` 动态构建 `ChatOpenAI` 或 `ChatAnthropic` 客户端。
- 审计日志：记录"谁在何时新增/删除/切换了哪个提供商配置"（不含明文 Key）。

### 2.2 本期 Out of Scope（后续/不做）

| 暂不做 | 说明 |
|---|---|
| 团队/组织级共享 Key、按角色分配 Key | 一期 Key 归属到单个用户，`admin` 也只能管理自己的；管理员统一分发是二期话题 |
| Key 用量计量与计费展示（按 Key 拆分 token 统计） | 现有 `usage_daily` 按 `principal_key`（IP/用户）统计，本期不细分到 provider 维度，二期可扩展 |
| 更多提供商（Moonshot/Kimi、百度文心、字节豆包等） | 架构做成可插拔注册表，本期先覆盖标题中列出的 5 家 + 自定义，其余留 Provider Registry 扩展位 |
| 自动路由/多提供商投票、故障自动切换 | 二期 |
| 前端本地缓存明文 Key（如"记住密码") | 明确不做，任何形式都不允许 |
| OAuth 式授权（如"用 OpenAI 账号登录授权"） | 各家均无此机制，维持 API Key 模式 |

---

## 3. 预置提供商注册表（Provider Registry）

系统内置一份提供商元数据表，作为前端下拉选项与后端 `baseURL` 自动填充的唯一数据源（后端也要有，避免前端伪造 `baseURL` 绕过白名单）。

| providerId | 展示名 | 默认 `baseURL` | 协议兼容性 | 鉴权头 | 示例模型 | LangChain 客户端 |
|---|---|---|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com/v1` | 原生 OpenAI | `Authorization: Bearer <key>` | `gpt-4o`、`gpt-4o-mini` | `@langchain/openai` `ChatOpenAI` |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | OpenAI 兼容 | `Authorization: Bearer <key>` | `deepseek-chat`、`deepseek-reasoner` | `ChatOpenAI`（覆盖 `configuration.baseURL`） |
| `zhipu` | 智谱 GLM（BigModel） | `https://open.bigmodel.cn/api/paas/v4/` | OpenAI 兼容 | `Authorization: Bearer <key>` | `glm-4.6`、`glm-4.5-air` | `ChatOpenAI`（覆盖 `configuration.baseURL`） |
| `alibaba` | 阿里云百炼（通义千问 / DashScope） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 | `Authorization: Bearer <key>` | `qwen-plus`、`qwen-max` | `ChatOpenAI`（覆盖 `configuration.baseURL`） |
| `anthropic` | Anthropic Claude | `https://api.anthropic.com` | 原生 Anthropic（非 OpenAI 兼容） | `x-api-key: <key>` | `claude-sonnet-4.5`、`claude-opus-4.1` | `@langchain/anthropic` `ChatAnthropic` |
| `custom_openai` | 自定义（OpenAI 兼容） | 用户手填，必填，需 `https://` | OpenAI 兼容 | `Authorization: Bearer <key>` | 用户手填 | `ChatOpenAI`（覆盖 `configuration.baseURL`） |

说明：

1. 前 4 个 + `custom_openai` 均走 OpenAI Chat Completions 协议，只是 `baseURL` 与模型名不同，后端可用同一套 `ChatOpenAI` 适配层处理；仅 `anthropic` 需要单独的 SDK/客户端与鉴权头（`x-api-key` 而非 `Authorization: Bearer`），需新增依赖 `@langchain/anthropic`。
2. 预置的 `baseURL` 允许被"高级选项"覆盖（例如阿里云百炼的业务空间专属域名 `https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`），但默认值必须是上表中的通用域名，保证零配置可用。
3. 模型列表本期为**静态预置 + 用户可手填自定义模型名**，不做"调用提供商接口拉取实时模型列表"（避免为拉列表就要求用户先填 Key 才能选模型的先鸡后蛋问题；作为二期增强项）。
4. Provider Registry 以后端一份 JSON/TS 常量为准（例如 `apps/api/src/services/providerRegistry.ts`），前端通过 `GET /api/providers/catalog` 获取，避免前后端定义漂移。

---

## 4. 功能需求详述

### 4.1 提供商配置管理（FR-PROVIDER）

每个登录用户可以维护 0..N 条"提供商配置"（Provider Credential），字段：

```ts
interface ProviderCredential {
  id: string;                // uuid
  ownerUserId: string;
  providerId: "openai" | "deepseek" | "zhipu" | "alibaba" | "anthropic" | "custom_openai";
  label: string;              // 用户自定义备注名，如 "工作 DeepSeek"
  baseUrl: string;            // 预置带出，custom_openai 必填手动填写
  apiKeyMasked: string;       // 展示用掩码，如 "sk-ab********wxyz"；绝不返回明文
  defaultModel: string;       // 该配置下默认使用的模型名
  extraModels: string[];      // 该配置下可选的其它模型名（可选）
  isDefault: boolean;         // 是否为该用户当前默认使用的提供商
  enabled: boolean;           // 停用后不可被选用，但保留记录
  lastTestedAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  createdAt: string;
  updatedAt: string;
}
```

行为规则：

1. 新增时选择 `providerId`：
   - 非 `custom_openai`：`baseUrl` 自动带出且默认只读（UI 提供"高级：自定义 baseURL"折叠项，允许有经验的用户覆盖，例如切换阿里云区域域名）。
   - `custom_openai`：`baseUrl` 必填，需通过格式校验（`https://` 开头）。
2. 同一用户可以为同一个 `providerId` 建多条配置（例如两个不同的 DeepSeek 账号），用 `label` 区分。
3. `isDefault` 在用户维度唯一：设置一条为默认时，该用户下其它配置自动取消默认（后端事务保证）。
4. 删除某配置时，如果它是当前默认且还有其它可用配置，需提示用户重新选择默认，或自动降级为"无默认，回退系统配置"。
5. 新用户 / 未配置任何提供商时，`GET /api/providers` 返回空列表，生成任务走"系统默认"回退（§4.5）。

### 4.2 密钥安全存储与展示（FR-SECRET）— 核心安全要求

1. **加密存储**：Key 使用服务端对称加密（AES-256-GCM）落库，密文 + `iv` + `authTag` 一起存储；加密主密钥来自新增环境变量 `CREDENTIAL_ENCRYPTION_KEY`（32 字节，Base64/hex），**不入库、不进代码仓库**，生产启动校验其存在且非默认值（参照现有 `assertProductionConfig` 的模式，新增一条校验）。
2. **只写不回读明文**：
   - `POST /api/providers`、`PATCH /api/providers/:id` 请求体里的 `apiKey` 字段仅用于当次加密写入，服务端处理完立即从内存/日志上下文中丢弃引用；响应体和后续任何 `GET` 都只返回 `apiKeyMasked`。
   - 编辑一条已存在配置且不想改 Key 时，前端不传 `apiKey` 字段（或传空/占位符），后端保持原密文不变——绝不允许"为了修改其它字段被迫重新粘贴 Key"。
   - 掩码规则：保留前 4 位与后 4 位真实字符，中间用固定长度 `*` 遮盖（不透露真实长度，避免长度侧信道），如：`sk-ab********wxyz`；不足 8 位的极短 Key 全部遮盖为 `****`。
3. **前端展示**：
   - 输入框 `type="password"`，`autocomplete="new-password"`，禁止浏览器/表单自动填充历史明文。
   - 已保存配置的列表/详情页只显示 `apiKeyMasked`；不提供"点击显示明文"功能（不同于常见的"眼睛图标显示密码"模式——因为服务端从不返回明文，前端根本拿不到）。
   - 复制/粘贴到剪贴板等交互只在"首次输入"阶段允许，保存后的掩码值不可复制出有效 Key。
4. **传输安全**：所有相关接口只走 HTTPS（生产 `COOKIE_SECURE=true` 语境下应同样要求 API 走 TLS）；Key 只在请求体（不在 URL query）中传递。
5. **日志脱敏**：结构化日志、错误堆栈、SSE 事件、审计日志中，Key 字段一律替换为掩码或 `[REDACTED]`，与现有"密码/Authorization 不出现在日志明文"的规范保持一致（参照 `2026-09-02-frontend-vue-auth-design.md` §8）。
6. **删除**：删除配置为硬删除密文（不做"软删除仍保留密文"），避免残留可解密数据。
7. **访问控制**：普通用户只能 CRUD 自己 `ownerUserId` 下的配置；`admin` 角色本期**不能**查看/管理其他用户的 Key（无后门接口），符合"用户自己的 Key 自己管"的诉求；如需管理员代运维能力，留待二期单独评审（不应弱化本条安全约束）。

### 4.3 连接测试（FR-TEST）

- `POST /api/providers/:id/test`：用当前已保存（或本次提交但未保存）的 `baseUrl` + Key 发起一次极小成本的探测请求（如极短 `max_tokens` 的一次 completion，或提供商的 models 端点，若不可用则用最小 chat 请求兜底）。
- 返回 `{ ok: boolean, latencyMs?: number, errorCode?: string, message?: string }`；不返回底层原始错误全文中的敏感信息（如某些网关会把 Key 回显在错误信息里，需二次脱敏过滤）。
- 结果写入 `lastTestedAt` / `lastTestStatus`，前端在列表用绿色/红色角标呈现。
- 限流：同一配置测试接口最少间隔（如 5s），防止被当成压测/爆破探针。

### 4.4 生成任务中的提供商选择（FR-SELECT）

1. 工作台「生成设置」新增可选项：
   - 「使用我的模型提供商」下拉：列出当前用户已启用的配置（`label` + provider 名），默认选中 `isDefault=true` 的一条；用户没有任何配置时该区域提示"未配置，将使用系统默认模型"并隐藏下拉。
   - 模型名下拉：跟随所选配置的 `defaultModel` / `extraModels`，也允许手填任意模型名（高级用户，兼容提供商新模型上线快于本系统维护速度的情况）。
2. `POST /api/generate` 请求体 `options` 增加可选字段 `providerCredentialId`（不传则用用户默认配置 → 无默认则用系统配置）；`model` 字段语义不变（覆盖具体模型名）。
3. 后端在任务创建时解析出 `{ providerId, baseUrl, decryptedApiKey, model }`，仅在**内存**中传给当次 LangGraph run 的 `modelFactory` 闭包使用，不落入 `tasks` 表的 `config` JSON（`config` 里只能存 `providerCredentialId` 引用，不能存 Key 或解密后的值），避免明文随任务记录持久化。
4. 每个任务运行期间只解密一次、用完即释放引用；不做进程级缓存解密结果（避免内存长期持有明文 Key）。

### 4.5 系统级默认回退（FR-ADMIN-FALLBACK，向后兼容）

- 保留现有环境变量 `OPENAI_API_KEY` / `EXTRACT_MODEL` / `PRD_MODEL` 作为"系统默认提供商"，`providerId` 固定为 `openai`。
- 决策优先级：`任务显式指定 providerCredentialId` → `用户默认配置（isDefault=true）` → `系统默认（env）` → 三者皆无则任务创建时报错 `NO_MODEL_PROVIDER_CONFIGURED`，提示用户先去设置页添加。
- 现有仅依赖 env 的部署方式（未接入本功能的老用户）行为不变，实现零迁移成本。

---

## 5. 数据模型（新增表）

新增 Postgres 迁移（追加到 `apps/api/migrations/`，如 `002_model_providers.sql`），并同步实现内存态（`MemoryProviderStore`，供无 `DATABASE_URL` 的开发环境使用，与现有 `memoryUserStore`/`memorySessionStore` 模式一致）：

```sql
CREATE TABLE IF NOT EXISTS model_provider_credentials (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL CHECK (provider_id IN
    ('openai', 'deepseek', 'zhipu', 'alibaba', 'anthropic', 'custom_openai')),
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_ciphertext BYTEA NOT NULL,
  api_key_iv BYTEA NOT NULL,
  api_key_auth_tag BYTEA NOT NULL,
  api_key_last4 TEXT NOT NULL,       -- 用于掩码展示，如 "wxyz"
  api_key_first4 TEXT NOT NULL,      -- 用于掩码展示，如 "sk-a"
  default_model TEXT NOT NULL,
  extra_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_status TEXT CHECK (last_test_status IN ('success', 'failed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 同一用户最多一条默认配置
CREATE UNIQUE INDEX IF NOT EXISTS model_provider_credentials_one_default_per_user
  ON model_provider_credentials (owner_user_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS model_provider_credentials_owner_idx
  ON model_provider_credentials (owner_user_id);
```

`tasks` 表增量字段（用于追溯任务使用了哪条配置，不存密钥）：

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_credential_id UUID
  REFERENCES model_provider_credentials(id) ON DELETE SET NULL;
```

---

## 6. API 设计（新增端点）

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| `GET` | `/api/providers/catalog` | 返回预置提供商元数据（§3 表格内容：providerId、展示名、默认 baseURL、是否需要 `custom` baseURL、示例模型） | 需登录 |
| `GET` | `/api/providers` | 列出当前用户的全部配置（掩码） | 需登录，仅本人 |
| `POST` | `/api/providers` | 新增配置：`{ providerId, label, baseUrl?, apiKey, defaultModel, extraModels?, isDefault? }` | 需登录 |
| `PATCH` | `/api/providers/:id` | 编辑：同上字段均可选；不传 `apiKey` 则保留原值 | 需登录，仅本人 |
| `POST` | `/api/providers/:id/set-default` | 设为默认（互斥其它配置） | 需登录，仅本人 |
| `POST` | `/api/providers/:id/enable` \| `/disable` | 启用/停用 | 需登录，仅本人 |
| `POST` | `/api/providers/:id/test` | 连接测试 | 需登录，仅本人 |
| `DELETE` | `/api/providers/:id` | 删除（硬删除密文） | 需登录，仅本人 |

请求/响应示例：

```ts
// POST /api/providers  请求
{
  "providerId": "deepseek",
  "label": "工作 DeepSeek",
  "apiKey": "sk-abcd1234...wxyz",
  "defaultModel": "deepseek-chat",
  "isDefault": true
}

// 响应（201）—— 全程不回显明文
{
  "id": "b7e0...",
  "providerId": "deepseek",
  "label": "工作 DeepSeek",
  "baseUrl": "https://api.deepseek.com",
  "apiKeyMasked": "sk-a********wxyz",
  "defaultModel": "deepseek-chat",
  "extraModels": [],
  "isDefault": true,
  "enabled": true,
  "lastTestedAt": null,
  "lastTestStatus": null,
  "createdAt": "2026-09-03T08:00:00Z",
  "updatedAt": "2026-09-03T08:00:00Z"
}
```

错误码新增：`INVALID_BASE_URL`（自定义 baseURL 格式不合法）、`PROVIDER_NOT_FOUND`、`PROVIDER_TEST_FAILED`、`NO_MODEL_PROVIDER_CONFIGURED`（§4.5）。

---

## 7. 前端设计

### 7.1 路由与入口

- 新增路由 `/settings/providers`（需登录守卫，与工作台同级），顶栏 `AppHeader.vue` 增加入口（如齿轮图标/「模型设置」）。
- 工作台生成表单内嵌"当前使用的提供商"只读摘要 + 「去设置」快捷链接。

### 7.2 页面结构（模型提供商设置页）

1. **配置列表**：卡片/表格展示每条配置的 `label`、提供商图标+名称、`baseUrl`（缩略）、`apiKeyMasked`、默认模型、`isDefault` 标签、启用状态、上次测试结果角标；操作列：设为默认 / 编辑 / 测试 / 停用 / 删除（删除需二次确认弹窗）。
2. **新增/编辑表单**（弹窗或独立面板）：
   - 第一步选提供商（图标网格或下拉：OpenAI / DeepSeek / 智谱 / 阿里云百炼 / Claude / 自定义）。
   - 选中后自动带出 `baseURL`（只读文本，附"高级：自定义"折叠开关）。
   - `label` 输入（必填，便于用户区分多条配置）。
   - Key 输入（`type="password"`，占位符提示去哪申请，例如"在 DeepSeek 控制台生成的 API Key"；编辑态下留空表示不修改，旁边展示当前掩码值作为提示）。
   - 默认模型下拉（预置候选 + 可手填自定义模型名）。
   - 「测试连接」按钮（异步，loading/成功/失败三态提示，失败展示可读错误但不含敏感细节）。
   - 保存 / 取消。
3. 全程使用现有 `vue-i18n`（`zh-CN` / `en`）补充文案，遵循现有工作台的响应式（mobile-first）与错误提示模式。

### 7.3 交互与状态

- 保存成功后立刻刷新列表，新纪录只展示掩码。
- 首次进入且列表为空：展示引导卡片"添加你的第一个模型提供商"，附各家控制台/开通页外链（纯文档链接，不代替用户跳转授权）。
- 设为默认时若原默认配置存在，前端提示"将替换当前默认"；后端保证互斥。

---

## 8. 与现有架构的集成点

1. **`apps/api/src/config.ts`**：新增 `credentialEncryptionKey` 字段，`assertProductionConfig` 增加校验（缺失或为占位值时生产环境拒绝启动，模式与 `apiKey`/`adminPassword` 校验一致）。
2. **`apps/api/src/services/providerRegistry.ts`（新增）**：承载 §3 的预置提供商元数据（唯一数据源），供路由与前端 `catalog` 接口复用。
3. **`apps/api/src/services/credentialCrypto.ts`（新增）**：封装 AES-256-GCM 加解密与掩码生成的纯函数，供 provider store 使用；单元测试覆盖"加密后无法从密文/掩码反推明文长度或内容"。
4. **`apps/api/src/auth/*ProviderStore.ts`（新增，Memory + Postgres 两实现）**：CRUD、"仅一个默认"事务、硬删除，模式对齐现有 `memoryUserStore.ts` / `postgresUserStore.ts`。
5. **`apps/api/src/graph/workflow.ts` / `state.ts`**：`modelFactory` 签名从 `(model: string) => GraphModel` 扩展为可携带 `{ providerId, baseUrl, apiKey, model }`；新增 `anthropic` 分支使用 `@langchain/anthropic`（需在 `apps/api/package.json` 新增依赖），其余走带 `configuration.baseURL` 覆盖的 `ChatOpenAI`。
6. **`apps/api/src/services/taskService.ts`**：任务创建时按 §4.5 优先级解析出本次运行要用的凭据，只在内存传递，`tasks.config` 落库时只存 `providerCredentialId` 引用。
7. **`apps/web`**：新增 `stores/providers.ts`（Pinia）、`views/ProviderSettingsView.vue`、路由项、i18n 词条；`stores/job.ts` 的 `StartGenerateInput`/`options` 增加 `providerCredentialId?` 与模型覆盖字段。
8. **依赖新增**：`@langchain/anthropic`（Claude 支持）；其余提供商复用现有 `@langchain/openai` + `configuration.baseURL` 覆盖，无需新增 SDK。

---

## 9. 非功能需求

### 9.1 安全（本功能的核心非功能项，优先级高于其它一切）

- 见 §4.2 全部条款；额外要求：
  - 加密主密钥轮换预案：文档需说明"更换 `CREDENTIAL_ENCRYPTION_KEY` 会导致既有密文不可解密"，上线前必须给出运维指引（一期可要求"不可轮换，如需轮换需批量提示用户重新填 Key"，二期做双密钥滚动解密）。
  - 速率限制：新增/测试接口纳入现有按用户/IP 的限流策略，防止批量爆破验证第三方 Key 有效性。
  - 渗透测试关注点：确认响应体、错误堆栈、SSE 日志、Postgres 慢查询日志中均不出现明文 Key（尤其是 `custom_openai` 场景下用户可能把 Key 错填进 `baseUrl` 字段——需校验/提示，不将其原样存回）。

### 9.2 兼容性与可扩展性

- Provider Registry 设计为数据驱动（新增一个提供商只需加一条元数据 + 若非 OpenAI 兼容协议则加一个客户端适配分支），不应要求改动路由/UI 结构本身。
- 与现有"系统默认 env Key"共存，零停机迁移。

### 9.3 性能

- Provider CRUD 接口属于低频管理操作，性能目标与现有 `非 LLM API < 500ms` 基线一致。
- 加解密（AES-256-GCM，单条 Key 数十字节）耗时可忽略（&lt; 5ms）。

### 9.4 国际化

- 新增页面文案纳入 `zh-CN` / `en` 双语资源包，与现有 i18n 基线一致。

### 9.5 可观测性

- 新增审计事件：`provider.created` / `provider.updated` / `provider.deleted` / `provider.set_default` / `provider.test_failed`，记录 `userId`、`providerId`、`credentialId`、时间，**不含 Key 或掩码之外的任何密钥片段**。

---

## 10. 验收用例（草案）

| ID | 场景 | 期望 |
|---|---|---|
| MP-01 | 用户新增一条 DeepSeek 配置并保存 | 列表展示掩码 Key；数据库中仅存密文，无明文列 |
| MP-02 | 编辑该配置只改 `label`，不填 `apiKey` | Key 密文不变，`label` 更新成功 |
| MP-03 | 任意接口响应体、服务端日志检索 Key 明文片段 | 全链路搜索不到明文（自动化测试用固定 Key 前缀断言） |
| MP-04 | 用户设置第二条配置为默认 | 原默认配置 `isDefault` 自动置 false，且数据库唯一索引不冲突 |
| MP-05 | 用户点击"测试连接"，Key 无效 | 返回 `ok:false` 且错误信息不泄露 Key 片段 |
| MP-06 | 用户删除唯一的默认配置后发起生成任务 | 任务创建失败并返回 `NO_MODEL_PROVIDER_CONFIGURED`，或按约定回退系统默认（取决于是否配置了 env） |
| MP-07 | 选择 `custom_openai` 但 `baseUrl` 填了非 `https://` 值 | 400 `INVALID_BASE_URL` |
| MP-08 | 选择 Anthropic Claude 提供商并生成任务 | 后端走 `ChatAnthropic` 分支，鉴权头为 `x-api-key`，任务正常完成 |
| MP-09 | 用户 A 尝试通过接口访问用户 B 的配置 ID | 403/404，不泄露是否存在 |
| MP-10 | 未配置任何提供商的老用户（现有部署） | 生成任务行为与升级前一致（走系统默认 env Key） |

---

## 11. 开放问题（需在开工前拍板）

| # | 问题 | 建议默认（待确认） |
|---|---|---|
| Q1 | 管理员是否需要"全局提供商模板"能力（给团队预置一批 Key，用户直接选用而非自己申请）？ | 一期不做，用户各自持有 Key；二期评估 |
| Q2 | `admin` 是否需要只读审计视图（看到"谁配置了哪个 provider"但看不到 Key）？ | 可以做，成本低，建议一期顺带加一个只读审计列表 |
| Q3 | 加密主密钥的轮换/多密钥支持是否要一期做？ | 建议先不做，仅在文档里写清风险与运维手册 |
| Q4 | 是否需要按 provider/credential 维度的 Token 用量统计（细化现有 `usage_daily`）？ | 二期，本期只需保证任务记录里能追溯到 `provider_credential_id` |
| Q5 | 阿里云百炼是否要支持"业务空间专属域名"这种带变量的 baseURL 模板，还是只给通用域名？ | 一期给通用域名 + 高级自定义覆盖开关即可满足两种场景 |
| Q6 | Claude（Anthropic）等非 OpenAI 协议供应商未来若增多，是否要抽象统一的 `ChatModelAdapter` 接口？ | 建议做，`modelFactory` 内部按 `providerId` 分发到不同适配器，为后续供应商预留位置 |

---

## 12. 参考

- 现有实现：`apps/api/src/config.ts`、`apps/api/src/graph/workflow.ts`、`apps/api/src/graph/state.ts`
- `docs/superpowers/specs/2026-09-02-prd-generator-requirements.md`
- `docs/superpowers/specs/2026-09-02-frontend-vue-auth-design.md`
- OpenAI 兼容 Base URL：DeepSeek `https://api.deepseek.com`；智谱 `https://open.bigmodel.cn/api/paas/v4/`；阿里云百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Anthropic 原生 API：`https://api.anthropic.com`（`@langchain/anthropic`）

---

**文档状态说明：** 本文档为需求整理草案（v0.1），尚未冻结。建议评审后按本仓库既有流程补一份 `*-design.md`（设计说明）与实现 `plan`，再进入编码阶段。
