/** 解析 HTML → PageDSL 的 user 消息（无单独 system，与压缩 HTML 拼接调用） */
export function buildParseHtmlUserMessage(compressedHtml: string, pageUrl: string): string {
  return `分析以下 HTML，提取关键交互与表单，输出严格 JSON（PageDSL）：\n\nHTML:\n${compressedHtml}\n\n页面 URL：${pageUrl}`
}
