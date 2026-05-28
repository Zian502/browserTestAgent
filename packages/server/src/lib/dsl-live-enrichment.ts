import type { Page } from 'playwright'
import type { PageDSL } from '../agents/state'

type LiveElement = PageDSL['elements'][number]

/** 在已打开的 Playwright 页签上探测常见交互控件（补全静态 HTML 解析遗漏的 CSR 节点） */
export async function probeLivePageElements(page: Page): Promise<LiveElement[]> {
  return page.evaluate(() => {
    type Raw = { id: string; type: LiveElement['type']; selector: string; text?: string }

    function stableSelector(el: Element): string | null {
      const tag = el.tagName.toLowerCase()
      if (el.id) return `#${CSS.escape(el.id)}`
      const classes = [...el.classList].filter((c) => !/^jsx-/.test(c) && c.length > 0)
      if (classes.length > 0) return `${tag}.${classes.map((c) => CSS.escape(c)).join('.')}`
      const testId = el.getAttribute('data-testid')
      if (testId) return `[data-testid="${testId}"]`
      return null
    }

    function pushUnique(out: Raw[], seen: Set<string>, el: Element | null, meta: Omit<Raw, 'selector'>) {
      if (!el) return
      const selector = stableSelector(el)
      if (!selector || seen.has(selector)) return
      seen.add(selector)
      const text =
        (el as HTMLElement).innerText?.trim().slice(0, 40) ||
        el.getAttribute('placeholder')?.trim().slice(0, 40) ||
        el.getAttribute('aria-label')?.trim().slice(0, 40) ||
        undefined
      out.push({ ...meta, selector, ...(text ? { text } : {}) })
    }

    const out: Raw[] = []
    const seen = new Set<string>()

    // 搜索（header CSR 常见结构）
    pushUnique(out, seen, document.querySelector('.search-icon, [class*="search-icon"]'), {
      id: 'live-search-icon',
      type: 'button',
    })
    pushUnique(out, seen, document.querySelector('.search-menu-wrap, [class*="search-menu-wrap"]'), {
      id: 'live-search-menu',
      type: 'modal',
    })
    pushUnique(
      out,
      seen,
      document.querySelector(
        '.search-menu-wrap input.ant-input, input.search-input, input.ant-input.search-input, .search-menu-wrap input[type="text"]',
      ),
      { id: 'live-search-input', type: 'input' },
    )

    // 登录入口
    pushUnique(out, seen, document.querySelector('button.log-btn, button.lr-btn.log-btn, .moonx-login button'), {
      id: 'live-login-btn',
      type: 'button',
    })

    return out
  })
}

export function mergeLiveElementsIntoDsl(dsl: PageDSL, live: LiveElement[]): PageDSL {
  if (live.length === 0) return dsl
  const seen = new Set(dsl.elements.map((e) => e.selector.trim()))
  const merged = [...dsl.elements]
  for (const el of live) {
    const sel = el.selector.trim()
    if (!sel || seen.has(sel)) continue
    seen.add(sel)
    merged.push(el)
  }
  return { ...dsl, elements: merged }
}
