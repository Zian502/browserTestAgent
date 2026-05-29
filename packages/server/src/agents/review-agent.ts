import { Command } from '@langchain/langgraph'
import type { State, TestReviewContext } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { extractMessageText } from './llm-text'
import {
  REVIEW_AGENT_SYSTEM_PROMPT,
  buildReviewAgentUserMessage,
  formatFallbackTestReview,
} from './prompts/review-agent.prompt'
import { agentObservation } from './agent-observation'
import {
  buildTaskStatusSyncEvents,
  findMainTaskByStepId,
  findMainTaskWithFailedStep,
  markMainTaskStatus,
} from './graph-helpers'

async function analyzeTestFailure(ctx: TestReviewContext): Promise<string> {
  if (!hasChatLlm()) return formatFallbackTestReview(ctx)
  const model = createChatLlm({ temperature: 0.2 })
  const response = await model.invoke([
    { role: 'system', content: REVIEW_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: buildReviewAgentUserMessage(ctx) },
  ])
  const text = extractMessageText(response.content).trim()
  return text || formatFallbackTestReview(ctx)
}

function resolveFailedMainId(state: State, stepTaskId?: string): string | undefined {
  if (stepTaskId) {
    const main = findMainTaskByStepId(state.taskPlan, stepTaskId)
    if (main) return main.id
  }
  return findMainTaskWithFailedStep(state.taskPlan)?.id
}

function markRunFailed(state: State, stepTaskId?: string) {
  const mainId = resolveFailedMainId(state, stepTaskId)
  if (!mainId) return state.taskPlan
  return markMainTaskStatus(state.taskPlan, mainId, 'failed')
}

/** 测试执行失败后：LLM 复盘并输出给用户，随后结束主流程 */
export async function reviewAgentNode(state: State) {
  const ctx = state.testReviewContext
  if (!ctx) {
    return new Command({
      goto: 'finalSummary',
      update: {
        streamEvents: [
          {
            type: 'text' as const,
            payload: { content: '未收到测试失败上下文，跳过复盘。' },
            timestamp: Date.now(),
          },
        ],
      },
    })
  }

  const analysis = await analyzeTestFailure(ctx)
  const taskPlan = markRunFailed(state, ctx.taskId)

  return new Command({
    goto: 'finalSummary',
    update: {
      taskPlan,
      agentOutputs: {
        reviewAgent: {
          status: 'done',
          data: { analysis, passed: ctx.passed, failed: ctx.failed, runFailed: true },
        },
      },
      streamEvents: [
        ...buildTaskStatusSyncEvents(taskPlan),
        agentObservation('reviewAgent', 'done', {
          taskId: ctx.taskId,
          summary: `测试失败复盘（通过 ${ctx.passed} · 失败 ${ctx.failed}）`,
          data: { taskTitle: ctx.taskTitle, error: ctx.error, runFailed: true },
        }),
        {
          type: 'text' as const,
          payload: { content: analysis },
          timestamp: Date.now(),
        },
        {
          type: 'agent_done' as const,
          agentName: 'reviewAgent' as const,
          taskId: ctx.taskId,
          payload: { passed: ctx.passed, failed: ctx.failed, runFailed: true },
          timestamp: Date.now(),
        },
      ],
    },
  })
}
