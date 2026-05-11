export type ReportType = 'test' | 'seo' | 'pagespeed'

/** 与 reportAgent LLM 输出及 `prompts/report-agent.prompt` 描述一致 */
export interface ReportLlmOutline {
  title: string
  executiveSummary: string
  keyFindings: string[]
  sections?: { heading: string; content: string }[]
  recommendations?: string
}

export function coerceReportLlmOutline(raw: unknown, fallbackTitle: string): ReportLlmOutline {
  if (!raw || typeof raw !== 'object') {
    return {
      title: fallbackTitle,
      executiveSummary: '（未获取到模型纲要，以下为原始数据附录。）',
      keyFindings: [],
      sections: [],
    }
  }
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : fallbackTitle
  const executiveSummary =
    typeof o.executiveSummary === 'string'
      ? o.executiveSummary
      : typeof o.summary === 'string'
        ? o.summary
        : ''
  const keyFindings = Array.isArray(o.keyFindings)
    ? o.keyFindings
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  let sections: { heading: string; content: string }[] | undefined
  if (Array.isArray(o.sections)) {
    sections = o.sections
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
      .map((s) => ({
        heading: typeof s.heading === 'string' ? s.heading : '小节',
        content: typeof s.content === 'string' ? s.content : '',
      }))
      .filter((s) => s.heading.trim() || s.content.trim())
  }
  const recommendations = typeof o.recommendations === 'string' ? o.recommendations : undefined
  return { title, executiveSummary, keyFindings, sections, recommendations }
}

export const reportGenerator = {
  async generate(
    type: ReportType,
    ctx: {
      data: unknown
      url: string
      userInput: string
      generatedAt: string
      llmOutline?: ReportLlmOutline
    },
  ): Promise<string> {
    const outline = ctx.llmOutline ?? coerceReportLlmOutline(null, `${type} report`)
    const findings =
      outline.keyFindings.length > 0
        ? `<ul>${outline.keyFindings.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
        : ''
    const sectionBlocks =
      outline.sections && outline.sections.length > 0
        ? outline.sections
            .map(
              (s) =>
                `<section><h2>${escapeHtml(s.heading)}</h2><p>${escapeHtml(s.content).replace(/\n/g, '<br/>')}</p></section>`,
            )
            .join('\n')
        : ''
    const rec = outline.recommendations
      ? `<aside class="rec"><strong>建议</strong>：${escapeHtml(outline.recommendations)}</aside>`
      : ''

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(outline.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 56rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #111; }
    h1 { font-size: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
    .meta { color: #555; font-size: 0.9rem; }
    .summary { margin: 1rem 0; }
    .rec { margin-top: 1.5rem; padding: 0.75rem 1rem; background: #f4f4f5; border-radius: 6px; }
    details { margin-top: 2rem; }
    pre { overflow: auto; font-size: 0.8rem; background: #fafafa; padding: 1rem; border: 1px solid #e4e4e7; border-radius: 6px; }
    .type-badge { display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.5rem; background: #e4e4e7; border-radius: 4px; margin-left: 0.5rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(outline.title)}<span class="type-badge">${escapeHtml(type)}</span></h1>
  <p class="meta">URL：${escapeHtml(ctx.url)} · 生成时间：${escapeHtml(ctx.generatedAt)}</p>
  <p class="meta">用户需求摘要：${escapeHtml(ctx.userInput.slice(0, 500))}${ctx.userInput.length > 500 ? '…' : ''}</p>
  <div class="summary"><p>${escapeHtml(outline.executiveSummary).replace(/\n/g, '<br/>')}</p></div>
  ${findings}
  ${sectionBlocks}
  ${rec}
  <details>
    <summary>原始子代理 JSON 数据</summary>
    <pre>${escapeHtml(JSON.stringify(ctx.data, null, 2))}</pre>
  </details>
</body>
</html>`
  },
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
