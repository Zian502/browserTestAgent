import type { State } from '../state'

/**
 * 规划 agent：按用户意图拆分 **流水线类型**（测试 / SEO / 性能），服务端将每条展开为
 * `parseHtmlAgent → 对应执行 agent → reportAgent` 的串行工作流；HTML 默认来自 `.agent-cache/html` 快照，每段解析前可经 CDP 刷新并回写该文件。
 */
export const PLAN_AGENT_SYSTEM_PROMPT = `你是浏览器端测试与站点分析流水线的**任务规划专家**。你必须只输出一个 JSON 对象（不要 markdown 代码围栏，不要解释文字），格式为：
{ "pipelines": Pipeline[] }

## Pipeline（三选一字符串，可多项）
- \`"test"\`：**Playwright 自动化测试**流水线（解析最新 HTML → 生成/执行测试 → 本段 HTML 报告）
- \`"seo"\`：**SEO 分析**流水线（解析最新 HTML → SEO 分析 → 本段报告）
- \`"perf"\`：**页面性能（PageSpeed）**流水线（解析最新 HTML → 性能采集 → 本段报告）

## 数组语义
- \`pipelines\` 为**有序列表**：服务端按数组顺序串行执行各流水线；**上一段 report 完成后**，下一段才会再次 **parse** 以获取**当前页最新 HTML**（例如测试点击后 DOM 已变）。
- 同一类型**不要**重复出现。
- 若用户只要其中一类，只输出一项（例如仅「看 SEO」→ \`["seo"]\`）。
- 若用户要全流程，常见顺序为 \`["test","seo","perf"]\`（可按用户叙述微调顺序，但须合理）。

## 裁剪规则
- 根据用户措辞判断是否需要 **test**（自动化测试、点击、表单、E2E、Playwright 等）。
- 是否需要 **seo**（收录、meta、标题、结构化数据、排名因素等）。
- 是否需要 **perf**（加载速度、Core Web Vitals、Lighthouse、PageSpeed 等）。
- 若描述极泛且三类都可做，可输出 \`["test","seo","perf"]\`。
- 不要输出 mainAgent、planAgent；不要发明 test/seo/perf 以外的字符串。`

/** 将 State 中与规划相关的信息拼成 user 消息，驱动 LLM 生成流水线列表 */
export function buildPlanAgentUserMessage(state: State, htmlSnapshot?: string | null): string {
  const pageUrl = state.pageUrl?.trim() || ''
  const user = state.userInput?.trim() || ''
  const parts: string[] = [
    '## 用户与页面',
    `**用户需求**：\n${user || '（空）'}`,
    `**页面 URL**：\`${pageUrl || '（空）'}\``,
  ]

  if (state.usePlaywrightBrowser) {
    parts.push(
      `**Playwright 托管**：已启用（session: \`${(state.runnerSessionId ?? '').trim() || '未建立'}\`）。`,
    )
  }

  const html = htmlSnapshot?.trim()
  if (html && html.length > 0) {
    const cap = 3200
    parts.push(
      '',
      '## 页面 HTML 参考（来自 `.agent-cache/html` 快照，仅用于判断意图与范围；执行时每段 parse 前仍会按需 CDP 刷新并更新该快照）',
      '```html',
      html.length > cap ? `${html.slice(0, cap)}\n…（已截断）` : html,
      '```',
    )
  }

  parts.push(
    '',
    '## 输出要求',
    '请根据以上信息输出 `{ "pipelines": [...] }`，\`pipelines\` 为 \`"test" | "seo" | "perf"\` 组成的数组。',
  )

  return parts.join('\n')
}
