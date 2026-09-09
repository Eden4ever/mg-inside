import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=resolve(root,'.runtime/credentials');
await mkdir(dir,{recursive:true,mode:0o700});
const config=JSON.parse(await readFile(resolve(root,'server/resources.json'),'utf8'));
const collector=(await readFile(resolve(root,'scripts/collector.py'),'utf8')).replaceAll('\r\n','\n');
const known=[];
for(const resource of config.resources){
 const key=resolve(dir,resource.credential);
 try{await access(key)}catch{execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-C',`mg-resource-${resource.credential}`,'-f',key],{windowsHide:true,stdio:'pipe'})}
 if(process.platform==='win32')execFileSync('icacls',[key,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`],{stdio:'pipe',windowsHide:true});
 const pub=(await readFile(key+'.pub','utf8')).trim();
 const pin=execFileSync('ssh-keygen',['-F',resource.host],{encoding:'utf8',windowsHide:true}).split('\n').filter(line=>line&&!line.startsWith('#')).join('\n');
 if(!pin)throw new Error('主机尚未经过可信 SSH 主机指纹验证');known.push(pin);
 const script=`set -eu
test -x /usr/bin/python3
test -x /usr/bin/sudo
if ! id mg-resource >/dev/null 2>&1; then useradd --system --create-home --shell /bin/sh mg-resource; fi
test "$(id -u mg-resource)" != 0
install -d -m 700 -o mg-resource -g mg-resource /home/mg-resource/.ssh
cat > /usr/local/sbin/mg-resource-collect <<'MG_COLLECTOR'
${collector}
MG_COLLECTOR
chown root:root /usr/local/sbin/mg-resource-collect
chmod 755 /usr/local/sbin/mg-resource-collect
printf '%s\\n' 'mg-resource ALL=(root) NOPASSWD: /usr/local/sbin/mg-resource-collect ""' > /etc/sudoers.d/mg-resource
chmod 440 /etc/sudoers.d/mg-resource
visudo -cf /etc/sudoers.d/mg-resource >/dev/null
cat > /home/mg-resource/.ssh/authorized_keys <<'MG_KEY'
restrict,command="/usr/bin/sudo -n /usr/local/sbin/mg-resource-collect" ${pub}
MG_KEY
chown mg-resource:mg-resource /home/mg-resource/.ssh/authorized_keys
chmod 600 /home/mg-resource/.ssh/authorized_keys
echo collector-ready
`;
 const run=spawnSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',`root@${resource.host}`,'sh','-s'],{input:script,encoding:'utf8',timeout:30000,windowsHide:true});
 if(run.status!==0)throw new Error(`采集器安装失败：${resource.host}，${run.stderr}`);
 console.log(`${resource.host}：专用固定采集器已安装`);
}
await writeFile(resolve(dir,'known_hosts'),known.join('\n')+'\n',{mode:0o600});
console.log('专用凭据已保存至受限 .runtime/credentials，未输出私钥。');
