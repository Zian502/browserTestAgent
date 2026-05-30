# Browser Test Agent — Agent 说明

面向本仓库的 **Cursor Agent / 自动化助手** 的简要约定（与 `.cursor/rules` 互补）。

## 仓库与命令

- **Monorepo**：pnpm；根目录 `pnpm run dev:server`、`pnpm run dev:extension`、`pnpm run build`。
- **服务端**：`packages/server`（NestJS + LangGraph + Playwright）。
- **扩展**：`packages/extension`（Vite + React 19，MV3）。

## 修改代码时

- 只改与任务相关的文件；避免无关重构与大面积格式化。
- 服务端请求 API 已异步化时注意与 Nest / Node 版本一致。
- 不要提交密钥、`.env`、`.agent-cache/`、`.pnpm-store/`。
- 与用户交流：**中文**（若用户另有说明则从其说明）。
- **Playwright 网络/链下拉**：禁止在测试代码或 prompt 中鼓励 `nth-child` 选选项；须 `filter({ hasText })`。见 `.cursor/rules/playwright-network-dropdown.mdc`；**不要**在 `test-code-agent.ts` 用 regex 事后替换 selector。

## 文档

- 项目说明：`README.md`（英文）、`README.zh-CN.md`（中文）。
