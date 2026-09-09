"""为已构建的应用写入公开版本元数据；不包含主机配置或凭据。"""
from pathlib import Path
import hashlib, json, re, sys

def write_version(source, app_id, release):
    source = Path(source)
    assert re.fullmatch(r'[a-z0-9-]+', app_id)
    assert re.fullmatch(r'\d{8}T\d{6}Z', release)
    value = {'schemaVersion': 1, 'appId': app_id, 'version': release,
             'indexSHA256': hashlib.sha256((source / 'index.html').read_bytes()).hexdigest()}
    (source / 'version.json').write_text(json.dumps(value) + '\n', encoding='utf-8')

if __name__ == '__main__':
    write_version(*sys.argv[1:])
