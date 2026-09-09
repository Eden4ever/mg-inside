import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const runtime=new URL('../.runtime/',import.meta.url);await mkdir(runtime,{recursive:true});
const source=new URL('../../mg-desktop-one/.runtime/local/',import.meta.url);
const env=parseEnv(await readFile(new URL('identity.env',source),'utf8'));
const database=new URL(env.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(database.hostname)||database.searchParams.get('schema')!=='mg_desktop_local_identity')throw Error('只允许修改隔离演示库');
let secret;try{secret=parseEnv(await readFile(new URL('documentserver.env',runtime),'utf8')).JWT_SECRET}catch{secret=randomBytes(48).toString('base64url')}
if(!secret||secret.length<32)throw Error('Office 密钥无效');
await writeFile(new URL('documentserver.env',runtime),`JWT_SECRET=${secret}\n`,{mode:0o600});
const original=parseEnv(await readFile(new URL('files.env',source),'utf8'));
const fileEnv={...original,FILES_HOST:'0.0.0.0',OFFICE_DOCUMENT_SERVER_URL:'http://127.0.0.1:14460',OFFICE_DOCUMENT_SERVER_INTERNAL_URL:'http://127.0.0.1:14460',OFFICE_CALLBACK_BASE:'http://host.docker.internal:14350',OFFICE_JWT_SECRET:secret};
await writeFile(new URL('files-office.env',runtime),Object.entries(fileEnv).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
const account=JSON.parse(await readFile(new URL('account.json',source),'utf8'));if(account.username!=='desktop-preview')throw Error('仅授权已确认的演示账号');
const Prisma=createRequire(new URL('../../mg-auth-one-identity/package.json',import.meta.url))('@prisma/client').PrismaClient;
const db=new Prisma({datasources:{db:{url:env.DATABASE_URL}}});
try{const user=await db.user.findUniqueOrThrow({where:{username:account.username}});await db.application.upsert({where:{clientId:'office-one'},create:{clientId:'office-one',name:'Office One',enabled:true},update:{}});await db.applicationUser.upsert({where:{clientId_userId:{clientId:'office-one',userId:user.id}},create:{clientId:'office-one',userId:user.id,enabled:true},update:{enabled:true}});}finally{await db.$disconnect()}
console.log('Office 本地专用密钥与演示账号授权已配置；未输出密钥。');
