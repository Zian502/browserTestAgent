import type { PageDSL } from '../agents/state'

const INTENT_KEYWORDS: Record<string, string[]> = {
  search: ['搜索', 'search', '搜尋', '查询', 'btc', 'eth', '币种', '代币'],
  login: ['登录', '登入', 'login', 'sign in', '账号', '密码'],
  register: ['注册', 'register', 'sign up'],
}

function normalizeHaystack(...parts: (string | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function elementBlob(el: PageDSL['elements'][number]): string {
  return `${el.id} ${el.selector} ${el.text ?? ''} ${el.type}`.toLowerCase()
}

function matchElementsByKeywords(dsl: PageDSL, keywords: string[]): PageDSL['elements'] {
  const uniq = [...new Set(keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 2))]
  if (uniq.length === 0) return []
  return dsl.elements.filter((el) => uniq.some((k) => elementBlob(el).includes(k)))
}

function detectIntents(haystack: string): string[] {
  const intents: string[] = []
  for (const [intent, keys] of Object.entries(INTENT_KEYWORDS)) {
    if (keys.some((k) => haystack.includes(k.toLowerCase()))) intents.push(intent)
  }
  return intents
}

function formatElementLine(el: PageDSL['elements'][number]): string {
  const text = el.text?.trim() ? ` text="${el.text.trim().slice(0, 40)}"` : ''
  return `- \`${el.id}\` (${el.type}) selector=\`${el.selector}\`${text}`
}

/** 为 testCodeAgent 注入与用户需求相关的 DSL 摘要与缺失时的 fallback 规则 */
export function buildDslHintsForTestGeneration(
  userInput: string,
  stepTitle: string | undefined,
  dsl: PageDSL,
): string {
  const haystack = normalizeHaystack(userInput, stepTitle)
  const intents = detectIntents(haystack)
  const allKeywords = intents.flatMap((i) => INTENT_KEYWORDS[i] ?? [])
  const matched = matchElementsByKeywords(dsl, allKeywords)

  const lines: string[] = ['## DSL 与本步相关的元素']

  if (matched.length > 0) {
    lines.push('**必须优先使用以下 selector（勿臆造 class* / :has(svg) / placeholder）：**')
    for (const el of matched.slice(0, 12)) lines.push(formatElementLine(el))
    if (intents.includes('search')) {
      lines.push(
        '',
        '**搜索步骤写法**：先 `page.locator(".search-icon").first().click()`，再 `expect(page.locator(".search-menu-wrap").first()).toBeVisible()`，输入用 `page.locator(".search-menu-wrap input.ant-input, input.search-input").first().fill(...)`。',
      )
    }
  } else {
    lines.push(
      '**DSL 中未找到与用户步骤明显匹配的元素**（常见于客户端渲染的 header 搜索/图标）。',
      'Fallback 规则（仍须 `.first()`）：',
      '- 搜索入口：`await page.locator(".search-icon").first().click()`',
      '- 断言弹层：`await expect(page.locator(".search-menu-wrap").first()).toBeVisible()`',
      '- 搜索输入：`await page.locator(".search-menu-wrap input.ant-input, input.search-input").first().fill("BTC")`',
      '- **禁止**：`getByPlaceholder` / `input[placeholder*="搜索"]`（BYDFi 等站点 placeholder 常为空或不可见）、`button:has(svg)`、`[class*="search"]`',
    )
  }

  lines.push(
    '',
    '## Playwright strict mode',
    '- 任何 `page.locator(...)` 在 `click`/`fill`/`expect` 前**必须** `.first()`（或保证 selector 唯一）。',
    '- **禁止** `await expect(multiLocator).toBeVisible()` 且 locator 未 `.first()`。',
  )

  return lines.join('\n')
}
