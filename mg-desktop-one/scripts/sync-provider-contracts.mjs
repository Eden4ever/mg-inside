import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalogPath='../mg-platform/packages/frontend/services/catalog.json';
const contractsPath='../mg-platform/packages/frontend/services/openapi-catalog.json';
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
const contracts={};
for(const app of ['mg-resource-one','mg-files-one','mg-office-one','mg-expert-database','mg-token-one/mg-gateway','mg-auth-one-identity']){
 const registration=JSON.parse(await readFile(`../${app}/services/registration.json`,'utf8'));
 const doc=JSON.parse(await readFile(`../${app}/services/openapi.json`,'utf8'));
 assert.deepEqual(doc,registration.contract);
 assert.equal(doc.info.version,registration.manifest.version);
 const index=catalog.findIndex(m=>m.serviceId===registration.manifest.serviceId);assert(index>=0);
 catalog[index]=registration.manifest;contracts[registration.manifest.serviceId]=doc;
 await writeFile(`../${app}/services/manifest.json`,JSON.stringify(registration.manifest,null,2)+'\n');
}
await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
await writeFile(contractsPath,JSON.stringify(contracts,null,2)+'\n');
console.log('资源、文件、Office、知识库、Token 和统一身份清单、登记包及初始目录契约已同步');
