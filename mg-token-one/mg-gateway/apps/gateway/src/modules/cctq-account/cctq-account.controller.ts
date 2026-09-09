import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { CctqAccountService, SaveCctqAccountInput } from './cctq-account.service'

@Controller('api/admin/cctq-account')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class CctqAccountController {
  constructor(private readonly account: CctqAccountService) {}

  @Get()
  getState() {
    return this.account.getState()
  }

  @Put()
  save(@Body() input: SaveCctqAccountInput) {
    return this.account.save(input || {})
  }

  @Post('sync')
  sync() {
    return this.account.synchronize('manual')
  }
}
