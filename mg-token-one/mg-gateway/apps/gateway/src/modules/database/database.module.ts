import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Channel } from '@/entities/channel.entity'
import { ModelConfig } from '@/entities/model-config.entity'
import { User } from '@/entities/user.entity'
import { Token } from '@/entities/token.entity'
import { RequestLog } from '@/entities/request-log.entity'
import { StatsDaily } from '@/entities/stats-daily.entity'
import { WecomDepartment } from '@/entities/wecom-department.entity'
import { WecomConfig } from '@/entities/wecom-config.entity'
import { Group } from '@/entities/group.entity'
import { UserMonthlyQuota } from '@/entities/user-monthly-quota.entity'
import { ModelOwner } from '@/entities/model-owner.entity'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountSnapshotEntity } from '@/entities/supplier-account-snapshot.entity'
import { UserQuotaAdjustment } from '@/entities/user-quota-adjustment.entity'
import { ModelRoute } from '@/entities/model-route.entity'
import { AvailabilityAlertState } from '@/entities/availability-alert-state.entity'
import { AvailabilityAlertEvent } from '@/entities/availability-alert-event.entity'
import { ChannelRouteHealth } from '@/entities/channel-route-health.entity'

const entities = [
  Channel,
  ModelConfig,
  User,
  Token,
  RequestLog,
  StatsDaily,
  WecomDepartment,
  WecomConfig,
  Group,
  UserMonthlyQuota,
  ModelOwner,
  Supplier,
  SupplierAccount,
  SupplierAccountSnapshotEntity,
  UserQuotaAdjustment,
  ModelRoute,
  AvailabilityAlertState,
  AvailabilityAlertEvent,
  ChannelRouteHealth,
]

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.get('db')
        return {
          type: 'mysql',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          charset: 'utf8mb4',
          entities,
          synchronize: db.synchronize,
          timezone: '+08:00',
          extra: {
            connectionLimit: 10,
          },
        }
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
