import {
  Module,
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Token } from '@/entities/token.entity'
import { User } from '@/entities/user.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { AuthModule } from '@/modules/auth/auth.module'
import { PaginationDto, PageResult } from '@/common/dto/pagination.dto'
import { CryptoUtil } from '@/common/utils/crypto.util'
import { nanoid } from 'nanoid'

class TokenDto {
  name: string
  userId?: number
  groupTag?: string
}

function genKey(): { key: string; keyHash: string; keyPrefix: string } {
  const raw = nanoid(32)
  const key = `sk-${raw}`
  return {
    key,
    keyHash: CryptoUtil.sha256(raw),
    keyPrefix: raw.slice(0, 8),
  }
}

@Controller('api/admin/tokens')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class TokenAdminController {
  constructor(
    @InjectRepository(Token) private readonly repo: Repository<Token>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  @Get()
  async list(@Query() q: PaginationDto): Promise<PageResult<any>> {
    const page = q.page || 1
    const pageSize = q.pageSize || 10
    const [rows, total] = await this.repo.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { id: 'DESC' },
    })
    const list = rows.map((t) => {
      const { keyHash, quotaTotal, quotaUsed, ...rest } = t
      return rest
    })
    return { list, total, page, pageSize }
  }

  @Post()
  async create(@Body() dto: TokenDto) {
    if (!dto.name) throw new BadRequestException('name 必填')
    const userId = dto.userId
    if (!userId) throw new BadRequestException('userId 必填')
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException('用户不存在')
    const { key, keyHash, keyPrefix } = genKey()
    const t = this.repo.create({
      keyHash,
      keyPrefix,
      name: dto.name,
      userId,
      groupTag: dto.groupTag || null,
      status: 1,
    })
    await this.repo.save(t)
    return { id: t.id, name: t.name, key }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.repo.delete(parseInt(id, 10))
    return { ok: true }
  }
}

@Controller('api/portal/tokens')
@UseGuards(JwtAuthGuard)
export class TokenPortalController {
  constructor(@InjectRepository(Token) private readonly repo: Repository<Token>) {}

  @Get()
  async my(@CurrentUser() user: any): Promise<PageResult<any>> {
    const [rows, total] = await this.repo.findAndCount({
      where: { userId: user.sub },
      order: { id: 'DESC' },
    })
    const list = rows.map((t) => {
      const { keyHash, quotaTotal, quotaUsed, ...rest } = t
      return rest
    })
    return { list, total, page: 1, pageSize: rows.length || 1 }
  }

  @Post()
  async create(@CurrentUser() user: any, @Body() dto: TokenDto) {
    if (!dto.name) throw new BadRequestException('name 必填')
    const { key, keyHash, keyPrefix } = genKey()
    const t = this.repo.create({
      keyHash,
      keyPrefix,
      name: dto.name,
      userId: user.sub,
      // 员工门户创建的令牌始终继承账号分组，不能借请求体扩大模型权限。
      groupTag: null,
      status: 1,
    })
    await this.repo.save(t)
    return { id: t.id, name: t.name, key }
  }

  @Delete(':id')
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    const t = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!t || t.userId !== user.sub) throw new NotFoundException('令牌不存在')
    await this.repo.delete(t.id)
    return { ok: true }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Token, User]), AuthModule],
  controllers: [TokenAdminController, TokenPortalController],
})
export class TokenModule {}
