"""在新服务器建立独立服务目录数据库，不访问身份/文件业务数据库。"""
from pathlib import Path
import json,os,secrets,subprocess

root=Path('/opt/mg-service-registry');secret_dir=Path('/opt/mg-desktop/secrets')
assert secret_dir.is_dir()
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def private(path,text):
 with path.open('x') as file:file.write(text)
 path.chmod(0o600)

if root.exists():
 assert (root/'provisioned.json').is_file(),'已有目录尚未完成准备，请检查实际状态'
 assert json.loads((root/'provisioned.json').read_text())['database']=='mg_services'
 print('独立服务数据库已准备，沿用现有私密配置。')
else:
 root.mkdir(mode=0o700);(root/'secrets').mkdir(mode=0o700)
 owner=secrets.token_hex(32);runtime=secrets.token_hex(32)
 image=subprocess.check_output(['docker','image','inspect','postgres:17-alpine','--format','{{index .RepoDigests 0}}'],text=True).strip()
 assert image.startswith('postgres@sha256:')
 private(root/'secrets/db.env',f'POSTGRES_USER=registry_owner\nPOSTGRES_PASSWORD={owner}\nPOSTGRES_DB=mg_services\n')
 private(root/'secrets/admin.env',f'SERVICE_DATABASE_URL=postgresql://registry_owner:{owner}@127.0.0.1:15440/mg_services\nSERVICE_ENVIRONMENT=production\n')
 private(secret_dir/'services.env',f'SERVICE_DATABASE_URL=postgresql://registry_app:{runtime}@127.0.0.1:15440/mg_services\nSERVICE_ENVIRONMENT=production\n')
 (root/'compose.yaml').write_text(f'''name: mg-service-registry
services:
  db:
    image: {image}
    restart: unless-stopped
    env_file: ./secrets/db.env
    ports: ["127.0.0.1:15440:5432"]
    volumes: ["./data:/var/lib/postgresql/data"]
    mem_limit: 512m
    cpus: 1
    command: ["postgres", "-c", "max_connections=50", "-c", "shared_buffers=64MB"]
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U registry_owner -d mg_services"]
      interval: 5s
      timeout: 3s
      retries: 12
    logging:
      driver: json-file
      options: {{max-size: "10m", max-file: "3"}}
''')
 run(['docker','compose','-f',str(root/'compose.yaml'),'up','-d','--wait','--wait-timeout','90'])
 sql=f"CREATE ROLE registry_app LOGIN PASSWORD '{runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE; REVOKE ALL ON DATABASE mg_services FROM PUBLIC; GRANT CONNECT ON DATABASE mg_services TO registry_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO registry_app;"
 run(['docker','exec','-i','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-v','ON_ERROR_STOP=1'],input=sql,text=True,stdout=subprocess.DEVNULL)
 (root/'provisioned.json').write_text(json.dumps({'database':'mg_services','role':'registry_app','image':image,'port':15440}))
 print('独立服务数据库和受限运行账号已准备；只绑定 loopback，未迁移或切换目录。')
