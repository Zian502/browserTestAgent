# Extension package — Agent 说明

## 范围

面板与后台契约：`agent-runtime`、SSE 解析、`VITE_AGENT_API`。改 API 形状时需同步改 `packages/server` 控制器。

## 构建

- 扩展加载路径为 **构建后的 `dist/`**，改 `src/` 后需 watch 或重新 build。
