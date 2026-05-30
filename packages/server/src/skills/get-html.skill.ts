import { invokePlaywrightTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'
import {
  effectiveRunnerPageUrl,
  readRunnerPageUrlFromSession,
  resolveSubtaskTargetUrl,
  shouldForceNavigateToPromptUrl,
  type SubtaskStepRef,
} from '../lib/runner-page-url'

/**
 * 获取页面 HTML：首次 `capture` 打开浏览器；已有会话时 `cdp_refresh` 经 CDP 刷新 outerHTML。
 * 依赖：`playwright`。HTML 落盘请由调用方再执行 `cache-file` skill。
 */
export const getHtmlSkill: SkillDefinition = {
  id: 'get-html',
  name: '获取页面 HTML',
  description: 'Playwright 打开页面并 CDP 取 HTML，或在同一会话内刷新 documentElement.outerHTML。',
  toolsRequired: ['playwright'],
  async run(ctx, input) {
    const phase = String(input['phase'] ?? 'capture')
    if (phase === 'cdp_refresh') {
      const sessionId = String(input['sessionId'] ?? ctx.state.runnerSessionId ?? '').trim()
      if (!sessionId) {
        return { ok: false, error: '缺少 runnerSessionId' }
      }
      const subtask = input['subtask'] as SubtaskStepRef | undefined
      const forceNavigate =
        Boolean(input['forceNavigate']) || shouldForceNavigateToPromptUrl(subtask)
      const pageUrl = String(
        input['pageUrl'] ?? resolveSubtaskTargetUrl(ctx.state, subtask) ?? effectiveRunnerPageUrl(ctx.state) ?? '',
      ).trim()
      const out = await invokePlaywrightTool(ctx.agentName, ctx.emit, {
        op: 'refresh_outer_html',
        sessionId,
        ...(forceNavigate && pageUrl
          ? { navigateToUrl: pageUrl, navigateExact: true }
          : {}),
      })
      if (out['ok'] === true && typeof out['pageHtml'] === 'string') {
        const pageHtml = out['pageHtml'] as string
        const pageUrlAfter =
          readRunnerPageUrlFromSession(sessionId) || pageUrl
        return { ok: true, pageHtml, pageUrl: pageUrlAfter, phase: 'cdp_refresh' }
      }
      return { ok: false, error: String(out['error'] ?? 'CDP 刷新失败'), phase: 'cdp_refresh' }
    }
    const pageUrl = String(input['pageUrl'] ?? ctx.state.pageUrl ?? effectiveRunnerPageUrl(ctx.state) ?? '').trim()
    const headless = Boolean(input['headless'] ?? ctx.state.playwrightHeadless ?? false)
    const slowMoMs = Number(input['slowMoMs'] ?? ctx.state.playwrightSlowMoMs ?? 0) || 0
    const out = await invokePlaywrightTool(ctx.agentName, ctx.emit, {
      op: 'capture',
      pageUrl,
      headless,
      slowMoMs,
      exactPath: true,
    })
    if (out['ok'] === true && typeof out['pageHtml'] === 'string') {
      const pageHtml = out['pageHtml'] as string
      const sessionId = String(out['sessionId'] ?? '')
      return { ok: true, pageHtml, sessionId, phase: 'capture' }
    }
    return {
      ok: false,
      error: String(out['error'] ?? 'capture 失败'),
      sessionId: out['sessionId'],
      phase: 'capture',
    }
  },
}
