import { loadApplicationConfig, applicationPresentation } from '@mg-inside/frontend';
import input from '../application.json';
import { pageComponents, assets } from './registry';
const config = loadApplicationConfig(input, { components: Object.keys(pageComponents), assets: Object.keys(assets) });
const presentation = applicationPresentation('app-manager');
if (presentation) { config.name = presentation.name; config.brand.name = presentation.name; config.pages[0]!.description = presentation.description; }
if (config.layout !== 'standard') throw new Error('应用管理使用 standard 标准布局');
export const application = config;
