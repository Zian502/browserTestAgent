import { expect } from '@playwright/test'
import type { Page } from 'playwright'

export interface RunTestInput {
  code: string
  targetUrl: string
  timeout?: number
  /** 若传入，则在同一浏览器页签中执行测试（与 Playwright CDP 会话一致） */
  existingPage?: Page
}

export interface RunTestResult {
  passed: number
  failed: number
  logs: string[]
  skipped?: boolean
}

/** 从 @playwright/test 风格源码中取出第一个 `test(..., async (...) => { ... })` 的函数体（不含最外层大括号） */
export function extractFirstTestCallbackBody(source: string): string | null {
  const head = /\btest\s*(?:\.only\s*)?\(/.exec(source)
  if (!head) return null
  const arrow = source.indexOf('=>', head.index)
  if (arrow === -1) return null
  const bodyOpen = source.indexOf('{', arrow)
  if (bodyOpen === -1 || bodyOpen < arrow) return null
  let depth = 0
  for (let i = bodyOpen; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(bodyOpen + 1, i)
    }
  }
  return null
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

    const body = extractFirstTestCallbackBody(input.code)
    if (!body?.trim()) {
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

    const AsyncConstructor = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>

    const runner = new AsyncConstructor('page', 'expect', `"use strict";\n${body}`)
    const timeout = input.timeout ?? 60_000

    try {
      await Promise.race([
        runner(page, expect) as Promise<unknown>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`测试执行超过 ${timeout}ms`)), timeout),
        ),
      ])
      return { passed: 1, failed: 0, logs, skipped: false }
    } catch (e) {
      logs.push(`[error] ${String(e)}`)
      return { passed: 0, failed: 1, logs, skipped: false }
    } finally {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    }
  },
}
