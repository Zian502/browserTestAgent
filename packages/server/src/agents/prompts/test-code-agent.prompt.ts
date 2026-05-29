/** Playwright 测试代码生成：system 提示 */
import type { PageDSL } from '../state'

export const TEST_CODE_AGENT_SYSTEM_PROMPT =
  '你是 Playwright 测试专家。只输出可执行的 TypeScript 测试代码，使用 @playwright/test。' +
  ' **必须按功能点拆成多条独立的 `test("…", async ({ page }) => { … })`**：每条用例只做一类事、结尾有明确断言；禁止把一长串无关联步骤塞进单条 `test`。**示例（登录）**：第 1 条——定位并点击登录按钮/链接，断言登录弹框或弹层可见；第 2 条——在弹层内对账号、密码输入框执行 `fill`（登录场景默认 `testEnv.TEST_USERNAME`、`testEnv.TEST_PASSWORD`）并点击提交，断言登录成功或预期错误提示。' +
  ' 服务端执行每条 `test` 的回调体时，会注入第三个参数 **`testEnv`**（普通对象：键为大写蛇形环境变量名，值来自服务端 .env）。**禁止**声明 `const env` / `let env` / `var env` 或解构出同名 `env`，以免与运行时注入冲突；**一律使用 `testEnv.变量名` 读取凭据**。' +
  ' **凡涉及账号、密码、登录表单（含「用账号登录」「输入用户名密码」等）时，默认必须使用 `testEnv.TEST_USERNAME` 与 `testEnv.TEST_PASSWORD`**，禁止在源码中硬编码邮箱、手机号、密码。' +
  ' 其他敏感配置只通过 `testEnv.键名` 读取，勿用 `process.env`，勿硬编码 token。' +
  ' **Selector 与可点击/可输入**：当本步操作要求元素处于**可点、可填、可聚焦**（即可交互）时，若 DSL 中该元素的 `selector` 含有禁用态片段，生成代码前**必须过滤或改写**，不得原样用于 `click` / `dblclick` / `hover` / `fill` / `focus`。常见需剥离片段：`.disabled`、`.is-disabled`、`[disabled]`、`:disabled`、`[aria-disabled="true"]`、`[data-disabled="true"]` 及链式选择器里等价的禁用后缀。做法示例：去掉上述片段后保留基础定位；或 `page.getByRole(...)`；或 `locator.filter({ hasNot: ... })` / `.and(locator.locator(":not(:disabled)"))` 等指向**启用态**节点。若用例目的是断言控件**应保持禁用**，则保留含禁用的 selector，仅做 `toBeDisabled()` / `toHaveAttribute("aria-disabled","true")` 等，**禁止**对其 `click`/`fill`。' +
  ' **登录结果断言（重要）**：提交后优先基于 **DSL 中实际存在的元素** 或页面文案断言——例如登录弹层 `not.toBeVisible()`、出现「退出/个人中心/账户」等 `getByText`、或表单内错误提示 `toBeVisible()`。**禁止**臆造未在 DSL 出现的通用 class（如 `.user-avatar`）。**禁止**用 `page.waitForTimeout` 代替 `expect` 等待。' +
  ' **页面就绪（重要）**：服务端已用 `domcontentloaded` 打开目标页，**禁止** `page.waitForLoadState("networkidle")` 或 `"load"`（SPA 长连接会导致永不返回）。用 `expect(locator).toBeVisible()` 等待目标元素。' +
  ' **Selector 通用规则**：交互与断言**必须优先使用页面 DSL 里的 `selector`**；DSL 不足时用 `getByRole` / `getByText` / `getByLabel`。**禁止**逗号拼接多 selector 猜测列表、`button:has(svg)`、`[class*="…"]` 等宽泛定位；`page.locator(...)` 在 click/fill/expect 前须 `.first()`（或保证唯一）。**禁止**根据「充值/登录/跳转」等语义臆造 URL 路径片段（如 `deposit`、`recharge`、`wallet/deposit`）。' +
  ' **按文案定位（重要，禁止 jQuery 语法）**：`page.locator()` 传入的是**标准 CSS 选择器**（浏览器 `querySelectorAll`），**不支持** jQuery 扩展伪类 **`:contains()`**、`:has()`（注意与 Playwright 的 `:has-text()` 不同）等；误用会在运行时报 `SyntaxError: Failed to execute \'querySelectorAll\' … :contains(...) is not a valid selector`。**禁止**写 `page.locator(\'button.foo:contains("文案")\')` 或任何含 `:contains(` 的 selector 字符串。按可见文案匹配时**必须**用以下方式之一：（1）`page.getByRole(\'button\', { name: \'快速充值\' })`；（2）`page.getByText(\'快速充值\', { exact: true })`；（3）DSL 有 class 时 `page.locator(\'button.common-button.primary.action-bt\').filter({ hasText: \'快速充值\' })`——**CSS 选 class，`.filter({ hasText })` 选文案，二者分开写，不要把文案塞进 selector 字符串**。**禁止**把 Playwright 引擎伪类 `:has-text()` / `:visible` 写进传给 `locator()` 的 CSS 字符串（应改用 `getByText` / `filter({ hasText })` / `expect(locator).toBeVisible()`）。' +
  ' **跳转与落地页断言（重要）**：本片段若职责是**点击入口进入另一页面**（跳转/路由触发步），**只做**入口元素 `toBeVisible()` + `click()`，**禁止**在同一片段写落地页断言——**禁止** `toHaveURL` / `waitForURL` / `page.url()`；**禁止** `getByText(\'充值\')`、`getByText(\'登录\')` 等泛化文案猜测；**禁止** `waitForTimeout`；**禁止**以「DSL 未提供目标页元素」为由用 `body` 或模糊文案凑断言。落地页是否到达、有哪些可测元素，须由**下一步** test 片段负责：该步 parse 在本片段 test **执行完成后** CDP 刷新落地页 HTML，DSL 才有准确 selector，再在下一步用 DSL 元素 `toBeVisible()`。**禁止**臆造 pathname 或 URL 断言。' +
  ' **下拉/弹层**：先点击触发器打开选项列表，再对**弹层内**可见选项 click；readonly 展示字段用 `toContainText` / `getByText` 断言，勿对非 input value 用 `toHaveValue`。**`.react-dropdown-select` 多为币种下拉**；充值「选择网络/選擇網路」用 **`.address-input .input`** 打开，选项在 **`.address-input .select-view .item`**，按 `.network-name` 文案（如 `Ethereum (ERC20)`）用 `filter({ hasText })` 或 `getByText` 选中，勿与 `.react-dropdown-select` 混用。**禁止**用逗号拼接多 selector 猜测弹层（如 `.react-dropdown-select, .dropdown-menu, [role="listbox"]`）；弹层容器与选项 **必须来自 DSL**，无 DSL 时只写触发 click，把断言留给下一步。' +
  ' 同文件内 `test` 按执行顺序从上到下排列；必要时用 `test.describe` 分组（可选）。' +
  ' **执行收尾**：**禁止**在生成代码末尾用 `waitForTimeout` 做无意义等待。'

