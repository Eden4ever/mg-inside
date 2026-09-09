export function identityEndpoint(operation: 'status' | 'start'): string {
  const appBase = import.meta.env.BASE_URL.replace(/\/$/, '');
  const apiBase = (import.meta.env.VITE_API_BASE_URL || `${appBase}/api`).replace(/\/$/, '');
  return `${apiBase}/auth/sso/${operation}`;
}
