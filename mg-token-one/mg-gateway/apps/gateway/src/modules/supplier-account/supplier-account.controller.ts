import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import {
  CreateSupplierAccountInput,
  SupplierAccountDirectoryService,
  UpdateSupplierAccountInput,
} from './supplier-account-directory.service'
import {
  SaveSupplierAccountCredentialInput,
  SupplierAccountSyncService,
} from './supplier-account-sync.service'

@Controller('api/admin/supplier-accounts')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class SupplierAccountController {
  constructor(
    private readonly directory: SupplierAccountDirectoryService,
    private readonly syncService: SupplierAccountSyncService,
  ) {}

  @Get()
  async list() {
    const list = await this.directory.list()
    return { list, total: list.length }
  }

  @Post()
  create(@Body() input: CreateSupplierAccountInput) {
    return this.directory.create(input)
  }

  @Get(':id')
  getState(@Param('id') id: string) {
    return this.syncService.getState(id)
  }

  @Put(':id/credential')
  saveCredential(
    @Param('id') id: string,
    @Body() input: SaveSupplierAccountCredentialInput,
  ) {
    return this.syncService.saveCredential(id, input)
  }

  @Post(':id/sync')
  synchronize(@Param('id') id: string) {
    return this.syncService.synchronize(id)
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() input: UpdateSupplierAccountInput) {
    return this.directory.update(id, input)
  }
}
