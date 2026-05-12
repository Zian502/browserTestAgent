# Extension package — Agent 说明

## 范围

面板与后台契约：`agent-runtime`、SSE 解析、`VITE_AGENT_API`。`plan_created` 的 `payload` 为 **`TaskPlanMain[]`**（主任务 + `subTasks`），`task-store` 会归一化为 `mainTasks` 供 `TaskListCard` 分组展示。

## 构建

- 扩展加载路径为 **构建后的 `dist/`**，改 `src/` 后需 watch 或重新 build。
