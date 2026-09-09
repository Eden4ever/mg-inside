"""在既有生产配置上幂等追加桌面服务身份；不输出任何凭据。"""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys

release = sys.argv[1]
if not re.fullmatch(r'\d{8}T\d{6}Z', release):
    raise SystemExit('发布编号无效')
identity = Path('/opt/mg-identity/secrets/identity.json')
service = identity.with_name('service.env')
backup = Path('/opt/mg-desktop/backups') / ('identity-' + release) / 'identity-config'
backup.mkdir(parents=True, mode=0o700, exist_ok=True)
for source in [identity, service]:
    target = backup / source.name
    if not target.exists():
        shutil.copy2(source, target)
        os.chmod(target, 0o600)
config = json.loads(identity.read_text())
clients = {item['client_id']: item for item in config['clients']}
specs = [('desktop-one', '统一桌面', 'https://desktop.meta-gravity.com/auth/callback'),
         ('files', '文件', 'https://desktop.meta-gravity.com/apps/files/')]
for client_id, name, callback in specs:
    if client_id not in clients:
        item = {'client_id': client_id, 'client_name': name, 'client_secret': secrets.token_hex(32), 'redirect_uris': [callback]}
        config['clients'].append(item)
        clients[client_id] = item
    elif callback not in clients[client_id]['redirect_uris']:
        clients[client_id]['redirect_uris'].append(callback)

def private_write(path, content, owner=None):
    temporary = path.with_name(path.name + '.next')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    if owner:
        os.chown(temporary, owner.st_uid, owner.st_gid)
    os.replace(temporary, path)

private_write(identity, json.dumps(config, ensure_ascii=False, indent=2) + '\n', identity.stat())
lines = [line for line in service.read_text().splitlines() if not line.startswith('DESKTOP_ORIGIN=')]
lines.append('DESKTOP_ORIGIN=https://desktop.meta-gravity.com')
private_write(service, '\n'.join(lines) + '\n', service.stat())
destination = Path('/opt/mg-desktop/secrets')
destination.mkdir(parents=True, exist_ok=True, mode=0o700)
for app, client_id in [('desktop', 'desktop-one'), ('files', 'files')]:
    path = destination / (app + '.env')
    existing = {}
    if path.exists():
        existing = dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line and not line.startswith('#'))
    template = Path('/opt/mg-desktop/releases') / release / 'deploy' / (app + '.env.example')
    content = template.read_text().replace('REPLACE_WITH_REGISTERED_SERVICE_SECRET', clients[client_id]['client_secret'])
    content = content.replace('REPLACE_WITH_PERSISTENT_64_HEX', existing.get('DESKTOP_FLOW_KEY', secrets.token_hex(32)))
    if 'REPLACE_WITH_' in content:
        raise SystemExit('模板仍含未配置项')
    private_write(path, content)
print('桌面与文件服务身份已追加，原身份密钥和业务客户端保持；配置备份已保存，未输出凭据。')
