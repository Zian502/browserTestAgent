import * as path from 'path'
import { fileCacheService } from '../lib/file-cache'
import { invokeWriteTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'

/**
 * 在 `.agent-cache` 下写入 HTML 快照、DSL 侧车文件或 JSON KV 缓存条目（经 `write` 工具）。
 */
export const cacheFileSkill: SkillDefinition = {
  id: 'cache-file',
  name: '缓存文件',
  description: '将 HTML 快照、PageDSL 元数据或 JSON 缓存条目写入受控缓存目录。',
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
    if (kind === 'kv_cache') {
      const cacheKey = String(input['cacheKey'] ?? '')
      if (!cacheKey) return { ok: false, error: '缺少 cacheKey' }
      const ttl = input['ttl'] != null ? Number(input['ttl']) : 3600
      const data = input['data']
      const { relativePath, body } = fileCacheService.buildKvCacheWrite(cacheKey, data, {
        ttl: Number.isFinite(ttl) ? ttl : 3600,
        metadata: input['metadata'] as Record<string, unknown> | undefined,
      })
      await invokeWriteTool(ctx.agentName, ctx.emit, relativePath, body)
      return { ok: true, kind, relativePath }
    }
    return { ok: false, error: `未知 cache-file.kind：${kind}` }
  },
}
