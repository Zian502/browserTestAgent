import { htmlCompressor, type CompressOptions } from '../lib/html-compressor'
import type { SkillDefinition } from './skill-types'

/**
 * 将原始 HTML 压缩为适合 LLM 的文本（去 script/style/注释等）。纯本地计算，不调用内置文件工具。
 */
export const compressHtmlSkill: SkillDefinition = {
  id: 'compress-html',
  name: '压缩 HTML',
  description: '移除脚本、样式与注释并裁剪属性，控制最大长度，供解析 Agent 使用。',
  toolsRequired: [],
  async run(ctx, input) {
    const pageHtml = String(input['html'] ?? '')
    const options = (input['compressOptions'] ?? {}) as CompressOptions
    const compressedHtml = await htmlCompressor.compress(pageHtml, {
      removeScripts: true,
      removeStyles: true,
      removeComments: true,
      keepAttributes: ['id', 'class', 'data-testid', 'role', 'type', 'name', 'placeholder', 'href'],
      maxLength: 800_000,
      ...options,
    })
    return {
      ok: true,
      compressedHtml,
      sourceLength: pageHtml.length,
      compressedLength: compressedHtml.length,
    }
  },
}
