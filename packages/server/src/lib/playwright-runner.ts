import { expect } from '@playwright/test'
import type { Page } from 'playwright'

export interface RunTestInput {
  code: string
  targetUrl: string
  timeout?: number
  /** 若传入，则在同一浏览器页签中执行测试（与 Playwright CDP 会话一致） */
  existingPage?: Page
  /**
   * 注入到测试体内的第三个参数 `testEnv`（如 `testEnv.TEST_USERNAME`），来自服务端 `.env` 白名单。
   * 使用 `testEnv` 而非 `env`，避免与生成代码中的 `const env = …` 等声明冲突。
   */
  env?: Record<string, string>
}

export interface RunTestResult {
  passed: number
  failed: number
  logs: string[]
  skipped?: boolean
}

/** 全部 test 体执行完毕后默认停留，便于观察最终页面状态 */
export const POST_TEST_DWELL_MS = 6_000

/** 从源码中依次解析每一段 `test(..., async (...) => { ... })` 的箭头函数体（不含最外层大括号） */
export function extractAllTestCallbackBodies(source: string): string[] {
  const bodies: string[] = []
  let pos = 0
  while (pos < source.length) {
    const slice = source.slice(pos)
    const head = /\btest\s*(?:\.only\s*)?\(/.exec(slice)
    if (!head) break
    const absHead = pos + head.index
    const arrow = source.indexOf('=>', absHead)
    if (arrow === -1) {
      pos = absHead + 1
      continue
    }
    const bodyOpen = source.indexOf('{', arrow)
    if (bodyOpen === -1 || bodyOpen < arrow) {
      pos = absHead + 1
      continue
    }
    let depth = 0
    let i = bodyOpen
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          bodies.push(source.slice(bodyOpen + 1, i))
          pos = i + 1
          break
        }
      }
    }
    if (i >= source.length) break
  }
  return bodies
}

/** @deprecated 使用 {@link extractAllTestCallbackBodies}；仅取第一段以兼容旧调用 */
export function extractFirstTestCallbackBody(source: string): string | null {
  const all = extractAllTestCallbackBodies(source)
  return all[0] ?? null
}

export const playwrightRunner = {
  async execute(input: RunTestInput): Promise<RunTestResult> {
    const logs: string[] = []

    if (!input.existingPage) {
      const safe = input.code.length > 0
      return {
        passed: safe ? 1 : 0,
        failed: safe ? 0 : 1,
        logs: [`[stub] 未启用 Playwright 会话：将仅校验代码非空。目标 URL：${input.targetUrl}`],
        skipped: true,
      }
    }

    const page = input.existingPage
    const onConsole = (msg: { type: () => string; text: () => string }) => {
      logs.push(`[console.${msg.type()}] ${msg.text()}`)
    }
    const onPageError = (err: Error) => {
      logs.push(`[pageerror] ${err.message}`)
    }
    page.on('console', onConsole)
    page.on('pageerror', onPageError)

    const bodies = extractAllTestCallbackBodies(input.code).filter((b) => b.trim())
    if (bodies.length === 0) {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      return {
        passed: 0,
        failed: 1,
        logs: [
          ...logs,
          '未能解析测试体：需要至少一段 `test(..., async ({ page }) => { ... });` 且箭头函数体使用 `{ ... }` 包裹。',
        ],
        skipped: false,
      }
    }

    const totalTimeout = input.timeout ?? 90_000
    const perTestTimeout = Math.max(30_000, Math.floor(totalTimeout / Math.max(bodies.length, 1)))
    let passed = 0
    let failed = 0

    const AsyncConstructor = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>

    const injectedEnv = input.env && typeof input.env === 'object' ? input.env : {}

    try {
      for (let bi = 0; bi < bodies.length; bi++) {
        const body = bodies[bi]
        logs.push(`[runner] 执行第 ${bi + 1}/${bodies.length} 段 test 体`)
        const runner = new AsyncConstructor('page', 'expect', 'testEnv', `"use strict";\n${body}`)
        try {
          await Promise.race([
            runner(page, expect, injectedEnv) as Promise<unknown>,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`第 ${bi + 1} 段测试超过 ${perTestTimeout}ms`)), perTestTimeout),
            ),
          ])
          passed++
        } catch (e) {
          failed++
          logs.push(`[error] 第 ${bi + 1} 段: ${String(e)}`)
        }
      }
      logs.push(`[runner] 全部用例执行完毕，停留 ${POST_TEST_DWELL_MS / 1000}s`)
      await page.waitForTimeout(POST_TEST_DWELL_MS)
      return { passed, failed, logs, skipped: false }
    } finally {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    }
  },
}
