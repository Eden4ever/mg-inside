import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allowsReservation,
  composeMonthlyQuota,
  periodFor,
  resolveMonthlyQuota,
  settledUsage,
} from '../src/modules/relay/monthly-quota-policy'

const defaults = [
  { name: 'default', monthlyQuota: 0 },
  { name: '研究人员', monthlyQuota: 100 },
  { name: '开发人员', monthlyQuota: 200 },
]

test('群组月度额度：默认、研究人员、开发人员与多群组取最高值', () => {
  assert.equal(resolveMonthlyQuota('user', [defaults[0]]).quota, 0)
  assert.equal(resolveMonthlyQuota('user', [defaults[1]]).quota, 100)
  assert.equal(resolveMonthlyQuota('user', [defaults[2]]).quota, 200)
  assert.deepEqual(resolveMonthlyQuota('user', [defaults[1], defaults[2]]), {
    quota: 200, appliedGroups: ['开发人员'], isUnlimited: false,
  })
})

test('管理员不受月度额度限制，零额度仅允许零成本调用', () => {
  assert.deepEqual(resolveMonthlyQuota('admin', [defaults[0]]), {
    quota: null, appliedGroups: [], isUnlimited: true,
  })
  assert.equal(allowsReservation(0, 0, 0), true)
  assert.equal(allowsReservation(0, 0, 0.000001), false)
})

test('预扣与结算不会突破额度，退款不会扣成负数', () => {
  assert.equal(allowsReservation(100, 99.999999, 0.000001), true)
  assert.equal(allowsReservation(100, 99.999999, 0.000002), false)
  assert.equal(settledUsage(100, 20, -25), 0)
  assert.equal(settledUsage(100, 99, 2), 99)
})

test('单用户固定月包和当前月临时包叠加到群组额度', () => {
  assert.equal(composeMonthlyQuota(100, 25.5, 10.25), 135.75)
  assert.equal(composeMonthlyQuota(0, -10, 5), 5)
})

test('账期以 Asia/Shanghai 自然月划分', () => {
  assert.equal(periodFor(new Date('2026-01-31T16:00:00.000Z')), '2026-02')
  assert.equal(periodFor(new Date('2026-01-31T15:59:59.000Z')), '2026-01')
})
