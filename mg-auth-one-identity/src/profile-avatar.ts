/** 只接收可由浏览器安全展示的头像地址；旧企微头像域名统一升级 HTTPS。 */
export function profileAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'http:' && /(^|\.)(qlogo\.cn|qpic\.cn)$/.test(url.hostname)) url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** 缺少字段或上游返回无效地址时保留缓存，明确空头像才清空。 */
export function weComAvatar(value: { avatar?: unknown; thumb_avatar?: unknown }): string | null | undefined {
  const avatar = profileAvatarUrl(value.avatar) || profileAvatarUrl(value.thumb_avatar);
  if (avatar) return avatar;
  if ((value.avatar === '' || value.thumb_avatar === '')
    && (value.avatar === undefined || value.avatar === '')
    && (value.thumb_avatar === undefined || value.thumb_avatar === '')) return null;
  return undefined;
}
