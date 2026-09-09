import { applicationPresentation, loadApplicationConfig } from '@mg-inside/frontend';
import input from '../application.json';
import { pageComponents, assets } from './registry';

const config = loadApplicationConfig(input, { components: Object.keys(pageComponents), assets: Object.keys(assets) });
config.name = applicationPresentation(config.appId)?.name || config.name;
if (config.layout !== 'standard') throw new Error('个人中心使用 standard 标准布局，请检查 application.json 的 layout 字段');
export const application = config;

export function applicationPage(id: string) { const page = application.pages.find(page => page.id === id); if (!page) throw new Error('页面配置不存在：' + id); return page; }
