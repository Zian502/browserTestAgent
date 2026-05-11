import * as path from 'path'
import * as crypto from 'crypto'
import { agentFileMkdirp, agentFileReadText, agentFileUnlinkQuiet, agentFileWriteText } from './agent-files'

interface CacheEntry<T> {
  data: T
  expiresAt: number
  metadata?: Record<string, unknown>
}

class FileCacheService {
  private cacheDir = path.join(process.cwd(), '.agent-cache')

  async init() {
    await agentFileMkdirp(this.cacheDir)
    await agentFileMkdirp(path.join(this.cacheDir, 'reports'))
    await agentFileMkdirp(path.join(this.cacheDir, 'dsl'))
    await agentFileMkdirp(path.join(this.cacheDir, 'html'))
    await agentFileMkdirp(path.join(this.cacheDir, 'testCode'))
  }

  htmlFilenameFromPageUrl(pageUrl: string): string {
    const trimmed = pageUrl.trim()
    let base: string
    try {
      const u = new URL(trimmed)
      const host = u.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')
      const pathAndQuery = `${u.pathname}${u.search}`
        .replace(/^\//, '')
        .replace(/[/\\:?*&|"<>\s}%]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 160)
      base = pathAndQuery ? `${host}_${pathAndQuery}` : host
    } catch {
      base = crypto.createHash('md5').update(trimmed).digest('hex')
    }
    const max = 200
    if (base.length > max) {
      base = `${base.slice(0, max)}_${crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`
    }
    return `${base || 'page'}.html`
  }

  async writeHtmlSnapshotByPageUrl(pageUrl: string, html: string): Promise<string | null> {
    const u = pageUrl.trim()
    if (!u || !html?.trim()) return null
    await agentFileMkdirp(path.join(this.cacheDir, 'html'))
    const rel = path.join('html', this.htmlFilenameFromPageUrl(u))
    return this.writeFile(rel, html)
  }

  artifactIdFromKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private getFilePath(key: string) {
    const safeKey = crypto.createHash('md5').update(key).digest('hex')
    return path.join(this.cacheDir, `${safeKey}.json`)
  }

  jsonCacheRelativePath(key: string): string {
    const safeKey = crypto.createHash('md5').update(key).digest('hex')
    return `${safeKey}.json`
  }

  private async ensureDir() {
    await agentFileMkdirp(this.cacheDir)
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      await this.ensureDir()
      const filePath = this.getFilePath(key)
      const raw = await agentFileReadText(filePath)
      const entry = JSON.parse(raw) as CacheEntry<T>

      if (Date.now() > entry.expiresAt) {
        await agentFileUnlinkQuiet(filePath)
        return null
      }

      return entry.data
    } catch {
      return null
    }
  }

  buildKvCacheWrite<T>(
    key: string,
    data: T,
    options: { ttl?: number; metadata?: Record<string, unknown> } = {},
  ): { relativePath: string; body: string } {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + (options.ttl ?? 3600) * 1000,
      metadata: options.metadata,
    }
    return { relativePath: this.jsonCacheRelativePath(key), body: JSON.stringify(entry, null, 2) }
  }

  async set<T>(key: string, data: T, options: { ttl?: number; metadata?: Record<string, unknown> } = {}) {
    await this.ensureDir()
    const { relativePath, body } = this.buildKvCacheWrite(key, data, options)
    await agentFileWriteText(path.join(this.cacheDir, relativePath), body)
  }

  async writeFile(relativePath: string, content: string): Promise<string> {
    await this.ensureDir()
    const fullPath = path.join(this.cacheDir, relativePath)
    await agentFileWriteText(fullPath, content)
    return fullPath
  }

  async writeDslSnapshot(cacheKey: string, body: { pageUrl: string; dsl: unknown }): Promise<string> {
    const id = this.artifactIdFromKey(cacheKey)
    const rel = path.join('dsl', `${id}.json`)
    const payload = {
      cacheKey,
      pageUrl: body.pageUrl,
      savedAt: new Date().toISOString(),
      dsl: body.dsl,
    }
    return this.writeFile(rel, JSON.stringify(payload, null, 2))
  }

  private escapeMdCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim().slice(0, 2000)
  }

  async persistTestCodeArtifacts(opts: {
    cacheKey: string
    userInput: string
    pageUrl: string
    code: string
    passed: number
    failed: number
    skipped?: boolean
  }): Promise<{ tsRelative: string; manifestRelative: string }> {
    const id = this.artifactIdFromKey(opts.cacheKey)
    const tsRel = path.join('testCode', `${id}.ts`)
    const ck = opts.cacheKey.length > 240 ? `${opts.cacheKey.slice(0, 240)}…` : opts.cacheKey
    const pu = opts.pageUrl.replace(/\*\//g, '* /')
    const ui = opts.userInput.replace(/\r?\n/g, ' ').replace(/\*\//g, '* /').slice(0, 480)
    const header = `/**\n * testCodeAgent 生成（${new Date().toISOString()}）\n * cacheKey: ${ck}\n * pageUrl: ${pu}\n * userInput: ${ui}\n */\n\n`
    await this.writeFile(tsRel, `${header}${opts.code}`)

    const manifestRel = path.join('testCode', 'MANIFEST.md')
    const fullManifest = path.join(this.cacheDir, manifestRel)
    const title = `# testCode 生成记录\n\n> 测试任务描述与 ${id}.ts 的对应关系（追加式）\n\n`
    let prev = ''
    try {
      prev = await agentFileReadText(fullManifest)
    } catch {
      prev = ''
    }
    const fragment = [
      `## ${new Date().toISOString()} — ${id}`,
      '',
      '| 字段 | 值 |',
      '|------|-----|',
      `| 任务描述 | ${this.escapeMdCell(opts.userInput)} |`,
      `| pageUrl | ${this.escapeMdCell(opts.pageUrl)} |`,
      `| 代码文件 | [\`${id}.ts\`](./${id}.ts) |`,
      `| 结果 | passed **${opts.passed}** / failed **${opts.failed}**${opts.skipped ? '（stub 跳过）' : ''} |`,
      '',
    ].join('\n')
    const next = prev.trim() ? `${prev.trim()}\n\n---\n\n${fragment}` : `${title}${fragment}`
    await agentFileWriteText(fullManifest, next)
    return { tsRelative: tsRel, manifestRelative: manifestRel }
  }
}

export const fileCacheService = new FileCacheService()
