import { useTaskStore } from '../stores/task-store'
import { TaskListCard } from './TaskListCard'
import { ToolCallObservationCards } from './ToolCallObservationCards'

function toolKind(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const k = (data as { kind?: string }).kind
  return typeof k === 'string' ? k : undefined
}

/** 任务计划 + 工具调用卡片（挂在助手首段文本或等待占位内） */
export function RunArtifactsPanel() {
  const hasArtifacts = useTaskStore((s) => {
    if (s.tasks.length > 0) return true
    return s.agentObservationLog.some((o) => {
      const k = toolKind(o.data)
      return k === 'tool_call' || k === 'tool_result'
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
