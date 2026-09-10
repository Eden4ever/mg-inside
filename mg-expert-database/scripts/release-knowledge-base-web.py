"""在服务器上发布知识库前端：校验全部文件摘要后原子切换，保留上一版本以便回滚。"""
from pathlib import Path
import hashlib, json, os, re, shutil, sys, tarfile

release, filename, expected = sys.argv[1:]
assert re.fullmatch(r'\d{8}T\d{6}Z', release)
archive = Path(filename)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, '发布包摘要不一致'
parent = Path('/var/www/mg-expert-database')
current = parent / 'knowledge-base-inside'
staged = parent / ('.knowledge-base-inside.' + release + '.next')
previous = parent / ('.knowledge-base-inside.' + release + '.previous')
assert current.is_dir() and not staged.exists() and not previous.exists()

staged.mkdir()
with tarfile.open(archive) as package:
    for item in package.getmembers():
        path = Path(item.name)
        assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
    package.extractall(staged, filter='data')
manifest = json.loads((staged / 'build-checksums.json').read_text())
for name, digest in manifest.items():
    file = staged / name
    assert file.resolve().is_relative_to(staged.resolve())
    assert hashlib.sha256(file.read_bytes()).hexdigest() == digest, name
(staged / 'build-checksums.json').unlink()
# 保留旧版本的哈希资源，已打开页面的旧 index 仍能取到自己的脚本。
carried = 0
for file in current.rglob('*'):
    if not file.is_file() or file.is_symlink():
        continue
    target = staged / file.relative_to(current)
    if target.exists():
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, target)
    carried += 1
os.chmod(staged, 0o755)
for path in staged.rglob('*'):
    os.chmod(path, 0o755 if path.is_dir() else 0o644)

current.rename(previous)
try:
    staged.rename(current)
except Exception:
    previous.rename(current)
    raise
print(json.dumps({'release': release, 'filesVerified': len(manifest), 'filesCarried': carried, 'previous': str(previous)}))
