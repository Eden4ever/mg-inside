"""从已核对的提供方路由和数据模型编写契约；不修改发布目录和启用状态。"""
from pathlib import Path
import json

string={'type':'string'}
boolean={'type':'boolean'}
number={'type':'number','minimum':0}
integer={'type':'integer','minimum':0}
uuid={'type':'string','format':'uuid'}
date={'type':'string','format':'date-time'}
def obj(properties,required=None,closed=False):
 result={'type':'object','properties':properties,'required':list(properties) if required is None else required}
 if closed:result['additionalProperties']=False
 return result
def array(items):return {'type':'array','items':items}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def response(schema,description='请求成功'):return {'description':description,'content':{'application/json':{'schema':schema}}}
def parameter(name,location,schema,description='',required=False):return {'name':name,'in':location,'required':required,'description':description,'schema':schema}
def body(schema,required=True):return {'required':required,'content':{'application/json':{'schema':schema}}}
def base(app):
 manifest=json.loads(Path('../'+app+'/services/manifest.json').read_text(encoding='utf-8'))
 manifest['version']='1.1.0'
 doc={'openapi':'3.1.1','jsonSchemaDialect':'https://json-schema.org/draft/2020-12/schema','info':{'title':manifest['name'],'version':manifest['version'],'description':'提供方 /api 相对路由。统一出口由平台绑定，调用使用当前用户身份；写请求须携带当前会话的 X-CSRF-Token。'},'x-service-id':manifest['serviceId'],'x-app-id':manifest['appId'],'servers':[{'url':'/api'}],'security':[{'unifiedSession':[]}],'paths':{},'components':{'securitySchemes':{'unifiedSession':{'type':'http','scheme':'bearer','description':'由桌面统一出口转发的用户令牌；浏览器使用平台会话，不在页面持久保存令牌。'}},'schemas':{'Error':obj({'message':string})}}}
 for op in manifest['operations']:
  value={'operationId':op['operationId'],'summary':op['summary'],'responses':{code:response(ref('Error'),description) for code,description in [('400','参数无效'),('401','未登录或会话过期'),('403','无应用权限或 CSRF 校验失败'),('404','不存在或不属于当前账户'),('500','服务未完成请求')]}}
  params=[]
  if '{id}' in op['path']:params.append(parameter('id','path',uuid,'目标条目 ID',True))
  if op['method']!='GET':params.append(parameter('X-CSRF-Token','header',string,'当前用户会话的 CSRF 值',True))
  if params:value['parameters']=params
  doc['paths'].setdefault(op['path'],{})[op['method'].lower()]=value
 return manifest,doc
