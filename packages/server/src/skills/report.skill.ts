import { executeReportBatchForTool } from '../agents/report-batch-executor'
import { findTaskId, updateStatus } from '../agents/graph-helpers'
import { agentObservation } from '../agents/agent-observation'
import { invokeWriteTool } from './tool-invoker'
import type { SkillDefinition } from './skill-types'
import type { ReportLlmOutline, ReportType } from '../lib/report-generator'

/**
 * 根据子 agent 输出与 LLM 纲要批量生成 HTML 报告（每份文件经 `write` 工具写入 `.agent-cache/reports`）。
 */
export const reportSkill: SkillDefinition = {
  id: 'report',
  name: '批量生成报告',
  description: '为 test / seo / pagespeed 等类型生成 HTML 报告并写入缓存目录，附带 report_ready 事件。',
  toolsRequired: ['write'],
  async run(ctx, input) {
    const llmSpecs = (input['llmSpecs'] ?? {}) as Partial<Record<ReportType, ReportLlmOutline>>
    const taskId = (input['taskId'] as string | undefined) ?? findTaskId(ctx.state.taskPlan, 'reportAgent')
    const { reports, streamEvents: reportEvents, outcomes } = await executeReportBatchForTool(ctx.state, {
      llmSpecs,
      writeText: (rel, html) => invokeWriteTool(ctx.agentName, ctx.emit, rel, html),
      onlyTypes:
        Array.isArray(input['onlyTypes']) && (input['onlyTypes'] as unknown[]).length > 0
          ? (input['onlyTypes'] as ReportType[]).filter((x) => x === 'test' || x === 'seo' || x === 'pagespeed')
          : undefined,
    })
    for (const ev of reportEvents) {
      ctx.emit(ev)
    }
    const okCount = outcomes.filter((o) => o.ok).length
    const failCount = outcomes.filter((o) => !o.ok).length
    ctx.emit(
      agentObservation('reportAgent', failCount > 0 && okCount === 0 ? 'failed' : 'done', {
        taskId,
        summary:
          failCount === 0
            ? `已生成 ${okCount} 份报告`
            : okCount === 0
              ? `${failCount} 份报告均未生成成功`
              : `已生成 ${okCount} 份，${failCount} 份失败`,
        data: { reports, outcomes, generated: reportEvents.map((e) => e.payload) },
      }),
    )
    const reportAgentFailed = outcomes.length > 0 && okCount === 0
    const reportAgentError = reportAgentFailed
      ? outcomes
          .filter((o): o is { ok: false; type: ReportType; error: string } => !o.ok)
          .map((o) => `${o.type}: ${o.error}`)
          .join('；')
      : undefined
    const taskPlan = taskId
      ? updateStatus(ctx.state.taskPlan, taskId, reportAgentFailed ? 'failed' : 'done')
      : ctx.state.taskPlan
    return {
      reports,
      outcomes,
      reportAgentFailed,
      reportAgentError,
      taskPlan,
      agentOutput: reportAgentFailed
        ? { status: 'failed' as const, data: reports, error: reportAgentError }
        : { status: 'done' as const, data: reports },
    }
  },
}
