import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common'
import { Request } from 'express'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { identityEndSession } from './identity-client'
import { bearerToken, unifiedIdentity, unifiedIdentityEnabled } from './unified-client'

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.username, dto.password)
    const result = this.authService.login(user)
    return {
      token: result.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        department: user.department,
        avatarUrl: user.avatarUrl,
        syncSource: user.syncSource,
      },
    }
  }

  @Post(['logout', 'logout/token-one', 'logout/token-one-console', 'logout/token-one-docs'])
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    if (unifiedIdentityEnabled()) {
      await unifiedIdentity.revoke(bearerToken(req.headers.authorization), (req as any).user.applicationId)
      return { ok: true }
    }
    const claims = (req as any).user
    if (claims.identitySubject && claims.identitySession) await identityEndSession(claims.identitySubject, claims.identitySession)
    return { ok: true }
  }

  @Get(['me', 'me/token-one', 'me/token-one-console', 'me/token-one-docs'])
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: Request) {
    const userId = (req as any).user.sub
    const user = await this.authService.me(userId)
    if (!user) throw new BadRequestException('用户不存在')
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      department: user.department,
      avatarUrl: user.avatarUrl,
      syncSource: user.syncSource,
    }
  }
}
