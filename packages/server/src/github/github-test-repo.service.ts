import { Injectable } from '@nestjs/common'
import { UserService } from '../auth/user.service'
import { REPO_BOOTSTRAP_FILES } from './repo-bootstrap-files'

const GITHUB_API = 'https://api.github.com'
const API_VERSION = '2022-11-28'

export type GithubTestUploadResult = {
  repoFullName: string
  filePath: string
  htmlUrl: string
  created: boolean
}

@Injectable()
export class GithubTestRepoService {
  /** 默认仓库名，可通过 GITHUB_TEST_REPO_NAME 覆盖 */
  readonly defaultRepoName = String(process.env.GITHUB_TEST_REPO_NAME ?? 'playwright-test-code').trim() || 'playwright-test-code'

  constructor(private readonly userService: UserService) {}

  async uploadTestSpecForUser(
    githubId: string,
    opts: {
      fileName: string
      content: string
      commitMessage: string
      /** 被测页面 URL，写入 .browser-test-agent.json 供 CI 默认 BASE_URL */
      pageUrl?: string
    },
  ): Promise<GithubTestUploadResult> {
    const creds = await this.userService.getGithubCredentials(githubId)
    if (!creds) {
      throw new Error('未找到 GitHub 访问令牌，请重新登录以授权仓库写入')
    }

    const { fullName: repoFullName, created: repoCreated } = await this.ensurePlaywrightTestRepo(creds.token, creds.login)
    await this.userService.savePlaywrightTestRepoFullName(githubId, repoFullName)

    const filePath = `tests/${opts.fileName.replace(/^[/\\]+/, '')}`
    const result = await this.upsertRepoFile(creds.token, repoFullName, filePath, opts.content, opts.commitMessage)

    try {
      await this.ensureRepoBootstrap(creds.token, repoFullName, repoCreated)
      if (opts.pageUrl?.trim()) {
        await this.upsertBrowserTestAgentConfig(creds.token, repoFullName, opts.pageUrl.trim())
      }
    } catch {
      /* CI 引导文件失败不影响 spec 已上传 */
    }

    return result
  }

  private githubHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
      ...extra,
    }
  }

  private encodeRepoPath(filePath: string): string {
    return filePath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
  }

  private contentsUrl(repoFullName: string, filePath: string): string {
    const [owner, repo] = repoFullName.split('/')
    if (!owner || !repo) throw new Error(`无效的仓库名：${repoFullName}`)
    return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${this.encodeRepoPath(filePath)}`
  }

  private async repoFileExists(token: string, repoFullName: string, filePath: string): Promise<boolean> {
    const res = await fetch(this.contentsUrl(repoFullName, filePath), { headers: this.githubHeaders(token) })
    return res.ok
  }

  private async ensurePlaywrightTestRepo(
    token: string,
    login: string,
  ): Promise<{ fullName: string; created: boolean }> {
    const owner = login.trim()
    const repo = this.defaultRepoName
    const fullName = `${owner}/${repo}`

    const check = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: this.githubHeaders(token),
    })

    if (check.ok) return { fullName, created: false }

    if (check.status !== 404) {
      const body = await check.text().catch(() => '')
      throw new Error(`检查 GitHub 仓库失败（${check.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    const create = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: this.githubHeaders(token),
      body: JSON.stringify({
        name: repo,
        description: 'Browser Test Agent 自动生成的 Playwright 测试用例',
        private: false,
        auto_init: true,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      }),
    })

    if (!create.ok) {
      const body = await create.text().catch(() => '')
      throw new Error(`创建 GitHub 仓库 \`${fullName}\` 失败（${create.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    return { fullName, created: true }
  }

  /** 写入 Actions / Node 引导文件（缺失时才创建，避免覆盖用户改动） */
  private async ensureRepoBootstrap(token: string, repoFullName: string, repoJustCreated: boolean): Promise<void> {
    const workflowPath = '.github/workflows/playwright.yml'
    if (!repoJustCreated && (await this.repoFileExists(token, repoFullName, workflowPath))) {
      return
    }

    for (const file of REPO_BOOTSTRAP_FILES) {
      const exists = await this.repoFileExists(token, repoFullName, file.path)
      if (exists) continue
      try {
        await this.putRepoFile(token, repoFullName, file.path, file.content, file.commitMessage)
      } catch {
        /* 单个引导文件失败不阻断其余文件与 spec 上传 */
      }
    }
  }

  private async upsertBrowserTestAgentConfig(token: string, repoFullName: string, pageUrl: string): Promise<void> {
    const path = '.browser-test-agent.json'
    const content = `${JSON.stringify({ defaultBaseUrl: pageUrl, updatedAt: new Date().toISOString() }, null, 2)}\n`
    await this.putRepoFile(token, repoFullName, path, content, `chore: set default BASE_URL to ${pageUrl}`)
  }

  private async putRepoFile(
    token: string,
    repoFullName: string,
    filePath: string,
    content: string,
    commitMessage: string,
    existingSha?: string,
  ): Promise<void> {
    let sha = existingSha
    if (sha === undefined) {
      const getUrl = this.contentsUrl(repoFullName, filePath)
      const existing = await fetch(getUrl, { headers: this.githubHeaders(token) })
      if (existing.ok) {
        const json = (await existing.json()) as { sha?: string }
        sha = json.sha
      } else if (existing.status !== 404) {
        const body = await existing.text().catch(() => '')
        throw new Error(`读取 GitHub 文件失败（${existing.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
    }

    const put = await fetch(this.contentsUrl(repoFullName, filePath), {
      method: 'PUT',
      headers: this.githubHeaders(token),
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    })

    if (!put.ok) {
      const body = await put.text().catch(() => '')
      throw new Error(`写入 GitHub 文件 \`${filePath}\` 失败（${put.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
  }

  private async upsertRepoFile(
    token: string,
    repoFullName: string,
    filePath: string,
    content: string,
    commitMessage: string,
  ): Promise<GithubTestUploadResult> {
    const getUrl = this.contentsUrl(repoFullName, filePath)
    const existing = await fetch(getUrl, { headers: this.githubHeaders(token) })

    let sha: string | undefined
    let created = true
    if (existing.ok) {
      const json = (await existing.json()) as { sha?: string }
      sha = json.sha
      created = false
    } else if (existing.status !== 404) {
      const body = await existing.text().catch(() => '')
      throw new Error(`读取 GitHub 文件失败（${existing.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    await this.putRepoFile(token, repoFullName, filePath, content, commitMessage, sha)

    const [owner, repo] = repoFullName.split('/')
    const htmlUrl = `https://github.com/${owner}/${repo}/blob/main/${filePath}`

    return {
      repoFullName,
      filePath,
      htmlUrl,
      created,
    }
  }
}
