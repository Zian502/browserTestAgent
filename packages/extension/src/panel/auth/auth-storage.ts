export type AuthUser = {
  id: string
  login: string
  name?: string
  avatarUrl?: string
}

export type AuthConfigResponse = {
  enabled: boolean
  provider: 'github'
}

export type AuthMeResponse = {
  authenticated: boolean
  authRequired: boolean
  user: AuthUser | null
}

const TOKEN_KEY = 'bta_access_token'
const USER_KEY = 'bta_user'

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

async function storageGet(keys: string[]): Promise<Record<string, string>> {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (items) => {
        const out: Record<string, string> = {}
        for (const key of keys) {
          const v = items[key]
          if (typeof v === 'string') out[key] = v
        }
        resolve(out)
      })
    })
  }

  const out: Record<string, string> = {}
  for (const key of keys) {
    const v = localStorage.getItem(key)
    if (v) out[key] = v
  }
  return out
}

async function storageSet(items: Record<string, string>): Promise<void> {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve())
    })
  }
  for (const [key, value] of Object.entries(items)) {
    localStorage.setItem(key, value)
  }
}

async function storageRemove(keys: string[]): Promise<void> {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve())
    })
  }
  for (const key of keys) {
    localStorage.removeItem(key)
  }
}

export async function getStoredAccessToken(): Promise<string | null> {
  const items = await storageGet([TOKEN_KEY])
  const token = items[TOKEN_KEY]?.trim()
  return token || null
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const items = await storageGet([USER_KEY])
  const raw = items[USER_KEY]
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export async function saveAuthSession(token: string, user: AuthUser): Promise<void> {
  await storageSet({
    [TOKEN_KEY]: token,
    [USER_KEY]: JSON.stringify(user),
  })
}

export async function clearAuthSession(): Promise<void> {
  await storageRemove([TOKEN_KEY, USER_KEY])
}

export function parseAccessTokenFromRedirectUrl(redirectUrl: string): string | null {
  try {
    const url = new URL(redirectUrl)
    const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('access_token')
    if (fromHash) return fromHash
    return url.searchParams.get('access_token')
  } catch {
    return null
  }
}

export function parseAccessTokenFromLocationHash(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('access_token')
}

export function clearAccessTokenFromLocationHash(): void {
  if (typeof window === 'undefined') return
  if (!window.location.hash.includes('access_token')) return
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(null, '', url.toString())
}

export function getGithubOAuthFinalRedirect(): string {
  if (typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL) {
    return chrome.identity.getRedirectURL()
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}`
  }
  return 'http://localhost:5175/'
}
