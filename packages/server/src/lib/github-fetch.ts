import { fetch as undiciFetch, ProxyAgent } from 'undici'

const DEFAULT_TIMEOUT_MS = 60_000

function resolveProxyUrl(): string | undefined {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ]
  for (const raw of candidates) {
    const v = String(raw ?? '').trim()
    if (v) return v
  }
  return undefined
}

function resolveTimeoutMs(): number {
  const n = Number(process.env.GITHUB_FETCH_TIMEOUT_MS ?? '')
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

function isNetworkError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err)
  const cause = err instanceof Error && err.cause ? String(err.cause) : ''
  const blob = `${msg} ${cause}`
  return (
    blob.includes('fetch failed') ||
    blob.includes('Timeout') ||
    blob.includes('ECONNREFUSED') ||
    blob.includes('ENOTFOUND') ||
    blob.includes('UND_ERR_CONNECT_TIMEOUT') ||
    blob.includes('ETIMEDOUT')
  )
}

/** 访问 GitHub（OAuth / API）的 fetch，支持 HTTPS_PROXY 与更长超时 */
export async function githubFetch(input: string | URL, init?: RequestInit) {
  const timeoutMs = resolveTimeoutMs()
  const proxy = resolveProxyUrl()
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined

  try {
    return await undiciFetch(input, {
      ...init,
      dispatcher,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    } as Parameters<typeof undiciFetch>[1])
  } catch (err) {
    if (!isNetworkError(err)) throw err
    const hint = proxy
      ? `（已使用代理 ${proxy}，仍无法连接，请检查代理是否可用）`
      : '（若在国内网络，可在 .env 设置 HTTPS_PROXY=http://127.0.0.1:7890 等本地代理）'
    throw new Error(`连接 GitHub 失败${hint}：${String(err instanceof Error ? err.message : err)}`, {
      cause: err,
    })
  }
}
