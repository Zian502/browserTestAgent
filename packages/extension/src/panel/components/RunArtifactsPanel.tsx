import { useTaskStore } from '../stores/task-store'
import { TaskListCard } from './TaskListCard'
import { ToolCallObservationCards } from './ToolCallObservationCards'

function invocationObservationKind(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const k = (data as { kind?: string }).kind
  return typeof k === 'string' ? k : undefined
}

/** 任务计划 + 工具调用卡片（挂在助手首段文本或等待占位内） */
export function RunArtifactsPanel() {
  const hasArtifacts = useTaskStore((s) => {
    if (s.mainTasks.some((m) => m.subTasks.length > 0)) return true
    return s.agentObservationLog.some((o) => {
      const k = invocationObservationKind(o.data)
      return (
        k === 'tool_start' ||
        k === 'tool_success' ||
        k === 'tool_failure' ||
        k === 'skill_start' ||
        k === 'skill_success' ||
        k === 'skill_failure' ||
        k === 'mcp_call' ||
        k === 'mcp_result'
      )
    })
  })
  if (!hasArtifacts) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <TaskListCard />
      <ToolCallObservationCards />
    </div>
  )
}
