import type { PageDSL } from '../state'

/** SEO 分析：无单独 system，单条 user 消息要求输出 JSON */
export function buildSeoUserMessage(pageUrl: string, dsl: PageDSL, htmlHead: string): string {
  return `基于页面 DSL 与 HTML 片段做 SEO 分析，只输出 JSON：\nURL: ${pageUrl}\nDSL: ${JSON.stringify(
    dsl,
  )}\nHTML前3000字: ${htmlHead}`
}
