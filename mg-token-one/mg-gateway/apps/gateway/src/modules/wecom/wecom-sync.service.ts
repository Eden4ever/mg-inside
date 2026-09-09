import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import axios from 'axios'
import { WecomService } from './wecom.service'
import { AuthService } from '@/modules/auth/auth.service'
import { WecomDepartment } from '@/entities/wecom-department.entity'
import { User } from '@/entities/user.entity'

const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin'

@Injectable()
export class WecomSyncService {
  private readonly logger = new Logger(WecomSyncService.name)
  private syncing = false

  constructor(
    private readonly wecom: WecomService,
    private readonly auth: AuthService,
    @InjectRepository(WecomDepartment)
    private readonly deptRepo: Repository<WecomDepartment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** 每天 02:00 全量同步 */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledSync() {
    try {
      await this.syncAll()
    } catch (e) {
      this.logger.error('定时同步通讯录失败', e?.message)
    }
  }

  async syncAll(): Promise<{ departments: number; users: number }> {
    if (process.env.IDENTITY_ENABLED === 'true') return { departments: 0, users: 0 }
    if (this.syncing) return { departments: 0, users: 0 }
    this.syncing = true
    try {
      const cfg = await this.wecom.getConfig()
      if (!cfg || !cfg.corpid || !cfg.secret) {
        throw new Error('企业微信未配置，跳过同步')
      }
      const token = await (this.wecom as any)['getAccessToken'](cfg)
      const deptMap = await this.syncDepartments(token)
      const users = await this.syncUsers(token, deptMap)
      return { departments: deptMap.size, users }
    } finally {
      this.syncing = false
    }
  }

  private async syncDepartments(token: string): Promise<Map<number, string>> {
    const { data } = await axios.get(`${QYAPI}/department/list`, {
      params: { access_token: token },
      timeout: 10000,
    })
    const map = new Map<number, string>()
    if (data.errcode !== 0) throw new Error(`department/list: ${data.errmsg}`)
    for (const d of data.department || []) {
      await this.deptRepo.upsert(
        {
          id: d.id,
          name: d.name,
          parentid: d.parentid,
          order: d.order || 0,
        },
        ['id'],
      )
      map.set(d.id, d.name)
    }
    return map
  }

  private async syncUsers(
    token: string,
    deptMap: Map<number, string>,
  ): Promise<number> {
    const { data } = await axios.get(`${QYAPI}/department/list`, {
      params: { access_token: token },
      timeout: 10000,
    })
    const departments: any[] = data.department || []
    let count = 0
    for (const dept of departments) {
      const members = await this.listDeptMembers(token, dept.id)
      for (const m of members) {
        const primaryDept = (m.department && m.department[0]) || dept.id
        const deptName = deptMap.get(primaryDept) || dept.name
        const role = await this.wecom.resolveRole(m)
        await this.auth.upsertByWeCom({
          wecomUserId: m.userid,
          displayName: m.name,
          department: deptName,
          wecomDeptIds: m.department,
          role,
        })
        count++
      }
    }
    return count
  }

  private async listDeptMembers(
    token: string,
    departmentId: number,
  ): Promise<any[]> {
    const { data } = await axios.get(`${QYAPI}/user/simplelist`, {
      params: { access_token: token, department_id: departmentId },
      timeout: 10000,
    })
    if (data.errcode !== 0) {
      this.logger.warn(`user/simplelist(${departmentId}): ${data.errmsg}`)
      return []
    }
    return data.userlist || []
  }
}
