import type { ReportType } from '../../lib/report-generator'

/** 与 `report-generator` 中 `ReportLlmOutline` 字段对齐；模型仅输出 JSON，无其它文字。 */
export const REPORT_LLM_JSON_SCHEMA_HINT = `你必须只输出一个 JSON 对象（不要 markdown 代码围栏），字段如下：
{
  "title": "报告标题，简短",
  "executiveSummary": "2～5 句执行摘要，纯文本",
  "keyFindings": ["要点1", "要点2", ...],
  "sections": [ { "heading": "小节标题", "content": "小节正文，纯文本" } ],
  "recommendations": "可选，一行行动建议"
}
sections 可为空数组；keyFindings 建议 3～8 条。`

export const REPORT_LLM_SYSTEM_PROMPT = `你是资深测试与站点质量顾问，负责把结构化数据改写成面向读者的报告纲要。
${REPORT_LLM_JSON_SCHEMA_HINT}`

function typeFocus(type: ReportType): string {
  switch (type) {
    case 'test':
      return '聚焦自动化测试结果：通过/失败/跳过、失败原因、与用户需求「可测性」的对应关系。'
    case 'seo':
      return '聚焦 SEO：评分、标题/元信息、可访问性相关 issue 的严重程度与修复优先级。'
    case 'pagespeed':
      return '聚焦性能指标：Core Web Vitals、资源体积、阻塞渲染等，用业务语言解释影响。'
    default:
      return ''
  }
}

export function buildReportLlmUserContent(
  type: ReportType,
  ctx: { pageUrl: string; userInput: string; dataJson: string },
): string {
  return [
    `报告类型：${type}`,
    typeFocus(type),
    `页面 URL：${ctx.pageUrl}`,
    `用户原始需求：${ctx.userInput}`,
    '以下为子代理输出的 JSON（可能较长，请抽取关键信息写入纲要字段，勿逐字照抄）：',
    ctx.dataJson,
  ].join('\n\n')
}

export const REPORT_AGENT_HAS_LLM_PROMPTS = true as const
