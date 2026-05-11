/// <reference types="vite/client" />
/// <reference types="chrome" />

interface ImportMetaEnv {
  readonly VITE_AGENT_API?: string
  /** 设为 `0` 时扩展请求走服务端 HTTP 拉 HTML，不启 Playwright */
  readonly VITE_USE_PLAYWRIGHT?: string
  /** 设为 `1` 时 Playwright 无头（默认有头窗口） */
  readonly VITE_PLAYWRIGHT_HEADLESS?: string
}
