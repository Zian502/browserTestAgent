import { Injectable, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { AuthUser } from './auth.types'
import { signAccessToken, verifyAccessToken } from './jwt'
import { UserService } from './user.service'

type PendingOAuth = {
  finalRedirect: string
  expiresAt: number
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const ACCESS_TOKEN_TTL_SEC = 7 * 24 * 60 * 60

@Injectable()
export class AuthService {
  private readonly pendingOAuth = new Map<string, PendingOAuth>()

  constructor(private readonly userService: UserService) {}

  isEnabled(): boolean {
    return Boolean(this.githubClientId && this.githubClientSecret && this.jwtSecret)
  }

  get githubClientId(): string {
    return String(process.env.GITHUB_CLIENT_ID ?? '').trim()
  }

  private get githubClientSecret(): string {
    return String(process.env.GITHUB_CLIENT_SECRET ?? '').trim()
  }

  private get jwtSecret(): string {
    return String(process.env.JWT_SECRET ?? process.env.AUTH_JWT_SECRET ?? '').trim()
  }

  get callbackBaseUrl(): string {
    const raw = String(process.env.AUTH_CALLBACK_BASE_URL ?? '').trim()
    if (raw) return raw.replace(/\/+$/, '')
    const port = process.env.PORT ? Number(process.env.PORT) : 3850
    return `http://localhost:${port}`
  }

  get githubCallbackUrl(): string {
    return `${this.callbackBaseUrl}/api/auth/github/callback`
  }

  createOAuthState(finalRedirect: string): string {
    this.pruneExpiredStates()
    const state = randomBytes(24).toString('hex')
    this.pendingOAuth.set(state, {
      finalRedirect,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    })
    return state
  }

  consumeOAuthState(state: string): string {
    this.pruneExpiredStates()
    const entry = this.pendingOAuth.get(state)
    this.pendingOAuth.delete(state)
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('OAuth state 无效或已过期')
    }
    return entry.finalRedirect
  }

  buildGithubAuthorizeUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.githubClientId,
      redirect_uri: this.githubCallbackUrl,
      scope: 'read:user user:email repo',
      state,
    })
    return `https://github.com/login/oauth/authorize?${q}`
  }

  async exchangeGithubCode(code: string): Promise<AuthUser> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
        redirect_uri: this.githubCallbackUrl,
      }),
    })

    if (!tokenRes.ok) {
      throw new UnauthorizedException('GitHub token 交换失败')
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
    const accessToken = String(tokenJson.access_token ?? '').trim()
    if (!accessToken) {
      throw new UnauthorizedException(tokenJson.error || 'GitHub 未返回 access_token')
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!userRes.ok) {
      throw new UnauthorizedException('读取 GitHub 用户信息失败')
    }

    const gh = (await userRes.json()) as {
      id?: number
      login?: string
      name?: string | null
      avatar_url?: string
    }

    const id = gh.id != null ? String(gh.id) : ''
    const login = String(gh.login ?? '').trim()
    if (!id || !login) {
      throw new UnauthorizedException('GitHub 用户信息不完整')
    }

    const profile: AuthUser = {
      id,
      login,
      name: gh.name != null ? String(gh.name) : undefined,
      avatarUrl: gh.avatar_url != null ? String(gh.avatar_url) : undefined,
    }

    return this.userService.upsertFromGithub(profile, accessToken)
  }

  async logout(bearerToken: string): Promise<void> {
    const user = this.verifyBearerToken(bearerToken)
    await this.userService.revokeGithubAuthorization(user.id, {
      clientId: this.githubClientId,
      clientSecret: this.githubClientSecret,
    })
  }

  async resolveUserFromToken(token: string): Promise<AuthUser> {
    const claims = this.verifyBearerToken(token)
    const stored = await this.userService.findByGithubId(claims.id)
    return stored ?? claims
  }

  issueAccessToken(user: AuthUser): string {
    if (!this.jwtSecret) {
      throw new UnauthorizedException('服务端未配置 JWT_SECRET')
    }
    return signAccessToken(user, this.jwtSecret, ACCESS_TOKEN_TTL_SEC)
  }

  verifyBearerToken(token: string): AuthUser {
    if (!this.jwtSecret) {
      throw new UnauthorizedException('服务端未配置 JWT_SECRET')
    }
    const user = verifyAccessToken(token, this.jwtSecret)
    if (!user) {
      throw new UnauthorizedException('登录已过期，请重新登录')
    }
    return user
  }

  appendTokenToRedirect(finalRedirect: string, accessToken: string): string {
    const url = new URL(finalRedirect)
    url.hash = `access_token=${encodeURIComponent(accessToken)}&token_type=bearer`
    return url.toString()
  }

  private pruneExpiredStates(): void {
    const now = Date.now()
    for (const [key, value] of this.pendingOAuth) {
      if (value.expiresAt < now) this.pendingOAuth.delete(key)
    }
  }
}