/** 单步子任务：只输出一条 test */
export const TEST_CODE_FRAGMENT_SYSTEM_PROMPT =
  TEST_CODE_AGENT_SYSTEM_PROMPT +
  ' **本请求为测试流水线中的一个片段**：只输出 **一条** `test("…", async ({ page }) => { … })` 及必要 `import`；**禁止** `test.describe`；**禁止**输出多条 `test`。**每条片段必须能单独在同一已打开页签上执行**：若依赖前序 UI（如已打开的下拉/弹框/已跳转到子页），片段开头先检测该状态；不可见时须在本片段内重复**前序触发操作**（如再次 click 入口或打开下拉），不得假设前序 `test` 已执行。' +
  ' **弹框/下拉分步（重要）**：若本片段职责是**触发/打开**弹层（标题含打开、点击触发、展开下拉等），**只 click DSL 中的触发器**（如 `network-select-trigger` / `.address-input .input`），**禁止**在同一片段断言弹层内选项或使用未出现在 DSL 的容器 selector（勿猜 `.react-dropdown-select`、`.dropdown-menu`、`[role="listbox"]` 等）；可选断言**同一组件**的弹层容器（DSL 中已有，如 `.address-input .select-view`）`toBeVisible()`，若无则 click 即可、勿瞎断言。' +
  ' **页面跳转分步（重要）**：若本片段职责是**click 进入另一页**（如快速充值、进入账户页），**只**对入口按钮/链接 `toBeVisible()` + `click()`，**禁止** click 后断言落地页 `getByText`、禁止 `waitForTimeout`、禁止 `body` 敷衍断言；落地页断言放在**下一步**片段（该步 DSL 来自跳转后 CDP 刷新的 HTML）。' +
  ' 若本片段是**第 2 步及以后**且前序含「打开/触发/跳转」，当前 DSL 来自**前序片段 test 执行后** CDP 快照，须**仅**用 DSL 中已有元素做断言与 click；片段开头若状态未就绪须先重复前序触发再操作；**禁止**用 DSL 中不存在的泛化文案补断言。'

