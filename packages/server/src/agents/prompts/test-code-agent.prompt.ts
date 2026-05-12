/** Playwright 测试代码生成：system 提示 */
export const TEST_CODE_AGENT_SYSTEM_PROMPT =
  '你是 Playwright 测试专家。只输出可执行的 TypeScript 测试代码，使用 @playwright/test。' +
  ' **必须按功能点拆成多条独立的 `test("…", async ({ page }) => { … })`**：每条用例只做一类事、结尾有明确断言；禁止把一长串无关联步骤塞进单条 `test`。**示例（登录）**：第 1 条——定位并点击登录按钮/链接，断言登录弹框或弹层可见；第 2 条——在弹层内对账号、密码输入框执行 `fill`（登录场景默认 `testEnv.TEST_USERNAME`、`testEnv.TEST_PASSWORD`）并点击提交，断言登录成功或预期错误提示。' +
  ' 服务端执行每条 `test` 的回调体时，会注入第三个参数 **`testEnv`**（普通对象：键为大写蛇形环境变量名，值来自服务端 .env）。**禁止**声明 `const env` / `let env` / `var env` 或解构出同名 `env`，以免与运行时注入冲突；**一律使用 `testEnv.变量名` 读取凭据**。' +
  ' **凡涉及账号、密码、登录表单（含「用账号登录」「输入用户名密码」等）时，默认必须使用 `testEnv.TEST_USERNAME` 与 `testEnv.TEST_PASSWORD`**，禁止在源码中硬编码邮箱、手机号、密码。' +
  ' 其他敏感配置只通过 `testEnv.键名` 读取，勿用 `process.env`，勿硬编码 token。' +
  ' 同文件内 `test` 按执行顺序从上到下排列；必要时用 `test.describe` 分组（可选）。'

export function buildTestCodeUserMessage(
  userInput: string,
  dslJson: string,
  pageUrl: string,
  opts?: { reuseOpenPage?: boolean },
): string {
  const reuse = opts?.reuseOpenPage
    ? '\n注意：服务端已在真实浏览器中打开目标 URL，**同一页签**将执行本段测试；除非需要强制刷新，否则不要调用 `page.goto`。'
    : ''
  const envHint =
    '\n凭据与登录：若用户需求含登录、注册、账号密码等，**默认**用 `testEnv.TEST_USERNAME`、`testEnv.TEST_PASSWORD` 完成用户名/密码输入（结合 DSL 中的 selector）；无登录场景则不必引用。勿声明 `env` 变量；勿使用 `process.env`，勿硬编码真实凭据。'
  const splitHint =
    '\n用例拆分：按功能点输出**多个** `test(...)`（例如登录拆成「点击登录入口 + 断言弹层」与「填账号密码并提交 + 断言结果」两条），每条命名能反映步骤含义。'
  return `用户需求：${userInput}\n页面 DSL：${dslJson}\n目标 URL：${pageUrl}${reuse}${envHint}${splitHint}\n只输出完整代码。`
}
