"""身份中心就绪后原地激活已准备业务包；不迁移数据库、不关闭鉴权。"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

kind, release_id = sys.argv[1:]
if kind not in ('token', 'expert') or not re.fullmatch(r'[a-z0-9TZ-]+', release_id):
    raise SystemExit('发布参数无效')
root = pathlib.Path('/opt/mg-gateway' if kind == 'token' else '/opt/mg-expert-database')
prepared = root / 'prepared' / release_id
backup = root / 'backups' / (release_id + '-prepare')
if not prepared.is_dir() or not backup.is_dir() or (backup / 'activated.json').exists():
    raise SystemExit('准备目录或激活状态无效')

def switch_file(source, target):
    target = pathlib.Path(target)
    temporary = target.with_name(target.name + '.' + release_id + '.next')
    if temporary.exists():
        raise SystemExit('临时切换文件已存在')
    shutil.copy2(source, temporary)
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)

def health(url):
    for _ in range(45):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('新版本健康检查失败；保留新版本与备份，禁止自动降级鉴权')

if kind == 'token':
    import yaml
    compose = root / 'docker-compose.yml'
    if compose.read_bytes() != (backup / 'docker-compose.yml').read_bytes() or (root / 'mg-gateway.env').read_bytes() != (backup / 'mg-gateway.env').read_bytes():
        raise SystemExit('准备后在线配置发生变化，需要重新核对')
    config = yaml.safe_load(compose.read_text())
    config['services']['gateway']['image'] = 'mg-gateway:' + release_id
    candidate = backup / 'next-compose.yaml'
    candidate.write_text(yaml.safe_dump(config, sort_keys=False))
    os.chmod(candidate, 0o600)
    switch_file(backup / 'next-mg-gateway.env', root / 'mg-gateway.env')
    switch_file(candidate, compose)
    subprocess.run(['docker', 'compose', '-f', str(compose), 'up', '-d', '--no-build', 'gateway'], cwd=root, check=True)
    health('http://127.0.0.1:3001/api/health/live')
    health('http://127.0.0.1:3001/api/health/ready')
else:
    current = root / 'current'
    old = pathlib.Path((backup / 'previous-release.txt').read_text().strip())
    if current.resolve() != old or pathlib.Path('/etc/mg-expert-database/api.env').read_bytes() != (backup / 'api.env').read_bytes():
        raise SystemExit('准备后在线配置或版本发生变化，需要重新核对')
    target = root / 'releases' / release_id
    web = pathlib.Path('/var/www/mg-expert-database/knowledge-base-inside')
    next_web = web.with_name('.knowledge-base-inside.' + release_id + '.next')
    previous_web = web.with_name('.knowledge-base-inside.' + release_id + '.previous')
    if target.exists() or next_web.exists() or previous_web.exists():
        raise SystemExit('目标版本目录已存在，禁止覆盖')
    shutil.copytree(prepared / 'web', next_web)
    web_stat = web.stat()
    for directory, directories, files in os.walk(next_web):
        os.chown(directory, web_stat.st_uid, web_stat.st_gid)
        for file in files:
            os.chown(pathlib.Path(directory) / file, web_stat.st_uid, web_stat.st_gid)
    os.rename(prepared / 'source', target)
    subprocess.run(['chown', '-R', 'mgexpert:mgexpert', str(target)], check=True)
    # 与线上相同 schema/迁移，直接切换代码，不执行 migrate/reset/seed。
    subprocess.run(['systemctl', 'stop', 'mg-expert-database-api'], check=True)
    switch_file(backup / 'next-api.env', '/etc/mg-expert-database/api.env')
    next_link = root / ('.current.' + release_id + '.next')
    next_link.symlink_to(target)
    os.replace(next_link, current)
    subprocess.run(['systemctl', 'start', 'mg-expert-database-api'], check=True)
    health('http://127.0.0.1:4100/api/health')
    os.rename(web, previous_web)
    os.rename(next_web, web)

record = {'kind': kind, 'release': release_id, 'health': 'passed', 'backup': str(backup)}
(backup / 'activated.json').write_text(json.dumps(record, indent=2))
os.chmod(backup / 'activated.json', 0o600)
print(json.dumps(record))
