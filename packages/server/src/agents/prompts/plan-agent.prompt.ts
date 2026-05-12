import type { State } from '../state'

/**
 * 规划 agent：输出 **主任务列表** `mainTasks`（每项含 `pipeline` 与可选 `subTasks`），
 * 服务端将每条流水线展开为 `parseHtmlAgent → 对应执行 agent → reportAgent` 的有序子任务；
 * 仍兼容旧格式 `{ "pipelines": [...] }`。HTML 默认来自 `.agent-cache/html` 快照，每段解析前可经 CDP 刷新并回写该文件。
 */
export const PLAN_AGENT_SYSTEM_PROMPT = `你是浏览器端测试与站点分析流水线的**任务规划专家**。你必须只输出一个 JSON 对象（不要 markdown 代码围栏，不要解释文字）。

## 首选格式（主任务 + 可选子任务标题）
\`\`\`json
{
  "mainTasks": [
    {
      "id": "可选，字符串，主任务唯一 id",
      "title": "可选，主任务展示标题",
      "pipeline": "test",
      "subTasks": [
        { "kind": "parseHtml", "title": "可选，子任务标题" },
        { "kind": "testCode", "title": "可选" },
        { "kind": "report", "title": "可选" }
      ]
    }
  ]
}
\`\`\`

- 若省略某主任务的 \`subTasks\`，服务端会按该 \`pipeline\` 自动填三条子任务（解析 → 执行 → 报告），并生成默认标题。
- 若提供 \`subTasks\`，**必须恰好 3 条**，且 \`kind\` 必须与下表一致（顺序不可改）。

### pipeline 与 subTasks.kind 对应关系
| pipeline | 第 1 条 kind | 第 2 条 kind | 第 3 条 kind |
|----------|--------------|--------------|--------------|
| test | parseHtml | testCode | report |
| seo | parseHtml | seo | report |
| perf | parseHtml | pagespeed | report |

## 兼容旧格式（仅流水线顺序）
\`\`\`json
{ "pipelines": ["test", "seo", "perf"] }
\`\`\`
- \`pipelines\` 为 \`"test" | "seo" | "perf"\` 组成的**有序**数组；服务端为每项生成一个主任务，子任务顺序同上。
- 同一类型**不要**重复出现。

## 测试用例拆分原则（pipelines / mainTasks 含 test 时，下游代码生成须遵守）
- 按**用户可感知的步骤 / 功能点**拆分：每一步可单独断言、单独失败定位。
- **示例（登录）**：宜拆成 **2 条** \`test\`——（1）找到登录入口并点击、断言登录弹框/层已展示；（2）在弹框内输入账号与密码并提交、断言登录成功或错误提示。**不要**把「点击登录 + 填表 + 提交」写在同一条 \`test\` 里。
- 若流程更长，按类似粒度继续拆分为 3 条及以上 \`test\`，每条命名清晰。
- \`"seo"\`：**SEO 分析**流水线。
- \`"perf"\`：**页面性能（PageSpeed）**流水线。

## 数组语义
- 多个主任务按数组顺序**串行**执行：**上一段 report 完成后**，下一段才会再次 **parse** 以获取**当前页最新 HTML**。
- 若用户只要其中一类，只输出一个主任务（例如仅「看 SEO」→ \`mainTasks: [{ "pipeline": "seo" }]\`）。
- 若用户要全流程，常见顺序为 test → seo → perf（可按用户叙述微调顺序，但须合理）。

## 裁剪规则
- 根据用户措辞判断是否需要 **test**、**seo**、**perf**；不要输出 mainAgent、planAgent；不要发明 test/seo/perf 以外的 \`pipeline\` 字符串。`

/** 将 State 中与规划相关的信息拼成 user 消息，驱动 LLM 生成主任务 / 流水线列表 */
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
    '请输出 `{ "mainTasks": [...] }`（推荐）或 `{ "pipelines": [...] }`（兼容）。',
  )

  return parts.join('\n')
}
