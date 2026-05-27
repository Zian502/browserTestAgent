import { AGENT_API_BASE } from '../agent-api-base'
import type { AuthConfigResponse, AuthMeResponse, AuthUser } from './auth-storage'
import { clearAuthSession, getGithubOAuthFinalRedirect, getStoredAccessToken } from './auth-storage'

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

export function buildGithubOAuthStartUrl(finalRedirect: string): string {
  const q = new URLSearchParams({ finalRedirect })
  return `${AGENT_API_BASE}/api/auth/github/start?${q}`
}

export async function loginWithGithub(): Promise<{ token: string; user: AuthUser }> {
  const startUrl = buildGithubOAuthStartUrl(getGithubOAuthFinalRedirect())

  if (typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow) {
    const redirectUrl = await new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true }, (responseUrl) => {
        const err = chrome.runtime.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        if (!responseUrl) {
          reject(new Error('GitHub 登录已取消'))
          return
        }
        resolve(responseUrl)
      })
    })

    const token = parseTokenFromRedirect(redirectUrl)
    if (!token) {
      throw new Error('登录回调中未找到 access_token')
    }

    const me = await fetchAuthMeWithToken(token)
    if (!me.user) {
      throw new Error('登录成功但无法读取用户信息')
    }
    return { token, user: me.user }
  }

  return loginWithGithubPopup(startUrl)
}

async function fetchAuthMeWithToken(token: string): Promise<AuthMeResponse> {
  const res = await fetch(`${AGENT_API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`验证登录状态失败：HTTP ${res.status}`)
  }
  return (await res.json()) as AuthMeResponse
}

function parseTokenFromRedirect(redirectUrl: string): string | null {
  try {
    const url = new URL(redirectUrl)
    const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('access_token')
    if (fromHash) return fromHash
    return url.searchParams.get('access_token')
  } catch {
    return null
  }
}

function loginWithGithubPopup(startUrl: string): Promise<{ token: string; user: AuthUser }> {
  return new Promise((resolve, reject) => {
    const popup = window.open(startUrl, 'bta_github_login', 'width=520,height=720')
    if (!popup) {
      reject(new Error('无法打开登录窗口，请允许弹窗'))
      return
    }

    const timer = window.setInterval(async () => {
      if (popup.closed) {
        window.clearInterval(timer)
        reject(new Error('GitHub 登录已取消'))
        return
      }

      let href = ''
      try {
        href = popup.location.href
      } catch {
        return
      }

      const token = parseTokenFromRedirect(href)
      if (!token) return

      window.clearInterval(timer)
      popup.close()

      try {
        const me = await fetchAuthMeWithToken(token)
        if (!me.user) {
          reject(new Error('登录成功但无法读取用户信息'))
          return
        }
        resolve({ token, user: me.user })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }, 400)
  })
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getStoredAccessToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    await clearAuthSession()
    unauthorizedHandler?.()
  }
  return res
}
