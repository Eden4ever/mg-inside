import catalog from './application-catalog.json' with { type: 'json' };
/** 平台展示元数据唯一来源；权限、部署地址与业务规则不在这里配置。 */
export const platformCatalog = catalog;
export interface ApplicationPresentation {
  name: string;
  description: string;
  icon?: { name: string; palette: string; image?: string; imageViewport?: number[]; badge?: string };
}
export function applicationPresentation(appId: string): ApplicationPresentation | undefined {
  return Object.hasOwn(catalog.applications, appId) ? catalog.applications[appId as keyof typeof catalog.applications] : undefined;
}
