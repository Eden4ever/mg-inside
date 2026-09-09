import { createHash } from 'node:crypto'
import { Not, Repository } from 'typeorm'
import { User } from '@/entities/user.entity'
import { DirectoryUser } from './identity-client'

// 只有认证中心签发的应用目录/登录结果可调用；不接受浏览器提交的身份字段。
export async function applyIdentityUser(repo: Repository<User>, p: DirectoryUser): Promise<User | null> {
  const issuer = process.env.IDENTITY_ISSUER || 'https://identity.meta-gravity.com'
  if (!p.subject || !p.name.trim() || (p.localUserId !== null && !/^\d+$/.test(p.localUserId))) throw new Error('中心用户映射无效')
  let user = await repo.findOne({ where: { identitySubject: p.subject }, lock: { mode: 'pessimistic_write' } })
  if (user && (user.identitySubject !== p.subject || user.identityIssuer !== issuer || (p.localUserId !== null && user.id !== Number(p.localUserId)))) throw new Error('中心身份与原账号冲突')
  if (!user && p.localUserId !== null) {
    user = await repo.findOne({ where: { id: Number(p.localUserId) }, lock: { mode: 'pessimistic_write' } })
    if (!user || (user.identitySubject && user.identitySubject !== p.subject) || (user.identityIssuer && user.identityIssuer !== issuer)) throw new Error('禁止覆盖历史账号绑定')
  }
  if (!user && !p.active) return null
  if (await repo.findOne({ where: { displayName: p.name, ...(user ? { id: Not(user.id) } : {}) } })) throw new Error('存在同名历史账号，请在中心关联原 ID')
  if (!user) {
    user = repo.create({ username: p.username || `identity_${createHash('sha256').update(p.subject).digest('hex').slice(0,40)}`, role: 'user', passwordHash: null,
      syncSource: 'sso', groupNames: ['default'], fixedMonthlyQuota: 0, quotaTotal: 0, quotaUsed: 0 })
  }
  Object.assign(user, { identityIssuer: issuer, identitySubject: p.subject, identityEnabled: p.active,
    displayName: p.name, department: p.department, status: p.active ? 1 : 0, ...(p.username ? { username: p.username } : {}) })
  return repo.save(user)
}
