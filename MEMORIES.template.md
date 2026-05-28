# Cursor Memories — 建议条目（复制到 Cursor → Memories）

> 将下面 **「---」之间的块** 按需拆成多条 Memory 粘贴到 Cursor；本文件可随项目演进更新并提交到 Git。

---

**项目名称**：browserTestAgent（Browser Test Agent）。pnpm monorepo：根目录脚本 `dev:server` / `dev:extension` / `build`；包名 `@browser-test-agent/server` 与 `@browser-test-agent/extension`。

---

**后端默认端口**：3850；环境变量 `PORT` 可覆盖。Nest 入口 `packages/server/src/main.ts`，CORS 已开启。扩展默认请求 `http://localhost:3850`，构建时用 `VITE_AGENT_API` 覆盖。

---

**LLM**：OpenAI 兼容 API；密钥链见 `packages/server/src/agents/llm-client.ts`（`LLM_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 等）。默认 base URL 指向 DeepSeek 兼容端点。

---

**编排**：LangGraph 状态机在 `packages/server/src/agents/graph.ts`；共享状态定义在 `state.ts`。主接口 SSE：`POST /api/agent/run`；单独跑测试代码：`POST /api/agent/run-test-code`。

---

**Playwright**：服务端 Chromium/CDP；工具在 `packages/server/src/tools/playwright.ts`。首次需在该包执行 `pnpm run playwright:install`。会话与复用逻辑见 `lib/playwright-browser-session.ts`。挂接本机 Chrome：`PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222`（Chrome 需 `--remote-debugging-port=9222`），见 `lib/playwright-cdp-connect.ts`。

---

**缓存目录**：`packages/server/.agent-cache/`（gitignore），勿提交。PageSpeed 无 `PAGESPEED_API_KEY` / `GOOGLE_PSI_API_KEY` 时为 stub 数据。

---

**用户偏好**：与用户对话时默认使用 **中文**（若用户规则中有要求）。

---

## English (optional duplicate memories)

- **Project**: `browserTestAgent` — pnpm monorepo; Nest + LangGraph server in `packages/server`, Chrome MV3 extension in `packages/extension`.
- **Default API port**: `3850`; extension default base `http://localhost:3850`, overridable via `VITE_AGENT_API`.
