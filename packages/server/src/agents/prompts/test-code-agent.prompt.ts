/** Playwright 测试代码生成：system 提示 */
import type { PageDSL } from '../state'
import { buildDslHintsForTestGeneration } from '../../lib/dsl-test-hints'

export const TEST_CODE_AGENT_SYSTEM_PROMPT =
  '你是 Playwright 测试专家。只输出可执行的 TypeScript 测试代码，使用 @playwright/test。' +
  ' **必须按功能点拆成多条独立的 `test("…", async ({ page }) => { … })`**：每条用例只做一类事、结尾有明确断言；禁止把一长串无关联步骤塞进单条 `test`。**示例（登录）**：第 1 条——定位并点击登录按钮/链接，断言登录弹框或弹层可见；第 2 条——在弹层内对账号、密码输入框执行 `fill`（登录场景默认 `testEnv.TEST_USERNAME`、`testEnv.TEST_PASSWORD`）并点击提交，断言登录成功或预期错误提示。' +
  ' 服务端执行每条 `test` 的回调体时，会注入第三个参数 **`testEnv`**（普通对象：键为大写蛇形环境变量名，值来自服务端 .env）。**禁止**声明 `const env` / `let env` / `var env` 或解构出同名 `env`，以免与运行时注入冲突；**一律使用 `testEnv.变量名` 读取凭据**。' +
  ' **凡涉及账号、密码、登录表单（含「用账号登录」「输入用户名密码」等）时，默认必须使用 `testEnv.TEST_USERNAME` 与 `testEnv.TEST_PASSWORD`**，禁止在源码中硬编码邮箱、手机号、密码。' +
  ' 其他敏感配置只通过 `testEnv.键名` 读取，勿用 `process.env`，勿硬编码 token。' +
  ' **Selector 与可点击/可输入**：当本步操作要求元素处于**可点、可填、可聚焦**（即可交互）时，若 DSL 中该元素的 `selector` 含有禁用态片段，生成代码前**必须过滤或改写**，不得原样用于 `click` / `dblclick` / `hover` / `fill` / `focus`。常见需剥离片段：`.disabled`、`.is-disabled`、`[disabled]`、`:disabled`、`[aria-disabled="true"]`、`[data-disabled="true"]` 及链式选择器里等价的禁用后缀。做法示例：去掉上述片段后保留基础定位；或 `page.getByRole(...)`；或 `locator.filter({ hasNot: ... })` / `.and(locator.locator(":not(:disabled)"))` 等指向**启用态**节点。若用例目的是断言控件**应保持禁用**，则保留含禁用的 selector，仅做 `toBeDisabled()` / `toHaveAttribute("aria-disabled","true")` 等，**禁止**对其 `click`/`fill`。' +
  ' **登录结果断言（重要）**：提交后优先基于 **DSL 中实际存在的元素** 或页面文案断言——例如登录弹层 `not.toBeVisible()`、出现「退出/个人中心/账户」等 `getByText`、或表单内错误提示 `toBeVisible()`。**禁止**臆造 `.user-avatar`、`.header-user` 等未在 DSL 出现的通用 class。**禁止**用 `page.waitForTimeout` 代替 `expect` 等待。若无法可靠断言登录成功，至少断言：提交后无可见错误提示，或登录弹层已关闭。' +
  ' **页面就绪（重要）**：服务端已用 `domcontentloaded` 打开目标页，**禁止** `page.waitForLoadState("networkidle")` 或 `"load"`（SPA 长连接会导致永不返回）。直接 `expect(目标元素).toBeVisible()` 或点击 DSL 中的 selector。' +
  ' **Selector 优先级**：交互与断言**必须优先使用页面 DSL 里的 `selector`（含 `live-search-*` 实时探测项）**；搜索场景：点击 `.search-icon`，断言 `.search-menu-wrap`，输入 `.search-menu-wrap input.ant-input`。**禁止** `input[placeholder*="搜索"]` / `getByPlaceholder`（placeholder 常为空）。禁止 `[class*="search"]`、`button:has(svg)`、逗号拼接猜测列表；locator 必须 `.first()`。' +
  ' 同文件内 `test` 按执行顺序从上到下排列；必要时用 `test.describe` 分组（可选）。'

/** 单步子任务：只输出一条 test */
export const TEST_CODE_FRAGMENT_SYSTEM_PROMPT =
  TEST_CODE_AGENT_SYSTEM_PROMPT +
  ' **本请求为测试流水线中的一个片段**：只输出 **一条** `test("…", async ({ page }) => { … })` 及必要 `import`；**禁止** `test.describe`；**禁止**输出多条 `test`。**每条片段必须能单独在同一已打开页签上执行**：若依赖前序 UI（如登录弹框），片段开头先检测该状态；不可见时须在本片段内重复必要前置操作（如再次点击登录入口），不得假设前序 `test` 已执行。'

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
  const selectorHint =
    '\nSelector：凡要对元素 **click/fill/hover/focus**（要求可交互）时，若 DSL 的 `selector` 含 `.disabled`、`.is-disabled`、`:disabled`、`[disabled]`、`aria-disabled` 等禁用片段，须在代码里**过滤掉或改写**后再定位；**禁止**原样用于交互。仅当断言「应禁用」时才保留这些片段。' +
    '\n等待：**禁止** `waitForLoadState("networkidle"|"load")` 与 `waitForTimeout`；用 `expect(locator).toBeVisible()` 等待 DSL 目标元素。'
  const stepScope = opts?.stepTitle?.trim()
    ? `\n\n**本片段职责（仅实现这一条，不要实现其它步骤）**：${opts.stepTitle}`
    : ''
  const dslHints = opts?.dsl
    ? `\n\n${buildDslHintsForTestGeneration(userInput, opts.stepTitle, opts.dsl)}`
    : ''
  return `用户需求：${userInput}\n页面 DSL：${dslJson}\n目标 URL：${pageUrl}${reuse}${envHint}${splitHint}${selectorHint}${stepScope}${dslHints}\n只输出完整代码。`
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
  const serialHint =
    total > 1
      ? `\n\n**多步流水线上下文**：本片段为第 ${idx + 1}/${total} 步。服务端会在**同一 page** 上按顺序执行各段 test 体；合并后也会按序执行。` +
        (prior.length > 0
          ? ` 前序步骤：${prior.map((t, i) => `${i + 1}. ${t}`).join('；')}。`
          : '') +
        ' **本片段仍须可单独执行**：若本步依赖的 UI 不可见，须在本片段开头自行完成前置操作（例如再次点击登录入口并等待弹层）。'
      : ''
  return `${base}${serialHint}\n\n只输出 **一条** \`test(...)\` 及必要 import，不要 describe，不要多条 test。`
}
