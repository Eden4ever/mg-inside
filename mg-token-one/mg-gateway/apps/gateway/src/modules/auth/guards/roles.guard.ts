import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import { unifiedIdentityEnabled } from '../unified-client'

/**
 * 角色守卫工厂：直接在 @UseGuards(JwtAuthGuard, Roles('admin')) 中使用。
 * JwtAuthGuard 先校验登录态并写入 req.user，本守卫再校验角色。
 */
export const Roles = (...roles: string[]): CanActivate => {
  return {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest()
      const user = req.user
      if (!user) throw new ForbiddenException('未登录')
      // 统一模式的控制台授权就是管理应用能力，不提升共享用户的业务角色。
      if (unifiedIdentityEnabled() && roles.includes('admin')) {
        if (user.applicationId !== 'token-one-console') throw new ForbiddenException('没有控制台访问权限')
        return true
      }
      if (roles.length && !roles.includes(user.role)) {
        throw new ForbiddenException('无权限')
      }
      return true
    },
  }
}
