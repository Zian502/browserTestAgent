# Extension package — Agent 说明

## 范围

面板与后台契约：`agent-runtime`、SSE 解析、`VITE_AGENT_API`。`plan_created` 的 `payload` 为 **`TaskPlanMain[]`**（主任务 + `subTasks`），`task-store` 会归一化为 `mainTasks` 供 `TaskListCard` 分组展示。

## 构建

- 扩展加载路径为 **构建后的 `dist/`**，改 `src/` 后需 watch 或重新 build。
- **环境变量**：Vite 从 **monorepo 根目录 `.env`** 读取；客户端可用 `VITE_*` 前缀变量。`VITE_AGENT_API` 未设置时依次回退 `PUBLIC_BASE_URL` → `AUTH_CALLBACK_BASE_URL` → `http://localhost:${PORT}`。
