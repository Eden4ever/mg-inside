import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AppConfig } from '@/config/configuration'

@Controller('api/health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      releaseId: this.config.releaseId,
      releaseSha256: this.config.releaseSha256,
    }
  }

  @Get('ready')
  async ready() {
    const policies = {
      autoCircuitBreakerEnabled: this.config.relay.autoCircuitBreakerEnabled,
      availabilityMonitoringSchedulerEnabled: this.config.availabilityMonitoring.schedulerEnabled,
      requestLogRetentionSchedulerEnabled: this.config.requestLogRetention.schedulerEnabled,
    }
    try {
      await this.dataSource.query('SELECT 1')
      return {
        status: 'ready',
        releaseId: this.config.releaseId,
        releaseSha256: this.config.releaseSha256,
        checks: { database: 'ok' },
        policies,
      }
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        releaseId: this.config.releaseId,
        releaseSha256: this.config.releaseSha256,
        checks: { database: 'failed' },
        policies,
      })
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
