"""生成统一身份的本人资料契约，不扩大管理应用授权。"""
from pathlib import Path
import json

root=Path('../mg-auth-one-identity/services')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
manifest['version']='1.1.0'
def obj(properties, required=None):
 return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':False}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def response(schema,description):return {'description':description,'content':{'application/json':{'schema':schema}}}
string={'type':'string'}
nullable={'type':['string','null']}
schemas={
 'Role':obj({'id':string,'key':nullable,'name':string}),
 'CurrentUser':obj({'userId':string,'username':nullable,'name':string,'departmentName':nullable,'avatarUrl':nullable,
  'role':{'type':'string','enum':['system_admin','member'],'description':'由当前角色集合计算的兼容字段；不是历史 User.role 列。'},
  'roles':{'type':'array','items':ref('Role')},'authSource':string,
  'identityAuthorized':{'type':'boolean','description':'当前统一身份应用有效授权；不等于平台管理员角色。管理入口同时要求管理员角色与应用授权。'}}),
 'CurrentIdentity':obj({'user':ref('CurrentUser'),'csrfToken':{'type':'string','readOnly':True,'description':'当前会话的 CSRF 防护值，仅用于当前账户写请求。敏感字段，不得写入日志、共享示例或公共缓存。'}}),
 'Error':obj({'message':string,'error':string,'statusCode':{'type':'integer','minimum':400,'maximum':599}},['message']),
}
description='只读取请求会话对应的本人资料，不接受目标账户参数。每次读取当前角色与应用授权；撤销会话、账户停用、会话过期或安全版本变化后返回 401。提供方允许任意有效中心会话读取本人资料（基础身份能力），无需 identity 管理应用授权；经当前已登记的 identity 统一出口调用时，仍要求 identity 应用授权及平台管理员角色，不据此扩大管理权限。Bearer 显式提供时优先且必须有效，不回退到 Cookie。读取可能刷新会话活动时间，不修改用户资料。响应不含密码哈希、访问令牌、会话 ID、安全凭据或其他账户数据。'
doc={'openapi':'3.1.1','jsonSchemaDialect':'https://json-schema.org/draft/2020-12/schema',
 'info':{'title':manifest['name'],'version':manifest['version'],'description':'统一身份的当前账户资料。管理写接口、登录凭据交换和机器身份不在本契约范围内。'},
 'x-service-id':manifest['serviceId'],'x-app-id':manifest['appId'],'servers':[{'url':'/api'}],
 'security':[{'unifiedSession':[]},{'identityCookie':[]}],
 'paths':{'/auth/me':{'get':{'operationId':'me','summary':manifest['operations'][0]['summary'],'description':description,'responses':{
  '200':response(ref('CurrentIdentity'),'读取当前身份成功；生产响应禁止缓存'),
  **{str(status):response(ref('Error'),text) for status,text in [(401,'会话无效、过期、撤销或账户不可用'),(403,'统一出口拒绝应用授权或角色'),(500,'提供方未完成查询'),(502,'统一出口无法连接提供方'),(503,'服务未启用或未配置')]},
 }}}},'components':{'schemas':schemas,'securitySchemes':{
  'unifiedSession':{'type':'http','scheme':'bearer','description':'有效的统一身份中心会话令牌；统一出口代当前用户转发。'},
  'identityCookie':{'type':'apiKey','in':'cookie','name':'mg_identity_session','description':'身份站点同源 HttpOnly 会话 Cookie；不能由调用应用伪造用户标识替代。'},
 }}}
for name,value in [('openapi.json',doc),('registration.json',{'manifest':manifest,'contract':doc})]:
 (root/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('统一身份 1.1.0 本人资料契约已生成，尚未修改生产启用状态。')
