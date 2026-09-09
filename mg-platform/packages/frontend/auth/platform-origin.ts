export function defaultPlatformOrigin() {
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? 'http://127.0.0.1:4301' : 'https://desktop.meta-gravity.com';
}
let origin = defaultPlatformOrigin();
/** 由应用 SDK 的启动配置提供可信桌面来源，不读取地址栏参数。 */
export function configurePlatformOrigin(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('平台来源配置无效');
  origin = url.origin;
  if (typeof document === 'undefined') return;
  // 所有应用按同一个公开 URL 加载字体，不携带会话凭据。
  let link = document.querySelector<HTMLLinkElement>('link[data-platform-fonts]');
  if (!link) { link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.platformFonts = ''; link.crossOrigin = 'anonymous'; document.head.append(link); }
  link.href = `${origin}/fonts/fonts.css`;
}
export function getPlatformOrigin() { return origin; }
