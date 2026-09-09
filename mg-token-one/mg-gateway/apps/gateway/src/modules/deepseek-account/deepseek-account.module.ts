import { Module } from '@nestjs/common'
import { SupplierAccountAdapterModule } from '@/modules/supplier-account/supplier-account-adapter.module'
import { DeepSeekAccountAdapter } from './deepseek-account.adapter'

@Module({
  imports: [SupplierAccountAdapterModule],
  providers: [DeepSeekAccountAdapter],
})
export class DeepSeekAccountModule {}
