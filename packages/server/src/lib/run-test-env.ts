/**
 * 运行 `run-test-code` / `run_test` 时注入到测试函数体的 **`testEnv`** 对象（来自服务端已加载的 `process.env`，如根目录 `.env`）。
 * 仅导出白名单键，避免把整份环境变量暴露给 LLM 观测或工具 payload。
 */

const DEFAULT_KEYS = ['TEST_USERNAME', 'TEST_PASSWORD'] as const

function extraKeysFromEnv(): string[] {
  const raw = process.env.RUN_TEST_ENV_KEYS?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * 构建注入到 Playwright 内联测试执行器的 `testEnv` 对象（仅字符串值，空值省略）。
 * 默认包含 `TEST_USERNAME`、`TEST_PASSWORD`；可通过 `RUN_TEST_ENV_KEYS`（逗号/空格分隔）追加键名。
 */
export function buildRunTestInjectedEnv(): Record<string, string> {
  const keys = new Set<string>([...DEFAULT_KEYS, ...extraKeysFromEnv()])
  const out: Record<string, string> = {}
  for (const key of keys) {
    const v = process.env[key]
    if (typeof v === 'string' && v.length > 0) out[key] = v
  }
  return out
}

/** 仅用于日志/观测：键名列表，不含值 */
export function runTestInjectedEnvKeyNames(): string[] {
  return Object.keys(buildRunTestInjectedEnv())
}
