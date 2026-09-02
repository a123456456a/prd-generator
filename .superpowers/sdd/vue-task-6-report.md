# Vue Task 6 实施报告

## 状态

已完成 Vue i18n、认证 API 客户端、Pinia Auth store、路由守卫、登录页、语言切换、应用头部和工作台占位页。

## TDD 与验证

- RED：`router.spec.ts` 因 `./index` 尚不存在而按预期失败。
- GREEN：未登录访问 `/` 会调用 `/api/auth/me`，随后重定向到 `/login?redirect=/`。
- `pnpm --filter @prd/web test`：通过，1 个测试文件、1 个测试。
- `pnpm --filter @prd/web build`：通过，Vue TypeScript 检查与 Vite 生产构建成功。
- IDE 诊断：修改后的 `apps/web/src` 无 linter 错误。

## 自审

- `apiFetch` 始终使用 `credentials: "include"`，解析扁平 API 错误，并在 401 时清理认证用户。
- 路由包含 `/login`、受保护的 `/` 和 catch-all；登录后的 redirect 仅接受站内路径。
- `ui_locale` 支持 `zh-CN`/`en` 持久化；登录及占位工作台均为响应式中英 UI。
- 未实现 Task 7 工作台功能；未修改或提交现有无关 `AGENTS.md`。
- 构建产生的 `apps/web/tsconfig.app.tsbuildinfo` 变更属于生成内容，不纳入 Task 6 提交。
