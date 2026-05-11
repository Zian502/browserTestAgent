import type { AgentName, TaskPlan } from './state'

export function markRunning(plan: TaskPlan[], taskId: string): TaskPlan[] {
  return plan.map((t) => (t.id === taskId ? { ...t, status: 'running' as const } : t))
}

export function markRunningBatch(plan: TaskPlan[], ids: string[]): TaskPlan[] {
  const set = new Set(ids)
  return plan.map((t) => (set.has(t.id) ? { ...t, status: 'running' as const } : t))
}

export function markDoneBatch(plan: TaskPlan[], ids: string[]): TaskPlan[] {
  const set = new Set(ids)
  return plan.map((t) => (set.has(t.id) ? { ...t, status: 'done' as const } : t))
}

export function markFailed(plan: TaskPlan[], taskId: string): TaskPlan[] {
  return plan.map((t) => (t.id === taskId ? { ...t, status: 'failed' as const } : t))
}

export function updateStatus(plan: TaskPlan[], taskId: string, status: TaskPlan['status']): TaskPlan[] {
  return plan.map((t) => (t.id === taskId ? { ...t, status } : t))
}

/**
 * 解析/报告等节点执行时，对应子任务在计划中应为 `running`；优先匹配 `running` 以免误用同 assignTo 的其它条目。
 */
export function findTaskId(plan: TaskPlan[], assignTo: AgentName): string | undefined {
  const running = plan.find((t) => t.assignTo === assignTo && t.status === 'running')
  if (running) return running.id
  return plan.find((t) => t.assignTo === assignTo)?.id
}

export function executablePendingTasks(state: { taskPlan: TaskPlan[] }): TaskPlan[] {
  return state.taskPlan.filter((task) => {
    if (task.status !== 'pending') return false
    return task.dependencies.every((depId) => {
      const dep = state.taskPlan.find((t) => t.id === depId)
      return dep?.status === 'done' || dep?.status === 'skipped'
    })
  })
}

export function allTasksFinished(plan: TaskPlan[]): boolean {
  return plan.every((t) => ['done', 'failed', 'skipped'].includes(t.status))
}
