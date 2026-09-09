import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const base=new URL('../.runtime/local/',import.meta.url);
const env=parseEnv(await readFile(new URL('identity.env',base),'utf8'));
const url=new URL(env.DATABASE_URL);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.get('schema')!=='mg_desktop_local_identity')throw Error('仅允许隔离体验库');
const path=new URL('identity.json',base),config=JSON.parse(await readFile(path,'utf8'));
let client=config.clients.find(c=>c.client_id==='resource-manager');
if(!client){client={client_id:'resource-manager',client_name:'资源管理',client_secret:randomBytes(32).toString('hex'),redirect_uris:['http://127.0.0.1:14371/']};config.clients.push(client);await writeFile(path,JSON.stringify(config,null,2),{mode:0o600});}
const target=new URL('../../mg-resource-one/.runtime/',import.meta.url);await mkdir(target,{recursive:true});
await writeFile(new URL('resource.env',target),`IDENTITY_ENABLED=true\nIDENTITY_ISSUER=http://127.0.0.1:14200\nIDENTITY_CLIENT_ID=resource-manager\nIDENTITY_CLIENT_SECRET=${client.client_secret}\nRESOURCE_PORT=14370\n`,{mode:0o600});
const Prisma=createRequire(new URL('../../mg-auth-one-identity/package.json',import.meta.url))('@prisma/client').PrismaClient;
const db=new Prisma({datasources:{db:{url:env.DATABASE_URL}}});
try{const user=await db.user.findUniqueOrThrow({where:{username:'desktop-preview'}});await db.application.upsert({where:{clientId:'resource-manager'},create:{clientId:'resource-manager',name:'资源管理'},update:{}});await db.applicationUser.upsert({where:{clientId_userId:{clientId:'resource-manager',userId:user.id}},create:{clientId:'resource-manager',userId:user.id,enabled:true},update:{enabled:true}});}finally{await db.$disconnect()}
console.log('资源管理已接入隔离体验身份中心；未输出凭据。');
