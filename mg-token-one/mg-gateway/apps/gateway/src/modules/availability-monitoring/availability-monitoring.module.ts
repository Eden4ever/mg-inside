import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsBooleanString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AvailabilityAlertEvent } from '@/entities/availability-alert-event.entity'
import { AvailabilityAlertState } from '@/entities/availability-alert-state.entity'
import { RequestLog } from '@/entities/request-log.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { AuthModule } from '@/modules/auth/auth.module'
import { AvailabilityMonitoringService } from './availability-monitoring.service'

class AvailabilityPaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}

class AlertListQuery extends AvailabilityPaginationQuery {
  @IsOptional()
  @IsBooleanString()
  active?: string
}

class EventListQuery extends AvailabilityPaginationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  fingerprint?: string
}

@Controller('api/admin/availability-alerts')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class AvailabilityMonitoringController {
  constructor(private readonly monitoring: AvailabilityMonitoringService) {}

  @Get('states')
  listStates(@Query() query: AlertListQuery) {
    const active = this.parseActive(query.active)
    return this.monitoring.listStates(
      this.parsePage(query.page, 1, 'page'),
      this.parsePage(query.pageSize, 20, 'pageSize'),
      active,
    )
  }

  @Get('events')
  listEvents(@Query() query: EventListQuery) {
    const fingerprint = query.fingerprint === undefined
      ? undefined
      : this.parseFingerprint(query.fingerprint)
    return this.monitoring.listEvents(
      this.parsePage(query.page, 1, 'page'),
      this.parsePage(query.pageSize, 20, 'pageSize'),
      fingerprint,
    )
  }

  @Post('evaluate')
  @HttpCode(200)
  async evaluate(@Body() body: unknown) {
    if (body !== undefined && body !== null && (!this.isEmptyObject(body))) {
      throw new BadRequestException('立即评估不接受请求参数')
    }
    return this.monitoring.evaluate()
  }

  private isEmptyObject(value: unknown): boolean {
    return typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0
  }

  private parseActive(value: unknown): boolean | undefined {
    if (value === undefined) return undefined
    if (value === 'true') return true
    if (value === 'false') return false
    throw new BadRequestException('active 必须是 true 或 false')
  }

  private parsePage(value: unknown, fallback: number, field: 'page' | 'pageSize'): number {
    if (value === undefined) return fallback
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException(`${field} 必须是整数`)
    }
    const parsed = Number(value)
    const upper = field === 'pageSize' ? 100 : Number.MAX_SAFE_INTEGER
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > upper) {
      throw new BadRequestException(
        field === 'pageSize' ? 'pageSize 必须是 1-100 的整数' : 'page 必须是正整数',
      )
    }
    return parsed
  }

  private parseFingerprint(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 191) {
      throw new BadRequestException('fingerprint 必须是 1-191 字符的字符串')
    }
    return value
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([RequestLog, AvailabilityAlertState, AvailabilityAlertEvent]),
    AuthModule,
  ],
  controllers: [AvailabilityMonitoringController],
  providers: [AvailabilityMonitoringService],
  exports: [AvailabilityMonitoringService],
})
export class AvailabilityMonitoringModule {}
