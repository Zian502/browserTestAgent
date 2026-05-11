import { create } from 'zustand'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface UiTask {
  id: string
  title: string
  assignTo: string
  status: TaskStatus
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
  tasks: UiTask[]
  reports: Record<string, string>
  agentObservationLog: AgentObservationLogEntry[]
  setTasksFromPlan: (payload: unknown) => void
  updateByAgent: (agentName: string, patch: Partial<Pick<UiTask, 'status'>> & { result?: unknown }) => void
  addReport: (type: string, path: string) => void
  pushAgentObservation: (e: Omit<AgentObservationLogEntry, 'id' | 'ts'> & { ts?: number }) => void
  reset: () => void
}

function normalizePlan(payload: unknown): UiTask[] {
  if (!Array.isArray(payload)) return []
  return payload.map((t) => {
    const x = t as Record<string, unknown>
    return {
      id: String(x.id ?? ''),
      title: String(x.title ?? ''),
      assignTo: String(x.assignTo ?? ''),
      status: (x.status as TaskStatus) ?? 'pending',
    }
  })
}

function newObservationId() {
  return `obs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  reports: {},
  agentObservationLog: [],
  setTasksFromPlan: (payload) => set({ tasks: normalizePlan(payload) }),
  updateByAgent: (agentName, patch) => {
    const tasks = get().tasks.map((t) => (t.assignTo === agentName ? { ...t, ...patch } : t))
    set({ tasks })
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
  reset: () => set({ tasks: [], reports: {}, agentObservationLog: [] }),
}))
