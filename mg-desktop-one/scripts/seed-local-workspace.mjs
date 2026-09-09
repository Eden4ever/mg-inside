import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const env = parseEnv(await readFile('.runtime/local/expert.env','utf8'));
const url = new URL(env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '5437' || url.searchParams.get('schema') !== 'mg_desktop_local_expert') throw new Error('只允许独立桌面体验 Schema');
Object.assign(process.env, env);
const outputPath = resolve('.runtime/local/workspace.json');
const apiRoot = resolve('../mg-expert-database/apps/api');
const require = createRequire(resolve(apiRoot, 'package.json'));
process.chdir(apiRoot);
const { PrismaClient } = require('@prisma/client');
const { CatalogService } = require('./dist/apps/api/src/catalog.service.js');
const { SystemAccessService } = require('./dist/apps/api/src/system-access.js');
const { TemplatesService } = require('./dist/apps/api/src/templates.service.js');
const db = new PrismaClient();
try {
  const user = await db.user.findUniqueOrThrow({where:{username:'desktop-preview'}});
  const access = new SystemAccessService(db), templates = new TemplatesService(db, access);
  const catalog = new CatalogService(templates, db, access);
  // 仅由开发种子创建演示内容；不提升用户的业务平台角色。
  const actor = {userId:user.id,name:'本地桌面演示种子',role:'system_admin'};
  let system = await db.indicatorSystem.findUnique({where:{code:'DESKTOP-PREVIEW-ONLY'}});
  if(!system) system=await catalog.createSystem({name:'桌面体验示例 · 非业务数据',code:'DESKTOP-PREVIEW-ONLY',region:'本地演示',maxLevel:1},actor);
  const version=await db.indicatorVersion.findFirstOrThrow({where:{systemId:system.id}});
  let node=await db.indicatorNode.findFirst({where:{versionId:version.id}});
  if(!node)node=await catalog.createNode(version.id,{level:1,name:'公共服务便利度',code:'DEMO-001'},actor);
  const template=await db.indicatorLevelTemplate.findUniqueOrThrow({where:{systemId_level:{systemId:system.id,level:1}}});
  const module=template.modules[0], field=module.fields.find(f=>['short_text','long_text','rich_text'].includes(f.fieldType));
  await writeFile(outputPath,JSON.stringify({systemId:system.id,versionId:version.id,nodeId:node.id,path:`/systems/${version.id}/indicators/${node.id}`,moduleKey:module.moduleKey,fieldId:field.fieldId,fieldLabel:field.label}));
  console.log('本地桌面示例体系已准备，原业务平台角色保持不变。');
}finally{await db.$disconnect()}