export type FragmentOverlayPhase = 'trigger' | 'interact' | 'navigate-trigger' | 'navigate-assert' | 'normal'

const OVERLAY_WIDGET_RE =
  /下拉|弹框|弹层|对话框|抽屉|modal|dropdown|overlay|picker|popover|選擇|选择|网络|網路|菜单|選單|菜单/
const NAV_PAGE_RE = /页|页面|頁面|充值|登录|登入|账户|賬戶|fund|wallet|recharge|account/i
const TRIGGER_ACTION_RE = /打开|点击|點擊|触发|觸發|展开|展開|点开|點開|toggle|open|进入|進入|跳转|跳轉/i
const INTERACT_ACTION_RE = /断言|斷言|选择|選擇|勾选|填写|填寫|输入|輸入|可见|可見|选项|選項|选中|選中|验证|驗證|确认|確認/i

function isNavigateTriggerTitle(title: string): boolean {
  return TRIGGER_ACTION_RE.test(title) && NAV_PAGE_RE.test(title) && !INTERACT_ACTION_RE.test(title)
}

function priorHasNavigateTrigger(priorStepTitles: string[]): boolean {
  return priorStepTitles.some((t) => isNavigateTriggerTitle(t) || /快速充值|recharge|充值按钮/i.test(t))
}

/** 判断片段属于触发弹层、弹层内交互、跳转触发、落地页断言或普通步骤 */
export function classifyFragmentOverlayPhase(
  stepTitle: string,
  stepIndex: number,
  priorStepTitles: string[],
): FragmentOverlayPhase {
  const title = stepTitle.trim()
  if (!title) return stepIndex > 0 ? 'interact' : 'normal'

  if (isNavigateTriggerTitle(title)) return 'navigate-trigger'
  if (stepIndex > 0 && priorHasNavigateTrigger(priorStepTitles) && INTERACT_ACTION_RE.test(title)) {
    return 'navigate-assert'
  }

  const hasWidget = OVERLAY_WIDGET_RE.test(title)
  const isTrigger =
    hasWidget &&
    TRIGGER_ACTION_RE.test(title) &&
    !INTERACT_ACTION_RE.test(title)
  const priorHasTrigger =
    stepIndex > 0 &&
    priorStepTitles.some((t) => OVERLAY_WIDGET_RE.test(t) && TRIGGER_ACTION_RE.test(t))
  const isInteract =
    (stepIndex > 0 && priorHasTrigger && (INTERACT_ACTION_RE.test(title) || hasWidget)) ||
    (stepIndex > 0 && hasWidget && INTERACT_ACTION_RE.test(title))

  if (isTrigger) return 'trigger'
  if (isInteract) return 'interact'
  return 'normal'
}

