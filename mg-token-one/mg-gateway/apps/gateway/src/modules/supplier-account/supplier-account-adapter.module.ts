import { Module } from '@nestjs/common'
import { SupplierAccountAdapterRegistry } from './supplier-account-adapter.registry'

@Module({
  providers: [SupplierAccountAdapterRegistry],
  exports: [SupplierAccountAdapterRegistry],
})
export class SupplierAccountAdapterModule {}
