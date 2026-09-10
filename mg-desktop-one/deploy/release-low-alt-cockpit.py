"""增量发布跨服务器低空驾驶舱入口，不改 Files、业务数据库或其他应用。"""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile

root = Path('/opt/mg-desktop')
release, archive_name, expected = sys.argv[1:]
archive = Path(archive_name)
assert re.fullmatch(r'\d{8}T\d{6}Z', release)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, '归档校验失败'
previous = (root / 'current').resolve(strict=True)
assert previous.is_relative_to(root / 'releases')
target = root / 'releases' / release
backup = root / 'backups' / ('low-alt-cockpit-' + release)
assert not target.exists() and not backup.exists()
backup.mkdir(mode=0o700)
os.umask(0o077)

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def image(container):
    return subprocess.check_output(['docker', 'inspect', container, '--format', '{{.Config.Image}}']).decode().strip()

old_desktop = image('mg-desktop-desktop-1')
old_files = image('mg-desktop-files-1')
nginx = Path('/etc/nginx/conf.d/desktop.meta-gravity.conf')
shutil.copy2(nginx, backup / 'nginx.conf')
(backup / 'previous.json').write_text(json.dumps({'release': str(previous), 'desktopImage': old_desktop, 'filesImage': old_files}))
shutil.copytree(previous, target)
with tarfile.open(archive) as package:
    for member in package.getmembers():
        path = Path(member.name)
        assert not path.is_absolute() and '..' not in path.parts and (member.isfile() or member.isdir())
    package.extractall(target, filter='data')

for required in ['desktop/main.mjs', 'desktop/web/index.html', 'kernel/app.jar', 'application-catalog.json',
                 'deploy/nginx-desktop.conf']:
    assert (target / required).is_file(), f'缺少 {required}'
assert 'low-alt-cockpit' in (target / 'application-catalog.json').read_text()
dockerfile = target / 'deploy/low-alt-cockpit.Dockerfile'
dockerfile.write_text(f'FROM {old_desktop}\nCOPY desktop/main.mjs /app/main.mjs\nCOPY desktop/web /app/web\nCOPY kernel/app.jar /app/app.jar\nCOPY application-catalog.json /app/application-catalog.json\n')
run(['docker', 'build', '-t', 'mg-desktop-service:' + release, '-f', str(dockerfile), str(target)])
run(['docker', 'tag', old_files, 'mg-files-service:' + release])
compose = ['docker', 'compose', '-f', str(target / 'deploy/compose.yaml')]

try:
    run(compose + ['up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '120', 'desktop'],
        env={**os.environ, 'RELEASE_ID': release})
    link = root / ('.current-' + release + '.next')
    link.symlink_to(target)
    link.replace(root / 'current')
    shutil.copyfile(target / 'deploy/nginx-desktop.conf', nginx)
    run(['nginx', '-t'])
    run(['systemctl', 'reload', 'nginx'])
    run(['curl', '--noproxy', '*', '-fsS', '--retry', '5', '--retry-delay', '2',
         '--resolve', 'desktop.meta-gravity.com:443:127.0.0.1', 'https://desktop.meta-gravity.com/api/health'])
    run(['curl', '--noproxy', '*', '-fsS', 'https://lowalt.meta-gravity.com/cockpit/'], stdout=subprocess.DEVNULL)
    print(json.dumps({'release': release, 'previous': str(previous), 'desktop': 'healthy', 'cockpitEntry': 'remote-healthy'}))
except Exception:
    shutil.copyfile(backup / 'nginx.conf', nginx)
    rollback = root / ('.rollback-' + release + '.next')
    rollback.symlink_to(previous)
    rollback.replace(root / 'current')
    run(['docker', 'compose', '-f', str(previous / 'deploy/compose.yaml'), 'up', '-d', '--no-deps', '--no-build', '--wait', 'desktop'],
        env={**os.environ, 'RELEASE_ID': old_desktop.split(':')[-1]})
    run(['nginx', '-t'])
    run(['systemctl', 'reload', 'nginx'])
    raise
