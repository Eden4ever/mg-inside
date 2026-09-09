"""逐个构建、发布并核验公共壳应用；每个应用都保留独立发布版本。"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess, sys, urllib.request

app = sys.argv[1]
repos = {'service-manager':'mg-service-one', 'resource-manager': 'mg-resource-one', 'files': 'mg-files-one', 'office-one': 'mg-office-one',
         'personal-center': 'mg-personal-one', 'identity': 'mg-auth-one-identity/web', 'app-manager': 'mg-app-manager-one'}
repo = Path('..', repos[app]).resolve()
release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
log = Path('artifacts') / (app + '-' + release + '.log')
env = {**os.environ, 'VITE_APP_BASE': '/apps/' + app + '/', 'VITE_DESKTOP_ORIGIN': 'https://desktop.meta-gravity.com'}
print(app + '：开始类型检查与生产构建', flush=True)
with log.open('w', encoding='utf-8') as output:
    for args in [['node', 'node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'], ['node', 'node_modules/vite/bin/vite.js', 'build']]:
        subprocess.run(args, cwd=repo, env=env, stdout=output, stderr=subprocess.STDOUT, check=True)
package = json.loads(subprocess.check_output([sys.executable, 'scripts/package-static-app.py', app, str(repo / 'dist'), release], text=True))
subprocess.run(['scp', package['archive'], 'deploy/release-static-app.py', 'root@43.139.78.226:/tmp/'], check=True)
result = subprocess.check_output(['ssh', 'root@43.139.78.226', 'python3', '/tmp/release-static-app.py', release, app,
    '/tmp/' + Path(package['archive']).name, package['sha256']], text=True)
url = 'https://desktop.meta-gravity.com/apps/' + app + '/'
with urllib.request.urlopen(url + 'version.json', timeout=20) as response:
    metadata = json.load(response)
assert metadata['appId'] == app and metadata['version'] == release
with urllib.request.urlopen(url, timeout=20) as response:
    assert hashlib.sha256(response.read()).hexdigest() == metadata['indexSHA256']
with Path('artifacts/header-app-releases.jsonl').open('a', encoding='utf-8') as output:
    output.write(json.dumps({**metadata, 'url': url, 'archiveSHA256': package['sha256']}) + '\n')
print(result.strip(), flush=True)
print(app + '：已发布并验证 ' + release, flush=True)
