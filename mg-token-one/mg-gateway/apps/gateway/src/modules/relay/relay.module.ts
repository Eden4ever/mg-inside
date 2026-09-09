import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ModelConfig } from '@/entities/model-config.entity'
import { RelayController } from './relay.controller'
import { RelayService } from './relay.service'
import { ChannelPoolService } from './channel-pool.service'
import { QuotaService } from './quota.service'
import { LogService } from './log.service'
import { Channel } from '@/entities/channel.entity'
import { RequestLog } from '@/entities/request-log.entity'
import { StatsDaily } from '@/entities/stats-daily.entity'
import { Token } from '@/entities/token.entity'
import { User } from '@/entities/user.entity'
import { Group } from '@/entities/group.entity'
import { UserMonthlyQuota } from '@/entities/user-monthly-quota.entity'
import { TokenAuthMiddleware } from '@/common/middleware/token-auth.middleware'
import { GroupModule } from '@/modules/group/group.module'
import {
  AxiosUpstreamPostAdapter,
  NativeResponsesTransport,
} from './native-responses-transport'
import { ChatCompletionsTransport } from './chat-completions-transport'
import { RelayAccounting } from './relay-accounting'
import { AnthropicMessagesTransport } from './anthropic-messages-transport'
import { RelayExecutor } from './relay-executor'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { ModelRouteModule } from '@/modules/model-route/model-route.module'
import { ChannelRouteHealth } from '@/entities/channel-route-health.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModelConfig,
      Channel,
      RequestLog,
      StatsDaily,
      Token,
      User,
      Group,
      UserMonthlyQuota,
      SupplierAccount,
      ChannelRouteHealth,
    ]),
    GroupModule,
    ModelRouteModule,
  ],
  controllers: [RelayController],
  providers: [
    RelayService,
    ChannelPoolService,
    QuotaService,
    LogService,
    TokenAuthMiddleware,
    AxiosUpstreamPostAdapter,
    NativeResponsesTransport,
    ChatCompletionsTransport,
    RelayAccounting,
    AnthropicMessagesTransport,
    RelayExecutor,
  ],
  exports: [RelayService, ChannelPoolService, QuotaService, LogService, TokenAuthMiddleware],
})
export class RelayModule {}
