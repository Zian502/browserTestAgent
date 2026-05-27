import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthUser, JwtClaims } from './auth.types'

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function signAccessToken(user: AuthUser, secret: string, ttlSec: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload: JwtClaims = {
    ...user,
    iat: now,
    exp: now + ttlSec,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyAccessToken(token: string, secret: string): AuthUser | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const data = `${header}.${body}`
  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let claims: JwtClaims
  try {
    claims = JSON.parse(base64UrlDecode(body)) as JwtClaims
  } catch {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (!claims.exp || claims.exp < now) return null
  if (!claims.id || !claims.login) return null

  return {
    id: String(claims.id),
    login: String(claims.login),
    name: claims.name != null ? String(claims.name) : undefined,
    avatarUrl: claims.avatarUrl != null ? String(claims.avatarUrl) : undefined,
  }
}
