import type { ApplicationConfig } from './application';

export function applicationDocumentTitle(config: ApplicationConfig, title = config.name): string {
  return (config.browser?.titleTemplate || '{title} · {name}').replace(/\{(title|name)\}/g, (_, key: string) => key === 'title' ? title : config.name);
}
/** 图片由构建时资源注册表提供，JSON 不拼接地址或执行脚本。 */
export function applyApplicationDocument(config: ApplicationConfig, assets: Record<string, string>, title?: string) {
  document.title = applicationDocumentTitle(config, title);
  const key = config.brand.favicon;
  if (!key || !assets[key]) return;
  let link = document.querySelector<HTMLLinkElement>('link[data-platform-favicon]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.dataset.platformFavicon = ''; document.head.append(link); }
  link.href = assets[key];
}
