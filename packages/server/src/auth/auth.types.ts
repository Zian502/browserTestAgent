export type AuthUser = {
  id: string
  login: string
  name?: string
  avatarUrl?: string
}

export type JwtClaims = AuthUser & {
  iat: number
  exp: number
}
