/**
 * 清理 LLM 生成测试代码中的高危等待模式与易触发 strict mode 的定位方式。
 */

function isBroadLocatorExpr(expr: string): boolean {
  return (
    expr.includes('[class*="') ||
    expr.includes(":has(") ||
    /locator\(\s*['"][^'"]*['"]\s*,/.test(expr)
  )
}

/** 对宽泛 locator 补 `.first()`，避免 strict mode 多元素报错 */
function ensureFirstOnBroadLocators(code: string): string {
  let out = code

  out = out.replace(
    /const\s+(\w+)\s*=\s*(page\.locator\([^;]+\))(\s*;)/g,
    (full, name, locExpr, semi) => {
      if (locExpr.includes('.first()') || locExpr.includes('.nth(')) return full
      if (!isBroadLocatorExpr(locExpr)) return full
      return `const ${name} = ${locExpr}.first()${semi}`
    },
  )

  out = out.replace(/expect\(\s*(page\.locator\([^)]+\))\s*\)/g, (full, locExpr) => {
    if (locExpr.includes('.first()') || locExpr.includes('.nth(')) return full
    if (!isBroadLocatorExpr(locExpr)) return full
    return `expect(${locExpr}.first())`
  })

  out = out.replace(
    /(page\.locator\([^)]+\))(\.(?:click|fill|clear|press|hover|focus)\()/g,
    (full, locExpr, action) => {
      if (locExpr.includes('.first()') || locExpr.includes('.nth(')) return full
      if (!isBroadLocatorExpr(locExpr)) return full
      return `${locExpr}.first()${action}`
    },
  )

  return out
}

/** 去掉易误点的猜测型 selector 片段 */
function stripRiskyLocatorFragments(code: string): string {
  let out = code
  const risky = [
    /,?\s*button:has\(svg\)/gi,
    /,?\s*button:has\(i\)/gi,
    /,?\s*button:has\(svg[^)]*\)/gi,
    /,?\s*svg\[class\*="search"\]/gi,
  ]
  for (const re of risky) {
    out = out.replace(re, '')
  }
  out = out.replace(/locator\(\s*['"]([^'"]*)['"]\s*\)/g, (full, inner) => {
    const cleaned = inner.replace(/,{2,}/g, ',').replace(/^,|,$/g, '').trim()
    if (!cleaned) return full
    return `locator('${cleaned}')`
  })
  return out
}

function normalizeSearchInputLocators(code: string): string {
  const searchInputSel = "'.search-menu-wrap input.ant-input, input.search-input'"
  let out = code
  const placeholderPatterns = [
    /locator\(\s*['"]input\[placeholder\*="搜索"\][^'"]*['"]\s*\)/gi,
    /locator\(\s*['"]input\[placeholder\*="Search"\][^'"]*['"]\s*\)/gi,
    /locator\(\s*['"]input\[placeholder\*="搜尋"\][^'"]*['"]\s*\)/gi,
    /locator\(\s*['"]input\[type="text"\]\[placeholder\*="search"\][^'"]*['"]\s*\)/gi,
    /locator\(\s*['"]input\[type="text"\]\[placeholder\*="Search"\][^'"]*['"]\s*\)/gi,
    /locator\(\s*['"]input\[placeholder\*="搜索"\][^'"]*['"]\s*\)/gi,
    /getByPlaceholder\(\s*\/搜索[^)]*\)/gi,
    /getByPlaceholder\(\s*\/search[^)]*\)/gi,
  ]
  for (const re of placeholderPatterns) {
    out = out.replace(re, `locator(${searchInputSel})`)
  }
  return out
}

export function sanitizeGeneratedTestCode(code: string): string {
  let out = code

  out = out.replace(
    /\n[ \t]*await[ \t]+page\.waitForLoadState\s*\(\s*['"]networkidle['"]\s*(?:,\s*\{[^}]*\})?\s*\)\s*;?[ \t]*(?:\/\/[^\n]*)?\n/g,
    '\n',
  )
  out = out.replace(
    /\n[ \t]*await[ \t]+page\.waitForLoadState\s*\(\s*['"]load['"]\s*(?:,\s*\{[^}]*\})?\s*\)\s*;?[ \t]*(?:\/\/[^\n]*)?\n/g,
    '\n',
  )
  out = out.replace(/\n[ \t]*await[ \t]+page\.waitForTimeout\s*\([^)]*\)\s*;?[ \t]*(?:\/\/[^\n]*)?\n/g, '\n')

  out = stripRiskyLocatorFragments(out)
  out = normalizeSearchInputLocators(out)
  out = ensureFirstOnBroadLocators(out)

  return out
}
