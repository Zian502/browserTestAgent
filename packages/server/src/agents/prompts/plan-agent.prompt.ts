import type { State } from '../state'

/**
 * 规划 agent：说明可执行 agent、固定任务 id、依赖与 cacheKey 规则。
 * 具体「做哪些子任务」由 user 侧动态上下文 + LLM 裁剪；归一化在 plan-agent 内完成。
 */
export const PLAN_AGENT_SYSTEM_PROMPT = `你是浏览器端测试与站点分析流水线的**任务规划专家**。你必须只输出一个 JSON 对象（不要 markdown 代码围栏，不要解释文字），格式为：
{ "tasks": TaskPlan[] }

## TaskPlan 字段
- id：必须使用下列**固定 id**之一（勿发明其它 id）：task_parse、task_test、task_seo、task_perf、task_report
- title：面向用户的简短中文标题，**必须结合用户真实需求改写**（勿照搬模板句）。对 **task_test**，请在标题末尾用括号附上 **2～6 个英文单词的 kebab-case 关键词**（如「…（login-modal）」「…（email-verify）」），用于生成缓存测试文件 \`*.spec.ts\` 名；若用户已用英文描述意图，可直接提炼为关键词。
- type：与 id 对应 — task_parse→parseHtml，task_test→testCode，task_seo→seo，task_perf→pagespeed，task_report→report
- assignTo：task_parse→parseHtmlAgent，task_test→testCodeAgent，task_seo→seoAgent，task_perf→pagespeedAgent，task_report→reportAgent
- dependencies：字符串数组，元素必须是**本计划中会出现的**其它任务 id
- canParallel：parseHtml 与 report 为 false；test、seo、perf 一般为 true（除非你有充分理由设为 false）
- cacheKey：字符串，见下

## 默认依赖关系（若某任务被保留，其依赖中应包含这些前置 id；系统也会再次校验）
- task_parse：[]
- task_test：["task_parse"]
- task_seo：["task_parse"]
- task_perf：[]（可与 parse 并行，不依赖 HTML 结构）
- task_report：必须依赖**当前计划中除自身外所有** parse/test/seo/perf 任务 id（顺序不限）

## cacheKey 约定（便于命中 .agent-cache；勿留空）
- parse："{pageUrl}_parse"
- test："{pageUrl}_test_{用户意图摘要，约 40 字内，可截断}"
- seo："{pageUrl}_seo"
- perf："{pageUrl}_perf"
- report："{pageUrl}_report"

## 裁剪规则（重要）
- 根据用户意图**删除不需要的任务整项**（例如只要 SEO 时可只保留 task_parse、task_seo、task_report）。
- 若保留 task_test 或 task_seo，**必须**保留 task_parse。
- 若计划中除 task_report 外仍有任意执行类任务，**应**保留 task_report 以生成汇总 HTML（除非用户明确说不要报告）。
- 不要输出 mainAgent、planAgent；不要输出未在固定 id 列表中的任务。`

/** 将 State 中与规划相关的信息拼成 user 消息，驱动 LLM 生成/裁剪任务列表 */
export function buildPlanAgentUserMessage(state: State): string {
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

  const html = state.pageHtml?.trim()
  if (html && html.length > 0) {
    const cap = 3200
    parts.push(
      '',
      '## 页面 HTML 参考（用于判断分析范围、是否需解析结构等；勿复述全文）',
      '```html',
      html.length > cap ? `${html.slice(0, cap)}\n…（已截断）` : html,
      '```',
    )
  }

  parts.push(
    '',
    '## 输出要求',
    '请根据以上信息，输出 `{ "tasks": [...] }`。',
    '为每一项写**贴合当前用户措辞**的 title；用裁剪规则决定保留哪些固定 id；dependencies 与 cacheKey 按 system 说明填写。',
  )

  return parts.join('\n')
}
