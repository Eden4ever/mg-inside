"""将旧运行配置转成内核迁移输入，不读取用户或授权凭据。"""
import json
from pathlib import Path

root = Path('/opt/mg-desktop/backups/catalog-20260909T173539Z')
catalog = json.loads((root / 'runtime-catalog.json').read_text())
for app in catalog['applications']:
    app['runtimePolicy'] = {'apiMode': 'compatibility'}
    if app['id'] == 'low-alt-cockpit':
        app['runtimePolicy']['apiMode'] = 'registered'
    if app['id'] in ['token-one-console', 'token-one-docs']:
        app['runtimePolicy']['versionOwnerAppId'] = 'token-one'
    if app['id'] == 'token-one-console':
        app['runtimePolicy']['rolePath'] = '/auth/me/token-one-console'
    if app['id'] == 'token-one-docs':
        app['runtimePolicy']['allowedApiMethods'] = ['GET', 'HEAD']
    if app['id'] == 'identity':
        app['requiredRole'] = 'identity-manager'
        app['runtimePolicy'].update(rolePath='/auth/me', rolePointer='/user/managementRole')
        app['allowedPaths'] = list(dict.fromkeys(app['allowedPaths'] + ['/divisions', '/organizations', '/scopes']))
target = root / 'kernel-catalog-input.json'
with target.open('x') as stream:
    json.dump(catalog, stream, ensure_ascii=False)
target.chmod(0o600)
print('迁移输入已生成：12 个生产应用；入口和上游保持原值。')
