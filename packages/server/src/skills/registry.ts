import type { SkillDefinition } from './skill-types'
import { getHtmlSkill } from './get-html.skill'
import { compressHtmlSkill } from './compress-html.skill'
import { cacheFileSkill } from './cache-file.skill'
import { reportSkill } from './report.skill'
import { runTestCodeSkill } from './run-test-code.skill'

const list: SkillDefinition[] = [
  getHtmlSkill,
  compressHtmlSkill,
  cacheFileSkill,
  reportSkill,
  runTestCodeSkill,
]

export const SKILL_REGISTRY: Record<string, SkillDefinition> = Object.fromEntries(list.map((s) => [s.id, s]))

export function listSkills(): SkillDefinition[] {
  return list
}
