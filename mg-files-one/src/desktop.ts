import { defaultPlatformOrigin, createDesktopApplication, createPlatformSession } from '@mg-inside/frontend';
export const desktop = createDesktopApplication({ appId: 'files', origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection: false });
export const platformSession = createPlatformSession({ origin: desktop.origin, onExpired: () => desktop.login() });
const guards = new Set<() => boolean | Promise<boolean>>();
export const pending = new Set<string>();
export function leaveGuard(guard: () => boolean | Promise<boolean>) { guards.add(guard); return () => guards.delete(guard); }
export async function canLeave() { for (const guard of guards) if (!(await guard())) return false; return true; }
export function setPending(key: string, value: boolean) { if (value) pending.add(key); else pending.delete(key); desktop.setState({ dirty: pending.size > 0, busy: pending.has('upload') }); }
window.addEventListener('beforeunload', event => { if (pending.size) { event.preventDefault(); event.returnValue = ''; } });
