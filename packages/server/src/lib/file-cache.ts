import * as path from 'path'
import * as crypto from 'crypto'
import { agentFileMkdirp, agentFileReadText, agentFileWriteText, agentFileExists } from './agent-files'

class FileCacheService {
  private cacheDir = path.join(process.cwd(), '.agent-cache')

  async init() {
    await agentFileMkdirp(this.cacheDir)
    await agentFileMkdirp(path.join(this.cacheDir, 'reports'))
    await agentFileMkdirp(path.join(this.cacheDir, 'html'))
    await agentFileMkdirp(path.join(this.cacheDir, 'dsl'))
    await agentFileMkdirp(path.join(this.cacheDir, 'testCode'))
    await agentFileMkdirp(path.join(this.cacheDir, 'testCode', 'fragments'))
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

  /** 读取 `.agent-cache/html` 下与 pageUrl 对应的最新快照（无文件或为空则返回 null） */
  async readHtmlSnapshotByPageUrl(pageUrl: string): Promise<string | null> {
    const u = pageUrl.trim()
    if (!u) return null
    const fullPath = path.join(this.cacheDir, 'html', this.htmlFilenameFromPageUrl(u))
    try {
      const raw = await agentFileReadText(fullPath)
      return raw.trim() ? raw : null
    } catch {
      return null
    }
  }

  htmlRelativePathFromCacheKey(cacheKey: string): string {
    const id = this.artifactIdFromKey(cacheKey.trim())
    return path.join('html', `${id}.html`)
  }

  async writeHtmlSnapshotByCacheKey(cacheKey: string, html: string): Promise<string | null> {
    const key = cacheKey.trim()
    if (!key || !html?.trim()) return null
    await agentFileMkdirp(path.join(this.cacheDir, 'html'))
    const rel = this.htmlRelativePathFromCacheKey(key)
    return this.writeFile(rel, html)
  }

  artifactIdFromKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  /**
   * 从任务标题 / 用户输入中提取简短英文文件名段（kebab-case），如 login、email-verify。
   * 无可用拉丁词时回退为 `test-{md5 前 8 位}`。
   * 会过滤「spec / ts」等易与 `.spec.ts` 扩展名重复的噪声词，避免出现 `foo-spec-ts.spec.ts`。
   */
  testCodeSpecSlugFromTask(text: string, fallbackSeed: string): string {
    const raw = (text ?? '').trim()
    const withoutUrls = raw.replace(/https?:\/\/[^\s]+/gi, ' ')
    const tokens = withoutUrls.match(/[a-zA-Z][a-zA-Z0-9]*/g)
    /** 易与 `.spec.ts` / 语言后缀重复的片段，避免 `foo-spec-ts.spec.ts` */
    const skipToken = new Set([
      'spec',
      'ts',
      'tsx',
      'js',
      'mjs',
      'cjs',
      'typescript',
      'javascript',
    ])
    let slug = ''
    if (tokens && tokens.length > 0) {
      slug = tokens
        .map((w) => w.toLowerCase())
        .filter((w) => (w.length >= 2 || tokens!.length === 1) && !skipToken.has(w))
        .slice(0, 8)
        .join('-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 56)
    }
    if (!slug || slug.length < 2) {
      const h = crypto.createHash('md5').update(fallbackSeed).digest('hex').slice(0, 8)
      slug = `test-${h}`
    }
    slug = slug.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
    slug = slug.replace(/-spec-ts$/i, '').replace(/-spec$/i, '').replace(/-tsx?$/i, '')
    slug = slug.replace(/-+/g, '-').replace(/^-|-$/g, '')
    return slug || 'test'
  }

  private async resolveTestCodeSpecRelativePath(slug: string, cacheKey: string): Promise<string> {
    const dir = path.join(this.cacheDir, 'testCode')
    const primary = `${slug}.spec.ts`
    const primaryAbs = path.join(dir, primary)
    if (!(await agentFileExists(primaryAbs))) {
      return path.join('testCode', primary)
    }
    const suffix = this.artifactIdFromKey(cacheKey).slice(0, 8)
    return path.join('testCode', `${slug}-${suffix}.spec.ts`)
  }

  private async ensureDir() {
    await agentFileMkdirp(this.cacheDir)
  }

  async writeFile(relativePath: string, content: string): Promise<string> {
    await this.ensureDir()
    const fullPath = path.join(this.cacheDir, relativePath)
    await agentFileWriteText(fullPath, content)
    return fullPath
  }

  private escapeMdCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim().slice(0, 2000)
  }

  async persistTestCodeArtifacts(opts: {
    cacheKey: string
    userInput: string
    /** 任务计划中的标题（常与 userInput 互补，用于生成 *.spec.ts 名） */
    taskTitle?: string
    pageUrl: string
    code: string
    passed: number
    failed: number
    skipped?: boolean
  }): Promise<{ tsRelative: string; manifestRelative: string; specSlug: string }> {
    const id = this.artifactIdFromKey(opts.cacheKey)
    const slugSource = [opts.taskTitle, opts.userInput].filter(Boolean).join(' ')
    const specSlug = this.testCodeSpecSlugFromTask(slugSource, opts.cacheKey)
    const tsRel = await this.resolveTestCodeSpecRelativePath(specSlug, opts.cacheKey)
    const fileLabel = path.basename(tsRel)
    const ck = opts.cacheKey.length > 240 ? `${opts.cacheKey.slice(0, 240)}…` : opts.cacheKey
    const pu = opts.pageUrl.replace(/\*\//g, '* /')
    const ui = opts.userInput.replace(/\r?\n/g, ' ').replace(/\*\//g, '* /').slice(0, 480)
    const header = `/**\n * testCodeAgent 生成（${new Date().toISOString()}）\n * specSlug: ${specSlug}\n * artifactId: ${id}\n * cacheKey: ${ck}\n * pageUrl: ${pu}\n * userInput: ${ui}\n */\n\n`
    await this.writeFile(tsRel, `${header}${opts.code}`)

    const manifestRel = path.join('testCode', 'MANIFEST.md')
    const fullManifest = path.join(this.cacheDir, manifestRel)
    const title = `# testCode 生成记录\n\n> 测试任务与 \`*.spec.ts\` 文件（追加式）\n\n`
    let prev = ''
    try {
      prev = await agentFileReadText(fullManifest)
    } catch {
      prev = ''
    }
    const fragment = [
      `## ${new Date().toISOString()} — \`${fileLabel}\`（${specSlug}）`,
      '',
      '| 字段 | 值 |',
      '|------|-----|',
      `| 任务标题 | ${this.escapeMdCell(opts.taskTitle ?? '—')} |`,
      `| 任务描述 | ${this.escapeMdCell(opts.userInput)} |`,
      `| pageUrl | ${this.escapeMdCell(opts.pageUrl)} |`,
      `| 代码文件 | [\`${fileLabel}\`](./${encodeURI(fileLabel)}) |`,
      `| 结果 | passed **${opts.passed}** / failed **${opts.failed}**${opts.skipped ? '（stub 跳过）' : ''} |`,
      '',
    ].join('\n')
    const next = prev.trim() ? `${prev.trim()}\n\n---\n\n${fragment}` : `${title}${fragment}`
    await agentFileWriteText(fullManifest, next)
    return { tsRelative: tsRel, manifestRelative: manifestRel, specSlug }
  }
}

export const fileCacheService = new FileCacheService()
