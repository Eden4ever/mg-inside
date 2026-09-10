import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fromPublication,buildRegistration} from '../src/registration.ts';

test('编辑版本保留路径继承、扩展、公共引用与响应定义',()=>{
 const manifest:any={schemaVersion:1,serviceId:'files.api',appId:'files',name:'文件',version:'1.0.0',description:'',operations:[{operationId:'read',path:'/entries/{id}',method:'GET',summary:'读取',effect:'read'}]};
 const contract:any={openapi:'3.1.1',info:{title:'文件',version:'1.0.0'},paths:{'/entries/{id}':{summary:'资源',servers:[{url:'/files'}],'x-owner':'team',parameters:[{$ref:'#/components/parameters/Id'},{in:'query',name:'limit',schema:{type:'integer'},required:false}],get:{operationId:'read',summary:'读取',parameters:[{in:'query',name:'limit',schema:{type:'integer',maximum:10},required:true}],responses:{'200':{description:'成功'},'404':{description:'不存在'}},security:[{session:[]}]}}},components:{parameters:{Id:{in:'path',name:'id',required:true,schema:{type:'string'}}}}};
 const before=JSON.stringify(contract),draft=fromPublication(manifest,contract);draft.version='1.0.1';const result=buildRegistration(draft);
 assert.equal(JSON.stringify(contract),before);assert.equal(result.contract.paths['/entries/{id}']['x-owner'],'team');
 assert.deepEqual(result.contract.paths['/entries/{id}'].parameters,contract.paths['/entries/{id}'].parameters);
 assert.equal(result.contract.paths['/entries/{id}'].get.parameters.length,1);
 assert.deepEqual(result.contract.paths['/entries/{id}'].get.responses,contract.paths['/entries/{id}'].get.responses);
 assert.deepEqual(result.contract.components,contract.components);assert.equal(result.manifest.version,'1.0.1');
});
