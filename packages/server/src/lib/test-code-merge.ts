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

export type MergeTestCodeFragmentsOptions = {
  /** 用户提示词中的起始 URL；合并 spec 时会在最前插入 goto 测试 */
  promptPageUrl?: string
}

/** 合并 spec 首段：从提示词 URL 重头导航 */
export function buildPromptUrlGotoTestBlock(promptPageUrl: string): string {
  const url = promptPageUrl.trim()
  if (!url) return ''
  return `test('导航到用户需求起始页', async ({ page }) => {
  await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
})`
}

/** 合并多段测试片段为单个 spec 文件内容（去重 import，按序串联 test）。 */
export function mergeTestCodeFragments(
  fragments: string[],
  options?: MergeTestCodeFragmentsOptions,
): string {
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

  const gotoBlock = buildPromptUrlGotoTestBlock(options?.promptPageUrl ?? '')
  if (gotoBlock) tests.unshift(gotoBlock)

  if (tests.length === 0) {
    return `import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await expect(page.locator('body')).toBeVisible();\n});\n`
  }

  const header = importLines.size > 0 ? [...importLines].join('\n') : `import { test, expect } from '@playwright/test';`
  const body = tests.join('\n\n')
  if (tests.length > 1) {
    return `${header}\n\n/** 多段 test 在同一 page 上按序执行；首段导航至提示词 URL，后序步骤应自带前置 UI 恢复逻辑 */\ntest.describe.serial('merged flow', () => {\n${body
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n')}\n});\n`
  }
  return `${header}\n\n${body}\n`
}
