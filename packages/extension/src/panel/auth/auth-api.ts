import { AGENT_API_BASE } from '../agent-api-base'
import type { AuthConfigResponse, AuthMeResponse } from './auth-storage'
import {
  clearAllAuthCache,
  getGithubOAuthFinalRedirect,
  getStoredAccessToken,
  resetToLoginPage,
} from './auth-storage'
import { clearGithubBrowserCache } from './github-cache'

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export async function fetchAuthConfig(signal?: AbortSignal): Promise<AuthConfigResponse> {
  const res = await fetch(`${AGENT_API_BASE}/api/auth/config`, { signal })
  if (!res.ok) {
    throw new Error(`读取鉴权配置失败：HTTP ${res.status}`)
  }
  return (await res.json()) as AuthConfigResponse
}

export async function fetchAuthMe(signal?: AbortSignal): Promise<AuthMeResponse> {
  const token = await getStoredAccessToken()
  const headers: HeadersInit = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${AGENT_API_BASE}/api/auth/me`, { headers, signal })
  if (!res.ok) {
    throw new Error(`读取登录状态失败：HTTP ${res.status}`)
  }
  return (await res.json()) as AuthMeResponse
}

export function buildGithubOAuthStartUrl(finalRedirect: string, fresh = false): string {
  const q = new URLSearchParams({ finalRedirect })
  if (fresh) {
    q.set('_t', String(Date.now()))
  }
  return `${AGENT_API_BASE}/api/auth/github/start?${q}`
}

/** 退出登录：撤销 GitHub 授权、清除浏览器 GitHub 缓存与本地会话 */
export async function logoutAuthSession(): Promise<void> {
  const token = await getStoredAccessToken()
  if (token) {
    try {
      await fetch(`${AGENT_API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // 网络失败时仍继续清理本地状态
    }
  }

  await clearGithubBrowserCache()
  await clearAllAuthCache()
  resetToLoginPage()
}

/** 在当前窗口/面板内跳转 GitHub OAuth，回调后由 auth-context 从 URL hash 恢复会话。 */
export function startGithubLogin(fresh = true): void {
  const startUrl = buildGithubOAuthStartUrl(getGithubOAuthFinalRedirect(), fresh)
  window.location.assign(startUrl)
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getStoredAccessToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    await clearAllAuthCache()
    unauthorizedHandler?.()
  }
  return res
}
