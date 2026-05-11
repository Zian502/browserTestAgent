import type { AgentName } from '../agents/state'
import type { State } from '../agents/state'
import type { StreamEvent } from '../agents/state'
import type { CoreToolName } from '../tools'

export type SkillEmit = (event: StreamEvent) => void

export interface SkillRunContext {
  state: State
  agentName: AgentName
  taskId?: string
  emit: SkillEmit
}

export interface SkillDefinition {
  /** 唯一标识，与 `runSkill(id)` 一致 */
  id: string
  name: string
  description: string
  /** 执行本 skill 时可能调用的内置工具（用于文档与校验） */
  toolsRequired: CoreToolName[]
  run: (ctx: SkillRunContext, input: Record<string, unknown>) => Promise<Record<string, unknown>>
}
