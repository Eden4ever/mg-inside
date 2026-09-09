export interface MonthlyQuotaGroup {
  name: string
  monthlyQuota: number | null
}

export interface ResolvedMonthlyQuota {
  quota: number | null
  appliedGroups: string[]
  isUnlimited: boolean
}

export function periodFor(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export function resolveMonthlyQuota(
  role: string,
  groups: MonthlyQuotaGroup[],
): ResolvedMonthlyQuota {
  if (role === 'admin') return { quota: null, appliedGroups: [], isUnlimited: true }
  const quota = groups.reduce((max, group) => Math.max(max, Number(group.monthlyQuota || 0)), 0)
  return {
    quota: roundMoney(quota),
    appliedGroups: groups
      .filter((group) => Number(group.monthlyQuota || 0) === quota)
      .map((group) => group.name),
    isUnlimited: false,
  }
}

export function allowsReservation(quota: number, used: number, estimate: number): boolean {
  return estimate <= 0 || roundMoney(used + estimate) <= quota + 0.000000001
}

export function composeMonthlyQuota(
  groupQuota: number,
  fixedQuota: number,
  temporaryQuota: number,
): number {
  return roundMoney(
    Math.max(0, Number(groupQuota || 0))
    + Math.max(0, Number(fixedQuota || 0))
    + Math.max(0, Number(temporaryQuota || 0)),
  )
}

export function settledUsage(quota: number, used: number, delta: number): number {
  const next = roundMoney(Math.max(0, used + delta))
  return delta > 0 && next > quota + 0.000000001 ? used : next
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6
}
