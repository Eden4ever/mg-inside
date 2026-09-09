"""准备不可变业务发布；不切换服务、不执行迁移、不修改在线 env。"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile

kind, release_id, archive_name, expected_sha = sys.argv[1:]
if kind not in ('token', 'expert') or not re.fullmatch(r'[a-z0-9TZ-]+', release_id):
    raise SystemExit('发布参数无效')
archive = pathlib.Path(archive_name)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_sha:
    raise SystemExit('归档 SHA256 不匹配')
root = pathlib.Path('/opt/mg-gateway' if kind == 'token' else '/opt/mg-expert-database')
prepared = root / 'prepared' / release_id
backup = root / 'backups' / (release_id + '-prepare')
if prepared.exists() or backup.exists():
    raise SystemExit('准备目录或备份已存在，禁止覆盖')
prepared.mkdir(parents=True)
backup.mkdir(parents=True, mode=0o700)
os.chmod(backup, 0o700)
with tarfile.open(archive, 'r:gz') as source:
    for member in source.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('归档包含不安全成员')
    source.extractall(prepared)
if kind == 'expert':
    for line in (prepared / 'SHA256SUMS').read_text().splitlines():
        sha, name = line.split('  ', 1)
        if hashlib.sha256((prepared / name).read_bytes()).hexdigest() != sha:
            raise SystemExit('成员校验失败')

def private_copy(source, target):
    shutil.copy2(source, target)
    os.chmod(target, 0o600)

def pending_env(source, target):
    lines = pathlib.Path(source).read_text().splitlines()
    replaced = {'DESKTOP_ORIGIN': 'https://desktop.meta-gravity.com', 'IDENTITY_TOKEN_MODE': 'unified'}
    lines = [line for line in lines if line.split('=', 1)[0] not in replaced]
    lines.extend(key + '=' + value for key, value in replaced.items())
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write('\n'.join(lines) + '\n')

if kind == 'token':
    for name in ('docker-compose.yml', 'mg-gateway.env', 'identity-client.env'):
        if (root / name).exists():
            private_copy(root / name, backup / name)
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'mg-gateway']))[0]
    (backup / 'image.json').write_text(json.dumps({'imageId': container['Image'], 'imageTag': container['Config']['Image']}, indent=2))
    os.chmod(backup / 'image.json', 0o600)
    env = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
    database = env['DB_DATABASE']
    if not re.fullmatch(r'[A-Za-z0-9_]+', database):
        raise SystemExit('数据库名称无效')
    with open(backup / 'database.sql', 'xb') as output:
        os.chmod(backup / 'database.sql', 0o600)
        subprocess.run(['docker', 'exec', '-e', 'MG_BACKUP_DB=' + database, 'mgnewapi-mysql', 'sh', '-c',
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --set-gtid-purged=OFF "$MG_BACKUP_DB"'], stdout=output, check=True)
    if (backup / 'database.sql').stat().st_size < 100:
        raise SystemExit('数据库备份为空')
    pending_env(root / 'mg-gateway.env', backup / 'next-mg-gateway.env')
    tag = 'mg-gateway:' + release_id
    if subprocess.run(['docker', 'image', 'inspect', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise SystemExit('镜像 tag 已存在，禁止覆盖')
    subprocess.run(['docker', 'build', '--build-arg', 'MG_RELEASE_ID=' + release_id,
        '--build-arg', 'MG_RELEASE_SHA256=' + expected_sha, '-t', tag, '.'], cwd=prepared, check=True)
else:
    source = prepared / 'source'
    current = (root / 'current').resolve(strict=True)
    (backup / 'previous-release.txt').write_text(str(current) + '\n')
    private_copy('/etc/mg-expert-database/api.env', backup / 'api.env')
    private_copy('/etc/systemd/system/mg-expert-database-api.service', backup / 'mg-expert-database-api.service')
    for name in ('auth-config.key', 'model-config.key'):
        if (root / 'shared' / name).exists():
            private_copy(root / 'shared' / name, backup / name)
    # 使用现有服务环境执行 pg_dump，凭据仅在子进程环境，不输出。
    script = 'set -a; . /etc/mg-expert-database/api.env; set +a; pg_dump --format=custom --file="$1" "${DATABASE_URL%%\\?schema=*}"'
    subprocess.run(['bash', '-c', script, 'backup', str(backup / 'database.dump')], check=True)
    os.chmod(backup / 'database.dump', 0o600)
    subprocess.run(['pg_restore', '--list', str(backup / 'database.dump')], stdout=subprocess.DEVNULL, check=True)
    with tarfile.open(backup / 'web.tar.gz', 'w:gz') as web:
        web.add('/var/www/mg-expert-database/knowledge-base-inside', arcname='knowledge-base-inside')
    os.chmod(backup / 'web.tar.gz', 0o600)
    pending_env('/etc/mg-expert-database/api.env', backup / 'next-api.env')
    # 确认并无待引入的 Prisma schema 或迁移变化，才允许继续准备。
    for path in (source / 'apps/api/prisma').rglob('*'):
        if path.is_file() and (path.name == 'schema.prisma' or 'migrations' in path.parts):
            old = current / path.relative_to(source)
            if not old.is_file() or path.read_bytes() != old.read_bytes():
                raise SystemExit('Prisma 与线上不一致，需要重新审核迁移范围')
    child_env = dict(os.environ)
    child_env['PATH'] = '/opt/mg-expert-database/runtimes/node-v24.20.0-linux-x64/bin:' + child_env['PATH']
    subprocess.run(['pnpm', '--filter', '@mg-expert/api...', 'install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'], cwd=source, env=child_env, check=True)
    subprocess.run(['apps/api/node_modules/.bin/prisma', 'generate', '--schema', 'apps/api/prisma/schema.prisma'], cwd=source, env=child_env, check=True)
    subprocess.run(['node', '-e', 'const {createRequire}=require("node:module");const r=createRequire(process.cwd()+"/apps/api/package.json");r("yauzl");r("exceljs");r("@prisma/client");require("./apps/api/dist/apps/api/src/xlsx-import-worker.js")'], cwd=source, env=child_env, check=True)
print(json.dumps({'kind': kind, 'prepared': str(prepared), 'backup': str(backup), 'runningServicesChanged': False}))
