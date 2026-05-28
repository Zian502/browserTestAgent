#!/usr/bin/env node
/**
 * 以远程调试端口启动 Chrome，默认复用日常用户配置（标签、登录态、扩展等）。
 * macOS：若 Chrome 已在运行，会先退出再以调试模式重启（Chrome 通常会恢复上次标签页）。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'

const port = String(process.env.CDP_PORT ?? '9222')
const chromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
]

const defaultChromeProfile = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome',
)
const isolatedProfile = path.join(
  os.homedir(),
  '.browser-test-agent/chrome-cdp-profile',
)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function probeCdp(p = port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${p}/json/version`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForCdp(maxMs = 25_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await probeCdp()) return true
    await sleep(400)
  }
  return false
}

function isDefaultChromeLocked() {
  return existsSync(path.join(defaultChromeProfile, 'SingletonLock'))
}

function countChromeProcesses() {
  try {
    const out = execSync('pgrep -lf "Google Chrome" 2>/dev/null || true', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() ? out.trim().split('\n').length : 0
  } catch {
    return 0
  }
}

function chromeIsRunning() {
  return isDefaultChromeLocked() || countChromeProcesses() > 0
}

/** 默认日常配置；CHROME_ISOLATED_PROFILE=1 时用独立空配置 */
function resolveUserDataDir() {
  const explicit = process.env.CHROME_USER_DATA_DIR?.trim()
  if (explicit) return { dir: explicit, isolated: false, isDefaultProfile: false }

  const useIsolated =
    process.env.CHROME_ISOLATED_PROFILE === '1' ||
    process.env.CHROME_ISOLATED_PROFILE === 'true'
  if (useIsolated) {
    mkdirSync(isolatedProfile, { recursive: true })
    return { dir: isolatedProfile, isolated: true, isDefaultProfile: false }
  }

  return { dir: defaultChromeProfile, isolated: false, isDefaultProfile: true }
}

async function quitChromeAndWait() {
  if (process.platform === 'darwin') {
    try {
      execSync(`osascript -e 'tell application "Google Chrome" to quit'`, { stdio: 'ignore' })
    } catch {
      /* Chrome 未运行时 osascript 可能报错，忽略 */
    }
  }

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (!chromeIsRunning()) return true
    await sleep(500)
  }
  return !chromeIsRunning()
}

const chrome = chromePaths.find((p) => existsSync(p))
if (!chrome) {
  console.error('未找到 Google Chrome，请手动安装或修改 scripts/start-chrome-cdp.mjs')
  process.exit(1)
}

if (await probeCdp()) {
  console.log(`✓ 远程调试已就绪: http://127.0.0.1:${port}`)
  console.log('当前 Chrome 已开启 CDP，可直接运行 Agent。')
  process.exit(0)
}

const { dir: userDataDir, isolated, isDefaultProfile } = resolveUserDataDir()

if (isDefaultProfile && chromeIsRunning()) {
  const noQuit =
    process.env.CHROME_NO_QUIT === '1' || process.env.CHROME_NO_QUIT === 'true'
  if (noQuit) {
    console.error(
      '日常 Chrome 仍在运行，无法在保留配置的同时开启 9222。\n' +
        '请任选其一：\n' +
        '  1. 允许本脚本退出并重启 Chrome（默认）：pnpm chrome:cdp\n' +
        '  2. 使用空配置（无原有标签）：CHROME_ISOLATED_PROFILE=1 pnpm chrome:cdp',
    )
    process.exit(1)
  }
  console.log(
    '检测到 Chrome 正在运行。将退出并以调试模式重新打开，\n' +
      '一般会恢复您上次的标签页、登录态与扩展（与日常 Chrome 相同用户配置）。\n',
  )
  const ok = await quitChromeAndWait()
  if (!ok) {
    console.error('Chrome 未能完全退出，请手动 Cmd+Q 退出所有 Chrome 窗口后重试。')
    process.exit(1)
  }
}

const args = [
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userDataDir}`,
]
if (isDefaultProfile) {
  args.push('--restore-last-session')
}

const openUrl = process.env.CHROME_OPEN_URL?.trim()

console.log(`启动: ${chrome}`)
console.log(`远程调试: http://127.0.0.1:${port}`)
console.log(`用户数据: ${userDataDir}`)
if (isolated) {
  console.log('（独立空配置，不含日常标签/登录；仅调试用途）')
} else if (isDefaultProfile) {
  console.log('（日常 Chrome 配置：标签、Cookie、扩展等将一并保留）')
}
console.log('')

const child = spawn(chrome, openUrl ? [...args, openUrl] : args, {
  stdio: 'ignore',
  detached: true,
})
child.unref()

if (await waitForCdp()) {
  console.log('✓ CDP 端口已监听，可以运行 Agent / 测试。')
  if (!openUrl) {
    console.log('若未自动恢复标签，请确认 Chrome 设置中启用了「退出时继续浏览」。')
  }
  process.exit(0)
}

console.error(
  `\n✗ ${port} 端口仍未监听。请 Cmd+Q 退出所有 Chrome 后重试：\n` +
    `  "${chrome}" --remote-debugging-port=${port} --remote-allow-origins=* --restore-last-session --user-data-dir="${userDataDir}"`,
)
process.exit(1)
