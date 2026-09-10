"""将同级应用导出到新的源码快照目录；不搬动原项目与各自 Git 历史。"""
from pathlib import Path
import argparse, hashlib, json, os, shutil

projects = ['mg-platform','mg-platform-kernel','mg-desktop-one','mg-service-one','mg-resource-one','mg-files-one','mg-office-one','mg-personal-one','mg-app-manager-one','mg-auth-one-identity','mg-security-one','mg-zentao-sso','mg-expert-database','mg-token-one']
skip_dirs = {'.git','node_modules','dist','build','.runtime','private','secrets','artifacts','backups','coverage','.pnpm-store','.deploy-deps','.tools','.workbuddy','.claude','.codex','.agents','sshpass-1.10','test-results','playwright-report','__pycache__','.pytest_cache','.venv','venv'}
skip_dirs.update({'target','.idea'})
skip_suffixes = ('.log','.tsbuildinfo','.pem','.key','.p12','.pfx','.sqlite','.sqlite3','.db','.db-journal','.zip','.tar','.tar.gz','.tgz','.sql.gz','.bak','.class','.jar','.dump')

def candidates(source):
    for project in projects:
        for base, dirs, names in os.walk(source/project):
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.tmp-') and not (Path(base)/d).is_symlink()]
            for name in names:
                path = Path(base)/name
                if path.is_symlink() or name.startswith('._') or name in {'.DS_Store','.npmrc','.git'}: continue
                if name.startswith('.env') and name != '.env.example': continue
                if name.lower().endswith(skip_suffixes): continue
                relative = path.relative_to(source)
                # 旧 Token 根目录中的一次性诊断/部署脚本，以及人工账号种子，不属于可复用应用源码。
                if project == 'mg-token-one' and ((len(relative.parts)==2 and path.suffix=='.py') or name=='seed-admin.js' or relative.parts[1]=='diagnostics'): continue
                yield relative, path

parser=argparse.ArgumentParser()
parser.add_argument('destination',type=Path)
args=parser.parse_args()
source=Path(__file__).resolve().parents[2]
destination=args.destination.resolve()
assert not destination.exists(), '导出目标必须是全新目录，禁止覆盖已有工作'
assert destination!=source and source not in destination.parents, '导出目录不能位于源工作区内'
destination.mkdir(parents=True)
inventory=[]
for relative,path in candidates(source):
    output=destination/relative;output.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,output)
    inventory.append({'path':relative.as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
(destination/'SOURCE_SNAPSHOT.json').write_text(json.dumps({'schemaVersion':1,'projects':projects,'files':inventory},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'directory':str(destination),'projects':len(projects),'files':len(inventory),'bytes':sum(item['bytes'] for item in inventory)},ensure_ascii=False))
