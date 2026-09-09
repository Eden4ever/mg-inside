import { Body, Controller, Get, Inject, Post, Put, Req } from '@nestjs/common';
import { actorFromRequest, AuthenticatedRequest } from './auth';
import { MailConfigInput, MailConfigService } from './mail-config';

@Controller('mail-settings')
export class MailConfigController {
  constructor(@Inject(MailConfigService) private readonly mail: MailConfigService) {}
  @Get() read(@Req() req: AuthenticatedRequest) { return this.mail.read(actorFromRequest(req)); }
  @Put() save(@Body() input: MailConfigInput, @Req() req: AuthenticatedRequest) { return this.mail.save(input, actorFromRequest(req)); }
  @Post('test') test(@Body() input: { to: string }, @Req() req: AuthenticatedRequest) { return this.mail.test(input?.to, actorFromRequest(req)); }
}
