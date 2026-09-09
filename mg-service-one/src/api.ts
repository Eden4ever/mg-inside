import {createDesktopApplication,createPlatformSession,createApplicationClient,defaultPlatformOrigin} from '@mg-inside/frontend';
export const desktop=createDesktopApplication({appId:'service-manager',origin:import.meta.env.VITE_DESKTOP_ORIGIN||defaultPlatformOrigin(),formProtection:false});
export const session=createPlatformSession({origin:desktop.origin,onExpired:()=>desktop.login()});
export const client=createApplicationClient({origin:desktop.origin,appId:'service-manager',session,onExpired:()=>desktop.login(),beginRequest:()=>desktop.beginRequest(),basePath:'/api/service-registry'});
