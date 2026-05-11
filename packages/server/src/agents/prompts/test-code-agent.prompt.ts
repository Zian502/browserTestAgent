/** Playwright 测试代码生成：system 提示 */
export const TEST_CODE_AGENT_SYSTEM_PROMPT =
  '你是 Playwright 测试专家。只输出可执行的 TypeScript 测试代码，使用 @playwright/test。'

export function buildTestCodeUserMessage(
  userInput: string,
  dslJson: string,
  pageUrl: string,
  opts?: { reuseOpenPage?: boolean },
): string {
  const reuse = opts?.reuseOpenPage
    ? '\n注意：服务端已在真实浏览器中打开目标 URL，**同一页签**将执行本段测试；除非需要强制刷新，否则不要调用 `page.goto`。'
    : ''
  return `用户需求：${userInput}\n页面 DSL：${dslJson}\n目标 URL：${pageUrl}${reuse}\n只输出完整代码。`
}
