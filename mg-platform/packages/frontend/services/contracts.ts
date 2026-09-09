export interface ServiceOperation { operationId: string; method: string; path: string; summary: string; effect: 'read' | 'write'; }
export interface ServiceManifest { schemaVersion: 1; serviceId: string; appId: string; name: string; version: string; description: string; operations: ServiceOperation[]; }
export function operationMatches(operation: ServiceOperation, method: string, path: string) {
  if (operation.method !== method.toUpperCase() || !/^\/[A-Za-z0-9/_-]*$/.test(path)) return false;
  const pattern = operation.path.split('/').map(part => /^\{[a-zA-Z][a-zA-Z0-9]*\}$/.test(part) ? '[A-Za-z0-9_-]+' : part).join('/');
  return new RegExp(`^${pattern}$`).test(path);
}
export function operationPath(operation: ServiceOperation, params: Record<string, string> = {}) {
  return operation.path.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => {
    const value = params[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`服务参数 ${key} 无效`);
    return value;
  });
}
