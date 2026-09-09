"""旧地址只转发至新主机，避免 DNS 缓存命中旧服务形成双写。"""
import pathlib,shutil,subprocess
root=pathlib.Path('/etc/nginx/conf.d')
backup=pathlib.Path('/opt/mg-desktop/backups/migrate-20260908T154000Z/nginx-before-forward')
assert not backup.exists();backup.mkdir(mode=0o700)
for service in ('desktop','identity'):
    path=root/f'{service}.meta-gravity.conf';shutil.copy2(path,backup/path.name)
    domain=f'{service}.meta-gravity.com'
    path.write_text(f'''server {{
    listen 80;
    server_name {domain};
    location / {{ return 308 https://{domain}$request_uri; }}
}}
server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    access_log off;
    client_max_body_size 50m;
    location / {{
        proxy_pass https://43.139.78.226;
        proxy_ssl_server_name on;
        proxy_ssl_name {domain};
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 5;
        proxy_ssl_trusted_certificate /etc/pki/tls/certs/ca-bundle.crt;
        proxy_set_header Host {domain};
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_request_buffering off;
        proxy_buffering off;
    }}
}}
''')
subprocess.run(['nginx','-t'],check=True)
subprocess.run(['systemctl','reload','nginx'],check=True)
print('旧主机桌面与身份域名已转发至新主机；原容器保持停止。')
