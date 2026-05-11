import { agentFileWriteText } from '../lib/agent-files'
import { resolveCacheRelativePath } from './read'

export const WRITE_TOOL = 'write' as const

export type WriteToolInput = {
  /** 相对于 `.agent-cache` 的路径 */
  relativePath: string
  content: string
}

export async function executeWriteTool(input: WriteToolInput): Promise<{ absolutePath: string; relativePath: string }> {
  const abs = resolveCacheRelativePath(input.relativePath)
  await agentFileWriteText(abs, input.content)
  return { absolutePath: abs, relativePath: input.relativePath.trim().replace(/^[/\\]+/, '') }
}
