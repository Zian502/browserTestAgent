import type { SkillRunContext } from './skill-types'
import { SKILL_REGISTRY } from './registry'

export async function runSkill(
  id: string,
  ctx: SkillRunContext,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const def = SKILL_REGISTRY[id]
  if (!def) {
    throw new Error(`未知 skill：${id}（请在 skills/registry 中注册）`)
  }
  const t0 = Date.now()
  ctx.emit({
    type: 'skill_call',
    agentName: ctx.agentName,
    taskId: ctx.taskId,
    payload: {
      skill: id,
      name: def.name,
      description: def.description,
      toolsRequired: def.toolsRequired,
      input,
      startedAt: t0,
    },
    timestamp: t0,
  })
  try {
    const result = await def.run(ctx, input)
    const ok = result['ok'] !== false
    ctx.emit({
      type: 'skill_result',
      agentName: ctx.agentName,
      taskId: ctx.taskId,
      payload: {
        skill: id,
        ok,
        durationMs: Date.now() - t0,
        ...(typeof result['error'] === 'string' ? { error: result['error'] } : {}),
      },
      timestamp: Date.now(),
    })
    return result
  } catch (e) {
    const err = String(e)
    ctx.emit({
      type: 'skill_result',
      agentName: ctx.agentName,
      taskId: ctx.taskId,
      payload: {
        skill: id,
        ok: false,
        durationMs: Date.now() - t0,
        error: err,
      },
      timestamp: Date.now(),
    })
    throw e
  }
}
