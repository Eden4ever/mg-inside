import { defaultPlatformOrigin, createDesktopApplication, createPlatformSession } from '@mg-inside/frontend';
import { application } from './application';
export const desktop = createDesktopApplication({ appId: application.appId, origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection: false });
export const platformSession = createPlatformSession({ origin: desktop.origin, onExpired: () => desktop.login() });
let guard: () => boolean | Promise<boolean> = () => true;
let pending: () => boolean = () => false;
export function registerLeaveGuard(value: () => boolean | Promise<boolean>, dirty: () => boolean) { guard = value; pending = dirty; return () => { if (guard === value) { guard = () => true; pending = () => false; desktop.setState({ dirty: false }); } }; }
export function canLeave() { return guard(); }
window.addEventListener('beforeunload', event => { if (pending()) { event.preventDefault(); event.returnValue = ''; } });
