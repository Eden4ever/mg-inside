import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import configuration from '@/config/configuration'
import { CoreModule } from '@/modules/core/core.module'
import { DatabaseModule } from '@/modules/database/database.module'
import { AuthModule } from '@/modules/auth/auth.module'
import { WecomModule } from '@/modules/wecom/wecom.module'
import { RelayModule } from '@/modules/relay/relay.module'
import { ChannelModule } from '@/modules/channel/channel.module'
import { ModelConfigModule } from '@/modules/model-config/model-config.module'
import { UserModule } from '@/modules/user/user.module'
import { TokenModule } from '@/modules/token/token.module'
import { StatsModule } from '@/modules/stats/stats.module'
import { GroupModule } from '@/modules/group/group.module'
import { TokenAuthMiddleware } from '@/common/middleware/token-auth.middleware'
import { HealthModule } from '@/modules/health/health.module'
import { CctqAccountModule } from '@/modules/cctq-account/cctq-account.module'
import { SupplierAccountModule } from '@/modules/supplier-account/supplier-account.module'
import { RoutingMetadataModule } from '@/modules/routing-metadata/routing-metadata.module'
import { DeepSeekAccountModule } from '@/modules/deepseek-account/deepseek-account.module'
import { AvailabilityMonitoringModule } from '@/modules/availability-monitoring/availability-monitoring.module'
import { RequestLogRetentionModule } from '@/modules/request-log-retention/request-log-retention.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    CoreModule,
    DatabaseModule,
    AuthModule,
    WecomModule,
    RelayModule,
    ChannelModule,
    ModelConfigModule,
    UserModule,
    TokenModule,
    StatsModule,
    GroupModule,
    HealthModule,
    CctqAccountModule,
    SupplierAccountModule,
    RoutingMetadataModule,
    DeepSeekAccountModule,
    AvailabilityMonitoringModule,
    RequestLogRetentionModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TokenAuthMiddleware).forRoutes('v1')
  }
}
