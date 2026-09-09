import { Module, Global } from '@nestjs/common'
import configuration, { AppConfig, validateAppConfig } from '@/config/configuration'

@Global()
@Module({
  providers: [
    {
      // 直接基于 process.env 构建配置，避免依赖 ConfigService.get() 的返回结构
      provide: 'APP_CONFIG',
      useFactory: (): AppConfig => validateAppConfig(configuration()),
    },
  ],
  exports: ['APP_CONFIG'],
})
export class CoreModule {}
