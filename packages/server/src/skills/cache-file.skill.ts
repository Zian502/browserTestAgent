import * as path from 'path'
import { fileCacheService } from '../lib/file-cache'
import { invokeWriteTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'

/**
 * 在 `.agent-cache/html` 下写入 HTML 快照（经 `write` 工具）。
 */
export const cacheFileSkill: SkillDefinition = {
  id: 'cache-file',
  name: '缓存文件',
  description: '将页面 HTML 快照写入受控缓存目录下的 html 子目录。',
  toolsRequired: ['write'],
  async run(ctx, input) {
    const kind = String(input['kind'] ?? '')
    if (kind === 'html_snapshot') {
      const pageUrl = String(input['pageUrl'] ?? ctx.state.pageUrl ?? '').trim()
      const html = String(input['html'] ?? '')
      if (!pageUrl || !html.trim()) {
        return { ok: false, error: '缺少 pageUrl 或 html' }
      }
      const rel = path.join('html', fileCacheService.htmlFilenameFromPageUrl(pageUrl))
      await invokeWriteTool(ctx.agentName, ctx.emit, rel, html)
      return { ok: true, kind, relativePath: rel }
    }
    return { ok: false, error: `未知 cache-file.kind：${kind}` }
  },
}
