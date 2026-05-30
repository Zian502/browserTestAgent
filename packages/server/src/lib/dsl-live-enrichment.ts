import type { Page } from 'playwright'
import type { PageDSL } from '../agents/state'

type LiveElement = PageDSL['elements'][number]

/** 将 live 探测中带 tag 的路径规范为 class  descendant（与 parse DSL 一致） */
export function normalizeAddressInputSelector(selector: string): string {
  return selector
    .replace(/(\.address-input)\s+(?:div|span)\.(input|select-view)/g, '$1 .$2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findParseNetworkSelector(dsl: PageDSL): string | undefined {
  const inp = dsl.elements.find((e) => e.id === 'inp-network' || e.id === 'input-network')
  if (inp?.selector.trim()) return normalizeAddressInputSelector(inp.selector.trim())
  for (const form of dsl.forms) {
    const field = form.fields.find((f) => f.name === 'network')
    if (field?.selector.trim()) return normalizeAddressInputSelector(field.selector.trim())
  }
  return undefined
}

/** 统一 DSL 内 address-input 相关 selector，并让 live 触发器对齐 parse 结果 */
export function normalizePageDslSelectors(dsl: PageDSL): PageDSL {
  const parseNetwork = findParseNetworkSelector(dsl)
  let changed = false
  const elements = dsl.elements.map((el) => {
    let selector = normalizeAddressInputSelector(el.selector)
    if (
      parseNetwork &&
      (el.id === 'live-network-select-trigger' || el.id.startsWith('live-address-input-trigger'))
    ) {
      selector = parseNetwork
    }
    if (el.id === 'live-network-select-dropdown' || el.id.startsWith('live-address-input-dropdown')) {
      selector = normalizeAddressInputSelector(selector)
    }
    if (selector !== el.selector) changed = true
    return selector === el.selector ? el : { ...el, selector }
  })
  return changed ? { ...dsl, elements } : dsl
}

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

    function pushUnique(
      out: Raw[],
      seen: Set<string>,
      el: Element | null,
      meta: Omit<Raw, 'selector'>,
      selectorOverride?: string,
    ) {
      if (!el) return
      const selector = selectorOverride?.trim() || stableSelector(el)
      if (!selector || seen.has(selector)) return
      seen.add(selector)
      const text =
        meta.text ??
        ((el as HTMLElement).innerText?.trim().slice(0, 40) ||
          el.getAttribute('placeholder')?.trim().slice(0, 40) ||
          el.getAttribute('aria-label')?.trim().slice(0, 40) ||
          undefined)
      out.push({ ...meta, selector, ...(text ? { text } : {}) })
    }

    function pushById(out: Raw[], seenIds: Set<string>, el: Element | null, meta: Raw) {
      if (!el || seenIds.has(meta.id)) return
      seenIds.add(meta.id)
      out.push(meta)
    }

    function buildRelativeSelector(container: Element, el: Element): string {
      const segments: string[] = []
      let node: Element | null = el
      while (node && node !== container) {
        const tag = node.tagName.toLowerCase()
        const classes = [...node.classList].filter((c) => !/^jsx-/.test(c) && c.length > 0)
        if (tag === 'input') {
          segments.unshift(classes.length ? `input.${classes.join('.')}` : 'input')
        } else if (classes.length > 0) {
          segments.unshift(`.${classes.join('.')}`)
        }
        node = node.parentElement
      }
      return `.address-input ${segments.join(' ')}`.trim()
    }

    function pickAddressInputTrigger(container: Element): { el: Element; selector: string } | null {
      const picks: { el: Element; selector: string; rank: number }[] = []
      const add = (el: Element | null, rank: number) => {
        if (!el) return
        picks.push({ el, selector: buildRelativeSelector(container, el), rank })
      }
      add(container.querySelector('.input input'), 0)
      add(container.querySelector('input[readonly]'), 1)
      add(container.querySelector('.select-view'), 2)
      add(container.querySelector('.input'), 3)
      add(container.querySelector('input'), 4)
      if (picks.length === 0) return null
      picks.sort((a, b) => a.rank - b.rank)
      return picks[0]
    }

    const out: Raw[] = []
    const seen = new Set<string>()
    const seenIds = new Set<string>()

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

    // 充值页网络/链选择（.address-input）：按 DOM 实测路径写入 selector，勿硬编码 .input
    const addressInputs = [...document.querySelectorAll('.address-input')]
    addressInputs.forEach((container, i) => {
      const blob = (container as HTMLElement).innerText?.trim().slice(0, 80) || ''
      const isNetwork = /网络|網路|选择网络|選擇網路|chain|network/i.test(blob)
      const picked = pickAddressInputTrigger(container)
      if (!picked) return

      const label =
        blob.match(/选择网络|選擇網路|选择链|選擇鏈|网络|網路/)?.[0]?.trim() || blob.slice(0, 24)
      const id = isNetwork ? 'live-network-select-trigger' : `live-address-input-trigger-${i}`
      pushById(out, seenIds, picked.el, {
        id,
        type: 'button',
        selector: picked.selector,
        ...(label ? { text: label } : {}),
      })

      const dropdown = container.querySelector('.select-view')
      if (dropdown) {
        pushById(out, seenIds, dropdown, {
          id: isNetwork ? 'live-network-select-dropdown' : `live-address-input-dropdown-${i}`,
          type: 'modal',
          selector: buildRelativeSelector(container, dropdown),
          ...(label ? { text: label } : {}),
        })
      }
    })

    return out
  })
}

export function mergeLiveElementsIntoDsl(dsl: PageDSL, live: LiveElement[]): PageDSL {
  if (live.length === 0) return normalizePageDslSelectors(dsl)
  const parseNetwork = findParseNetworkSelector(dsl)
  const seenIds = new Set(dsl.elements.map((e) => e.id.trim()))
  const seenSelectors = new Set(dsl.elements.map((e) => e.selector.trim()))
  const merged = [...dsl.elements]
  for (const el of live) {
    let item = el
    if (item.id === 'live-network-select-trigger' && parseNetwork) {
      item = { ...item, selector: parseNetwork }
    } else {
      item = { ...item, selector: normalizeAddressInputSelector(item.selector) }
    }
    const id = item.id.trim()
    const sel = item.selector.trim()
    if (!id || !sel || seenIds.has(id)) continue
    if (seenSelectors.has(sel) && !item.text?.trim()) continue
    seenIds.add(id)
    seenSelectors.add(sel)
    merged.push(item)
  }
  return normalizePageDslSelectors({ ...dsl, elements: merged })
}
