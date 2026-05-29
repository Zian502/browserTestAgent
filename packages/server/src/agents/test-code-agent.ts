import { Command, type LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentOutput, State, StreamEvent, TestCodeFragment, TestReviewContext } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { agentFileReadText } from '../lib/agent-files'
import { extractMessageText } from './llm-text'
import { findTaskId, updateStatus, findStepByTaskId, skipPendingTasks } from './graph-helpers'
import {
  TEST_CODE_AGENT_SYSTEM_PROMPT,
  TEST_CODE_FRAGMENT_SYSTEM_PROMPT,
  buildTestCodeUserMessage,
  buildTestCodeFragmentUserMessage,
} from './prompts/test-code-agent.prompt'
import { agentObservation } from './agent-observation'
import { buildRunTestInjectedEnv } from '../lib/run-test-env'
import { mergeTestCodeFragments } from '../lib/test-code-merge'
import { runSkill } from '../skills'
import * as path from 'path'
import {
  githubObservationData,
  githubUploadSummary,
  uploadFinalTestCodeToGithub,
  type GithubUploadOutcome,
} from '../lib/upload-test-code-github'

function resolveRunUserId(state: State, config?: LangGraphRunnableConfig): string | undefined {
  const fromCfg = config?.configurable?.userId
  if (typeof fromCfg === 'string' && fromCfg.trim()) return fromCfg.trim()
  return state.userId?.trim() || undefined
}

function githubUploadStreamEvent(outcome: GithubUploadOutcome | undefined, taskId?: string): StreamEvent | null {
  if (!outcome) return null
  const summary = githubUploadSummary(outcome)
  if (!summary) return null
  return {
    type: 'agent_observation',
    agentName: 'testCodeAgent',
    taskId,
    payload: {
      phase: outcome.ok ? 'done' : 'failed',
      label: 'GitHub 上传',
      summary,
      data: githubObservationData(outcome),
    },
    timestamp: Date.now(),
  }
}

function extractCode(raw: string): string {
  const fence = /^```(?:ts|typescript)?\s*([\s\S]*?)```$/m.exec(raw.trim())
  if (fence) return fence[1].trim()
  return raw.trim()
}