def operation(doc,opid):return next(op for path in doc['paths'].values() for op in path.values() if op['operationId']==opid)
def save(app,manifest,doc):
 path=Path('../'+app+'/services');(path/'openapi.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 # 登记包保留下一版本清单，现用清单待该应用验收发布时再提升。
 (path/'registration.json').write_text(json.dumps({'manifest':manifest,'contract':doc},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

m,d=base('mg-resource-one');s=d['components']['schemas']
s['Snapshot']=obj({'schemaVersion':{'const':1},'collectedAt':date,'hostname':string,'system':string,'cpuCount':number,'loadAverage':{**array(number),'minItems':3,'maxItems':3},'memoryTotal':number,'memoryAvailable':number,'diskTotal':number,'diskFree':number,'dockerAvailable':boolean,'containers':array(obj({k:string for k in ['Names','Image','State','Status']})),'services':array(obj({'name':string,'state':string})),'desktopRelease':{'type':['string','null']},'expertRelease':{'type':['string','null']}})
s['Observation']=obj({'snapshot':ref('Snapshot'),'attemptedAt':date,'error':{'type':['string','null']}},['attemptedAt','error'])
s['Pool']=obj({k:string for k in ['id','name','environment','description']})
resource={k:string for k in ['id','name','host','poolId','provider']}
resource.update({k:{'type':'null'} for k in ['cloudProduct','region','instanceId']})
resource.update({'deployments':array(obj({k:string for k in ['appId','name','domain','runtime','service']})),'observation':{'anyOf':[ref('Observation'),{'type':'null'}]},'collecting':boolean,'stale':boolean})
required=list(resource)
resource.update({'owner':string,'notes':string,'tags':array(string)})
s['Resource']=obj(resource,required,True)
s['Overview']=obj({'pools':array(ref('Pool')),'resources':array(ref('Resource')),'audit':array(obj({'id':uuid,'at':date,'actor':string,'action':string,'resourceId':uuid,'success':boolean})),'cloudApiConfigured':{'const':False}})
s['MetadataInput']=obj({'owner':{'type':'string','maxLength':100},'notes':{'type':'string','maxLength':2000},'tags':{'type':'array','maxItems':10,'items':{'type':'string','maxLength':30}},'poolId':{'type':'string','description':'必须是资源概览返回的资源池 ID'}})
for opid in ['overview','refresh','metadata']:operation(d,opid)['responses']['200']=response(ref('Overview'))
operation(d,'overview')['description']='读取共享资源台账及最新采集结果；仅授权资源管理员可用。observation 可为空，stale 表示采集数据超过五分钟或从未成功采集；不是服务健康结论。'
operation(d,'refresh')['description']='触发服务器采集并等待结果；采集失败仍返回 200 概览，须检查 observation.error。不会因为读取概览自动采集。'
operation(d,'metadata')['requestBody']=body(ref('MetadataInput'))
operation(d,'metadata')['responses']['413']=response(ref('Error'),'正文超过 8192 字节')
save('mg-resource-one',m,d)

m,d=base('mg-files-one');s=d['components']['schemas']
entry={'id':uuid,'parentId':{'type':['string','null']},'name':string,'kind':{'enum':['file','folder']},'size':integer,'mimeType':string,'preview':{'enum':['image','text','pdf','none']},'version':{'type':'integer','minimum':1},'favorite':boolean,'createdAt':date,'updatedAt':date}
required=list(entry)
entry.update({'protected':{'enum':['root','desktop']},'accessedAt':date,'officeAccessedAt':date,'deletedAt':date,'trashRootId':uuid})
s['Entry']=obj(entry,required,True)
s['FolderOption']=obj({**entry,'label':string},required+['label'],True)
s['Quota']=obj({'used':integer,'limit':integer,'maxFile':integer})
s['EntryPage']=obj({'items':array(ref('Entry')),'total':integer,'parentId':uuid,'rootId':uuid,'desktopFolderId':uuid,'breadcrumbs':array(ref('Entry')),'quota':ref('Quota')})
s['Ok']=obj({'ok':{'const':True}})
s['Name']={'type':'string','minLength':1,'maxLength':180,'description':'去除首尾空白后非空；不能是 . 或 ..，不能包含路径分隔符、控制字符、<>:"|?*，不能以点或空格结尾。'}
version={'type':'integer','minimum':1,'description':'可选乐观锁版本；提供时必须与当前版本一致，否则返回 409。'}
s['VersionInput']=obj({'version':version},[])
s['PatchInput']=obj({'name':ref('Name'),'favorite':boolean,'version':version},[])
operation(d,'me')['responses']['200']=response(obj({'id':string,'name':string,'username':string}))
operation(d,'desktop')['responses']['200']=response(obj({'folderId':uuid,'trashCount':integer,'items':array(ref('Entry'))}))
op=operation(d,'list');op['responses']['200']=response(ref('EntryPage'))
op['description']='仅返回当前账户的文件。recent 为文件应用访问历史；Office 独立打开历史由 Office 服务查询。文件夹优先，随后按指定字段排序。回收站只返回每次删除的根条目，配额包含回收站文件。'
op['parameters']=[parameter('view','query',{'enum':['files','favorites','recent','trash'],'default':'files'}),parameter('parentId','query',string,'默认根目录，也支持 desktop；所有视图均校验该文件夹归属。'),parameter('search','query',string,'名称包含匹配，忽略大小写，去除首尾空白。'),parameter('sort','query',{'enum':['name','size','updatedAt','accessedAt']},'默认 name；recent 默认 accessedAt。'),parameter('direction','query',string,'desc 为降序，其他值或省略为升序。'),parameter('page','query',{'type':'number','default':1},'最小按 1 处理。'),parameter('pageSize','query',{'type':'number','default':100},'限制在 1～200 之间。')]
operation(d,'folders')['responses']['200']=response(obj({'items':array(ref('FolderOption'))}))
operation(d,'createFolder')['requestBody']=body(obj({'parentId':uuid,'name':ref('Name')}))
operation(d,'createFolder')['responses']['201']=response(ref('Entry'),'文件夹已创建')
op=operation(d,'upload');op['parameters'] += [parameter('parentId','query',uuid,'目标文件夹',True),parameter('name','query',ref('Name'),'URL 编码后的文件名',True),parameter('Content-Length','header',integer,'文件字节长度，必须准确。浏览器由传输层自动设置。',True)]
op['requestBody']={'required':True,'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}};op['responses']['201']=response(ref('Entry'),'文件已保存；重名自动生成后缀')
op['responses']['411']=response(ref('Error'),'缺少有效 Content-Length');op['responses']['413']=response(ref('Error'),'单文件或账户配额不足')
operation(d,'get')['responses']['200']=response(ref('Entry'))
operation(d,'get')['description']='按当前账户查询元数据，返回值不包含 ownerId、storageKey 或磁盘路径；无法访问其他账户条目。'
operation(d,'content')['responses']['200']={'description':'原始文件内容；文件夹返回 400。','headers':{'Content-Disposition':{'description':'附件文件名（含 UTF-8 编码）','schema':string},'Content-Length':{'description':'原始字节数','schema':integer}},'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}}
operation(d,'patch')['requestBody']=body(ref('PatchInput'),False)
operation(d,'move')['requestBody']=body(obj({'parentId':uuid,'version':version},['parentId']))
for opid in ['restore','remove','permanent']:operation(d,opid)['requestBody']=body(ref('VersionInput'),False)
for opid in ['patch','move','restore']:operation(d,opid)['responses']['200']=response(ref('Entry'))
for opid in ['access','remove','permanent']:operation(d,opid)['responses']['200']=response(ref('Ok'))
for opid in ['patch','move','restore','remove','permanent','createFolder','upload']:operation(d,opid)['responses']['409']=response(ref('Error'),'版本冲突或名称冲突')
operation(d,'access')['description']='登记当前账户对条目的访问，不增加内容版本、不改变修改时间；不写入 Office 独立打开时间。'
operation(d,'restore')['description']='仅恢复回收站根条目及同批次子项；原父目录不存在时恢复到根目录，重名自动生成后缀。'
operation(d,'permanent')['description']='仅永久删除当前账户回收站根条目及同批次子项；不可恢复。'
save('mg-files-one',m,d)


m,d=base('mg-office-one');s=d['components']['schemas']
d['servers']=[{'url':'/api/office'}]
d['info']['description']='Office 能力由 Files 后端的 /api/office 提供；统一出口使用 office-one 应用授权。引擎文档读取与签名回调不作为通用服务登记。'
d['x-provider-app-id']='files'
file_schemas=json.loads(Path('../mg-files-one/services/openapi.json').read_text(encoding='utf-8'))['components']['schemas']
s['Entry']=file_schemas['Entry']
s['OfficeDocument']={**file_schemas['Entry'],'properties':{**file_schemas['Entry']['properties'],'editable':boolean},'required':file_schemas['Entry']['required']+['editable']}
s['SessionStatus']=obj({'savedAt':date,'version':{'type':'integer','minimum':1},'closed':boolean,'error':string,'savedRequests':{'type':'array','maxItems':32,'items':uuid}},['version','closed','savedRequests'])
s['EditorConfig']=obj({'documentType':{'enum':['word','cell','slide']},'type':{'const':'desktop'},'width':{'const':'100%'},'height':{'const':'100%'},'document':obj({'title':string,'fileType':{'enum':['docx','xlsx','pptx','doc','xls','ppt']},'key':string,'url':{'type':'string','format':'uri','description':'仅交给编辑引擎的签名读取 URL，包含临时凭据，不得记录或共享。'},'permissions':obj({'edit':boolean,'download':{'const':True},'print':{'const':True},'review':boolean})}),'editorConfig':obj({'mode':{'enum':['edit','view']},'lang':{'const':'zh-CN'},'callbackUrl':{'type':'string','format':'uri','description':'引擎专用签名回调地址，不通过公共服务出口调用。'},'user':obj({'id':string,'name':string}),'customization':obj({'forcesave':{'const':True},'autosave':{'const':True}})}),'token':{'type':'string','description':'编辑器配置签名，属于当前会话敏感数据，不在示例、日志或文档中回显。'}})
s['OpenedDocument']=obj({'sessionId':uuid,'file':ref('Entry'),'mode':{'enum':['edit','view']},'documentServerUrl':{'type':'string','format':'uri'},'config':ref('EditorConfig')})
s['SaveResponse']={'oneOf':[obj({'queued':{'const':True},'unchanged':{'const':False},'requestId':uuid}),obj({'queued':{'const':False},'unchanged':{'const':True},'requestId':uuid})]}
operation(d,'status')['responses']['200']=response(obj({'configured':boolean,'engine':{'const':'ONLYOFFICE Docs'},'maxFileBytes':integer}))
operation(d,'status')['description']='返回编辑服务是否已配置及单文件大小限制；configured 不代表引擎可达或健康。'
operation(d,'documents')['parameters']=[parameter('view','query',{'enum':['all','recent'],'default':'all'},'all 按修改时间倒序；recent 仅 Office 打开历史，按最近打开时间倒序。')]
operation(d,'documents')['responses']['200']=response(obj({'items':array(ref('OfficeDocument'))}))
operation(d,'documents')['description']='仅当前账户、未进入回收站的 Word/Excel/PowerPoint 文件。成功创建打开会话后才登记 officeAccessedAt，不影响修改时间或文件版本；不回填部署前未知历史。旧 doc/xls/ppt 格式只读。'
operation(d,'create')['requestBody']=body(obj({'format':{'enum':['docx','xlsx','pptx']}}))
operation(d,'create')['responses']['201']=response(ref('Entry'),'根据内置模板创建文件；同名自动生成后缀')
operation(d,'create')['description']='在当前账户文件根目录新建文档；受单文件大小、个人空间配额及 CSRF 校验约束。创建成功尚不代表已打开编辑器。'
operation(d,'open')['requestBody']=body(obj({'mode':{'enum':['edit','view'],'default':'edit'}},[]),False)
operation(d,'open')['responses']['200']=response(ref('OpenedDocument'))
operation(d,'open')['description']='为当前账户文件创建或复用八小时有效的会话，返回已签名编辑器配置。旧 doc/xls/ppt 即使请求 edit 也返回 view；同用户、文件、版本和模式复用未关闭会话。'
operation(d,'session')['responses']['200']=response(ref('SessionStatus'))
operation(d,'session')['description']='savedRequests 是文件已持久保存后由签名回调确认的最近 32 个请求 ID。不能仅凭 savedAt 或版本变化确认本次保存，也不能仅凭编辑器同步事件解除未保存保护。'
operation(d,'save')['responses']['200']=response(ref('SaveResponse'))
operation(d,'save')['description']='向引擎提交强制保存，queued=true 只表示已接受请求；须轮询 session，等待 savedRequests 包含本次 requestId。unchanged=true 表示引擎没有新内容，不是本次落盘证明。只读或关闭会话返回 409。请求正文不参与保存语义。'
for opid in ['create','open','save']:operation(d,opid)['responses']['503']=response(ref('Error'),'编辑服务未配置')
for opid in ['session','save']:operation(d,opid)['responses']['410']=response(ref('Error'),'会话不存在或已过期，需要重新打开文档')
for opid in ['create','open']:operation(d,opid)['responses']['413']=response(ref('Error'),'请求过大、单文件或账户配额不足')
operation(d,'open')['responses']['415']=response(ref('Error'),'不是支持的 Office 文件')
operation(d,'create')['responses']['409']=response(ref('Error'),'同名文件无法分配有效名称')
operation(d,'save')['responses']['409']=response(ref('Error'),'当前会话为只读或已关闭')
operation(d,'save')['responses']['502']=response(ref('Error'),'编辑服务拒绝保存或返回失败状态')
save('mg-office-one',m,d)
