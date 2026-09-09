import manifest from './app-icons/manifest.json';
import files from './app-icons/registry';

export interface ApplicationIcon {
  /** 由消费应用的 Vite 构建生成的资源 URL。 */
  src: string;
  /** 可选本地图片，优先于基础图标；失败时回退 src。 */
  image?: string;
  imageViewport?: number[];
  badge?: string;
  inset: number;
  shape: 'original' | 'rounded';
}
export type ApplicationIconId = keyof typeof manifest;
export const applicationIcons: Readonly<Record<ApplicationIconId, Readonly<ApplicationIcon>>> = Object.freeze(
  Object.fromEntries(Object.entries(manifest).map(([id, value]) => {
    const icon = value as typeof value & { image?: string; imageViewport?: number[]; badge?: string };
    const src = files[icon.src];
    const image = icon.image ? files[icon.image] : undefined;
    if (!/^[a-z0-9-]+\.svg$/.test(icon.src) || !src
      || !Number.isFinite(icon.inset) || icon.inset < 0 || icon.inset > 40
      || !['original', 'rounded'].includes(icon.shape)
      || (icon.image !== undefined && (!/^[a-z0-9-]+\.(?:png|svg|webp)$/.test(icon.image) || !image))) {
      throw new Error(`应用图标配置无效：${id}`);
    }
    return [id, Object.freeze({ src, ...(icon.badge ? { badge: files[icon.badge] } : {}), ...(image ? { image, imageViewport: icon.imageViewport } : {}), inset: icon.inset, shape: icon.shape as ApplicationIcon['shape'] })];
  })) as Record<ApplicationIconId, Readonly<ApplicationIcon>>,
);
