import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Group } from '@/entities/group.entity'

const DEFAULT_POLICIES = [
  { name: 'default', description: '默认员工分组', monthlyQuota: 0 },
  { name: '研究人员', description: '研究人员分组', monthlyQuota: 100 },
  { name: '开发人员', description: '开发人员分组', monthlyQuota: 200 },
]

/** 仅补齐缺失分组和旧记录的 NULL 字段，绝不覆盖管理员后续配置。 */
@Injectable()
export class GroupPolicyBootstrapService implements OnApplicationBootstrap {
  constructor(@InjectRepository(Group) private readonly groupRepo: Repository<Group>) {}

  async onApplicationBootstrap() {
    for (const policy of DEFAULT_POLICIES) {
      const existing = await this.groupRepo.findOne({ where: { name: policy.name } })
      if (!existing) {
        await this.groupRepo.save(this.groupRepo.create({ ...policy, status: 1 } as Group))
      } else if (existing.monthlyQuota === null || existing.monthlyQuota === undefined) {
        existing.monthlyQuota = policy.monthlyQuota
        await this.groupRepo.save(existing)
      }
    }
  }
}
