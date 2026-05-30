import type { State } from '../agents/state'
import { getPlaywrightSessionPage } from './playwright-browser-session'

/** 流水线子任务引用（parse / test 片段） */
export type SubtaskStepRef = {
  testStepIndex?: number
  testStepRole?: string
}

/** Playwright 会话当前页 URL；未更新时回退用户初始 pageUrl */
export function effectiveRunnerPageUrl(state: Pick<State, 'runnerPageUrl' | 'pageUrl'>): string {
  return state.runnerPageUrl?.trim() || state.pageUrl?.trim() || ''
}

/** 用户提示词中的初始 URL */
export function promptPageUrl(state: Pick<State, 'pageUrl'>): string {
  return state.pageUrl?.trim() || ''
}

/** 是否为流水线第一个子任务（step0 或 legacy 单段） */
export function isFirstPipelineSubtask(task?: SubtaskStepRef): boolean {
  const idx = task?.testStepIndex
  return idx == null || idx === 0
}

/** merge 合并 spec 或第一个子任务：须从提示词 URL 重头执行 */
export function shouldRestartFromPromptUrl(task?: SubtaskStepRef): boolean {
  if (task?.testStepRole === 'merge') return true
  return isFirstPipelineSubtask(task)
}

/**
 * 子任务应使用的目标 URL：
 * - 第一个子任务 / merge 合并 → 提示词 pageUrl
 * - 后续片段子任务 → 上一段 test 执行后的当前页
 */
export function resolveSubtaskTargetUrl(
  state: Pick<State, 'runnerSessionId' | 'runnerPageUrl' | 'pageUrl'>,
  task?: SubtaskStepRef,
): string {
  if (shouldRestartFromPromptUrl(task)) {
    return promptPageUrl(state) || effectiveRunnerPageUrl(state)
  }
  return syncRunnerPageUrlState(state)
}

/** 须强制导航到提示词 URL（精确 pathname，勿保留 SPA 子路径） */
export function shouldForceNavigateToPromptUrl(task?: SubtaskStepRef): boolean {
  return shouldRestartFromPromptUrl(task)
}

/** 从已登记 CDP 会话读取页签 URL */
export function readRunnerPageUrlFromSession(sessionId: string | undefined): string | undefined {
  const sid = sessionId?.trim()
  if (!sid) return undefined
  const page = getPlaywrightSessionPage(sid)
  if (!page) return undefined
  try {
    const url = page.url()?.trim()
    if (url && !url.startsWith('about:')) return url
  } catch {
    /* ignore */
  }
  return undefined
}

/** 优先会话实时 URL，否则 state 中已记录的 runnerPageUrl / pageUrl */
export function syncRunnerPageUrlState(state: Pick<State, 'runnerSessionId' | 'runnerPageUrl' | 'pageUrl'>): string {
  return readRunnerPageUrlFromSession(state.runnerSessionId) ?? effectiveRunnerPageUrl(state)
}

export function runnerPageUrlStatePatch(
  state: Pick<State, 'runnerSessionId' | 'runnerPageUrl' | 'pageUrl'>,
): { runnerPageUrl: string } {
  return { runnerPageUrl: syncRunnerPageUrlState(state) }
}