function buildFragmentOverlayPhaseHint(phase: FragmentOverlayPhase, stepIndex: number): string {
  if (phase === 'navigate-trigger') {
    return (
      '\n\n**本片段类型：页面跳转触发（第 ' +
      (stepIndex + 1) +
      ' 步）**：只对入口按钮/链接 `toBeVisible()` + `click()`；**禁止** click 后写落地页断言（勿 `getByText(\'充值\')`、勿 `waitForTimeout`、勿 `body` 敷衍）；' +
      '下一步 parse 会在本片段 test 执行后 CDP 刷新落地页 HTML，届时才有准确 DSL 供断言。'
    )
  }
  if (phase === 'trigger') {
    return (
      '\n\n**本片段类型：触发弹层（第 ' +
      (stepIndex + 1) +
      ' 步）**：只负责 click 打开弹框/下拉；**禁止**断言弹层内选项或使用 DSL 中不存在的弹层容器 selector；' +
      '下一步 parse 会在本片段执行后刷新 HTML，届时才有准确的弹层 DSL。'
    )
  }
  if (phase === 'navigate-assert') {
    return (
      '\n\n**本片段类型：落地页断言/交互（第 ' +
      (stepIndex + 1) +
      ' 步）**：DSL 来自**前序跳转步 test 执行后**的 CDP 快照；**仅**用 DSL 中元素 `toBeVisible()` / click，**禁止**泛化 `getByText` 猜测；' +
      '若单独执行时不在目标页，须先重复 click 入口再断言。'
    )
  }
  if (phase === 'interact') {
    return (
      '\n\n**本片段类型：弹层内交互/断言（第 ' +
      (stepIndex + 1) +
      ' 步）**：DSL 来自**前序触发步 test 执行后**的 CDP 快照，应使用 DSL 中弹层容器与选项条目；' +
      '若单独执行时弹层未打开，须在本片段开头先重复触发 click，再用 DSL 断言/选择。'
    )
  }
  return ''
}

function buildGenericDslUsageHint(dsl: PageDSL, stepTitle?: string): string {
  const lines = ['## DSL 使用说明', '- **必须优先**使用下列元素的 `selector`；勿臆造 DSL 中不存在的 class 或组件库类名。']
  const haystack = `${stepTitle ?? ''}`.toLowerCase()
  const picked = dsl.elements.filter((el) => {
    if (!stepTitle?.trim()) return true
    const blob = `${el.id} ${el.selector} ${el.text ?? ''}`.toLowerCase()
    const tokens = haystack.split(/\s+/).filter((t) => t.length >= 2)
    if (tokens.length === 0) return true
    return tokens.some((t) => blob.includes(t))
  })
  const show = (picked.length > 0 ? picked : dsl.elements).slice(0, 16)
  for (const el of show) {
    const text = el.text?.trim() ? ` text="${el.text.trim().slice(0, 40)}"` : ''
    lines.push(`- \`${el.id}\` (${el.type}) selector=\`${el.selector}\`${text}`)
  }
  if (show.length === 0) {
    lines.push('- （DSL 元素为空：仅基于用户需求与页面 URL 生成，仍须遵守上述 Selector 通用规则。）')
  }
  return lines.join('\n')
}

