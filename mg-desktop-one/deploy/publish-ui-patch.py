"""发布业务前端补丁：保留在线业务后端、数据库、密钥及环境配置。"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

kind, release, archive, expected_sha = sys.argv[1:]
assert kind in ('token', 'expert') and re.fullmatch(r'\d{8}T\d{6}Z', release)
archive = pathlib.Path(archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected_sha, '归档校验失败'
root = pathlib.Path('/opt/mg-gateway' if kind == 'token' else '/opt/mg-expert-database')
prepared = root / 'prepared' / ('ui-' + release)
backup = root / 'backups' / ('ui-' + release)
assert not prepared.exists() and not backup.exists(), '版本已存在'
prepared.mkdir(parents=True)
backup.mkdir(parents=True, mode=0o700)
with tarfile.open(archive) as source:
    for member in source.getmembers():
        path = pathlib.PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts and (member.isdir() or member.isfile())
    source.extractall(prepared)
assert (prepared / 'index.html').is_file()

def check_health(url):
    for _ in range(45):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('健康检查失败，保留备份并停止后续发布')

if kind == 'token':
    current = json.loads(subprocess.check_output(['docker', 'inspect', 'mg-gateway']))[0]
    image_id = current['Image']
    (backup / 'previous-image').write_text(image_id + '\n')
    for name in ('docker-compose.yml', 'mg-gateway.env', 'identity-client.env'):
        if (root / name).exists():
            shutil.copy2(root / name, backup / name)
            os.chmod(backup / name, 0o600)
    config_hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ('mg-gateway.env', 'identity-client.env') if (root / name).exists()}
    # 使用生产当前镜像作为基础，只替换静态前端。
    dockerfile = prepared / 'Dockerfile.ui'
    dockerfile.write_text('FROM ' + image_id + '\nCOPY . /app/web-dist/\n')
    (prepared / '.dockerignore').write_text('Dockerfile.ui\n.dockerignore\n')
    tag = 'mg-gateway:ui-' + release
    assert subprocess.run(['docker', 'image', 'inspect', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0
    subprocess.run(['docker', 'build', '-f', str(dockerfile), '-t', tag, str(prepared)], check=True)
    override = root / ('ui-' + release + '.yaml')
    assert not override.exists()
    override.write_text('services:\n  gateway:\n    image: ' + tag + '\n')
    subprocess.run(['docker', 'compose', '-f', 'docker-compose.yml', '-f', str(override), 'up', '-d', '--no-build', 'gateway'], cwd=root, check=True)
    check_health('http://127.0.0.1:3001/api/health/live')
    check_health('http://127.0.0.1:3001/api/health/ready')
    for name, digest in config_hashes.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, '业务配置发生变化'
    # 保存当前前端版本引用，便于日后常规 compose up 继续使用本次版本。
    (root / 'active-ui-override').write_text(str(override) + '\n')
else:
    web = pathlib.Path('/var/www/mg-expert-database/knowledge-base-inside')
    current = (root / 'current').resolve()
    (backup / 'previous-release').write_text(str(current) + '\n')
    with tarfile.open(backup / 'web.tar.gz', 'w:gz') as output:
        output.add(web, arcname='knowledge-base-inside')
    os.chmod(backup / 'web.tar.gz', 0o600)
    # 先增加带摘要的资源，再原子替换首页；旧资源保留，已打开页面仍可继续使用。
    for source in prepared.rglob('*'):
        if not source.is_file() or source.name == 'index.html':
            continue
        relative = source.relative_to(prepared)
        target = web / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() == source.read_bytes():
            continue
        if relative.parts[0] == 'assets' and target.exists():
            raise RuntimeError('同名摘要资源内容不一致')
        temporary = target.with_name(target.name + '.' + release + '.next')
        shutil.copy2(source, temporary)
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    temporary = web / ('.index.' + release + '.next')
    shutil.copy2(prepared / 'index.html', temporary)
    os.chmod(temporary, 0o644)
    os.replace(temporary, web / 'index.html')
    assert (root / 'current').resolve() == current, '业务后端版本不应变化'
    check_health('http://127.0.0.1:4100/api/health')

record = {'kind': kind, 'release': release, 'archiveSha256': expected_sha, 'health': 'passed', 'backendChanged': False, 'backup': str(backup)}
(backup / 'result.json').write_text(json.dumps(record, indent=2))
print(json.dumps(record))
