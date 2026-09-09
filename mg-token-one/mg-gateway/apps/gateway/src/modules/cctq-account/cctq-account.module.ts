import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '@/modules/auth/auth.module'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountSnapshotEntity } from '@/entities/supplier-account-snapshot.entity'
import { Supplier } from '@/entities/supplier.entity'
import { CctqAccountController } from './cctq-account.controller'
import { CctqAccountService } from './cctq-account.service'
import { CctqAccountAdapter, CctqApiKeyAccountAdapter } from './cctq-account.adapter'
import { SupplierAccountAdapterModule } from '@/modules/supplier-account/supplier-account-adapter.module'
import { SupplierAccountModule } from '@/modules/supplier-account/supplier-account.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierAccount, SupplierAccountSnapshotEntity, Supplier]),
    AuthModule,
    SupplierAccountAdapterModule,
    SupplierAccountModule,
  ],
  controllers: [CctqAccountController],
  providers: [CctqAccountService, CctqAccountAdapter, CctqApiKeyAccountAdapter],
  exports: [CctqAccountService],
})
export class CctqAccountModule {}
