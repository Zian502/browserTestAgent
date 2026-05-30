import type { TestReviewContext } from '../state'

export const REVIEW_AGENT_SYSTEM_PROMPT =
  '你是 Playwright 自动化测试失败分析专家。根据用户目标、页面 URL、测试执行日志与错误信息，用中文输出简洁、可操作的复盘。' +
  ' **结构**（Markdown）：\n' +
  '1. **结论**：一句话说明失败性质（断言失败 / selector 无效 / 超时 / 环境等）。\n' +
  '2. **直接原因**：引用日志中的关键报错（勿编造未出现的错误）。\n' +
  '3. **可能根因**：2–4 条 bullet，结合页面场景推断（如 selector 臆造、URL 断言过窄、混淆币种与网络下拉等）。\n' +
  '4. **修复建议**：2–4 条具体改法（优先改 selector / 断言 / 前置步骤，而非空泛「检查网络」）。若代码含 `.item:nth-child(N)` / `.nth(N)` 选网络/链选项，须建议改为 `filter({ hasText: /ETH|Ethereum/i })` 等文案匹配，并说明 nth-child 在 `.select-view` 内顺序不可靠。\n' +
  ' **禁止**输出完整测试代码；**禁止**重复粘贴整段 runner 日志；日志过长时只摘取与失败段相关的 10–30 行。**禁止**建议用服务端 regex 事后替换 generated code；修复应通过 **test-code-agent 提示词** 让 LLM 生成正确 selector。'

export function buildReviewAgentUserMessage(ctx: TestReviewContext): string {
  const logBlob = ctx.logs.join('\n')
  const logTrimmed =
    logBlob.length > 12000 ? `${logBlob.slice(-12000)}\n…（日志已截断，仅保留尾部）` : logBlob

  return [
    `页面 URL：${ctx.pageUrl}`,
    `用户需求：${ctx.userInput}`,
    ctx.taskTitle ? `失败子任务：${ctx.taskTitle}` : '',
    `执行结果：通过 ${ctx.passed} · 失败 ${ctx.failed}`,
    ctx.error ? `Runner 错误：${ctx.error}` : '',
    '',
    '--- Runner 日志 ---',
    logTrimmed || '(无)',
    ctx.codePreview
      ? `\n--- 测试代码摘要（前 ${ctx.codePreview.length} 字符）---\n${ctx.codePreview}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatFallbackTestReview(ctx: TestReviewContext): string {
  const errLines = ctx.logs.filter((l) => /\[error\]|Error:|failed/i.test(l)).slice(-8)
  return (
    `## 测试失败复盘\n\n` +
    `**结论**：Playwright 执行未全部通过（通过 ${ctx.passed}，失败 ${ctx.failed}）。\n\n` +
    `**直接原因**：${ctx.error ?? (errLines.join('\n') || '见 runner 日志中的 [error] 行。')}\n\n` +
    `**说明**：未配置 LLM，以上为日志摘要；请查看完整 runner 输出定位 selector / 断言 / 超时问题。`
  )
}
