import type { AgentOutput, State, StreamEvent, TaskPlan } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractMessageText } from './llm-text'
import { findTaskId, updateStatus } from './graph-helpers'
import { TEST_CODE_AGENT_SYSTEM_PROMPT, buildTestCodeUserMessage } from './prompts/test-code-agent.prompt'
import { agentObservation } from './agent-observation'
import { runSkill } from '../skills'

function extractCode(raw: string): string {
  const fence = /^```(?:ts|typescript)?\s*([\s\S]*?)```$/m.exec(raw.trim())
  if (fence) return fence[1].trim()
  return raw.trim()
}

export async function testCodeAgentNode(state: State) {
  const taskId = findTaskId(state.taskPlan, 'testCodeAgent')
  const task = taskId ? state.taskPlan.find((t: TaskPlan) => t.id === taskId) : undefined
  const cacheKey = task?.cacheKey

  if (cacheKey) {
    const cached = await fileCacheService.get<{ code: string; testResult: unknown }>(cacheKey)
    if (cached) {
      return {
        agentOutputs: { testCodeAgent: { status: 'cached', data: cached, fromCache: true } },
        taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
        streamEvents: [
          agentObservation('testCodeAgent', 'skipped', {
            taskId,
            summary: '测试代码与结果来自缓存',
            data: {
              fromCache: true,
              codeLength: typeof cached.code === 'string' ? cached.code.length : 0,
              testResult: cached.testResult,
            },
          }),
          {
            type: 'agent_done' as const,
            agentName: 'testCodeAgent' as const,
            payload: { cached: true },
            timestamp: Date.now(),
          },
        ],
      }
    }
  }

  const dsl = state.pageDSL
  if (!dsl) throw new Error('pageDSL 未就绪')

  const reuseOpenPage = Boolean(state.usePlaywrightBrowser && state.runnerSessionId)

  let code = reuseOpenPage
    ? `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await expect(page.locator('body')).toBeVisible();\n});\n`
    : `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await page.goto('${state.pageUrl}');\n  await expect(page).toHaveTitle(/.+/);\n});\n`

  if (hasChatLlm()) {
    const model = createChatLlm({ temperature: 0.1 })
    const fullCodeResp = await model.invoke([
      { role: 'system', content: TEST_CODE_AGENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildTestCodeUserMessage(state.userInput, JSON.stringify(dsl, null, 2), state.pageUrl, {
          reuseOpenPage,
        }),
      },
    ])
    code = extractCode(extractMessageText(fullCodeResp.content))
  }

  const streamEvents: StreamEvent[] = []
  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }
  const out = await runSkill(
    'run-test-code',
    { state, agentName: 'testCodeAgent', taskId, emit },
    {
      code,
      targetUrl: state.pageUrl,
      sessionId: state.runnerSessionId,
      timeoutMs: 90_000,
    },
  )

  if (out['ok'] !== true) {
    const err = String(out['error'] ?? 'run-test-code 失败')
    return {
      agentOutputs: { testCodeAgent: { status: 'failed', error: err } },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
      streamEvents: [
        ...streamEvents,
        agentObservation('testCodeAgent', 'failed', {
          taskId,
          summary: err,
          data: { error: err },
        }),
        {
          type: 'agent_failed' as const,
          agentName: 'testCodeAgent' as const,
          taskId,
          payload: { message: err },
          timestamp: Date.now(),
        },
      ],
    }
  }

  const testResult = {
    passed: Number(out['passed'] ?? 0),
    failed: Number(out['failed'] ?? 0),
    skipped: Boolean(out['skipped']),
    logs: Array.isArray(out['logs']) ? (out['logs'] as string[]) : [],
  }

  const persistKey = cacheKey ?? `${state.pageUrl}::${state.userInput}::testCode`
  if ((testResult.passed > 0 || testResult.failed === 0) && cacheKey) {
    await fileCacheService.set(cacheKey, { code, testResult }, { ttl: 86_400 })
  }
  await fileCacheService.persistTestCodeArtifacts({
    cacheKey: persistKey,
    userInput: state.userInput,
    pageUrl: state.pageUrl,
    code,
    passed: testResult.passed,
    failed: testResult.failed,
    skipped: testResult.skipped,
  })

  const doneOutput: AgentOutput = { status: 'done', data: { code, testResult } }

  return {
    agentOutputs: { testCodeAgent: doneOutput },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...streamEvents,
      agentObservation('testCodeAgent', 'done', {
        taskId,
        summary: `Playwright：通过 ${testResult.passed}，失败 ${testResult.failed}`,
        data: {
          codeLength: code.length,
          passed: testResult.passed,
          failed: testResult.failed,
          testResult,
        },
      }),
      {
        type: 'agent_done' as const,
        agentName: 'testCodeAgent' as const,
        payload: { passed: testResult.passed, failed: testResult.failed },
        timestamp: Date.now(),
      },
    ],
  }
}
