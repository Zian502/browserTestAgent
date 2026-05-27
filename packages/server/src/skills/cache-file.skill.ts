import * as path from 'path'
import { fileCacheService } from '../lib/file-cache'
import { invokeWriteTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'

/**
 * 在 `.agent-cache` 下写入 HTML 快照（`html/`）或 PageDSL 快照（`dsl/*.json`，经 `write` 工具）。
 */
export const cacheFileSkill: SkillDefinition = {
  id: 'cache-file',
  name: '缓存文件',
  description: '将页面 HTML 快照写入 html/，或将解析得到的 PageDSL 写入 dsl/。',
  toolsRequired: ['write'],
  async run(ctx, input) {
    const kind = String(input['kind'] ?? '')
    if (kind === 'html_snapshot') {
      const pageUrl = String(input['pageUrl'] ?? ctx.state.pageUrl ?? '').trim()
      const html = String(input['html'] ?? '')
      const cacheKey = String(input['cacheKey'] ?? '').trim()
      if (!html.trim()) {
        return { ok: false, error: '缺少 html' }
      }
      if (cacheKey) {
        const rel = fileCacheService.htmlRelativePathFromCacheKey(cacheKey)
        await invokeWriteTool(ctx.agentName, ctx.emit, rel, html)
        return { ok: true, kind, relativePath: rel, cacheKey }
      }
      if (!pageUrl) {
        return { ok: false, error: '缺少 pageUrl 或 cacheKey' }
      }
      const rel = path.join('html', fileCacheService.htmlFilenameFromPageUrl(pageUrl))
      await invokeWriteTool(ctx.agentName, ctx.emit, rel, html)
      return { ok: true, kind, relativePath: rel }
    }
    if (kind === 'dsl_snapshot') {
      const cacheKey = String(input['cacheKey'] ?? '')
      const pageUrl = String(input['pageUrl'] ?? ctx.state.pageUrl ?? '')
      const dsl = input['dsl']
      if (!cacheKey) return { ok: false, error: '缺少 cacheKey' }
      const id = fileCacheService.artifactIdFromKey(cacheKey)
      const rel = path.join('dsl', `${id}.json`)
      const body = JSON.stringify(
        {
          cacheKey,
          pageUrl,
          savedAt: new Date().toISOString(),
          dsl,
        },
        null,
        2,
      )
      await invokeWriteTool(ctx.agentName, ctx.emit, rel, body)
      return { ok: true, kind, relativePath: rel }
    }
    return { ok: false, error: `未知 cache-file.kind：${kind}` }
  },
}
