import * as path from 'path'
import { agentFileReadText } from '../lib/agent-files'

export const READ_TOOL = 'read' as const

/** 业务可读写的根目录：`<cwd>/.agent-cache` */
export function getAgentCacheRoot(): string {
  return path.resolve(process.cwd(), '.agent-cache')
}

function hasDotDotSegment(p: string): boolean {
  return path.normalize(p).split(path.sep).includes('..')
}

/**
 * 将相对路径（相对于 `.agent-cache`）解析为绝对路径；禁止 `..` 逃逸。
 */
export function resolveCacheRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim().replace(/^[/\\]+/, '')
  if (!trimmed || hasDotDotSegment(trimmed)) {
    throw new Error(`非法路径：${relativePath}`)
  }
  const root = path.resolve(getAgentCacheRoot())
  const abs = path.resolve(root, trimmed)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径必须位于 .agent-cache 目录下')
  }
  return abs
}

export type ReadToolInput = {
  /** 相对于 `.agent-cache` 的路径，如 `html/example.com.html` */
  relativePath: string
}

export async function executeReadTool(input: ReadToolInput): Promise<{ content: string; absolutePath: string }> {
  const abs = resolveCacheRelativePath(input.relativePath)
  const content = await agentFileReadText(abs)
  return { content, absolutePath: abs }
}
