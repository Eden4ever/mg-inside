import { loadApplicationConfig, applicationPresentation } from '@mg-inside/frontend';
import input from '../application.json';
import { pageComponents, assets } from './registry';
const config = loadApplicationConfig(input, { components: Object.keys(pageComponents), assets: Object.keys(assets) });
const presentation = applicationPresentation('files');
if (presentation) { config.name = presentation.name; config.brand.name = presentation.name; }
if (config.layout !== 'standard') throw new Error('文件应用使用 standard 布局');
export const application = config;
