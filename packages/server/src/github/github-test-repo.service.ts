import { Injectable } from '@nestjs/common'
import { UserService } from '../auth/user.service'

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
    },
  ): Promise<GithubTestUploadResult> {
    const creds = await this.userService.getGithubCredentials(githubId)
    if (!creds) {
      throw new Error('未找到 GitHub 访问令牌，请重新登录以授权仓库写入')
    }

    const repoFullName = await this.ensurePlaywrightTestRepo(creds.token, creds.login)
    await this.userService.savePlaywrightTestRepoFullName(githubId, repoFullName)

    const filePath = `tests/${opts.fileName.replace(/^[/\\]+/, '')}`
    return this.upsertRepoFile(creds.token, repoFullName, filePath, opts.content, opts.commitMessage)
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

  private async ensurePlaywrightTestRepo(token: string, login: string): Promise<string> {
    const owner = login.trim()
    const repo = this.defaultRepoName
    const fullName = `${owner}/${repo}`

    const check = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: this.githubHeaders(token),
    })

    if (check.ok) return fullName

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

    return fullName
  }

  private async upsertRepoFile(
    token: string,
    repoFullName: string,
    filePath: string,
    content: string,
    commitMessage: string,
  ): Promise<GithubTestUploadResult> {
    const [owner, repo] = repoFullName.split('/')
    if (!owner || !repo) throw new Error(`无效的仓库名：${repoFullName}`)

    const encodedPath = filePath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')

    const getUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`
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

    const put = await fetch(getUrl, {
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
      throw new Error(`上传 GitHub 文件失败（${put.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    const putJson = (await put.json()) as {
      content?: { html_url?: string; path?: string }
    }
    const htmlUrl = String(putJson.content?.html_url ?? `https://github.com/${owner}/${repo}/blob/main/${filePath}`)

    return {
      repoFullName,
      filePath: String(putJson.content?.path ?? filePath),
      htmlUrl,
      created,
    }
  }
}
