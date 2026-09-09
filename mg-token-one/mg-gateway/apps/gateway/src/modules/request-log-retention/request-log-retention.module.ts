import { Module } from '@nestjs/common'
import { RequestLogRetentionLockService } from './request-log-retention-lock.service'
import { RequestLogRetentionService } from './request-log-retention.service'

@Module({
  providers: [RequestLogRetentionLockService, RequestLogRetentionService],
})
export class RequestLogRetentionModule {}
