import type { AgentName, StreamEvent, TaskPlanMain, TaskPlanStatus, TaskPlanStep } from './state'

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

export function findMainTaskByStepId(groups: TaskPlanMain[], stepId: string): TaskPlanMain | undefined {
  return groups.find((g) => g.subTasks.some((s) => s.id === stepId))
}

export function findMainTaskWithFailedStep(groups: TaskPlanMain[]): TaskPlanMain | undefined {
  return groups.find((g) => g.subTasks.some((s) => s.status === 'failed'))
}

export function markMainTaskStatus(
  groups: TaskPlanMain[],
  mainId: string,
  status: TaskPlanStatus,
): TaskPlanMain[] {
  return groups.map((g) => (g.id === mainId ? { ...g, status } : g))
}

/** 将 taskPlan 中主/子任务状态同步为 SSE，供扩展侧更新 UI */
export function buildTaskStatusSyncEvents(plan: TaskPlanMain[]): StreamEvent[] {
  const ts = Date.now()
  const events: StreamEvent[] = []
  for (const main of plan) {
    if (main.status !== 'pending') {
      events.push({
        type: 'task_status',
        taskId: main.id,
        payload: { scope: 'main', status: main.status },
        timestamp: ts,
      })
    }
    for (const sub of main.subTasks) {
      if (sub.status === 'skipped' || sub.status === 'failed') {
        events.push({
          type: 'task_status',
          taskId: sub.id,
          payload: { scope: 'sub', status: sub.status },
          timestamp: ts,
        })
      }
    }
  }
  return events
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

/** 测试失败后跳过尚未执行的子任务，以便直接进入复盘与收尾 */
export function skipPendingTasks(groups: TaskPlanMain[]): TaskPlanMain[] {
  return mapSteps(groups, (s) => (s.status === 'pending' ? { ...s, status: 'skipped' as const } : s))
}
