"""安装已核验字体到 Office Data 持久卷，并刷新编辑器与转换器字体索引。"""
from pathlib import Path
import hashlib, json, re, subprocess, sys, tarfile

release, archive_name, digest = sys.argv[1:]
assert re.fullmatch(r'\d{8}T\d{6}Z', release)
archive = Path(archive_name)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest
container = 'mg-office-engine-documentserver-1'
root = '/var/www/onlyoffice/documentserver'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

state = json.loads(run('docker', 'inspect', container))[0]
assert state['State']['Health']['Status'] == 'healthy'
mount = next(item for item in state['Mounts'] if item['Destination'] == '/var/www/onlyoffice/Data')
assert mount['Type'] == 'volume' and mount['Name'] == 'mg-office-engine_office_data'
data = Path(mount['Source']).resolve(strict=True)
target = data / 'custom-fonts' / 'mg-chinese-fonts'
assert not target.exists(), '已安装字体，请先核对现有清单，不能覆盖已有发布'
backup = Path('/opt/mg-office/backups') / ('fonts-' + release)
backup.mkdir(parents=True, exist_ok=False)
stage = backup / 'package'
stage.mkdir()
with tarfile.open(archive) as package:
    for member in package.getmembers():
        assert member.isfile() and Path(member.name).name == member.name
        assert member.name in {'manifest.json', 'fz-xiaobiaosong.ttf', 'fangsong-gb2312.ttf', 'kaiti-gb2312.ttf', 'simhei.ttf', 'simsun.ttc'}
        (stage / member.name).write_bytes(package.extractfile(member).read())
manifest = json.loads((stage / 'manifest.json').read_text())
assert len(manifest['files']) == 5
for item in manifest['files']:
    assert hashlib.sha256((stage / item['file']).read_bytes()).hexdigest() == item['sha256']
run('docker', 'exec', container, 'tar', '-czf', '/tmp/mg-fonts-before-' + release + '.tgz', '-C', root,
    'sdkjs/common/AllFonts.js', 'sdkjs/common/Images', 'server/FileConverter/bin/AllFonts.js',
    'server/FileConverter/bin/font_selection.bin', 'fonts')
run('docker', 'cp', container + ':/tmp/mg-fonts-before-' + release + '.tgz', str(backup / 'generated-before.tgz'))
try:
    target.mkdir(parents=True)
    for path in stage.iterdir():
        (target / path.name).write_bytes(path.read_bytes())
        (target / path.name).chmod(0o644)
    # 引擎脚本本身扫描 Data/custom-fonts，使用已有命名卷，容器重建后仍保留。
    result = run('docker', 'exec', container, '/usr/bin/documentserver-generate-allfonts.sh')
    (backup / 'generation.log').write_text(result + '\n')
    generated = run('docker', 'exec', container, 'cat', root + '/sdkjs/common/AllFonts.js')
    required = ['FZXiaoBiaoSong-B05S', 'FangSong_GB2312', 'KaiTi_GB2312', 'SimHei', 'SimSun']
    assert all(name in generated for name in required), '字体索引未包含全部目标字体'
    assert run('docker', 'exec', container, 'curl', '-fsS', 'http://127.0.0.1/healthcheck') == 'true'
    (backup / 'installed.json').write_text(json.dumps({'release': release, 'archiveSHA256': digest, 'families': required, 'persistentPath': str(target), **manifest}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'installed': required, 'backup': str(backup), 'persistent': True, 'healthy': True}))
except Exception:
    # 保留失败字体包与日志，回退只移动本脚本新建的目录。
    if target.exists():
        target.rename(backup / 'failed-fonts')
    run('docker', 'exec', container, '/usr/bin/documentserver-generate-allfonts.sh')
    raise
