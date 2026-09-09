import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { actorFromRequest, AuthenticatedRequest } from './auth';
import { SemanticService } from './semantic.service';
@Controller('semantic-libraries')
export class SemanticController {
  constructor(@Inject(SemanticService) private readonly service: SemanticService) {}
  @Get() list(@Req() req: AuthenticatedRequest) { return this.service.list(actorFromRequest(req)); }
  @Post() create(@Body() body: { versionId?: string; name?: string }, @Req() req: AuthenticatedRequest) { return this.service.create(body, actorFromRequest(req)); }
  @Get(':id') detail(@Param('id') id: string, @Req() req: AuthenticatedRequest) { return this.service.detail(id, actorFromRequest(req)); }
  @Post(':id/build') build(@Param('id') id: string, @Body() body: { consent: boolean }, @Req() req: AuthenticatedRequest) { return this.service.enqueue(id, body.consent, actorFromRequest(req)); }
  @Post(':id/search') search(@Param('id') id: string, @Body() body: { query: string; consent: boolean }, @Req() req: AuthenticatedRequest) { return this.service.search(id, body.query, body.consent, actorFromRequest(req)); }
  @Delete(':id') remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) { return this.service.remove(id, actorFromRequest(req)); }
}
