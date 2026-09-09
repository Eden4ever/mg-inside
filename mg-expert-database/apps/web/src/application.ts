import { applicationPresentation, loadApplicationConfig, type ApplicationConfig } from '@mg-inside/frontend';
import input from './application.json';
const application = loadApplicationConfig(input, { components: ['systems', 'semantic', 'users', 'models', 'mail'], assets: ['enterpriseLogo'] });
application.name = applicationPresentation(application.appId)?.name || application.name;
application.brand.name = application.name;
export function applicationForRole(role: string): ApplicationConfig {
  if (application.layout !== 'standard') return application;
  return { ...application, navigation: { mode: 'flat', defaultCollapsed: true, pageIds: application.pages.filter(page => role === 'system_admin' || !['users', 'models', 'mail'].includes(page.id)).map(page => page.id) } };
}
