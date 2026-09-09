import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '@/modules/auth/auth.module'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountSnapshotEntity } from '@/entities/supplier-account-snapshot.entity'
import { SupplierAccountController } from './supplier-account.controller'
import { SupplierAccountDirectoryService } from './supplier-account-directory.service'
import { RelayModule } from '@/modules/relay/relay.module'
import { SupplierAccountAdapterModule } from './supplier-account-adapter.module'
import { SupplierAccountSyncService } from './supplier-account-sync.service'
import { SupplierAccountSyncLockService } from './supplier-account-sync-lock.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierAccount, SupplierAccountSnapshotEntity, Supplier]),
    AuthModule,
    RelayModule,
    SupplierAccountAdapterModule,
  ],
  controllers: [SupplierAccountController],
  providers: [
    SupplierAccountDirectoryService,
    SupplierAccountSyncLockService,
    SupplierAccountSyncService,
  ],
  exports: [
    SupplierAccountDirectoryService,
    SupplierAccountSyncLockService,
    SupplierAccountSyncService,
  ],
})
export class SupplierAccountModule {}
