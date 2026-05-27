/** 从 Playwright 片段中提取 `test(...)` 块（含 async 回调体）。 */
export function extractTestBlocks(source: string): string[] {
  const code = source.trim()
  if (!code) return []

  const blocks: string[] = []
  const re = /\btest\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const start = m.index
    let depth = 0
    let i = code.indexOf('(', start)
    if (i < 0) continue
    for (; i < code.length; i++) {
      const ch = code[i]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          blocks.push(code.slice(start, i + 1).trim())
          break
        }
      }
    }
  }
  return blocks
}

/** 合并多段测试片段为单个 spec 文件内容（去重 import，按序串联 test）。 */
export function mergeTestCodeFragments(fragments: string[]): string {
  const importLines = new Set<string>()
  const tests: string[] = []

  for (const frag of fragments) {
    const code = frag.trim()
    if (!code) continue
    for (const line of code.split('\n')) {
      const t = line.trim()
      if (t.startsWith('import ')) importLines.add(t)
    }
    const blocks = extractTestBlocks(code)
    if (blocks.length > 0) tests.push(...blocks)
    else if (code.includes('test(')) tests.push(code)
  }

  if (tests.length === 0) {
    return `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await expect(page.locator('body')).toBeVisible();\n});\n`
  }

  const header = importLines.size > 0 ? [...importLines].join('\n') : `import { test, expect } from '@playwright/test';`
  const body = tests.join('\n\n')
  if (tests.length > 1) {
    return `${header}\n\n/** 多段 test 在同一 page 上按序执行；后序步骤应自带前置 UI 恢复逻辑 */\ntest.describe.serial('merged flow', () => {\n${body
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n')}\n});\n`
  }
  return `${header}\n\n${body}\n`
}
