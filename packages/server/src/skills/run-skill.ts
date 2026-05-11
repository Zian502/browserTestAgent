import type { SkillRunContext } from './skill-types'
import { SKILL_REGISTRY } from './registry'

function emitSkillFailure(
  ctx: SkillRunContext,
  skillId: string,
  t0: number,
  error: string,
  startedWithDef: boolean,
) {
  ctx.emit({
    type: 'skill_failure',
    agentName: ctx.agentName,
    taskId: ctx.taskId,
    payload: {
      skill: skillId,
      durationMs: Date.now() - t0,
      error,
      /** 未进入 def.run（如未注册）时为 false */
      ranBody: startedWithDef,
    },
    timestamp: Date.now(),
  })
}

export async function runSkill(
  id: string,
  ctx: SkillRunContext,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const t0 = Date.now()
  const def = SKILL_REGISTRY[id]

  ctx.emit({
    type: 'skill_start',
    agentName: ctx.agentName,
    taskId: ctx.taskId,
    payload: {
      skill: id,
      name: def?.name ?? id,
      description: def?.description,
      toolsRequired: def?.toolsRequired,
      input,
      startedAt: t0,
    },
    timestamp: t0,
  })

  if (!def) {
    const msg = `未知 skill：${id}（请在 skills/registry 中注册）`
    emitSkillFailure(ctx, id, t0, msg, false)
    throw new Error(msg)
  }

  try {
    const result = await def.run(ctx, input)
    const t1 = Date.now()
    const ok = result['ok'] !== false
    if (ok) {
      ctx.emit({
        type: 'skill_success',
        agentName: ctx.agentName,
        taskId: ctx.taskId,
        payload: {
          skill: id,
          durationMs: t1 - t0,
        },
        timestamp: t1,
      })
    } else {
      const err =
        typeof result['error'] === 'string' && result['error'].trim()
          ? result['error']
          : 'skill 返回 ok: false'
      ctx.emit({
        type: 'skill_failure',
        agentName: ctx.agentName,
        taskId: ctx.taskId,
        payload: {
          skill: id,
          durationMs: t1 - t0,
          error: err,
          ranBody: true,
        },
        timestamp: t1,
      })
    }
    return result
  } catch (e) {
    emitSkillFailure(ctx, id, t0, String(e), true)
    throw e
  }
}
