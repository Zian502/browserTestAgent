#!/usr/bin/env node
/**
 * 以远程调试端口启动 Chrome。
 * 默认复用日常用户配置；macOS 上须先结束全部 Chrome 进程（含 Helper），否则会占用配置锁且不带 9222。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
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

const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']

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

async function waitForCdp(maxMs = 45_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await probeCdp()) return true
    await sleep(400)
  }
  return false
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function profileLocked(profileDir) {
  return lockFiles.some((name) => existsSync(path.join(profileDir, name)))
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
  return countChromeProcesses() > 0
}

function removeStaleProfileLocks(profileDir) {
  for (const name of lockFiles) {
    const p = path.join(profileDir, name)
    if (!existsSync(p)) continue
    try {
      unlinkSync(p)
    } catch {
      /* 仍被占用 */
    }
  }
}

function resolveUserDataDir(preferIsolated = false) {
  const explicit = process.env.CHROME_USER_DATA_DIR?.trim()
  if (explicit) {
    return { dir: explicit, isolated: false, isDefaultProfile: false }
  }

  const useIsolated =
    preferIsolated ||
    process.env.CHROME_ISOLATED_PROFILE === '1' ||
    process.env.CHROME_ISOLATED_PROFILE === 'true'
  if (useIsolated) {
    mkdirSync(isolatedProfile, { recursive: true })
    return { dir: isolatedProfile, isolated: true, isDefaultProfile: false }
  }

  return { dir: defaultChromeProfile, isolated: false, isDefaultProfile: true }
}

/** macOS：结束主进程 + Helper + 应用包内所有子进程 */
function forceKillChromeDarwin() {
  run(`osascript -e 'tell application "Google Chrome" to quit'`)
  const killalls = [
    'Google Chrome',
    'Google Chrome Helper',
    'Google Chrome Helper (Renderer)',
    'Google Chrome Helper (GPU)',
    'Google Chrome Helper (Plugin)',
    'Google Chrome Helper (Alerts)',
  ]
  for (const name of killalls) {
    run(`killall "${name}" 2>/dev/null || true`)
  }
  run('pkill -f "/Applications/Google Chrome.app/" 2>/dev/null || true')
  run('pkill -9 -f "/Applications/Google Chrome.app/" 2>/dev/null || true')
}

async function quitChromeCompletely(profileDir) {
  if (process.platform === 'darwin') {
    forceKillChromeDarwin()
  }

  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    if (!chromeIsRunning()) break
    await sleep(400)
    if (process.platform === 'darwin' && chromeIsRunning()) {
      forceKillChromeDarwin()
    }
  }

  if (chromeIsRunning()) return false

  removeStaleProfileLocks(profileDir)
  await sleep(400)
  return !chromeIsRunning() && !profileLocked(profileDir)
}

function buildChromeArgs(userDataDir, isDefaultProfile) {
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
  return args
}

function spawnChrome(chrome, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, {
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', reject)
    child.unref()
    resolve(child)
  })
}

async function tryLaunch(chrome, profile, openUrl) {
  const args = buildChromeArgs(profile.dir, profile.isDefaultProfile)
  if (openUrl) args.push(openUrl)

  console.log(`启动: ${chrome}`)
  console.log(`远程调试: http://127.0.0.1:${port}`)
  console.log(`用户数据: ${profile.dir}`)
  if (profile.isolated) {
    console.log('（独立配置，无日常标签/登录）')
  } else {
    console.log('（日常 Chrome 配置）')
  }
  console.log('')

  await spawnChrome(chrome, args)
  return waitForCdp()
}

function printFailure(chrome, userDataDir, procs, locked) {
  console.error(
    `\n✗ ${port} 端口仍未监听。` +
      (procs > 0 ? ` 仍有 ${procs} 个 Chrome 相关进程。` : '') +
      (locked ? ' 用户数据目录仍被锁定。' : '') +
      '\n\n建议：\n' +
      '  1. 活动监视器结束所有「Google Chrome」后: pnpm chrome:cdp\n' +
      '  2. 独立配置（最稳）: pnpm chrome:cdp:isolated\n' +
      '  3. 关闭 Chrome「关闭窗口后继续后台运行」后重试\n' +
      '  4. 手动启动（须零 Chrome 进程）：\n' +
      `     "${chrome}" --remote-debugging-port=${port} --remote-allow-origins=* --user-data-dir="${userDataDir}"`,
  )
}

const chrome = chromePaths.find((p) => existsSync(p))
if (!chrome) {
  console.error('未找到 Google Chrome')
  process.exit(1)
}

if (await probeCdp()) {
  console.log(`✓ 远程调试已就绪: http://127.0.0.1:${port}`)
  process.exit(0)
}

const openUrl = process.env.CHROME_OPEN_URL?.trim()
const noFallback =
  process.env.CHROME_NO_FALLBACK === '1' || process.env.CHROME_NO_FALLBACK === 'true'
let profile = resolveUserDataDir(false)

if (profile.isDefaultProfile && (chromeIsRunning() || profileLocked(profile.dir))) {
  const noQuit = process.env.CHROME_NO_QUIT === '1' || process.env.CHROME_NO_QUIT === 'true'
  if (noQuit) {
    console.error(
      '日常 Chrome 仍在运行或配置被锁，无法在同一配置下开启 9222。\n' +
        '请 Cmd+Q 退出 Chrome，或: pnpm chrome:cdp:isolated',
    )
    process.exit(1)
  }
  console.log(
    '检测到 Chrome 正在运行。将结束全部 Chrome 进程（含 Helper）并以调试模式重启…\n' +
      '（若仍失败，请关闭 Chrome 设置里的「关闭后继续后台运行」）\n',
  )
  const ok = await quitChromeCompletely(profile.dir)
  if (!ok) {
    const n = countChromeProcesses()
    console.error(
      `仍有 ${n} 个 Chrome 进程或配置锁未释放。\n` +
        '请活动监视器结束所有 Google Chrome，或直接使用: pnpm chrome:cdp:isolated',
    )
    process.exit(1)
  }
}

let ok = await tryLaunch(chrome, profile, openUrl)

if (!ok && profile.isDefaultProfile && !noFallback) {
  console.log('\n日常配置未能开启 CDP（常见原因：Helper 进程未退出）。正在改用独立配置重试…\n')
  await quitChromeCompletely(defaultChromeProfile)
  await quitChromeCompletely(isolatedProfile)
  profile = resolveUserDataDir(true)
  ok = await tryLaunch(chrome, profile, openUrl)
}

if (ok) {
  console.log('✓ CDP 端口已监听，可以运行 Agent / 测试。')
  console.log(`  验证: curl http://127.0.0.1:${port}/json/version`)
  if (profile.isolated) {
    console.log('  独立配置无日常登录；测业务站请先在该 Chrome 窗口打开目标 URL。')
  }
  process.exit(0)
}

printFailure(
  chrome,
  profile.dir,
  countChromeProcesses(),
  profileLocked(profile.dir),
)
process.exit(1)