/** 将已注入键上的 `env.XXX` 改为 `testEnv.XXX`，兼容旧提示词并避免与 `const env` 冲突 */
function rewriteInjectedEnvAccessors(code: string): string {
  let out = code
  for (const key of Object.keys(buildRunTestInjectedEnv())) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\benv\\.${escaped}\\b`, 'g'), `testEnv.${key}`)
  }
  return out
}

function findParseCacheKeyForFragment(state: State, groupId: string, stepIndex: number): string | undefined {
  for (const main of state.taskPlan) {
    if (main.id !== groupId) continue
    const parseStep = main.subTasks.find(
      (s) => s.type === 'parseHtml' && s.testStepIndex === stepIndex && s.groupId === groupId,
    )
    return parseStep?.cacheKey
  }
  return undefined
}

function getFragmentStepContext(
  state: State,
  groupId: string | undefined,
  stepIndex: number,
): { stepIndex: number; totalSteps: number; priorStepTitles: string[] } {
  if (!groupId) return { stepIndex, totalSteps: 1, priorStepTitles: [] }
  for (const main of state.taskPlan) {
    if (main.id !== groupId) continue
    const fragments = main.subTasks
      .filter((s) => s.type === 'testCode' && s.testStepRole === 'fragment')
      .sort((a, b) => (a.testStepIndex ?? 0) - (b.testStepIndex ?? 0))
    return {
      stepIndex,
      totalSteps: fragments.length || 1,
      priorStepTitles: fragments.filter((s) => (s.testStepIndex ?? 0) < stepIndex).map((s) => s.title),
    }
  }
  return { stepIndex, totalSteps: 1, priorStepTitles: [] }
}

async function generateTestCode(
  state: State,
  task: ReturnType<typeof findStepByTaskId>,
  reuseOpenPage: boolean,
): Promise<string> {
  const dsl = state.pageDSL
  if (!dsl) throw new Error('pageDSL 未就绪')

  const isFragment = task?.testStepRole === 'fragment'
  const stepTitle = task?.title?.trim() ?? ''

  let code = reuseOpenPage
    ? `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await expect(page.locator('body')).toBeVisible();\n});\n`
    : `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await page.goto('${state.pageUrl}');\n  await expect(page).toHaveTitle(/.+/);\n});\n`

  if (hasChatLlm()) {
    const model = createChatLlm({ temperature: 0.1 })
    const dslJson = JSON.stringify(dsl, null, 2)
    const stepCtx =
      isFragment && task?.groupId != null
        ? getFragmentStepContext(state, task.groupId, task.testStepIndex ?? 0)
        : undefined
    const userContent = isFragment
      ? buildTestCodeFragmentUserMessage(stepTitle, state.userInput, dslJson, state.pageUrl, {
          reuseOpenPage,
          stepIndex: stepCtx?.stepIndex,
          totalSteps: stepCtx?.totalSteps,
          priorStepTitles: stepCtx?.priorStepTitles,
          dsl,
        })
      : buildTestCodeUserMessage(state.userInput, dslJson, state.pageUrl, {
          reuseOpenPage,
          stepTitle: stepTitle || undefined,
          dsl,
        })

    const fullCodeResp = await model.invoke([
      { role: 'system', content: isFragment ? TEST_CODE_FRAGMENT_SYSTEM_PROMPT : TEST_CODE_AGENT_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ])
    code = rewriteInjectedEnvAccessors(extractCode(extractMessageText(fullCodeResp.content)))
  }

  return code
}

async function runGeneratedTest(
  state: State,
  taskId: string | undefined,
  code: string,
  emit: (e: StreamEvent) => void,
  testStepRole?: string,
) {
  return runSkill(
    'run-test-code',
    { state, agentName: 'testCodeAgent', taskId, emit },
    {
      code,
      targetUrl: state.pageUrl,
      sessionId: state.runnerSessionId,
      timeoutMs: 90_000,
      ...(testStepRole ? { testStepRole } : {}),
    },
  )
}

async function uploadPersistedSpecToGithub(
  userId: string | undefined,
  state: State,
  persisted: { tsRelative: string; specSlug: string },
  code: string,
  taskTitle?: string,
): Promise<GithubUploadOutcome | undefined> {
  const fileName = path.basename(persisted.tsRelative)
  let content = code
  try {
    const fullPath = path.join(process.cwd(), '.agent-cache', persisted.tsRelative)
    content = await agentFileReadText(fullPath)
  } catch {
    /* 回退为内存中的 code */
  }
  return uploadFinalTestCodeToGithub(userId, {
    fileName,
    content,
    specSlug: persisted.specSlug,
    taskTitle,
    pageUrl: state.pageUrl,
  })
}

type ParsedTestRun = {
  skillOk: boolean
  passed: number
  failed: number
  skipped: boolean
  logs: string[]
  error?: string
}

function parseTestRunOutput(out: Record<string, unknown>): ParsedTestRun {
  if (out['ok'] !== true) {
    return {
      skillOk: false,
      passed: 0,
      failed: 1,
      skipped: false,
      logs: Array.isArray(out['logs']) ? (out['logs'] as string[]) : [],
      error: String(out['error'] ?? 'run-test-code 失败'),
    }
  }
  return {
    skillOk: true,
    passed: Number(out['passed'] ?? 0),
    failed: Number(out['failed'] ?? 0),
    skipped: Boolean(out['skipped']),
    logs: Array.isArray(out['logs']) ? (out['logs'] as string[]) : [],
  }
}

function shouldUploadSpecToGithub(run: ParsedTestRun): boolean {
  if (!run.skillOk) return false
  if (run.failed > 0) return false
  if (run.passed <= 0) return false
  return true
}

function githubOutcomeWhenSkippedUpload(run: ParsedTestRun): GithubUploadOutcome {
  if (!run.skillOk) {
    return { ok: false, skipped: true, reason: '测试执行失败，未上传 GitHub' }
  }
  if (run.failed > 0) {
    return { ok: false, skipped: true, reason: `测试存在 ${run.failed} 条失败，未上传 GitHub` }
  }
  return { ok: false, skipped: true, reason: '无通过用例，未上传 GitHub' }
}

function isTestExecutionFailure(run: ParsedTestRun): boolean {
  if (!run.skillOk) return true
  if (run.failed > 0) return true
  return false
}

function buildTestReviewContext(
  state: State,
  task: ReturnType<typeof findStepByTaskId>,
  run: ParsedTestRun,
  code?: string,
): TestReviewContext {
  return {
    taskId: task?.id,
    taskTitle: task?.title,
    pageUrl: state.pageUrl,
    userInput: state.userInput,
    error: run.error,
    passed: run.passed,
    failed: run.failed,
    logs: run.logs,
    codePreview: code?.slice(0, 8000),
  }
}

function routeTestExecutionFailure(
  state: State,
  task: ReturnType<typeof findStepByTaskId>,
  run: ParsedTestRun,
  partial: Partial<State>,
  code?: string,
): Command {
  return new Command({
    goto: 'reviewAgent',
    update: {
      ...partial,
      testReviewContext: buildTestReviewContext(state, task, run, code),
      taskPlan: skipPendingTasks(partial.taskPlan ?? state.taskPlan),
    },
  })
}

function testFailureSummary(run: ParsedTestRun): string {
  if (run.error?.trim()) return run.error.trim()
  const errLine = run.logs.find((l) => /\[error\]|Error:/i.test(l))
  if (errLine) return errLine.replace(/^\[error\]\s*/i, '').slice(0, 500)
  return `测试未全部通过（通过 ${run.passed} · 失败 ${run.failed}）`
}

/** 持久化 spec；仅当全部用例通过时才上传到 GitHub */
async function persistAndUploadFinalSpec(
  userId: string | undefined,
  state: State,
  opts: {
    cacheKey: string
    code: string
    taskTitle?: string
    run: ParsedTestRun
  },
): Promise<{
  persisted: { tsRelative: string; manifestRelative: string; specSlug: string }
  githubOutcome: GithubUploadOutcome | undefined
}> {
  const persisted = await fileCacheService.persistTestCodeArtifacts({
    cacheKey: opts.cacheKey,
    userInput: state.userInput,
    taskTitle: opts.taskTitle,
    pageUrl: state.pageUrl,
    code: opts.code,
    passed: opts.run.passed,
    failed: opts.run.failed,
    skipped: opts.run.skipped,
  })
  const githubOutcome = shouldUploadSpecToGithub(opts.run)
    ? await uploadPersistedSpecToGithub(userId, state, persisted, opts.code, opts.taskTitle)
    : githubOutcomeWhenSkippedUpload(opts.run)
  return { persisted, githubOutcome }
}

export async function testCodeAgentNode(state: State, config?: LangGraphRunnableConfig) {
  const runUserId = resolveRunUserId(state, config)
  const taskId = findTaskId(state.taskPlan, 'testCodeAgent')
  const task = taskId ? findStepByTaskId(state.taskPlan, taskId) : undefined
  const cacheKey = task?.cacheKey
  const groupId = task?.groupId
  const role = task?.testStepRole

  const reuseOpenPage = Boolean(state.usePlaywrightBrowser && state.runnerSessionId)

  const streamEvents: StreamEvent[] = []
  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }

  /** 合并子任务：串联各片段，执行并持久化完整 spec */
  if (role === 'merge' && groupId) {
    const stored = state.testCodeFragments[groupId] ?? []
    const fragmentCodes = stored.map((f) => f.code)
    if (fragmentCodes.length === 0) {
      throw new Error(`主任务 ${groupId} 无可用测试片段，无法合并`)
    }

    const code = mergeTestCodeFragments(fragmentCodes)
    const out = await runGeneratedTest(state, taskId, code, emit, 'merge')
    const run = parseTestRunOutput(out as Record<string, unknown>)

    const persistKey = cacheKey ?? `${state.pageUrl}::${groupId}::merged`
    const { persisted, githubOutcome } = await persistAndUploadFinalSpec(runUserId, state, {
      cacheKey: persistKey,
      code: code,
      taskTitle: task?.title ?? `合并测试：${groupId}`,
      run,
    })
    const githubSummary = githubOutcome ? githubUploadSummary(githubOutcome) : undefined
    const ghUploadEvent = githubUploadStreamEvent(githubOutcome, taskId)

    const testResult = {
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      logs: run.logs,
    }

    if (isTestExecutionFailure(run)) {
      const err = testFailureSummary(run)
      return routeTestExecutionFailure(
        state,
        task,
        run,
        {
          agentOutputs: {
            testCodeAgent: {
              status: 'failed',
              error: err,
              data: { code, testResult, merged: true, ...persisted, github: githubOutcome ?? null },
            },
          },
          taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
          streamEvents: [
            ...streamEvents,
            ...(ghUploadEvent ? [ghUploadEvent] : []),
            agentObservation('testCodeAgent', 'failed', {
              taskId,
              summary: [err, githubSummary].filter(Boolean).join('；'),
              data: {
                error: err,
                specRelative: persisted.tsRelative,
                github: githubObservationData(githubOutcome),
                passed: run.passed,
                failed: run.failed,
              },
            }),
            {
              type: 'agent_failed' as const,
              agentName: 'testCodeAgent' as const,
              taskId,
              payload: { message: err, passed: run.passed, failed: run.failed },
              timestamp: Date.now(),
            },
          ],
        },
        code,
      )
    }

    return {
      agentOutputs: {
        testCodeAgent: {
          status: 'done',
          data: { code, testResult, merged: true, ...persisted, github: githubOutcome ?? null },
        },
      },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
      streamEvents: [
        ...streamEvents,
        ...(ghUploadEvent ? [ghUploadEvent] : []),
        agentObservation('testCodeAgent', 'done', {
          taskId,
          summary: [
            `已合并 ${fragmentCodes.length} 段测试；Playwright 通过 ${testResult.passed}，失败 ${testResult.failed}`,
            githubSummary,
          ]
            .filter(Boolean)
            .join('；'),
          data: {
            fragmentCount: fragmentCodes.length,
            codeLength: code.length,
            specRelative: persisted.tsRelative,
            passed: testResult.passed,
            failed: testResult.failed,
            github: githubObservationData(githubOutcome),
          },
        }),
        {
          type: 'agent_done' as const,
          agentName: 'testCodeAgent' as const,
          taskId,
          payload: { passed: testResult.passed, failed: testResult.failed, merged: true },
          timestamp: Date.now(),
        },
      ],
    }
  }

  /** 片段子任务：仅生成本步 test，缓存片段，单独执行校验 */
  if (role === 'fragment' && groupId && task) {
    const stepIndex = task.testStepIndex ?? 0
    let code: string
    try {
      code = await generateTestCode(state, task, reuseOpenPage)
    } catch (e) {
      const err = String(e)
      return {
        agentOutputs: { testCodeAgent: { status: 'failed', error: err } },
        taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
        streamEvents: [
          agentObservation('testCodeAgent', 'failed', { taskId, summary: err }),
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

    const parseCacheKey = findParseCacheKeyForFragment(state, groupId, stepIndex)
    const fragment: TestCodeFragment = {
      taskId: task.id,
      stepIndex,
      title: task.title,
      code,
      cacheKey: cacheKey ?? task.id,
      dslCacheKey: parseCacheKey,
    }

    const fragmentRel = `testCode/fragments/${fileCacheService.artifactIdFromKey(fragment.cacheKey)}.ts`
    await fileCacheService.writeFile(fragmentRel, code)

    const out = await runGeneratedTest(state, taskId, code, emit, 'fragment')
    const run = parseTestRunOutput(out as Record<string, unknown>)

    if (isTestExecutionFailure(run)) {
      const err = testFailureSummary(run)
      return routeTestExecutionFailure(
        state,
        task,
        run,
        {
          testCodeFragments: { [groupId]: [fragment] },
          agentOutputs: { testCodeAgent: { status: 'failed', error: err } },
          taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
          streamEvents: [
            ...streamEvents,
            agentObservation('testCodeAgent', 'failed', {
              taskId,
              summary: err,
              data: { stepIndex, fragmentRelative: fragmentRel, passed: run.passed, failed: run.failed },
            }),
            {
              type: 'agent_failed' as const,
              agentName: 'testCodeAgent' as const,
              taskId,
              payload: { message: err, passed: run.passed, failed: run.failed },
              timestamp: Date.now(),
            },
          ],
        },
        code,
      )
    }

    const testResult = {
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      logs: run.logs,
    }

    return {
      testCodeFragments: { [groupId]: [fragment] },
      agentOutputs: {
        testCodeAgent: {
          status: 'done',
          data: { code, testResult, fragment: true, stepIndex, fragmentRelative: fragmentRel },
        },
      },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
      streamEvents: [
        ...streamEvents,
        agentObservation('testCodeAgent', 'done', {
          taskId,
          summary: `测试片段 ${stepIndex + 1}：${task.title}（通过 ${testResult.passed}，失败 ${testResult.failed}）`,
          data: {
            stepIndex,
            fragmentRelative: fragmentRel,
            dslCacheKey: parseCacheKey ?? null,
            passed: testResult.passed,
            failed: testResult.failed,
          },
        }),
        {
          type: 'agent_done' as const,
          agentName: 'testCodeAgent' as const,
          taskId,
          payload: { passed: testResult.passed, failed: testResult.failed, fragment: true, stepIndex },
          timestamp: Date.now(),
        },
      ],
    }
  }

  /**  legacy 单段 test 主任务 */
  let code: string
  try {
    code = await generateTestCode(state, task, reuseOpenPage)
  } catch (e) {
    const err = String(e)
    return {
      agentOutputs: { testCodeAgent: { status: 'failed', error: err } },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
      streamEvents: [
        agentObservation('testCodeAgent', 'failed', { taskId, summary: err }),
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

  const out = await runGeneratedTest(state, taskId, code, emit, task?.testStepRole)
  const run = parseTestRunOutput(out as Record<string, unknown>)

  const persistKey = cacheKey ?? `${state.pageUrl}::${state.userInput}::testCode`
  const { persisted, githubOutcome } = await persistAndUploadFinalSpec(runUserId, state, {
    cacheKey: persistKey,
    code,
    taskTitle: task?.title,
    run,
  })
  const githubSummary = githubOutcome ? githubUploadSummary(githubOutcome) : undefined
  const ghUploadEvent = githubUploadStreamEvent(githubOutcome, taskId)

  const testResult = {
    passed: run.passed,
    failed: run.failed,
    skipped: run.skipped,
    logs: run.logs,
  }

  if (isTestExecutionFailure(run)) {
    const err = testFailureSummary(run)
    return routeTestExecutionFailure(
      state,
      task,
      run,
      {
        agentOutputs: {
          testCodeAgent: {
            status: 'failed',
            error: err,
            data: { code, testResult, ...persisted, github: githubOutcome ?? null },
          },
        },
        taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
        streamEvents: [
          ...streamEvents,
          ...(ghUploadEvent ? [ghUploadEvent] : []),
          agentObservation('testCodeAgent', 'failed', {
            taskId,
            summary: [err, githubSummary].filter(Boolean).join('；'),
            data: {
              error: err,
              specRelative: persisted.tsRelative,
              github: githubObservationData(githubOutcome),
              passed: run.passed,
              failed: run.failed,
            },
          }),
          {
            type: 'agent_failed' as const,
            agentName: 'testCodeAgent' as const,
            taskId,
            payload: { message: err, passed: run.passed, failed: run.failed },
            timestamp: Date.now(),
          },
        ],
      },
      code,
    )
  }

  const doneOutput: AgentOutput = {
    status: 'done',
    data: { code, testResult, ...persisted, github: githubOutcome ?? null },
  }

  return {
    agentOutputs: { testCodeAgent: doneOutput },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...streamEvents,
      ...(ghUploadEvent ? [ghUploadEvent] : []),
      agentObservation('testCodeAgent', 'done', {
        taskId,
        summary: [`Playwright：通过 ${testResult.passed}，失败 ${testResult.failed}`, githubSummary]
          .filter(Boolean)
          .join('；'),
        data: {
          codeLength: code.length,
          specRelative: persisted.tsRelative,
          passed: testResult.passed,
          failed: testResult.failed,
          testResult,
          github: githubObservationData(githubOutcome),
        },
      }),
      {
        type: 'agent_done' as const,
        agentName: 'testCodeAgent' as const,
        taskId,
        payload: { passed: testResult.passed, failed: testResult.failed },
        timestamp: Date.now(),
      },
    ],
  }
}
