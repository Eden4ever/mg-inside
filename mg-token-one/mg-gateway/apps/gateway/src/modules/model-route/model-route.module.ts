import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ModelConfig } from '@/entities/model-config.entity'
import { ModelRoute } from '@/entities/model-route.entity'
import { ModelRouteStore } from './model-route.store'

@Module({
  imports: [TypeOrmModule.forFeature([ModelConfig, ModelRoute])],
  providers: [ModelRouteStore],
  exports: [ModelRouteStore],
})
export class ModelRouteModule {}
