import { TemplatesService } from './templates.service';
import type { SaveSystemTemplatesRequest } from '@mg-expert/contracts';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { CloneVersionRequest, CreateSystemRequest, EvidenceRequest, IndicatorNodeRequest, SaveSummaryRequest, UpdateModuleRequest } from '@mg-expert/contracts';
import { actorFromRequest, Public, type AuthenticatedRequest } from './auth';
import { CatalogService } from './catalog.service';
import { RequireSystemPermission } from './system-access';

@Controller()
export class ApiController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService, @Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Get('systems/:systemId/templates') getTemplates(@Param('systemId') id: string, @Req() req: AuthenticatedRequest) { return this.templates.read(id, actorFromRequest(req)); }
  @Put('systems/:systemId/templates') saveTemplates(@Param('systemId') id: string, @Body() body: SaveSystemTemplatesRequest, @Req() req: AuthenticatedRequest) { return this.templates.save(id, body, actorFromRequest(req)); }

  @Public()
  @Get('health') health() { return this.catalog.health(); }

  @Get('systems') listSystems(@Req() req: AuthenticatedRequest) { return this.catalog.listSystems(actorFromRequest(req)); }
  @Post('systems') createSystem(@Body() body: CreateSystemRequest, @Req() req: AuthenticatedRequest) { return this.catalog.createSystem(body, actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Patch('systems/:systemId') updateSystem(@Param('systemId') id: string, @Body() body: { name?: string; region?: string }, @Req() req: AuthenticatedRequest) { return this.catalog.updateSystem(id, body, actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Delete('systems/:systemId') @HttpCode(204) async deleteSystem(@Param('systemId') id: string, @Body() body: { confirmName?: string }, @Req() req: AuthenticatedRequest) { await this.catalog.deleteSystem(id, body, actorFromRequest(req)); }
  @RequireSystemPermission('canView')
  @Get('systems/:systemId') getSystem(@Param('systemId') systemId: string, @Req() req: AuthenticatedRequest) { return this.catalog.getSystem(systemId, actorFromRequest(req)); }

  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId') getVersion(@Param('versionId') versionId: string, @Req() req: AuthenticatedRequest) { return this.catalog.getVersion(versionId, actorFromRequest(req)); }
  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId/tree') tree(@Param('versionId') versionId: string, @Query('q') q?: string) { return this.catalog.getTree(versionId, q); }
  @RequireSystemPermission('canManageCatalog')
  @Post('indicator-versions/:versionId/nodes') createNode(@Param('versionId') versionId: string, @Body() body: IndicatorNodeRequest, @Req() req: AuthenticatedRequest) { return this.catalog.createNode(versionId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Patch('indicator-versions/:versionId/nodes/:nodeId') updateNode(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Body() body: Partial<IndicatorNodeRequest>, @Req() req: AuthenticatedRequest) { return this.catalog.updateNode(versionId, nodeId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Post('indicator-versions/:versionId/nodes/reorder') reorderNode(@Param('versionId') versionId: string, @Body() body: { nodeId: string; targetId: string; position: 'before' | 'after' }, @Req() req: AuthenticatedRequest) { return this.catalog.reorderNode(versionId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Delete('indicator-versions/:versionId/nodes/:nodeId') @HttpCode(204) async deleteNode(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Req() req: AuthenticatedRequest, @Body() body?: { confirmName?: string }) { await this.catalog.deleteNode(versionId, nodeId, actorFromRequest(req), body); }
  @RequireSystemPermission('canManageCatalog')
  @Post('indicator-versions/:versionId/clone') cloneVersion(@Param('versionId') versionId: string, @Body() body: CloneVersionRequest, @Req() req: AuthenticatedRequest) { return this.catalog.cloneVersion(versionId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId/audit-logs') auditLogs(@Param('versionId') versionId: string) { return this.catalog.auditLogs(versionId); }

  @RequireSystemPermission('canManageCatalog')
  @Post('indicator-versions/:versionId/import/preflight') async previewImport(@Param('versionId') versionId: string, @Req() req: MultipartRequest) { return this.catalog.previewImport(versionId, await this.file(req), actorFromRequest(req)); }
  @RequireSystemPermission('canManageCatalog')
  @Post('indicator-versions/:versionId/import') async importTree(@Param('versionId') versionId: string, @Req() req: AuthenticatedRequest & MultipartRequest) { return this.catalog.importTree(versionId, await this.file(req), actorFromRequest(req)); }

  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId/indicators/:nodeId/workspace') workspace(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Req() req: AuthenticatedRequest) { return this.catalog.workspace(versionId, nodeId, actorFromRequest(req)); }
  @RequireSystemPermission('canResearch')
  @Patch('indicator-versions/:versionId/indicators/:nodeId/summary') saveSummary(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Body() body: SaveSummaryRequest, @Req() req: AuthenticatedRequest) { return this.catalog.saveSummary(versionId, nodeId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canResearch')
  @Patch('indicator-versions/:versionId/indicators/:nodeId/modules/:moduleKey') saveModule(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Param('moduleKey') moduleKey: string, @Body() body: UpdateModuleRequest, @Req() req: AuthenticatedRequest) { return this.catalog.saveModule(versionId, nodeId, moduleKey, body, actorFromRequest(req)); }

  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId/indicators/:nodeId/revisions') revisions(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Query('moduleKey') moduleKey: string | undefined, @Req() req: AuthenticatedRequest) { return this.catalog.revisions(versionId, nodeId, moduleKey, actorFromRequest(req)); }
  @RequireSystemPermission('canView')
  @RequireSystemPermission('canResearch')
  @RequireSystemPermission('canResearch')

  @RequireSystemPermission('canView')
  @Get('indicator-versions/:versionId/indicators/:nodeId/evidence') evidenceList(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Query('moduleKey') moduleKey: string | undefined, @Req() req: AuthenticatedRequest) { return this.catalog.evidenceList(versionId, nodeId, moduleKey, actorFromRequest(req)); }
  @RequireSystemPermission('canResearch', 'canReview')
  @Post('indicator-versions/:versionId/indicators/:nodeId/modules/:moduleKey/evidence') createEvidence(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Param('moduleKey') moduleKey: string, @Body() body: EvidenceRequest, @Req() req: AuthenticatedRequest) { return this.catalog.createEvidence(versionId, nodeId, moduleKey, body, actorFromRequest(req)); }
  @RequireSystemPermission('canResearch', 'canReview')
  @Put('indicator-versions/:versionId/indicators/:nodeId/evidence/:evidenceId') updateEvidence(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Param('evidenceId') evidenceId: string, @Body() body: Partial<EvidenceRequest>, @Req() req: AuthenticatedRequest) { return this.catalog.updateEvidence(versionId, nodeId, evidenceId, body, actorFromRequest(req)); }
  @RequireSystemPermission('canResearch', 'canReview')
  @Delete('indicator-versions/:versionId/indicators/:nodeId/evidence/:evidenceId') @HttpCode(204) async deleteEvidence(@Param('versionId') versionId: string, @Param('nodeId') nodeId: string, @Param('evidenceId') evidenceId: string, @Req() req: AuthenticatedRequest) { await this.catalog.deleteEvidence(versionId, nodeId, evidenceId, actorFromRequest(req)); }

  private async file(req: MultipartRequest): Promise<Buffer> {
    if (typeof req.file !== 'function') throw new BadRequestException('导入请求必须使用 multipart/form-data 上传 file 字段。');
    const upload = await req.file(); if (!upload) throw new BadRequestException('请上传 file 字段。');
    if (!/\.xlsx$/i.test(upload.filename ?? '')) throw new BadRequestException('仅支持 .xlsx 文件。');
    return upload.toBuffer();
  }
}

interface MultipartRequest extends AuthenticatedRequest {
  file?: () => Promise<{ filename?: string; toBuffer: () => Promise<Buffer> } | undefined>;
}
