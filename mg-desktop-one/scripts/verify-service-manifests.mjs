import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalog=JSON.parse(await readFile('../mg-platform/packages/frontend/services/catalog.json','utf8'));
const paths={ 'resource-manager':'../mg-resource-one/services/manifest.json',files:'../mg-files-one/services/manifest.json','office-one':'../mg-office-one/services/manifest.json','expert-database':'../mg-expert-database/services/manifest.json','token-one':'../mg-token-one/mg-gateway/services/manifest.json',identity:'../mg-auth-one-identity/services/manifest.json'};
for(const manifest of catalog){assert(paths[manifest.appId]);assert.deepEqual(manifest,JSON.parse(await readFile(paths[manifest.appId],'utf8')))}
const contracts=JSON.parse(await readFile('../mg-platform/packages/frontend/services/openapi-catalog.json','utf8'));
for(const app of ['resource-manager','files','office-one','expert-database','token-one','identity']){
 const dir=paths[app].replace('/manifest.json','');const manifest=catalog.find(m=>m.appId===app);
 const contract=JSON.parse(await readFile(dir+'/openapi.json','utf8'));
 assert.deepEqual(JSON.parse(await readFile(dir+'/registration.json','utf8')),{manifest,contract});
 assert.deepEqual(contracts[manifest.serviceId],contract);assert.equal(contract.info.version,manifest.version);
}
console.log(`${catalog.length} 个应用服务清单与公共目录一致，共 ${catalog.reduce((n,m)=>n+m.operations.length,0)} 个接口`);
