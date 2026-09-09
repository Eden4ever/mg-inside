import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const base=new URL('../.runtime/local/',import.meta.url),env=parseEnv(await readFile(new URL('identity.env',base),'utf8'));
const url=new URL(env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.searchParams.get('schema')!=='mg_desktop_local_identity')throw Error('仅允许隔离体验库');
const path=new URL('identity.json',base),config=JSON.parse(await readFile(path,'utf8'));
if(!config.clients.some(c=>c.client_id==='service-manager')){
  config.clients.push({client_id:'service-manager',client_name:'服务管理',client_secret:randomBytes(32).toString('hex'),redirect_uris:['http://127.0.0.1:14381/']});
  await writeFile(path,JSON.stringify(config,null,2),{mode:0o600});
}
const Prisma=createRequire(new URL('../../mg-auth-one-identity/package.json',import.meta.url))('@prisma/client').PrismaClient;
const db=new Prisma({datasources:{db:{url:env.DATABASE_URL}}});
try{
  await db.application.upsert({where:{clientId:'service-manager'},create:{clientId:'service-manager',name:'服务管理'},update:{}});
  const role=await db.role.findUniqueOrThrow({where:{key:'platform-admin'}});
  await db.roleApplication.upsert({where:{roleId_clientId:{roleId:role.id,clientId:'service-manager'}},create:{roleId:role.id,clientId:'service-manager',enabled:true},update:{enabled:true}});
}finally{await db.$disconnect()}
console.log('服务管理已登记到隔离身份环境');
