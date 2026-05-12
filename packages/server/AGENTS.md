# Server package — Agent 说明

## 范围

本目录下修改时：优先读 `src/agents/graph.ts`、`state.ts` 与相关 `*-agent.ts`，避免破坏 LangGraph 边与 `dispatcher` 逻辑。

## 接口

- `POST /api/agent/run`：SSE，勿在无流式消费场景误改为普通 JSON。
- `POST /api/agent/run-test-code`：与扩展 `RunTestCodeModal` 对齐字段名。

## 环境

- `.env` 由 `load-env.ts` 向上查找；LLM 与 Playwright 相关变量见 `llm-client.ts` 与 README。
