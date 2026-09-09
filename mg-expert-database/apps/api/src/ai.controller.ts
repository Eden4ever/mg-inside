import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { AiSuggestionStreamRequest, AiStreamEvent } from '@mg-expert/contracts';
import { AiService } from './ai.service';
import { actorFromRequest, Public, type AuthenticatedRequest } from './auth';
import { RequireSystemPermission } from './system-access';

interface StreamReply {
  hijack(): void;
  raw: { statusCode: number; setHeader(name: string, value: string): void; write(value: string): void; end(): void };
}

@Controller()
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Public()
  @Get('ai/status') status() { return this.ai.status(); }

  @RequireSystemPermission('canResearch')
  @Post('indicator-versions/:versionId/indicators/:nodeId/ai-suggestions/stream')
  async stream(
    @Param('versionId') versionId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: AiSuggestionStreamRequest,
    @Req() req: AuthenticatedRequest,
    @Res() reply: StreamReply,
  ): Promise<void> {
    const requestAbort = new AbortController();
    const rawRequest = (req as AuthenticatedRequest & { raw?: { on?: (event: string, handler: () => void) => void } }).raw;
    rawRequest?.on?.('close', () => requestAbort.abort());
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    const send = (event: AiStreamEvent) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    try {
      await this.ai.generate(versionId, nodeId, body, actorFromRequest(req), send, requestAbort.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 服务暂不可用。';
      send({ type: 'error', code: 'AI_GENERATION_FAILED', message });
    } finally {
      reply.raw.end();
    }
  }
}