export function buildTestCodeUserMessage(
  userInput: string,
  dslJson: string,
  pageUrl: string,
  opts?: { reuseOpenPage?: boolean; stepTitle?: string; dsl?: PageDSL },
): string {
  const reuse = opts?.reuseOpenPage
    ? '\n注意：服务端已在真实浏览器中打开目标 URL，**同一页签**将执行本段测试；除非需要强制刷新，否则不要调用 `page.goto`。'
    : ''
  const envHint =
    '\n凭据与登录：若用户需求含登录、注册、账号密码等，**默认**用 `testEnv.TEST_USERNAME`、`testEnv.TEST_PASSWORD` 完成用户名/密码输入（结合 DSL 中的 selector）；无登录场景则不必引用。勿声明 `env` 变量；勿使用 `process.env`，勿硬编码真实凭据。'
  const splitHint =
    '\n用例拆分：按功能点输出**多个** `test(...)`（例如登录拆成「点击登录入口 + 断言弹层」与「填账号密码并提交 + 断言结果」两条），每条命名能反映步骤含义。'
  const navigationHint =
    '\n跳转触发步：**禁止** click 后写落地页断言（勿 `getByText(\'充值\')`、勿 `waitForTimeout`、勿 URL 断言）；落地页断言须等下一步 parse 刷新 HTML 后，用 DSL 元素写独立 test 片段。'
  const selectorHint =
    '\nSelector：凡要对元素 **click/fill/hover/focus**（要求可交互）时，若 DSL 的 `selector` 含禁用态片段，须在代码里**过滤掉或改写**后再定位。**禁止** `waitForLoadState("networkidle"|"load")` 与 `waitForTimeout`；用 `expect(locator).toBeVisible()` 等待。**禁止** `:contains()`：按按钮文案用 `getByRole(\'button\', { name: \'…\' })` 或 `locator(\'button.class\').filter({ hasText: \'…\' })`，勿写 `button.class:contains("…")`。'
  const stepScope = opts?.stepTitle?.trim()
    ? `\n\n**本片段职责（仅实现这一条，不要实现其它步骤）**：${opts.stepTitle}`
    : ''
  const dslHints = opts?.dsl ? `\n\n${buildGenericDslUsageHint(opts.dsl, opts.stepTitle)}` : ''
  return `用户需求：${userInput}\n页面 DSL：${dslJson}\n目标 URL：${pageUrl}${reuse}${envHint}${splitHint}${navigationHint}${selectorHint}${stepScope}${dslHints}\n只输出完整代码。`
}

export function buildTestCodeFragmentUserMessage(
  stepTitle: string,
  userInput: string,
  dslJson: string,
  pageUrl: string,
  opts?: {
    reuseOpenPage?: boolean
    stepIndex?: number
    totalSteps?: number
    priorStepTitles?: string[]
    dsl?: PageDSL
  },
): string {
  const base = buildTestCodeUserMessage(userInput, dslJson, pageUrl, { ...opts, stepTitle })
  const idx = opts?.stepIndex ?? 0
  const total = opts?.totalSteps ?? 1
  const prior = opts?.priorStepTitles?.filter(Boolean) ?? []
  const overlayPhase = classifyFragmentOverlayPhase(stepTitle, idx, prior)
  const serialHint =
    total > 1
      ? `\n\n**多步流水线上下文**：本片段为第 ${idx + 1}/${total} 步。服务端按 \`parse → test\` 串行：第 N 步 parse 在**第 N-1 步 test 执行完**后 CDP 刷新 HTML，故弹层/下拉类步骤须先触发、后断言。` +
        (prior.length > 0
          ? ` 前序步骤：${prior.map((t, i) => `${i + 1}. ${t}`).join('；')}。`
          : '') +
        ' **本片段仍须可单独执行**：若本步依赖的 UI（如已打开的下拉）不可见，须在本片段开头自行完成**触发**操作（例如再次点击打开下拉的触发器），再用 DSL 断言/选择。'
      : ''
  const phaseHint = buildFragmentOverlayPhaseHint(overlayPhase, idx)
  return `${base}${serialHint}${phaseHint}\n\n只输出 **一条** \`test(...)\` 及必要 import，不要 describe，不要多条 test。`
}
