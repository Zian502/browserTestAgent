import { invokePlaywrightTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'
import { runTestInjectedEnvKeyNames } from '../lib/run-test-env'
import {
  effectiveRunnerPageUrl,
  resolveSubtaskTargetUrl,
  shouldForceNavigateToPromptUrl,
  type SubtaskStepRef,
} from '../lib/runner-page-url'

/**
 * 在已有 Playwright CDP 会话页签中执行 `@playwright/test` 风格源码（经 `playwright` 工具 `run_test`）。
 * 服务端将 `.env` 中白名单变量（默认 `TEST_USERNAME` / `TEST_PASSWORD`，见 `RUN_TEST_ENV_KEYS`）注入为测试体内的 **`testEnv`** 对象，不在工具流中传递具体值。
 */
export const runTestCodeSkill: SkillDefinition = {
  id: 'run-test-code',
  name: '运行 Playwright 测试代码',
  description: '复用 mainAgent 打开的浏览器会话，在同一 Page 上执行生成的测试代码并返回通过/失败统计。',
  toolsRequired: ['playwright'],
  async run(ctx, input) {
    const sessionId = String(input['sessionId'] ?? ctx.state.runnerSessionId ?? '').trim()
    const code = String(input['code'] ?? '')
    const subtask = input['subtask'] as SubtaskStepRef | undefined
    const targetUrl = String(
      input['targetUrl'] ?? resolveSubtaskTargetUrl(ctx.state, subtask) ?? effectiveRunnerPageUrl(ctx.state) ?? '',
    )
    const forceNavigate =
      Boolean(input['forceNavigate']) || shouldForceNavigateToPromptUrl(subtask)
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
      ...(forceNavigate ? { forceNavigate: true, navigateExact: true } : {}),
      /** 仅键名，供观测；具体值在 runner 内从 process.env 注入，不经过本 payload */
      injectedEnvKeys: runTestInjectedEnvKeyNames(),
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
