/**
 * 在目标页签执行 Playwright 测试代码。
 *
 * - 配置了 PLAYWRIGHT_CDP_URL：挂接本机已打开的 Chrome，匹配 URL 对应页签后直接 run_test（不新开浏览器/页签）
 * - 未配置：capture 打开页面后再 run_test
 *
 * 用法: npx tsx scripts/run-cdp-page-test.mts [pageUrl] [specPath]
 */
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const pageUrl = process.argv[2]?.trim() || 'https://www.bydfi.com/zh'
const specPath =
  process.argv[3]?.trim() ||
  resolve(import.meta.dirname, '../.agent-cache/testCode/btc.spec.ts')

const { executePlaywrightCoreTool } = await import('../src/tools/playwright.ts')
const { isPlaywrightCdpAttachActive, getPlaywrightCdpEndpoint, isPlaywrightCdpAttachMode } =
  await import('../src/lib/playwright-browser-session.ts')

const code = readFileSync(specPath, 'utf8')
const sessionId = randomUUID()
const attach = await isPlaywrightCdpAttachActive()

console.log(
  attach
    ? `[mode] 挂接已有 Chrome: ${getPlaywrightCdpEndpoint()}（复用已打开页签，不启动新浏览器）`
    : isPlaywrightCdpAttachMode()
      ? `[mode] 已配置 ${getPlaywrightCdpEndpoint()} 但端口未监听，将回退为 Playwright 启动 Chrome`
      : '[mode] 由 Playwright 启动新 Chrome（可设 PLAYWRIGHT_CDP_URL 挂接已有浏览器）',
)

if (!attach) {
  console.log('[1/2] CDP capture:', pageUrl, 'sessionId:', sessionId)
  const cap = await executePlaywrightCoreTool({
    op: 'capture',
    pageUrl,
    sessionId,
    headless: false,
  })
  if (!cap.ok) {
    console.error('capture failed:', cap.error)
    process.exit(1)
  }
  console.log('[capture] ok, html length:', cap.pageHtml.length)
}

console.log(attach ? '[run] 在当前 Chrome 页签执行测试 …' : '[2/2] run_test on same session …')
const run = await executePlaywrightCoreTool({
  op: 'run_test',
  sessionId: attach ? '' : sessionId,
  code,
  targetUrl: pageUrl,
  timeoutMs: 120_000,
})
if (!run.ok) {
  console.error('run_test failed:', run.error)
  process.exit(1)
}
console.log(JSON.stringify({ passed: run.passed, failed: run.failed, skipped: run.skipped }, null, 2))
for (const line of run.logs) console.log(line)
process.exit(run.failed > 0 ? 1 : 0)
