import { pinyin } from 'pinyin-pro';

/** 仅生成可编辑建议，不作为外部身份关联依据，也不预占用户名。 */
export function usernameBase(displayName: string): string {
  const base = pinyin(displayName.trim().slice(0, 100), {
    toneType: 'none', type: 'array', surname: 'head', v: true,
  }).join('').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  return base || 'user';
}

export function availableUsername(displayName: string, existing: ReadonlySet<string>): string {
  const base = usernameBase(displayName);
  if (!existing.has(base)) return base;
  // n 个已用名至多占用 n 个后缀；优先填补最小可用序号。
  for (let suffix = 1; suffix <= existing.size + 1; suffix++) {
    const candidate = `${base}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error('无法生成用户名建议。');
}
