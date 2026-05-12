import type { AgentName, TaskPlanMain, TaskPlanStep } from './state'

/** 将所有主任务下的子任务按主任务顺序展平（用于依赖解析与调度顺序） */
export function flattenTaskPlan(groups: TaskPlanMain[]): TaskPlanStep[] {
  const out: TaskPlanStep[] = []
  for (const g of groups) {
    for (const s of g.subTasks) {
      out.push(s)
    }
  }
  return out
}

export function findStepByTaskId(groups: TaskPlanMain[], taskId: string): TaskPlanStep | undefined {
  for (const g of groups) {
    const s = g.subTasks.find((x) => x.id === taskId)
    if (s) return s
  }
  return undefined
}

function mapSteps(groups: TaskPlanMain[], fn: (step: TaskPlanStep) => TaskPlanStep): TaskPlanMain[] {
  return groups.map((g) => ({
    ...g,
    subTasks: g.subTasks.map(fn),
  }))
}

export function markRunning(groups: TaskPlanMain[], taskId: string): TaskPlanMain[] {
  return updateStatus(groups, taskId, 'running')
}

export function updateStatus(
  groups: TaskPlanMain[],
  taskId: string,
  status: TaskPlanStep['status'],
): TaskPlanMain[] {
  return mapSteps(groups, (s) => (s.id === taskId ? { ...s, status } : s))
}

/**
 * 解析/报告等节点执行时，对应子任务在计划中应为 `running`；优先匹配 `running` 以免误用同 assignTo 的其它条目。
 */
export function findTaskId(groups: TaskPlanMain[], assignTo: AgentName): string | undefined {
  const flat = flattenTaskPlan(groups)
  const running = flat.find((t) => t.assignTo === assignTo && t.status === 'running')
  if (running) return running.id
  return flat.find((t) => t.assignTo === assignTo)?.id
}

export function executablePendingTasks(state: { taskPlan: TaskPlanMain[] }): TaskPlanStep[] {
  const flat = flattenTaskPlan(state.taskPlan)
  return flat.filter((task) => {
    if (task.status !== 'pending') return false
    return task.dependencies.every((depId) => {
      const dep = flat.find((t) => t.id === depId)
      return dep?.status === 'done' || dep?.status === 'skipped'
    })
  })
}

export function allTasksFinished(groups: TaskPlanMain[]): boolean {
  const flat = flattenTaskPlan(groups)
  if (flat.length === 0) return true
  return flat.every((t) => ['done', 'failed', 'skipped'].includes(t.status))
}
