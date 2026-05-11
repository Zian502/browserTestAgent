/**
 * mainAgent 为 LangGraph 入口节点，仅路由到 planAgent，无 LLM、无对话提示词。
 * 保留此文件与「一 agent 一文件」约定对齐。
 */
export const MAIN_AGENT_HAS_LLM_PROMPTS = false as const

/** 请求体缺少页面上下文时，通过 SSE `text` 事件返回给前端的说明文案 */
export const MISSING_PAGE_CONTEXT_MESSAGE = `当前请求里 **pageUrl** 为空，无法通过 Playwright 打开页面、解析结构或调用 PageSpeed。

请提供完整 \`https://\` 或 \`http://\` 页面地址（扩展侧会自动带上当前标签页；Web 调试请在对话里先发链接）。请求体需设置 **usePlaywright: true**（JSON 布尔），由 Playwright 打开浏览器并经 CDP 读取 HTML。

补充完整后请重新发送任务。`
