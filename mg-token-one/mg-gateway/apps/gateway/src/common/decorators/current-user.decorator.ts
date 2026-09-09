import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { JwtPayload } from '@/common/utils/jwt.util'

/** 管理/门户接口：从 JWT 取当前用户 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest()
    return req.user
  },
)
