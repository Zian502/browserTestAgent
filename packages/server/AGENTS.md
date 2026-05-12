# Server package — Agent 说明

## 范围

本目录下修改时：优先读 `src/agents/graph.ts`、`state.ts` 与相关 `*-agent.ts`，避免破坏 LangGraph 边与 `dispatcher` 逻辑。

## 接口

- `POST /api/agent/run`：SSE，勿在无流式消费场景误改为普通 JSON。
- `POST /api/agent/run-test-code`：与扩展 `RunTestCodeModal` 对齐字段名。

## 任务计划

- `state.taskPlan` 为 **`TaskPlanMain[]`**：每项含 `id`、`title`、`pipeline` 与有序 **`subTasks`（`TaskPlanStep[]`）**。
- 调度与依赖判断使用 `graph-helpers.flattenTaskPlan()` 展平后的全局子任务 id。
