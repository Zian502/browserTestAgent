import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import type { AuthUser } from './auth.types'

export type AuthenticatedRequest = Request & { user?: AuthUser }

function extractBearerToken(req: Request): string {
  const header = String(req.headers.authorization ?? '').trim()
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return ''
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.authService.isEnabled()) return true

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = extractBearerToken(req)
    if (!token) {
      throw new UnauthorizedException('需要登录')
    }
    req.user = this.authService.verifyBearerToken(token)
    return true
  }
}
