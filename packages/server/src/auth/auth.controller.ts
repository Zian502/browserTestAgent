import { Controller, Get, Query, Req, Res, UnauthorizedException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import type { AuthenticatedRequest } from './auth.guard'

function extractBearerToken(req: Request): string {
  const header = String(req.headers.authorization ?? '').trim()
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return ''
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('config')
  getConfig() {
    return {
      enabled: this.authService.isEnabled(),
      provider: 'github',
    }
  }

  @Get('me')
  getMe(@Req() req: AuthenticatedRequest) {
    if (!this.authService.isEnabled()) {
      return { authenticated: false, authRequired: false, user: null }
    }

    const token = extractBearerToken(req)
    if (!token) {
      return { authenticated: false, authRequired: true, user: null }
    }

    try {
      const user = this.authService.verifyBearerToken(token)
      return { authenticated: true, authRequired: true, user }
    } catch {
      return { authenticated: false, authRequired: true, user: null }
    }
  }

  @Get('github/start')
  startGithubOAuth(@Query('finalRedirect') finalRedirectRaw: string | undefined, @Res() res: Response) {
    if (!this.authService.isEnabled()) {
      throw new UnauthorizedException('GitHub 登录未配置（需 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / JWT_SECRET）')
    }

    const finalRedirect = String(finalRedirectRaw ?? '').trim()
    if (!finalRedirect) {
      throw new UnauthorizedException('缺少 finalRedirect')
    }

    let parsed: URL
    try {
      parsed = new URL(finalRedirect)
    } catch {
      throw new UnauthorizedException('finalRedirect 无效')
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new UnauthorizedException('finalRedirect 必须是 http(s) 地址')
    }

    const state = this.authService.createOAuthState(finalRedirect)
    const url = this.authService.buildGithubAuthorizeUrl(state)
    res.redirect(url)
  }

  @Get('github/callback')
  async githubCallback(
    @Query('code') codeRaw: string | undefined,
    @Query('state') stateRaw: string | undefined,
    @Res() res: Response,
  ) {
    if (!this.authService.isEnabled()) {
      throw new UnauthorizedException('GitHub 登录未配置')
    }

    const code = String(codeRaw ?? '').trim()
    const state = String(stateRaw ?? '').trim()
    if (!code || !state) {
      throw new UnauthorizedException('缺少 code 或 state')
    }

    const finalRedirect = this.authService.consumeOAuthState(state)
    const user = await this.authService.exchangeGithubCode(code)
    const accessToken = this.authService.issueAccessToken(user)
    res.redirect(this.authService.appendTokenToRedirect(finalRedirect, accessToken))
  }
}
