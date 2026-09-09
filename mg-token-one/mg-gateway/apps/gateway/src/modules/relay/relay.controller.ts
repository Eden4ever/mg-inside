import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { RelayService } from './relay.service'
import { GatewayTokenInfo } from '@/common/middleware/token-auth.middleware'

@Controller('v1')
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Post('chat/completions')
  async chatCompletions(@Req() req: Request, @Res() res: Response) {
    const info = (req as any).gatewayToken as GatewayTokenInfo
    if (!info) throw new BadRequestException('未鉴权')
    return this.relay.chatCompletions(req.body, req, res, info)
  }

  @Post('responses')
  async responses(@Req() req: Request, @Res() res: Response) {
    const info = (req as any).gatewayToken as GatewayTokenInfo
    if (!info) throw new BadRequestException('未鉴权')
    return this.relay.responses(req.body, req, res, info)
  }

  @Post('messages')
  async messages(@Req() req: Request, @Res() res: Response) {
    const info = (req as any).gatewayToken as GatewayTokenInfo
    if (!info) throw new BadRequestException('未鉴权')
    return this.relay.anthropicMessages(req.body, req, res, info)
  }

  @Get('models')
  async models(@Req() req: Request) {
    const info = (req as any).gatewayToken as GatewayTokenInfo | undefined
    if (req.headers['x-api-key'] || req.headers['anthropic-version']) {
      return this.relay.listAnthropicModels(info, {
        beforeId: req.query.before_id as string | undefined,
        afterId: req.query.after_id as string | undefined,
        limit: req.query.limit as string | undefined,
      })
    }
    return this.relay.listModels(info)
  }
}
