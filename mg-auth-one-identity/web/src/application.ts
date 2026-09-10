import { applicationPresentation, loadApplicationConfig } from '@mg-inside/frontend';
import input from './application.json';
export const application = loadApplicationConfig(input, { components: ['overview', 'employees', 'roles', 'divisions', 'organizations', 'applications', 'scopes', 'settings'], assets: ['enterpriseLogo'] });
application.name = applicationPresentation(application.appId)?.name || application.name;
application.brand.name = application.name;
