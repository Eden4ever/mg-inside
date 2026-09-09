"""按 Token 的公开目录、账户目录控制器生成契约，不纳入收费推理接口。"""
from pathlib import Path
import json

root=Path('../mg-token-one/mg-gateway/services')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
manifest['version']='1.2.0'
string={'type':'string'}
boolean={'type':'boolean'}
integer={'type':'integer'}
nullable={'type':['string','null']}
def array(items):return {'type':'array','items':items}
def obj(properties,required=None):return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':False}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def response(schema,description):return {'description':description,'content':{'application/json':{'schema':schema}}}

public={'name':string,'contextLength':integer,'maxOutputTokens':integer}
public.update({field:boolean for field in ['supportsVision','supportsTools','supportsReasoning','supportsResponses','supportsAnthropic']})
public.update({'reasoningEfforts':nullable,'inputModalities':array(string),'outputModalities':array(string)})
schemas={
 'PublicModel':obj(public),
 'AccountModel':obj({**public,'groupTag':string,'remark':nullable,'visionNotes':nullable,'groupNames':array(string)}),
 'PublicModels':obj({'list':array(ref('PublicModel'))}),
 'AccountModels':obj({'list':array(ref('AccountModel'))}),
 'GatewayError':obj({'error':obj({'message':{'anyOf':[string,array(string)]},'status_code':{'type':'integer','minimum':400,'maximum':599},'request_id':string},['message','status_code'])}),
 'OutletError':obj({'message':string}),
 'Error':{'anyOf':[ref('GatewayError'),ref('OutletError')]},
}
doc={'openapi':'3.1.1','jsonSchemaDialect':'https://json-schema.org/draft/2020-12/schema','info':{
 'title':manifest['name'],'version':manifest['version'],'description':'Token 的两个只读模型目录，返回原始 {list}。能力字段反映后台配置，不保证实时路由健康、账户额度或 sk- 令牌调用权限。本批不登记 /v1 推理、计费或管理写接口。'},
 'x-service-id':manifest['serviceId'],'x-app-id':manifest['appId'],'servers':[{'url':'/api'}],
 'security':[{'unifiedSession':[]}],'paths':{},'components':{'schemas':schemas,'securitySchemes':{
 'unifiedSession':{'type':'http','scheme':'bearer','description':'统一出口转发当前用户身份，提供方校验 token-one 应用授权并读取本地角色和分组；不使用 sk- 推理令牌。'}}}}
descriptions={
 'portal-models':'当前账户可见的启用模型，按模型 ID 升序。管理员可见全部；普通账户按用户分组与模型分组交集过滤，没有用户分组时使用 default。模型分组来自分组配置，旧 NULL 配置兼容 groupTag。返回空 list 表示没有可见模型。每次查询读取当前角色和分组，不信任浏览器提交的角色。上下文或输出限制 0 表示未标注；空模态配置默认 text。',
 'models':'公开能力目录，按模型 ID 升序返回全部启用模型；提供方原始 /api/public/models 允许匿名读取。经桌面统一出口时仍需平台会话及相应应用授权，文档入口的独立授权不因此扩大。公开响应不包含分组、价格、渠道绑定、备注或上游模型名。无分页、搜索或模型分组参数。'}
for item in manifest['operations']:
 op={'operationId':item['operationId'],'summary':item['summary'],'description':descriptions[item['operationId']],'responses':{
  '200':response(ref('AccountModels' if item['operationId']=='portal-models' else 'PublicModels'),'读取成功；不产生模型推理调用'),
  '401':response(ref('Error'),'未登录、身份无法验证或账户映射失败；公开提供方接口本身不要求登录'),
  '403':response(ref('Error'),'统一出口拒绝应用权限或来源'),
  '500':response(ref('Error'),'提供方未完成查询'),
  '502':response(ref('Error'),'统一出口无法连接提供方'),
  '503':response(ref('Error'),'身份服务不可用、服务未启用或提供方未配置'),
 }}
 if item['operationId']=='models':op['security']=[]
 doc['paths'][item['path']]={'get':op}
for name,value in [('openapi.json',doc),('registration.json',{'manifest':manifest,'contract':doc})]:
 (root/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Token 1.2.0 两个目录契约已生成，尚未修改生产启用状态。')
