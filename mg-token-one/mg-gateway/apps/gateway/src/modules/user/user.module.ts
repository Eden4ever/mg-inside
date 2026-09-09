import {
  Module,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, DeepPartial, EntityManager, In, Repository } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User, UserRole } from '@/entities/user.entity'
import { Group } from '@/entities/group.entity'
import { UserMonthlyQuota } from '@/entities/user-monthly-quota.entity'
import { UserQuotaAdjustment } from '@/entities/user-quota-adjustment.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { AuthModule } from '@/modules/auth/auth.module'
import { PaginationDto, PageResult } from '@/common/dto/pagination.dto'
import { composeMonthlyQuota, periodFor, roundMoney } from '@/modules/relay/monthly-quota-policy'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { JwtPayload } from '@/common/utils/jwt.util'
import * as bcrypt from 'bcryptjs'

class UserDto {
  username?: string
  displayName?: string
  password?: string
  department?: string
  role?: UserRole
  status?: number
  groupNames?: string[]
  fixedMonthlyQuota?: number | string
  temporaryMonthlyQuota?: number | string
  quotaAdjustmentReason?: string
}

@Controller('api/admin/users')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class UserAdminController {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Group) private readonly groupRepo: Repository<Group>,
    @InjectRepository(UserMonthlyQuota)
    private readonly monthlyQuotaRepo: Repository<UserMonthlyQuota>,
    @InjectRepository(UserQuotaAdjustment)
    private readonly quotaAdjustmentRepo: Repository<UserQuotaAdjustment>,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@Query() q: PaginationDto): Promise<PageResult<any>> {
    const page = q.page || 1
    const pageSize = q.pageSize || 10
    const [rows, total] = await this.repo.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { id: 'ASC' },
    })
    const groupNames = [...new Set(rows.flatMap((u) => u.groupNames || ['default']))]
    const groups = groupNames.length
      ? await this.groupRepo.find({ where: { name: In(groupNames), status: 1 } })
      : []
    const quotaByGroup = new Map(groups.map((group) => [group.name, Number(group.monthlyQuota || 0)]))
    const monthlyQuotaPeriod = periodFor(new Date())
    const userIds = rows.filter((user) => user.role !== 'admin').map((user) => user.id)
    const monthlyQuotas = userIds.length
      ? await this.monthlyQuotaRepo.find({
        where: { userId: In(userIds), period: monthlyQuotaPeriod },
      })
      : []
    const monthlyQuotaByUser = new Map(monthlyQuotas.map((item) => [item.userId, item]))
    const list = rows.map((u) => {
      const { passwordHash, ...rest } = u
      const assigned = Array.isArray(u.groupNames) && u.groupNames.length ? u.groupNames : ['default']
      const isQuotaUnlimited = u.role === 'admin'
      const ledger = monthlyQuotaByUser.get(u.id)
      const groupMonthlyQuota = isQuotaUnlimited
        ? 0
        : roundMoney(Math.max(0, ...assigned.map((name) => quotaByGroup.get(name) || 0)))
      const fixedMonthlyQuota = isQuotaUnlimited
        ? 0
        : roundMoney(Math.max(0, Number(u.fixedMonthlyQuota || 0)))
      const temporaryMonthlyQuota = isQuotaUnlimited
        ? 0
        : roundMoney(Math.max(0, Number(ledger?.temporaryMonthlyQuota || 0)))
      const effectiveMonthlyQuota = isQuotaUnlimited
        ? null
        : composeMonthlyQuota(groupMonthlyQuota, fixedMonthlyQuota, temporaryMonthlyQuota)
      const monthlyQuotaUsed = isQuotaUnlimited
        ? 0
        : roundMoney(Math.max(0, Number(ledger?.quotaUsed || 0)))
      return {
        ...rest,
        groupMonthlyQuota,
        fixedMonthlyQuota,
        temporaryMonthlyQuota,
        effectiveMonthlyQuota,
        monthlyQuotaUsed,
        monthlyQuotaRemaining: isQuotaUnlimited
          ? null
          : roundMoney(Math.max(0, Number(effectiveMonthlyQuota) - monthlyQuotaUsed)),
        monthlyQuotaPeriod,
        isQuotaUnlimited,
      }
    })
    return { list, total, page, pageSize }
  }

  @Get(':id/quota-adjustments')
  async quotaAdjustments(
    @Param('id') id: string,
    @Query() q: PaginationDto,
  ): Promise<PageResult<UserQuotaAdjustment>> {
    const userId = this.parseUserId(id)
    const exists = await this.repo.exist({ where: { id: userId } })
    if (!exists) throw new NotFoundException('用户不存在')
    const page = q.page || 1
    const pageSize = Math.min(q.pageSize || 20, 100)
    const [list, total] = await this.quotaAdjustmentRepo.findAndCount({
      where: { userId },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return { list, total, page, pageSize }
  }

  @Post()
  async create(@CurrentUser() operator: JwtPayload, @Body() dto: UserDto) {
    if(process.env.IDENTITY_ENABLED==='true')throw new BadRequestException('账号只能在统一认证中心创建并授权');
    if (!dto.username) throw new BadRequestException('username 必填')
    const exists = await this.repo.findOne({ where: { username: dto.username } })
    if (exists) throw new BadRequestException('用户名已存在')
    const period = periodFor(new Date())
    const role = this.parseRole(dto.role) || 'user'
    const groupNames = await this.validateGroupNames(dto.groupNames)
    const fixedMonthlyQuota = this.parseQuota(dto.fixedMonthlyQuota, '每月固定额度包') || 0
    const temporaryMonthlyQuota = this.parseQuota(dto.temporaryMonthlyQuota, '本月临时额度包')
    const hasInitialQuota = fixedMonthlyQuota > 0 || Number(temporaryMonthlyQuota || 0) > 0
    const quotaAdjustmentReason = hasInitialQuota
      ? this.parseAdjustmentReason(dto.quotaAdjustmentReason)
      : ''
    const userData: DeepPartial<User> = {
      username: dto.username,
      displayName: dto.displayName || dto.username,
      passwordHash: dto.password ? bcrypt.hashSync(dto.password, 10) : null,
      department: dto.department || null,
      role,
      status: dto.status ?? 1,
      groupNames,
      fixedMonthlyQuota,
    }
    const u = this.repo.create(userData)
    const saved = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(User, u)
      await this.setTemporaryMonthlyQuota(
        manager,
        created.id,
        temporaryMonthlyQuota,
        period,
      )
      if (hasInitialQuota) {
        await this.saveQuotaAdjustment(manager, {
          user: created,
          operator,
          fixedBefore: 0,
          fixedAfter: fixedMonthlyQuota,
          temporaryBefore: 0,
          temporaryAfter: temporaryMonthlyQuota || 0,
          reason: quotaAdjustmentReason,
          period,
        })
      }
      return created
    })
    const { passwordHash, ...safe } = saved
    return safe
  }

  @Put(':id')
  async update(
    @CurrentUser() operator: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UserDto,
  ) {
    if(process.env.IDENTITY_ENABLED==='true'&&['username','displayName','password','department','status'].some(k=>Object.prototype.hasOwnProperty.call(dto,k)))throw new BadRequestException('身份资料与启停由统一认证管理，此处仅管理应用权限和额度');
    const userId = this.parseUserId(id)
    const period = periodFor(new Date())
    const role = this.parseRole(dto.role)
    const fixedMonthlyQuota = this.parseQuota(dto.fixedMonthlyQuota, '每月固定额度包')
    const temporaryMonthlyQuota = this.parseQuota(dto.temporaryMonthlyQuota, '本月临时额度包')
    const groupNames = dto.groupNames === undefined
      ? undefined
      : await this.validateGroupNames(dto.groupNames)
    const saved = await this.dataSource.transaction(async (manager) => {
      const u = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!u) throw new NotFoundException('用户不存在')
      const ledger = await manager.findOne(UserMonthlyQuota, {
        where: { userId, period },
        lock: { mode: 'pessimistic_write' },
      })
      const fixedBefore = roundMoney(Math.max(0, Number(u.fixedMonthlyQuota || 0)))
      const temporaryBefore = roundMoney(Math.max(0, Number(ledger?.temporaryMonthlyQuota || 0)))
      const fixedAfter = fixedMonthlyQuota ?? fixedBefore
      const temporaryAfter = temporaryMonthlyQuota ?? temporaryBefore
      const quotaChanged = fixedBefore !== fixedAfter || temporaryBefore !== temporaryAfter
      const quotaAdjustmentReason = quotaChanged
        ? this.parseAdjustmentReason(dto.quotaAdjustmentReason)
        : ''

      if (dto.displayName !== undefined) u.displayName = dto.displayName
      if (dto.password) u.passwordHash = bcrypt.hashSync(dto.password, 10)
      if (dto.department !== undefined) u.department = dto.department || null
      if (role) u.role = role
      if (dto.status !== undefined) u.status = dto.status
      if (groupNames !== undefined) u.groupNames = groupNames
      if (fixedMonthlyQuota !== undefined) u.fixedMonthlyQuota = fixedMonthlyQuota
      const updated = await manager.save(User, u)
      await this.setTemporaryMonthlyQuota(
        manager,
        userId,
        temporaryMonthlyQuota,
        period,
      )
      if (quotaChanged) {
        await this.saveQuotaAdjustment(manager, {
          user: updated,
          operator,
          fixedBefore,
          fixedAfter,
          temporaryBefore,
          temporaryAfter,
          reason: quotaAdjustmentReason,
          period,
        })
      }
      return updated
    })
    const { passwordHash, ...safe } = saved
    return safe
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if(process.env.IDENTITY_ENABLED==='true')throw new BadRequestException('请在统一认证撤销应用授权，历史数据归属会保留');
    await this.repo.delete(parseInt(id, 10))
    return { ok: true }
  }

  private async validateGroupNames(names?: string[]): Promise<string[]> {
    const normalized = [...new Set((names || ['default'])
      .map((name) => String(name).trim())
      .filter(Boolean))]
    const selected = normalized.length ? normalized : ['default']
    const groups = await this.groupRepo.find({ where: { name: In(selected), status: 1 } })
    if (groups.length !== selected.length) {
      throw new BadRequestException('存在不存在或已禁用的分组')
    }
    return selected
  }

  private parseQuota(value: number | string | undefined, label: string): number | undefined {
    if (value === undefined) return undefined
    if (
      (typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && value.trim() === '')
    ) {
      throw new BadRequestException(`${label}必须是有效数字`)
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99_999_999.999999) {
      throw new BadRequestException(`${label}必须是 0 到 99999999.999999 之间的数字`)
    }
    return roundMoney(parsed)
  }

  private parseRole(value?: UserRole): UserRole | undefined {
    if (value === undefined) return undefined
    if (value !== 'admin' && value !== 'user') {
      throw new BadRequestException('角色必须是 admin 或 user')
    }
    return value
  }

  private parseUserId(id: string): number {
    const parsed = Number(id)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException('用户 ID 无效')
    return parsed
  }

  private parseAdjustmentReason(value?: string): string {
    const reason = String(value || '').trim()
    if (reason.length < 2 || reason.length > 255) {
      throw new BadRequestException('额度调整原因需填写 2 到 255 个字符')
    }
    return reason
  }

  private async setTemporaryMonthlyQuota(
    manager: EntityManager,
    userId: number,
    quota: number | undefined,
    period: string,
  ) {
    if (quota === undefined) return
    await manager.query(
      `INSERT INTO user_monthly_quotas
        (\`userId\`, \`period\`, \`quotaUsed\`, \`temporaryMonthlyQuota\`)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE \`temporaryMonthlyQuota\` = VALUES(\`temporaryMonthlyQuota\`)`,
      [userId, period, quota],
    )
  }

  private async saveQuotaAdjustment(
    manager: EntityManager,
    input: {
      user: User
      operator: JwtPayload
      fixedBefore: number
      fixedAfter: number
      temporaryBefore: number
      temporaryAfter: number
      reason: string
      period: string
    },
  ) {
    await manager.save(UserQuotaAdjustment, manager.create(UserQuotaAdjustment, {
      userId: input.user.id,
      username: input.user.username,
      operatorUserId: input.operator?.sub || null,
      operatorUsername: input.operator?.username || 'system',
      period: input.period,
      fixedQuotaBefore: input.fixedBefore,
      fixedQuotaAfter: input.fixedAfter,
      temporaryQuotaBefore: input.temporaryBefore,
      temporaryQuotaAfter: input.temporaryAfter,
      reason: input.reason,
    }))
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Group, UserMonthlyQuota, UserQuotaAdjustment]),
    AuthModule,
  ],
  controllers: [UserAdminController],
  exports: [TypeOrmModule],
})
export class UserModule {}
