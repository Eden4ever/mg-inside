import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { RoutingMetadataService } from './routing-metadata.service'

@Controller('api/admin/routing-metadata')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class RoutingMetadataController {
  constructor(private readonly metadata: RoutingMetadataService) {}

  @Get()
  catalog() {
    return this.metadata.catalog()
  }
}
