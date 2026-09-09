import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WecomConfig } from '@/entities/wecom-config.entity'
import { WecomDepartment } from '@/entities/wecom-department.entity'
import { User } from '@/entities/user.entity'
import { WecomService } from './wecom.service'
import { WecomSyncService } from './wecom-sync.service'
import { WecomController } from './wecom.controller'
import { AuthModule } from '@/modules/auth/auth.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([WecomConfig, WecomDepartment, User]),
    AuthModule,
  ],
  controllers: [WecomController],
  providers: [WecomService, WecomSyncService],
  exports: [WecomService, WecomSyncService],
})
export class WecomModule {}
