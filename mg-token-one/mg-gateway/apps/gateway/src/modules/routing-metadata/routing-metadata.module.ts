import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '@/modules/auth/auth.module'
import { ModelOwner } from '@/entities/model-owner.entity'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { RoutingMetadataController } from './routing-metadata.controller'
import { RoutingMetadataService } from './routing-metadata.service'
import { SupplierAccountAdapterModule } from '@/modules/supplier-account/supplier-account-adapter.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([ModelOwner, Supplier, SupplierAccount]),
    AuthModule,
    SupplierAccountAdapterModule,
  ],
  controllers: [RoutingMetadataController],
  providers: [RoutingMetadataService],
  exports: [RoutingMetadataService],
})
export class RoutingMetadataModule {}
