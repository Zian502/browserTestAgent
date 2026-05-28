import { getGithubTestRepoService } from '../github/github-bridge'
import type { GithubTestUploadResult } from '../github/github-test-repo.service'

export type GithubUploadOutcome =
  | { ok: true; result: GithubTestUploadResult }
  | { ok: false; error: string }
  | { ok: false; skipped: true; reason: string }

/** 将最终合并/单段 spec 上传到用户 GitHub 仓库 `playwright-test-code` */
export async function uploadFinalTestCodeToGithub(
  userId: string | undefined,
  opts: {
    fileName: string
    content: string
    specSlug: string
    taskTitle?: string
    pageUrl?: string
  },
): Promise<GithubUploadOutcome> {
  const uid = userId?.trim()
  if (!uid) return { ok: false, skipped: true, reason: '未登录' }

  const svc = getGithubTestRepoService()
  if (!svc) return { ok: false, skipped: true, reason: 'GitHub 服务未就绪' }

  const title = opts.taskTitle?.trim()
  const commitMessage = title
    ? `Add Playwright test: ${opts.specSlug} (${title})`
    : `Add Playwright test: ${opts.specSlug}`

  try {
    const result = await svc.uploadTestSpecForUser(uid, {
      fileName: opts.fileName,
      content: opts.content,
      commitMessage,
      pageUrl: opts.pageUrl,
    })
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function githubUploadSummary(outcome: GithubUploadOutcome): string | undefined {
  if ('skipped' in outcome && outcome.skipped) {
    return `GitHub 未上传（${outcome.reason}）`
  }
  if (outcome.ok) {
    const action = outcome.result.created ? '已上传' : '已更新'
    return `${action}至 GitHub：${outcome.result.htmlUrl}`
  }
  if ('error' in outcome) {
    return `GitHub 上传失败：${outcome.error}`
  }
  return undefined
}

export function githubObservationData(outcome: GithubUploadOutcome | undefined): unknown {
  if (!outcome) return undefined
  if (outcome.ok) return outcome.result
  if ('error' in outcome) return { error: outcome.error }
  if ('skipped' in outcome) return { skipped: true, reason: outcome.reason }
  return undefined
}
