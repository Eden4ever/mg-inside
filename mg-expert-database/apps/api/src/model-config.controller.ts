import { Body, Controller, Get, Inject, Post, Put, Req } from '@nestjs/common';
import { actorFromRequest, AuthenticatedRequest, requireRole } from './auth';
import { ModelConfigService } from './model-config';
import { ZhipuEmbedding } from './zhipu-embedding';
@Controller('model-management')
export class ModelConfigController {
  constructor(@Inject(ModelConfigService) private readonly config: ModelConfigService, @Inject(ZhipuEmbedding) private readonly gateway: ZhipuEmbedding) {}
  @Get() async read(@Req() req: AuthenticatedRequest) { requireRole(actorFromRequest(req), ['system_admin']); await this.config.refresh(); return this.config.read(); }
  @Put() save(@Body() body: { apiKey?: string; enabled: boolean; revision: number }, @Req() req: AuthenticatedRequest) { return this.config.save(body, req); }
  @Post('test') async test(@Req() req: AuthenticatedRequest) { requireRole(actorFromRequest(req), ['system_admin']); const started = Date.now(); const result = await this.gateway.embed(['智谱向量模型连接测试']); return { ok: true, dimensions: result.vectors[0]?.length, tokens: result.tokens, elapsedMs: Date.now() - started }; }
}
