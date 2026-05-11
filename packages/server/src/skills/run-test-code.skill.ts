import { invokePlaywrightTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'

/**
 * 在已有 Playwright CDP 会话页签中执行 `@playwright/test` 风格源码（经 `playwright` 工具 `run_test`）。
 */
export const runTestCodeSkill: SkillDefinition = {
  id: 'run-test-code',
  name: '运行 Playwright 测试代码',
  description: '复用 mainAgent 打开的浏览器会话，在同一 Page 上执行生成的测试代码并返回通过/失败统计。',
  toolsRequired: ['playwright'],
  async run(ctx, input) {
    const sessionId = String(input['sessionId'] ?? ctx.state.runnerSessionId ?? '').trim()
    const code = String(input['code'] ?? '')
    const targetUrl = String(input['targetUrl'] ?? ctx.state.pageUrl ?? '')
    const timeoutMs = input['timeoutMs'] != null ? Number(input['timeoutMs']) : 90_000
    if (!sessionId) {
      return { ok: false, error: '缺少 Playwright 会话 sessionId' }
    }
    const out = await invokePlaywrightTool(ctx.agentName, ctx.emit, {
      op: 'run_test',
      sessionId,
      code,
      targetUrl,
      timeoutMs,
    })
    if (out['ok'] === true) {
      return {
        ok: true,
        passed: Number(out['passed'] ?? 0),
        failed: Number(out['failed'] ?? 0),
        skipped: Boolean(out['skipped']),
        logs: Array.isArray(out['logs']) ? out['logs'] : [],
      }
    }
    return { ok: false, error: String(out['error'] ?? 'run_test 失败') }
  },
}
