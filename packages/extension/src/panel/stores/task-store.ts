import { create } from 'zustand'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 子任务：对应一次 agent 执行 */
export interface UiSubTask {
  id: string
  title: string
  assignTo: string
  status: TaskStatus
}

/** 主任务：含串行子任务列表 */
export interface UiMainTask {
  id: string
  title: string
  pipeline?: string
  subTasks: UiSubTask[]
}

/** 服务端 `agent_observation` SSE，用于观测各 agent 阶段与数据摘要 */
export interface AgentObservationLogEntry {
  id: string
  ts: number
  agentName: string
  label: string
  phase: string
  taskId?: string
  summary?: string
  data?: unknown
}

interface TaskStore {
  mainTasks: UiMainTask[]
  reports: Record<string, string>
  agentObservationLog: AgentObservationLogEntry[]
  setTasksFromPlan: (payload: unknown) => void
  updateByTaskId: (taskId: string, patch: Partial<Pick<UiSubTask, 'status'>> & { result?: unknown }) => void
  /** 无 taskId 时的回退：按 assignTo 更新（多段同 agent 时可能不精确） */
  updateByAgent: (agentName: string, patch: Partial<Pick<UiSubTask, 'status'>> & { result?: unknown }) => void
  addReport: (type: string, path: string) => void
  pushAgentObservation: (e: Omit<AgentObservationLogEntry, 'id' | 'ts'> & { ts?: number }) => void
  reset: () => void
}

function isNestedPlan(payload: unknown): boolean {
  if (!Array.isArray(payload) || payload.length === 0) return false
  const first = payload[0] as Record<string, unknown>
  return Array.isArray(first.subTasks)
}

function normalizeMainTasksFromServer(payload: unknown): UiMainTask[] {
  if (!Array.isArray(payload)) return []
  return payload.map((g, gi) => {
    const gx = g as Record<string, unknown>
    const id = String(gx.id ?? `main_${gi}`)
    const title = String(gx.title ?? '主任务')
    const pipeline = gx.pipeline != null ? String(gx.pipeline) : undefined
    const subs = Array.isArray(gx.subTasks) ? gx.subTasks : []
    const subTasks: UiSubTask[] = subs.map((s, si) => {
      const sx = s as Record<string, unknown>
      return {
        id: String(sx.id ?? `${id}_sub_${si}`),
        title: String(sx.title ?? ''),
        assignTo: String(sx.assignTo ?? ''),
        status: ((sx.status as TaskStatus) ?? 'pending') as TaskStatus,
      }
    })
    return { id, title, pipeline, subTasks }
  })
}

/** 兼容旧版扁平 task 数组（无 subTasks） */
function normalizeLegacyFlatTasks(payload: unknown): UiMainTask[] {
  if (!Array.isArray(payload)) return []
  const subTasks: UiSubTask[] = payload.map((t, i) => {
    const x = t as Record<string, unknown>
    return {
      id: String(x.id ?? `step_${i}`),
      title: String(x.title ?? ''),
      assignTo: String(x.assignTo ?? ''),
      status: ((x.status as TaskStatus) ?? 'pending') as TaskStatus,
    }
  })
  if (subTasks.length === 0) return []
  return [{ id: 'plan', title: '执行计划', subTasks }]
}

function newObservationId() {
  return `obs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  mainTasks: [],
  reports: {},
  agentObservationLog: [],
  setTasksFromPlan: (payload) => {
    if (isNestedPlan(payload)) {
      set({ mainTasks: normalizeMainTasksFromServer(payload) })
      return
    }
    set({ mainTasks: normalizeLegacyFlatTasks(payload) })
  },
  updateByTaskId: (taskId, patch) => {
    const { result: _r, ...rest } = patch
    set({
      mainTasks: get().mainTasks.map((m) => ({
        ...m,
        subTasks: m.subTasks.map((s) => (s.id === taskId ? { ...s, ...rest } : s)),
      })),
    })
  },
  updateByAgent: (agentName, patch) => {
    const { result: _r, ...rest } = patch
    const mainTasks = get().mainTasks.map((m) => {
      const runningI = m.subTasks.findIndex((t) => t.assignTo === agentName && t.status === 'running')
      if (runningI >= 0) {
        return {
          ...m,
          subTasks: m.subTasks.map((t, i) => (i === runningI ? { ...t, ...rest } : t)),
        }
      }
      if (rest.status === 'running') {
        const pendingI = m.subTasks.findIndex((t) => t.assignTo === agentName && t.status === 'pending')
        if (pendingI >= 0) {
          return {
            ...m,
            subTasks: m.subTasks.map((t, i) => (i === pendingI ? { ...t, ...rest } : t)),
          }
        }
      }
      if (rest.status === 'done' || rest.status === 'failed') {
        let last = -1
        for (let i = m.subTasks.length - 1; i >= 0; i--) {
          if (m.subTasks[i].assignTo === agentName && m.subTasks[i].status === 'running') {
            last = i
            break
          }
        }
        if (last >= 0) {
          return {
            ...m,
            subTasks: m.subTasks.map((t, i) => (i === last ? { ...t, ...rest } : t)),
          }
        }
      }
      return m
    })
    set({ mainTasks })
  },
  addReport: (type, path) => set({ reports: { ...get().reports, [type]: path } }),
  pushAgentObservation: (e) =>
    set((s) => ({
      agentObservationLog: [
        ...s.agentObservationLog,
        {
          id: newObservationId(),
          ts: e.ts ?? Date.now(),
          agentName: e.agentName,
          label: e.label,
          phase: e.phase,
          taskId: e.taskId,
          summary: e.summary,
          data: e.data,
        },
      ].slice(-80),
    })),
  reset: () => set({ mainTasks: [], reports: {}, agentObservationLog: [] }),
}))
