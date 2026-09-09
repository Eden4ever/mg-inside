"""在现有后端版本上仅更新目录服务，验证通过后切换；无需数据库迁移。"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

release_id, payload_dir = sys.argv[1:]
assert re.fullmatch(r'stage(?:13|14)-\d{8}-\d{6}', release_id)
root = Path('/opt/mg-expert-database')
current = root / 'current'
previous = current.resolve()
assert previous.parent == root / 'releases'
release = root / 'releases' / release_id
assert not release.exists()
payload = Path(payload_dir).resolve()
manifest = json.loads((payload / 'manifest.json').read_text())
for name, digest in manifest['files'].items():
    assert name in {'catalog.service.ts', 'catalog.service.js', 'api.controller.ts', 'api.controller.js', 'verify-indicator-hotfix.cjs'}
    assert hashlib.sha256((payload / name).read_bytes()).hexdigest() == digest
for name, digest in manifest['previous'].items():
    assert name in {'apps/api/src/catalog.service.ts', 'apps/api/dist/apps/api/src/catalog.service.js', 'apps/api/src/api.controller.ts', 'apps/api/dist/apps/api/src/api.controller.js'}
    assert hashlib.sha256((previous / name).read_bytes()).hexdigest() == digest, '当前服务版本已变化，停止发布'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def switch(target):
    link = root / ('.current.' + release_id)
    link.symlink_to(target)
    os.replace(link, current)

def healthy():
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4100/api/health', timeout=2) as response:
                if json.load(response).get('status') == 'ok':
                    run('systemctl', 'is-active', '--quiet', 'mg-expert-database-api')
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('知识库后端健康检查失败')

run('cp', '-a', '--reflink=auto', str(previous), str(release))
for source, destination in [
    ('catalog.service.ts', 'apps/api/src/catalog.service.ts'),
    ('catalog.service.js', 'apps/api/dist/apps/api/src/catalog.service.js'),
    ('api.controller.ts', 'apps/api/src/api.controller.ts'),
    ('api.controller.js', 'apps/api/dist/apps/api/src/api.controller.js'),
    ('verify-indicator-hotfix.cjs', 'verify-indicator-hotfix.cjs'),
]:
    if source in manifest['files']:
        run('install', '-o', 'mgexpert', '-g', 'mgexpert', '-m', '0644', str(payload / source), str(release / destination))
# Node 自行读取环境文件；凭据不进入命令参数或输出。
node = root / 'runtimes/node-v24.20.0-linux-x64/bin/node'
run(str(node), '--env-file=/etc/mg-expert-database/api.env', str(release / 'verify-indicator-hotfix.cjs'), str(release), cwd=release)
(release / 'indicator-hotfix-release.json').write_text(json.dumps({'release': release_id, 'previous': str(previous), **manifest}, indent=2) + '\n')
switch(release)
try:
    run('systemctl', 'restart', 'mg-expert-database-api')
    healthy()
except Exception:
    switch(previous)
    run('systemctl', 'restart', 'mg-expert-database-api')
    healthy()
    raise
print(json.dumps({'release': release_id, 'previous': str(previous), 'health': 'ok', 'databaseTest': 'passed_and_rolled_back'}))
